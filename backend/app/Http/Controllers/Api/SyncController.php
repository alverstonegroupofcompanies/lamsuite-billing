<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;

class SyncController
{
    /**
     * Idempotent push of offline invoices from desktop client.
     */
    public function pushInvoices(Request $request): JsonResponse
    {
        $invoicesData = $request->input('invoices', []);
        $ingested = 0;
        $failed = 0;

        DB::beginTransaction();
        try {
            foreach ($invoicesData as $inv) {
                $externalId = $inv['external_id'] ?? $inv['idempotency_key'] ?? null;
                if (!$externalId) continue;

                // Idempotent upsert by external_id
                Invoice::updateOrCreate(
                    ['external_id' => $externalId],
                    [
                        'module_key' => $inv['module_key'] ?? 'invoice',
                        'invoice_number' => $inv['invoice_number'],
                        'invoice_date' => $inv['invoice_date'],
                        'customer_id' => $inv['customer_id'] ?? null,
                        'customer_name' => $inv['customer_name'] ?? 'Walk-in Customer',
                        'customer_gstin' => $inv['customer_gstin'] ?? null,
                        'place_of_supply' => $inv['place_of_supply'] ?? null,
                        'subtotal' => $inv['subtotal'] ?? 0,
                        'discount_total' => $inv['discount_total'] ?? 0,
                        'tax_total' => $inv['tax_total'] ?? 0,
                        'round_off' => $inv['round_off'] ?? 0,
                        'grand_total' => $inv['grand_total'] ?? 0,
                        'paid_amount' => $inv['paid_amount'] ?? 0,
                        'payment_mode' => $inv['payment_mode'] ?? 'Cash',
                        'status' => $inv['status'] ?? 'issued',
                        'patient_name' => $inv['patient_name'] ?? null,
                        'doctor_name' => $inv['doctor_name'] ?? null,
                        'doctor_reg_no' => $inv['doctor_reg_no'] ?? null,
                        'synced_at' => now(),
                    ]
                );
                $ingested++;
            }
            DB::commit();

            return response()->json([
                'success' => true,
                'ingested_count' => $ingested,
                'failed_count' => $failed,
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Idempotent push of stock transactions from desktop client.
     */
    public function pushStockEvents(Request $request): JsonResponse
    {
        $events = $request->input('events', []);
        $ingested = 0;

        DB::beginTransaction();
        try {
            foreach ($events as $event) {
                DB::table('stock_transactions')->updateOrInsert(
                    ['id' => $event['id']],
                    [
                        'product_id' => $event['product_id'],
                        'batch_id' => $event['batch_id'] ?? null,
                        'event_type' => $event['event_type'],
                        'qty_delta' => $event['qty_delta'],
                        'reference_type' => $event['reference_type'] ?? null,
                        'reference_id' => $event['reference_id'] ?? null,
                        'created_at' => $event['created_at'] ?? now(),
                    ]
                );
                $ingested++;
            }
            DB::commit();

            return response()->json([
                'success' => true,
                'ingested_count' => $ingested,
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Pull master deltas updated since watermark timestamp.
     */
    public function pullDeltas(Request $request): JsonResponse
    {
        $watermark = $request->input('since_watermark', 0);
        $sinceDate = date('Y-m-d H:i:s', $watermark / 1000);

        $products = Product::where('updated_at', '>=', $sinceDate)->get();
        $batches = ProductBatch::where('updated_at', '>=', $sinceDate)->get();

        return response()->json([
            'watermark' => (int) (microtime(true) * 1000),
            'products' => $products,
            'batches' => $batches,
            'parties' => [],
        ]);
    }
}
