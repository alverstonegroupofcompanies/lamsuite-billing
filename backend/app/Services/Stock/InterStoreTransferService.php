<?php

namespace App\Services\Stock;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\TransferProductMapping;
use App\Models\User;
use App\Services\Catalog\StoreCatalogCopyService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Inter-store stock transfers under P-STORE-SCOPE.
 *
 * The source and destination stores have independent product catalogs, so a
 * dispatched line references the SOURCE store's product and receive must
 * resolve each line to the DESTINATION store's own product (explicit choice →
 * remembered store-pair mapping → barcode → external_id → auto-create).
 * Dispatch and receive each write their own store's ledger rows.
 */
class InterStoreTransferService
{
    public function __construct(private StoreCatalogCopyService $catalogCopy)
    {
    }

    /**
     * @param array<int, array{product_id: mixed, batch_no: string, qty: numeric}> $lines
     */
    public function dispatch(
        int $fromStoreId,
        int $toStoreId,
        array $lines,
        ?User $user,
        ?string $transferNo = null,
        ?string $notes = null
    ): StockTransfer {
        if ($fromStoreId === $toStoreId) {
            throw ValidationException::withMessages([
                'to_store_id' => 'Destination store must differ from the sending store.',
            ]);
        }

        $resolvedLines = [];
        foreach ($lines as $line) {
            $product = $this->sourceProduct($line['product_id'] ?? null, $fromStoreId);
            if (!$product) {
                throw ValidationException::withMessages([
                    'lines' => sprintf(
                        'Product %s does not belong to the sending store. Transfers can only dispatch this store\'s own products.',
                        is_scalar($line['product_id'] ?? null) ? (string) $line['product_id'] : '(missing)'
                    ),
                ]);
            }

            $batch = ProductBatch::where('store_id', $fromStoreId)
                ->where('product_id', $product->id)
                ->where('batch_no', $line['batch_no'] ?? '')
                ->first();
            if (!$batch) {
                throw ValidationException::withMessages([
                    'lines' => sprintf('Batch %s not found for %s in the sending store.', $line['batch_no'] ?? '?', $product->name),
                ]);
            }

            $qty = round((float) ($line['qty'] ?? 0), 3);
            if ($qty <= 0) {
                throw ValidationException::withMessages(['lines' => 'Transfer quantity must be greater than zero.']);
            }
            if ((float) $batch->stock_qty < $qty) {
                throw ValidationException::withMessages([
                    'lines' => sprintf(
                        'Insufficient stock for %s (batch %s): requested %s, available %s.',
                        $product->name,
                        $batch->batch_no,
                        $qty,
                        (float) $batch->stock_qty
                    ),
                ]);
            }

            $resolvedLines[] = ['product' => $product, 'batch' => $batch, 'qty' => $qty];
        }

        if ($resolvedLines === []) {
            throw ValidationException::withMessages(['lines' => 'At least one transfer line is required.']);
        }

        return DB::transaction(function () use ($fromStoreId, $toStoreId, $resolvedLines, $user, $transferNo, $notes) {
            $transfer = StockTransfer::create([
                'from_store_id' => $fromStoreId,
                'to_store_id' => $toStoreId,
                'transfer_number' => $transferNo ?: $this->nextTransferNumber(),
                'status' => 'dispatched',
                'notes' => $notes,
                'created_by' => $user?->id,
            ]);

            foreach ($resolvedLines as $i => $resolved) {
                $product = $resolved['product'];
                $batch = $resolved['batch'];
                $qty = $resolved['qty'];

                StockTransferItem::create([
                    'stock_transfer_id' => $transfer->id,
                    'store_id' => $fromStoreId,
                    'product_id' => $product->id,
                    'batch_no' => $batch->batch_no,
                    'qty' => $qty,
                ]);

                $newBalance = round((float) $batch->stock_qty - $qty, 3);
                $batch->update(['stock_qty' => $newBalance]);
                $this->syncProductStock($product->id, $fromStoreId);

                StockLedgerEntry::firstOrCreate(
                    ['idempotency_key' => 'trf_out_' . $transfer->transfer_number . '_' . ($i + 1)],
                    [
                        'store_id' => $fromStoreId,
                        'product_id' => $product->id,
                        'batch_id' => $batch->id,
                        'event_type' => 'TRANSFER_OUT',
                        'qty_delta' => -$qty,
                        'reference_type' => 'STOCK_TRANSFER',
                        'reference_id' => $transfer->transfer_number,
                        'balance_after' => $newBalance,
                        'staff_user_id' => $user?->id,
                    ]
                );
            }

            AuditLog::log(
                'dispatch_transfer',
                'StockTransfer',
                (string) $transfer->id,
                null,
                ['transfer_number' => $transfer->transfer_number, 'lines' => count($resolvedLines)],
                $fromStoreId,
                $user?->id
            );

            return $transfer->load('items');
        });
    }

