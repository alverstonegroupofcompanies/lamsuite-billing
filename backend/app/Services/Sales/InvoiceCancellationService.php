<?php

namespace App\Services\Sales;

use App\Models\Invoice;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\SyncEvent;
use App\Services\Payments\GiftCardService;
use App\Services\Webhook\WebhookOutboxService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The one place a sale is reversed. Both POST /api/invoices/{id}/cancel and the offline
 * sync queue go through here so a cancelled bill keeps its booked money and loses its
 * tender/stock the same way whether it was cancelled live or from a disconnected till.
 */
class InvoiceCancellationService
{
    public function cancel(Invoice $invoice, string $reason, ?int $userId = null): Invoice
    {
        $invoice->load('items');

        DB::transaction(function () use ($invoice, $reason, $userId) {
            $invoice->update([
                'status' => 'cancelled',
                'cancel_reason' => $reason,
                'cancelled_at' => now(),
                'cancelled_by' => $userId,
            ]);

            // Revert customer credit balance if any
            $creditRefund = $invoice->payments()->where('payment_mode', 'Credit')->sum('amount');
            if ($creditRefund <= 0 && strtolower((string) $invoice->payment_mode) === 'credit') {
                $creditRefund = (float) $invoice->grand_total;
            }
            if ($creditRefund > 0 && $invoice->customer_id) {
                $customer = Party::find($invoice->customer_id);
                if ($customer) {
                    $customer->decrement('current_balance', $creditRefund);
                }
            }

            // Mark associated payments refunded
            $invoice->payments()->update(['status' => 'refunded']);

            $this->refundGiftCardTenders($invoice, $userId);
            $this->restoreStock($invoice);

            SyncEvent::create([
                'store_id' => $invoice->store_id,
                'entity_type' => 'invoice',
                'entity_id' => (string) $invoice->id,
                'action' => 'cancel',
                'client_data' => [
                    'id' => $invoice->id,
                    'invoice_number' => $invoice->invoice_number,
                    'status' => 'cancelled',
                ],
                'status' => 'resolved',
            ]);
        });

        app(WebhookOutboxService::class)->enqueue(
            'invoice.cancelled',
            [
                'id' => $invoice->id,
                'invoice_number' => $invoice->invoice_number,
                'grand_total' => (float) $invoice->grand_total,
                'customer_id' => $invoice->customer_id,
                'reason' => $reason,
                'cancelled_at' => optional($invoice->cancelled_at)->toIso8601String() ?? now()->toIso8601String(),
            ],
            $invoice->store_id,
            'invoice',
            (string) $invoice->id
        );

        return $invoice;
    }

    private function refundGiftCardTenders(Invoice $invoice, ?int $userId): void
    {
        $giftCardService = app(GiftCardService::class);
        foreach ($invoice->payments as $payment) {
            $mode = strtoupper(trim((string) $payment->payment_mode));
            if (!in_array($mode, ['GIFT CARD', 'GIFT VOUCHER', 'GIFT_VOUCHER', 'GIFT_CARD', 'GIFTCARD'], true)) {
                continue;
            }
            $extra = is_array($payment->extra_fields) ? $payment->extra_fields : [];
            $code = $extra['gift_card_code'] ?? $payment->reference_no ?? null;
            if (!$code) {
                continue;
            }
            try {
                $giftCardService->refund($invoice->store_id, (string) $code, (float) $payment->amount, $invoice->id, $userId);
            } catch (\Throwable $e) {
                Log::warning('[GiftCard] Refund on cancellation failed', [
                    'invoice_id' => $invoice->id,
                    'payment_id' => $payment->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function restoreStock(Invoice $invoice): void
    {
        // A credit note already put its units back when it was booked, so cancelling one has to take
        // them off again; restoring in both directions quietly inflates the shelf on every voided
        // return.
        $module = strtolower((string) $invoice->module_key);
        $inward = in_array($module, ['credit_note', 'sales_return', 'debit_note'], true) ? -1.0 : 1.0;

        foreach ($invoice->items as $item) {
            if (!$item->product_id) {
                continue;
            }
            // A discarded or quarantined return line never reached the shelf, so voiding the note
            // that booked it has nothing to take back for that line.
            if ($inward < 0 && !$item->restocksShelf()) {
                continue;
            }

            $product = Product::find($item->product_id);
            $batch = null;
            if ($item->batch_no) {
                $batch = ProductBatch::where('store_id', $invoice->store_id)
                    ->where('product_id', $item->product_id)
                    ->where('batch_no', $item->batch_no)
                    ->lockForUpdate()
                    ->first();
            }

            // A line is billed in packs plus loose pieces, so the reversal has to return the
            // same base units the sale took — restoring only `qty` leaves multi-unit packs short.
            $unitsPerPack = max(1, (float) ($item->units_per_pack ?: 1));
            $qty = round(((float) $item->qty + (float) $item->free_qty) * $unitsPerPack
                + (float) $item->loose_qty + (float) $item->free_loose_qty, 4) * $inward;
            if ($batch) {
                $batch->increment('stock_qty', $qty);
            }
            if ($product) {
                $product->increment('current_stock', $qty);
            }

            StockLedgerEntry::create([
                'store_id' => $invoice->store_id,
                'product_id' => $item->product_id,
                'batch_id' => $batch ? $batch->id : null,
                'counter_id' => $invoice->counter_id,
                'counter_code' => $invoice->counter_code,
                'location_name' => $invoice->location_name,
                'event_type' => $inward < 0 ? 'CREDIT_NOTE_CANCEL' : 'CANCEL_RESTORE',
                'qty_delta' => $qty,
                'reference_type' => 'INVOICE_CANCEL',
                'reference_id' => (string) $invoice->id,
                'balance_after' => $batch ? $batch->stock_qty : 0,
            ]);

            // Broadcast stock restoration to all counters
            SyncEvent::create([
                'store_id' => $invoice->store_id,
                'entity_type' => 'stock_event',
                'entity_id' => (string) ($batch ? $batch->id : $item->product_id),
                'action' => 'update',
                'client_data' => [
                    'product_id' => $item->product_id,
                    'batch_id' => $batch ? $batch->id : null,
                    'batch_no' => $item->batch_no,
                    'remaining_stock' => $batch ? $batch->stock_qty : null,
                    'qty_delta' => $qty,
                    'reference_id' => "CANCEL-{$invoice->invoice_number}",
                ],
                'status' => 'resolved',
            ]);
        }
    }
}
