<?php

namespace App\Support;

use App\Models\Invoice;
use App\Models\MasterLookup;
use App\Models\Product;
use App\Models\Store;
use Illuminate\Support\Collection;

/**
 * GAP-02 / PHR-001, PHR-004 — which lines on this document need a pharmacist.
 *
 * The owner's schedule list decides, read live at the moment the document is
 * written: a product names a schedule, and the schedule says whether it is
 * restricted. Nothing here copies the mark onto the bill — the bill's own line
 * keeps the schedule code it was sold under, so an owner who later moves a
 * schedule off the restricted list changes the next bill and leaves the last
 * one exactly as it was written.
 *
 * A store that sells no medicines has no list, so this answers with an empty
 * array and the pharmacist rule never touches its till (PHR-011).
 */
final class RestrictedDrugResolver
{
    /**
     * The restricted lines of a document being written.
     *
     * @param  array<int, array<string, mixed>>  $lines
     * @return list<array{line:int, product_id:int|null, product_name:string, batch_no:string|null, schedule_code:string, qty:float}>
     */
    public static function forLines(int $storeId, array $lines): array
    {
        $restricted = DrugSchedule::restrictedCodes($storeId);

        if ($restricted === []) {
            return [];
        }

        $found = [];
        $schedules = DrugSchedule::forStore($storeId)->keyBy('id');

        foreach (array_values($lines) as $index => $line) {
            if (!is_array($line)) {
                continue;
            }

            $product = self::product($storeId, $line['product_id'] ?? null, $line['product_name'] ?? null);

            if ($product === null) {
                continue;
            }

            $code = self::resolveCode($product, $schedules);

            if ($code === null || !in_array($code, $restricted, true)) {
                continue;
            }

            $found[] = [
                'line' => $index + 1,
                'product_id' => (int) $product->id,
                'product_name' => (string) ($line['product_name'] ?? $product->name),
                'batch_no' => isset($line['batch_no']) ? (string) $line['batch_no'] : null,
                'schedule_code' => $code,
                'qty' => (float) ($line['qty'] ?? 0),
            ];
        }

        return $found;
    }

    /**
     * The restricted lines a document already holds, in the order it was saved.
     *
     * @return list<array{line:int, product_id:int|null, product_name:string, batch_no:string|null, schedule_code:string, qty:float}>
     */
    public static function forInvoice(Invoice $invoice): array
    {
        if (!$invoice->relationLoaded('items')) {
            $invoice->load('items');
        }

        return self::forLines(
            (int) $invoice->store_id,
            $invoice->items->map(fn ($item): array => [
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'batch_no' => $item->batch_no,
                'qty' => $item->qty,
            ])->all()
        );
    }

    public static function shows(int $storeId): bool
    {
        return DrugSchedule::showsFor(Store::find($storeId));
    }

    /**
     * Every product this store sells under one of its restricted schedules,
     * keyed by product id with the code it reads under.
     *
     * The register asks in one pass instead of loading the master for every
     * bill it pages through; the answer is the same list the gate applies.
     *
     * @return array<int,string>
     */
    public static function restrictedProducts(int $storeId): array
    {
        $restricted = DrugSchedule::restrictedCodes($storeId);

        if ($restricted === []) {
            return [];
        }

        $schedules = DrugSchedule::forStore($storeId)->keyBy('id');
        $found = [];

        foreach (
            Product::query()
                ->where('store_id', $storeId)
                ->where(fn ($q) => $q->whereNotNull('schedule_code')->orWhereNotNull('drug_schedule_id'))
                ->get()
            as $product
        ) {
            $code = self::resolveCode($product, $schedules);

            if ($code !== null && in_array($code, $restricted, true)) {
                $found[(int) $product->id] = $code;
            }
        }

        return $found;
    }

    /**
     * A till may name a product by its id, its external id or the words the
     * cashier typed, exactly as the sync ingest resolves them.
     */
    private static function product(int $storeId, mixed $identifier, ?string $name): ?Product
    {
        $clean = is_scalar($identifier) ? trim((string) $identifier) : '';

        if ($clean !== '' && is_numeric($clean)) {
            return Product::where('store_id', $storeId)->where('id', (int) $clean)->first();
        }

        if ($clean !== '') {
            return Product::where('store_id', $storeId)
                ->where(fn ($q) => $q->where('external_id', $clean)->orWhere('name', $clean))
                ->first();
        }

        $name = trim((string) $name);

        return $name === ''
            ? null
            : Product::where('store_id', $storeId)->where('name', $name)->first();
    }

    /**
     * The schedule a product names. `schedule_code` is the stamp the item
     * master writes; a row older than that stamp still points at the list, so
     * the code is read from it rather than guessed.
     *
     * @param  Collection<int,MasterLookup>  $schedules
     */
    private static function resolveCode(Product $product, Collection $schedules): ?string
    {
        $code = trim((string) ($product->schedule_code ?? ''));

        if ($code !== '') {
            return strtoupper($code);
        }

        if ($product->drug_schedule_id === null) {
            return null;
        }

        $schedule = $schedules->get((int) $product->drug_schedule_id);

        return $schedule === null ? null : strtoupper((string) ($schedule->code ?: $schedule->name));
    }
}