    /**
     * Receive a dispatched transfer at its destination store.
     *
     * @param array<int, array{item_id: mixed, dest_product_id?: mixed}> $lineInstructions
     * @param bool $autoCreate create missing destination products as independent copies
     * @return array{transfer: StockTransfer, resolutions: array<int, array>}
     */
    public function receive(StockTransfer $transfer, ?User $user, array $lineInstructions = [], bool $autoCreate = false): array
    {
        if ($transfer->status !== 'dispatched') {
            throw ValidationException::withMessages([
                'transfer' => sprintf('Only dispatched transfers can be received (current status: %s).', $transfer->status),
            ]);
        }

        $instructionsByItem = [];
        foreach ($lineInstructions as $instruction) {
            if (isset($instruction['item_id'])) {
                $instructionsByItem[(string) $instruction['item_id']] = $instruction['dest_product_id'] ?? null;
            }
        }

        $resolutions = [];
        foreach ($transfer->items()->orderBy('id')->get() as $item) {
            $sourceProduct = Product::where('store_id', $transfer->from_store_id)->find($item->product_id);
            $sourceBatch = ProductBatch::where('store_id', $transfer->from_store_id)
                ->where('product_id', $item->product_id)
                ->where('batch_no', $item->batch_no)
                ->first();

            $destProduct = $this->resolveDestinationProduct(
                $transfer->from_store_id,
                $transfer->to_store_id,
                $item,
                $instructionsByItem[(string) $item->id] ?? null,
                $autoCreate,
                $user
            );

            $resolutions[] = [
                'item_id' => $item->id,
                'source_product_id' => $item->product_id,
                'dest_product_id' => $destProduct?->id,
                'dest_product_name' => $destProduct?->name,
                'qty' => (float) $item->qty,
                'batch_no' => $item->batch_no,
            ];

            if (!$destProduct) {
                throw ValidationException::withMessages([
                    'lines' => array_map(
                        fn (array $r) => sprintf(
                            'No product in this store matches "%s" (barcode %s, batch %s). Map it to one of your products or allow create-in-my-store.',
                            $sourceProduct?->name ?? ('#' . $item->product_id),
                            $sourceProduct?->barcode ?? '—',
                            $item->batch_no
                        ),
                        array_filter($resolutions, fn (array $r) => $r['dest_product_id'] === null)
                    ),
                ]);
            }
        }

        return DB::transaction(function () use ($transfer, $user, $resolutions) {
            foreach ($resolutions as $resolution) {
                $item = StockTransferItem::where('stock_transfer_id', $transfer->id)
                    ->where('id', $resolution['item_id'])
                    ->first();
                if (!$item) {
                    continue;
                }

                // @store-scope-ok: dest id resolved to the receiving store's product above
                $destProduct = Product::find($resolution['dest_product_id']);
                $sourceBatch = ProductBatch::where('store_id', $transfer->from_store_id)
                    ->where('product_id', $item->product_id)
                    ->where('batch_no', $item->batch_no)
                    ->first();

                $ledgerKey = 'trf_in_' . $transfer->transfer_number . '_' . $item->id;
                if (StockLedgerEntry::where('idempotency_key', $ledgerKey)->exists()) {
                    continue;
                }

                $destBatch = ProductBatch::firstOrCreate(
                    [
                        'store_id' => $transfer->to_store_id,
                        'product_id' => $destProduct->id,
                        'batch_no' => $item->batch_no,
                    ],
                    [
                        'expiry_date' => $sourceBatch?->expiry_date ?? now()->addYear()->toDateString(),
                        'stock_qty' => 0,
                        'mrp' => $sourceBatch?->mrp ?? $destProduct->mrp,
                        'purchase_rate' => $sourceBatch?->purchase_rate ?? 0,
                        'selling_rate' => $sourceBatch?->selling_rate ?? $destProduct->sel_rate,
                        'version' => 1,
                    ]
                );

                $newBalance = round((float) $destBatch->stock_qty + (float) $item->qty, 3);
                $destBatch->update(['stock_qty' => $newBalance]);
                $this->syncProductStock($destProduct->id, $transfer->to_store_id);

                StockLedgerEntry::firstOrCreate(
                    ['idempotency_key' => $ledgerKey],
                    [
                        'store_id' => $transfer->to_store_id,
                        'product_id' => $destProduct->id,
                        'batch_id' => $destBatch->id,
                        'event_type' => 'TRANSFER_IN',
                        'qty_delta' => (float) $item->qty,
                        'reference_type' => 'STOCK_TRANSFER',
                        'reference_id' => $transfer->transfer_number,
                        'balance_after' => $newBalance,
                        'staff_user_id' => $user?->id,
                    ]
                );
            }

            $transfer->update([
                'status' => 'received',
                'approved_by' => $user?->id,
                'received_at' => now(),
            ]);

            AuditLog::log(
                'receive_transfer',
                'StockTransfer',
                (string) $transfer->id,
                ['status' => 'dispatched'],
                ['status' => 'received', 'resolutions' => $resolutions],
                $transfer->to_store_id,
                $user?->id
            );

            return ['transfer' => $transfer->load('items'), 'resolutions' => $resolutions];
        });
    }

