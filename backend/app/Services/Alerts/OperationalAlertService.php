<?php

namespace App\Services\Alerts;

use App\Models\Counter;
use App\Models\Device;
use App\Models\Invoice;
use App\Models\Notification;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\SyncEvent;
use Illuminate\Support\Carbon;

/**
 * Operational alerts used to exist only while somebody had the notification drawer
 * open. That made the serious ones — a sale that drove the shelf negative, a discount
 * that gutted the margin, a counter that went dark mid-day — invisible until an owner
 * happened to look. This service both raises the event-driven alerts at the moment of
 * the sale and sweeps the time-based ones on a schedule, so the inbox tells the story
 * even when nobody is watching.
 */
class OperationalAlertService
{
    public const LARGE_DISCOUNT_PERCENT = 50.0;
    public const COUNTER_OFFLINE_MINUTES = 15;

    /**
     * Raise one alert per product whose batch is now below zero because of this bill.
     */
    public function negativeStockOnInvoice(Invoice $invoice, int $storeId): int
    {
        $invoice->loadMissing('items');
        $created = 0;

        foreach ($invoice->items as $item) {
            if (!$item->product_id) {
                continue;
            }

            $remaining = null;
            if ($item->batch_no) {
                $batch = ProductBatch::where('store_id', $storeId)
                    ->where('product_id', $item->product_id)
                    ->where('batch_no', $item->batch_no)
                    ->first();
                $remaining = $batch ? (float) $batch->stock_qty : null;
            }
            if ($remaining === null) {
                $remaining = (float) (Product::where('store_id', $storeId)
                    ->whereKey($item->product_id)
                    ->value('current_stock') ?? 0);
            }

            if ($remaining >= 0) {
                continue;
            }

            $existing = Notification::where('type', 'negative_stock')
                ->where('data->invoice_id', $invoice->id)
                ->where('data->product_id', $item->product_id)
                ->exists();
            if ($existing) {
                continue;
            }

            Notification::create([
                'store_id' => $storeId,
                'title' => "Negative Stock: {$item->product_name}",
                'message' => "Invoice {$invoice->invoice_number} sold '{$item->product_name}' beyond the shelf; {$remaining} units remain on hand.",
                'type' => 'negative_stock',
                'data' => [
                    'invoice_id' => $invoice->id,
                    'invoice_number' => $invoice->invoice_number,
                    'product_id' => $item->product_id,
                    'batch_no' => $item->batch_no,
                    'remaining' => $remaining,
                ],
            ]);
            $created++;
        }

        return $created;
    }

    /**
     * AUD-02: stock reaches the server by more roads than a bill — a till's stock-event
     * stream, a stock adjustment — and a shelf driven below zero by any of them is the
     * same problem. One alert per product per day, whichever road raised it first, so a
     * run of sales off an empty shelf does not bury the inbox.
     */
    public function negativeStockFromLedger(StockLedgerEntry $entry): int
    {
        if (!$entry->is_reconciled_negative || !$entry->product_id || (float) $entry->qty_delta >= 0) {
            return 0;
        }

        $alreadyRaised = Notification::where('type', 'negative_stock')
            ->where('store_id', $entry->store_id)
            ->where('data->product_id', (int) $entry->product_id)
            ->where('created_at', '>=', now()->subHours(24))
            ->exists();
        if ($alreadyRaised) {
            return 0;
        }

        $product = Product::where('store_id', $entry->store_id)->whereKey($entry->product_id)->first();
        $batch = $entry->batch_id ? ProductBatch::whereKey($entry->batch_id)->first() : null;
        $name = $product?->name ?? 'Unknown item';
        $remaining = (float) $entry->balance_after;
        $where = $entry->counter_code ? " on counter {$entry->counter_code}" : '';

        Notification::create([
            'store_id' => $entry->store_id,
            'title' => "Negative Stock: {$name}",
            'message' => "'{$name}'" . ($batch ? " (batch {$batch->batch_no})" : '')
                . " went below zero{$where}; {$remaining} units remain on hand.",
            'type' => 'negative_stock',
            'data' => [
                'product_id' => (int) $entry->product_id,
                'batch_id' => $entry->batch_id,
                'batch_no' => $batch?->batch_no,
                'remaining' => $remaining,
                'ledger_entry_id' => $entry->id,
                'reference_type' => $entry->reference_type,
                'reference_id' => $entry->reference_id,
                'counter_code' => $entry->counter_code,
            ],
        ]);

        return 1;
    }