    public function cancel(StockTransfer $transfer, ?User $user, string $reason = ''): StockTransfer
    {
        if ($transfer->status !== 'dispatched') {
            throw ValidationException::withMessages([
                'transfer' => sprintf('Only dispatched transfers can be cancelled (current status: %s).', $transfer->status),
            ]);
        }

        return DB::transaction(function () use ($transfer, $user, $reason) {
            foreach ($transfer->items()->orderBy('id')->get() as $i => $item) {
                $batch = ProductBatch::where('store_id', $transfer->from_store_id)
                    ->where('product_id', $item->product_id)
                    ->where('batch_no', $item->batch_no)
                    ->first();

                if ($batch) {
                    $newBalance = round((float) $batch->stock_qty + (float) $item->qty, 3);
                    $batch->update(['stock_qty' => $newBalance]);
                    $this->syncProductStock($item->product_id, $transfer->from_store_id);

                    StockLedgerEntry::firstOrCreate(
                        ['idempotency_key' => 'trf_cnl_' . $transfer->transfer_number . '_' . $item->id],
                        [
                            'store_id' => $transfer->from_store_id,
                            'product_id' => $item->product_id,
                            'batch_id' => $batch->id,
                            'event_type' => 'TRANSFER_CANCEL',
                            'qty_delta' => (float) $item->qty,
                            'reference_type' => 'STOCK_TRANSFER',
                            'reference_id' => $transfer->transfer_number,
                            'balance_after' => $newBalance,
                            'staff_user_id' => $user?->id,
                        ]
                    );
                }
            }

            $transfer->update(['status' => 'cancelled']);

            AuditLog::log(
                'cancel_transfer',
                'StockTransfer',
                (string) $transfer->id,
                ['status' => 'dispatched'],
                ['status' => 'cancelled', 'reason' => $reason],
                $transfer->from_store_id,
                $user?->id
            );

            return $transfer->load('items');
        });
    }

    /**
     * Resolve a dispatched line to the destination store's own product.
     * Order: explicit instruction → remembered store-pair mapping → barcode →
     * external_id → (optionally) create an independent copy.
     */
    private function sourceProduct($identifier, int $fromStoreId): ?Product
    {
        if ($identifier === null || $identifier === '') {
            return null;
        }

        if (is_numeric($identifier)) {
            return Product::where('store_id', $fromStoreId)->find((int) $identifier);
        }

        return Product::where('store_id', $fromStoreId)->where('external_id', (string) $identifier)->first();
    }

    /**
     * Apply dispatch stock effects to an already-persisted transfer row
     * (offline sync path). Idempotent per line via the ledger key.
     */
    public function applyDispatchEffects(StockTransfer $transfer, ?User $user): void
    {
        if ($transfer->status !== 'dispatched') {
            return;
        }

        foreach ($transfer->items()->orderBy('id')->get() as $i => $item) {
            $ledgerKey = 'trf_out_' . $transfer->transfer_number . '_' . ($i + 1);
            if (StockLedgerEntry::where('idempotency_key', $ledgerKey)->exists()) {
                continue;
            }

            $batch = ProductBatch::where('store_id', $transfer->from_store_id)
                ->where('product_id', $item->product_id)
                ->where('batch_no', $item->batch_no)
                ->first();
            if (!$batch) {
                continue;
            }

            $newBalance = round((float) $batch->stock_qty - (float) $item->qty, 3);
            $batch->update(['stock_qty' => $newBalance]);
            $this->syncProductStock($item->product_id, $transfer->from_store_id);

            StockLedgerEntry::firstOrCreate(
                ['idempotency_key' => $ledgerKey],
                [
                    'store_id' => $transfer->from_store_id,
                    'product_id' => $item->product_id,
                    'batch_id' => $batch->id,
                    'event_type' => 'TRANSFER_OUT',
                    'qty_delta' => -(float) $item->qty,
                    'reference_type' => 'STOCK_TRANSFER',
                    'reference_id' => $transfer->transfer_number,
                    'balance_after' => $newBalance,
                    'staff_user_id' => $user?->id,
                ]
            );
        }

        AuditLog::log(
            'dispatch_transfer',
            'StockTransfer',
            (string) $transfer->id,
            null,
            ['transfer_number' => $transfer->transfer_number, 'source' => 'offline_sync'],
            $transfer->from_store_id,
            $user?->id
        );
    }

    private function resolveDestinationProduct(
        int $fromStoreId,
        int $toStoreId,
        StockTransferItem $item,
        $explicitDestProductId,
        bool $autoCreate,
        ?User $user
    ): ?Product {
        $explicit = null;
        if ($explicitDestProductId !== null && $explicitDestProductId !== '') {
            // @store-scope-ok: an explicit receiving-store choice, validated to belong to that store
            $explicit = Product::where('store_id', $toStoreId)->find((int) $explicitDestProductId);
            if ($explicit) {
                $this->rememberMapping($fromStoreId, $toStoreId, $item->product_id, $explicit->id, 'manual', $user);

                return $explicit;
            }
        }

        $mapping = TransferProductMapping::where('from_store_id', $fromStoreId)
            ->where('to_store_id', $toStoreId)
            ->where('source_product_id', $item->product_id)
            ->first();
        if ($mapping) {
            // @store-scope-ok: dest_product_id is a remembered receiving-store choice
            $mapped = Product::where('store_id', $toStoreId)->find($mapping->dest_product_id);
            if ($mapped) {
                return $mapped;
            }
        }

        $sourceProduct = Product::where('store_id', $fromStoreId)->find($item->product_id);
        if (!$sourceProduct) {
            return null;
        }

        if ($sourceProduct->barcode) {
            $byBarcode = Product::where('store_id', $toStoreId)->where('barcode', $sourceProduct->barcode)->first();
            if ($byBarcode) {
                $this->rememberMapping($fromStoreId, $toStoreId, $item->product_id, $byBarcode->id, 'barcode', $user);

                return $byBarcode;
            }
        }

        if ($sourceProduct->external_id) {
            $byExternal = Product::where('store_id', $toStoreId)->where('external_id', $sourceProduct->external_id)->first();
            if ($byExternal) {
                $this->rememberMapping($fromStoreId, $toStoreId, $item->product_id, $byExternal->id, 'external_id', $user);

                return $byExternal;
            }
        }

        if ($autoCreate) {
            $created = $this->catalogCopy->createCopy($sourceProduct, $toStoreId, $user?->id);
            $this->rememberMapping($fromStoreId, $toStoreId, $item->product_id, $created->id, 'auto_create', $user);

            return $created;
        }

        return null;
    }

    private function rememberMapping(
        int $fromStoreId,
        int $toStoreId,
        int $sourceProductId,
        int $destProductId,
        string $matchedBy,
        ?User $user
    ): void {
        TransferProductMapping::firstOrCreate(
            [
                'from_store_id' => $fromStoreId,
                'to_store_id' => $toStoreId,
                'source_product_id' => $sourceProductId,
            ],
            [
                'dest_product_id' => $destProductId,
                'matched_by' => $matchedBy,
                'created_by' => $user?->id,
            ]
        );
    }

    private function syncProductStock(int $productId, int $storeId): void
    {
        $total = (float) ProductBatch::where('store_id', $storeId)->where('product_id', $productId)->sum('stock_qty');
        // @store-scope-ok: product id resolved against this store's batches above
        Product::where('store_id', $storeId)->where('id', $productId)->update(['current_stock' => $total]);
    }

    private function nextTransferNumber(): string
    {
        do {
            $candidate = 'TRF-' . date('Ymd') . '-' . strtoupper(Str::random(6));
        } while (StockTransfer::where('transfer_number', $candidate)->exists());

        return $candidate;
    }
}