    /**
     * Flag a bill whose line or header discount reaches the review threshold.
     */
    public function largeDiscountOnInvoice(Invoice $invoice, int $storeId): int
    {
        $invoice->loadMissing('items');
        $maxPercent = 0.0;
        $worstLine = null;

        foreach ($invoice->items as $item) {
            $units = ((float) $item->qty) * max(1.0, (float) ($item->units_per_pack ?: 1))
                + (float) $item->loose_qty;
            $gross = $units * (float) $item->unit_price;
            $discount = (float) $item->discount_amount;

            $percent = (float) $item->discount_percent;
            if ($gross > 0 && $discount > 0) {
                $percent = max($percent, ($discount / $gross) * 100);
            }

            if ($percent > $maxPercent) {
                $maxPercent = $percent;
                $worstLine = $item;
            }
        }

        $subtotal = (float) $invoice->subtotal;
        $discountTotal = (float) ($invoice->discount_total ?? 0);
        if ($subtotal > 0 && $discountTotal > 0) {
            $billPercent = ($discountTotal / $subtotal) * 100;
            if ($billPercent > $maxPercent) {
                $maxPercent = $billPercent;
                $worstLine = null;
            }
        }

        if ($maxPercent < self::LARGE_DISCOUNT_PERCENT) {
            return 0;
        }

        $existing = Notification::where('type', 'large_discount')
            ->where('data->invoice_id', $invoice->id)
            ->exists();
        if ($existing) {
            return 0;
        }

        $subject = $worstLine ? "'{$worstLine->product_name}'" : 'the bill';
        Notification::create([
            'store_id' => $storeId,
            'title' => 'Large Discount On Sale',
            'message' => sprintf(
                'Invoice %s gives %s a %.1f%% discount, at or above the %.0f%% review threshold.',
                $invoice->invoice_number,
                $subject,
                $maxPercent,
                self::LARGE_DISCOUNT_PERCENT
            ),
            'type' => 'large_discount',
            'data' => [
                'invoice_id' => $invoice->id,
                'invoice_number' => $invoice->invoice_number,
                'discount_percent' => round($maxPercent, 2),
                'product_id' => $worstLine?->product_id,
            ],
        ]);

        return 1;
    }

    /**
     * PAY-03/PAY-04 — a bill a till rang up offline that breaks a store payment rule
     * (walk-in left owing, credit over limit, reference missing) is booked as it
     * happened, so the owner is told instead. One alert per bill; a re-push of the
     * same bill does not raise it again.
     *
     * @param array<int,string> $exceptions
     */
    public function offlinePaymentPolicyException(Invoice $invoice, array $exceptions): int
    {
        $exceptions = array_values(array_unique(array_filter($exceptions)));
        if ($exceptions === []) {
            return 0;
        }

        \App\Models\AuditLog::log(
            'offline_bill_policy_exception',
            'Invoice',
            (string) $invoice->id,
            null,
            [
                'invoice_number' => $invoice->invoice_number,
                'counter_code' => $invoice->counter_code,
                'exceptions' => $exceptions,
            ],
            (int) $invoice->store_id
        );

        $existing = Notification::where('type', 'offline_payment_policy')
            ->where('data->invoice_id', $invoice->id)
            ->exists();
        if ($existing) {
            return 0;
        }

        Notification::create([
            'store_id' => $invoice->store_id,
            'title' => 'Offline Bill Broke A Payment Rule',
            'message' => sprintf(
                'Invoice %s%s was rung up offline and booked as it happened: %s',
                $invoice->invoice_number,
                $invoice->counter_code ? " (counter {$invoice->counter_code})" : '',
                implode(' ', $exceptions)
            ),
            'type' => 'offline_payment_policy',
            'data' => [
                'invoice_id' => $invoice->id,
                'invoice_number' => $invoice->invoice_number,
                'exceptions' => $exceptions,
            ],
        ]);

        return 1;
    }

    /**
     * Time-based checks. The admin drawer and the scheduled sweep both call this, so a
     * counter that goes dark at 2 p.m. is reported even if nobody opens the panel.
     */
    public function sweep(?int $storeId = null): int
    {
        $created = 0;

        $lowStockProducts = Product::where('is_active', true)
            ->whereColumn('current_stock', '<=', 'reorder_level')
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->limit(5)
            ->get();

        foreach ($lowStockProducts as $p) {
            $existing = Notification::where('type', 'stock_low')
                ->where('data->product_id', $p->id)
                ->where('created_at', '>=', now()->subHours(24))
                ->exists();

            if (!$existing) {
                Notification::create([
                    'store_id' => $p->store_id,
                    'title' => "Low Stock Alert: {$p->name}",
                    'message' => "Current stock ({$p->current_stock}) has dropped below or reached reorder level ({$p->reorder_level}).",
                    'type' => 'stock_low',
                    'data' => ['product_id' => $p->id, 'current_stock' => $p->current_stock],
                ]);
                $created++;
            }
        }

        $expiringBatches = ProductBatch::with('product')
            ->where('stock_qty', '>', 0)
            ->whereDate('expiry_date', '<=', Carbon::now()->addDays(30))
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->limit(5)
            ->get();

        foreach ($expiringBatches as $b) {
            $existing = Notification::where('type', 'expiry')
                ->where('data->batch_id', $b->id)
                ->where('created_at', '>=', now()->subHours(24))
                ->exists();

            if (!$existing) {
                $pName = $b->product ? $b->product->name : 'Unknown Item';
                Notification::create([
                    'store_id' => $b->store_id,
                    'title' => "Expiry Warning: {$pName} (Batch {$b->batch_no})",
                    'message' => "Batch expires on {$b->expiry_date->toDateString()}. Remaining stock: {$b->stock_qty} units.",
                    'type' => 'expiry',
                    'data' => ['batch_id' => $b->id, 'expiry_date' => $b->expiry_date],
                ]);
                $created++;
            }
        }

        $offlineDevices = Device::where('status', 'active')
            ->where('last_seen_at', '<=', Carbon::now()->subHours(2))
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->get();

        foreach ($offlineDevices as $d) {
            $existing = Notification::where('type', 'store_offline')
                ->where('data->device_id', $d->id)
                ->where('created_at', '>=', now()->subHours(12))
                ->exists();

            if (!$existing) {
                Notification::create([
                    'store_id' => $d->store_id,
                    'title' => 'Workstation Offline Alert',
                    'message' => "Device '{$d->device_name}' has been offline for over 2 hours. Last seen: {$d->last_seen_at}.",
                    'type' => 'store_offline',
                    'data' => ['device_id' => $d->id],
                ]);
                $created++;
            }
        }

        // A counter is the thing a cashier actually works at, and it can stop syncing
        // long before its device looks dead, so it gets its own, shorter window.
        $offlineCounters = Counter::where('status', Counter::STATUS_ACTIVE)
            ->whereNotNull('last_seen_at')
            ->where('last_seen_at', '<=', Carbon::now()->subMinutes(self::COUNTER_OFFLINE_MINUTES))
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->get();

        foreach ($offlineCounters as $counter) {
            $existing = Notification::where('type', 'counter_offline')
                ->where('data->counter_id', $counter->id)
                ->where('created_at', '>=', now()->subHours(6))
                ->exists();

            if (!$existing) {
                Notification::create([
                    'store_id' => $counter->store_id,
                    'title' => "Counter Offline: {$counter->counter_code}",
                    'message' => "Counter {$counter->counter_code} ({$counter->counter_name}) has not checked in for over " . self::COUNTER_OFFLINE_MINUTES . ' minutes. Last seen: ' . $counter->last_seen_at . '.',
                    'type' => 'counter_offline',
                    'data' => ['counter_id' => $counter->id],
                ]);
                $created++;
            }
        }

        $syncFailures = SyncEvent::where('status', 'failed')
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->where('created_at', '>=', now()->subHours(24))
            ->count();

        if ($syncFailures > 0) {
            $existing = Notification::where('type', 'sync_failure')
                ->where('created_at', '>=', now()->subHours(6))
                ->exists();

            if (!$existing) {
                Notification::create([
                    'store_id' => $storeId,
                    'title' => 'Cloud Sync Failures Detected',
                    'message' => "{$syncFailures} sync operations have failed in the last 24 hours. Please review the Sync Center.",
                    'type' => 'sync_failure',
                    'data' => ['failed_count' => $syncFailures],
                ]);
                $created++;
            }
        }

        return $created;
    }
}
