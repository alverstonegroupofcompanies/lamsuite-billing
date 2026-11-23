<?php

namespace App\Services\Sales;

use App\Models\Invoice;
use App\Models\InvoiceItem;

/**
 * What a return line actually gives back, in the money it was sold for.
 *
 * A credit note used to be re-priced from scratch at the selling rate, which
 * added GST on top of an MRP-inclusive price (five ₹6 tablets refunded ₹33.60
 * instead of ₹30.00) and ignored the discount the line was sold with. A return
 * is a reversal, so it credits a proportional share of the original line: the
 * charged value, the taxable value, the components and the discount. Shares
 * are computed cumulatively from the quantity returned so far, and the return
 * that closes the line takes the remainder — every paisa of the original is
 * credited exactly once, however the returns were split.
 */
class SalesReturnPricingService
{
    /**
     * @return array{taxable_amount: float, cgst_amount: float, sgst_amount: float, igst_amount: float, cess_amount: float, tax_amount: float, total_amount: float, discount_amount: float}
     */
    public function reverseLine(
        InvoiceItem $original,
        float $soldBase,
        float $priorBase,
        float $returnBase,
        bool $interState = false
    ): array {
        $sold = max(0.0, $soldBase);
        $prior = max(0.0, min($priorBase, $sold));
        $return = max(0.0, $returnBase);

        if ($sold <= 0 || $return <= 0) {
            return $this->emptyLine();
        }

        $cumBase = min($sold, $prior + $return);
        $closing = $cumBase >= $sold - 0.0001;

        $origTotal = $this->paise($original->total_amount);
        $origTaxable = $this->paise($original->taxable_amount);
        $origDiscount = $this->paise($original->discount_amount);

        $origCgst = $this->paise($original->cgst_amount);
        $origSgst = $this->paise($original->sgst_amount);
        $origIgst = $this->paise($original->igst_amount);
        $origCess = $this->paise($original->cess_amount);

        // A line stored before the component columns existed still carries what
        // the customer paid and what the shelf price tax was; rebuild the split.
        if ($origTotal <= 0 && $origTaxable > 0) {
            $origTotal = $origTaxable + $origCgst + $origSgst + $origIgst + $origCess;
        }

        $origTax = $origTotal - $origTaxable;

        if ($origTax <= 0 && ($origCgst + $origSgst + $origIgst + $origCess) > 0) {
            $origTax = $origCgst + $origSgst + $origIgst + $origCess;
            $origTaxable = $origTotal - $origTax;
        }

        if ($origTax <= 0) {
            $origTax = 0;
            $origTaxable = $origTotal;
        }

        if (($origCgst + $origSgst + $origIgst + $origCess) <= 0 && $origTax > 0) {
            if ($interState) {
                $origIgst = $origTax;
            } else {
                $origCgst = (int) round($origTax / 2);
                $origSgst = $origTax - $origCgst;
            }
        }

        $cumTotal = $closing ? $origTotal : $this->share($origTotal, $cumBase, $sold);
        $priorTotal = $prior > 0 ? $this->share($origTotal, $prior, $sold) : 0;
        $cumDiscount = $closing ? $origDiscount : $this->share($origDiscount, $cumBase, $sold);
        $priorDiscount = $prior > 0 ? $this->share($origDiscount, $prior, $sold) : 0;

        // taxable = charged value / (1 + the line's own effective rate), so a
        // part-return of an inclusive price can never book tax the buyer never paid.
        if ($origTaxable > 0 && $origTax > 0) {
            $rate = $origTax / $origTaxable;
            $cumTaxable = $closing ? $origTaxable : (int) round($cumTotal / (1 + $rate));
            $priorTaxable = $prior > 0 ? (int) round($priorTotal / (1 + $rate)) : 0;
        } else {
            $cumTaxable = $closing ? $origTaxable : $this->share($origTaxable, $cumBase, $sold);
            $priorTaxable = $prior > 0 ? $this->share($origTaxable, $prior, $sold) : 0;
        }

        $cumTax = $cumTotal - $cumTaxable;
        $priorTax = $priorTotal - $priorTaxable;

        $chunkCgst = $this->componentShare($origCgst, $origTax, $cumTax, $priorTax, $closing);
        $chunkIgst = $this->componentShare($origIgst, $origTax, $cumTax, $priorTax, $closing);
        $chunkCess = $this->componentShare($origCess, $origTax, $cumTax, $priorTax, $closing);
        $chunkTax = $cumTax - $priorTax;
        $chunkSgst = max(0, $chunkTax - $chunkCgst - $chunkIgst - $chunkCess);

        return [
            'taxable_amount' => $this->rupees($cumTaxable - $priorTaxable),
            'cgst_amount' => $this->rupees($chunkCgst),
            'sgst_amount' => $this->rupees($chunkSgst),
            'igst_amount' => $this->rupees($chunkIgst),
            'cess_amount' => $this->rupees($chunkCess),
            'tax_amount' => $this->rupees($chunkTax),
            'total_amount' => $this->rupees($cumTotal - $priorTotal),
            'discount_amount' => $this->rupees($cumDiscount - $priorDiscount),
        ];
    }

    /**
     * Base units of a quantity line: packs times units-per-pack, plus loose units.
     */
    public static function baseUnits(mixed $qty, mixed $looseQty, mixed $unitsPerPack): float
    {
        $upp = max(1, (int) ($unitsPerPack ?: 1));

        return max(0, (float) $qty) * $upp + max(0, (float) $looseQty);
    }

    /**
     * Base units already credited per `productId_batchNo` against an invoice, so a
     * return can tell how much of its line has already gone back. The document
     * being written or re-synced is excluded, otherwise it counts its own credit.
     *
     * @return array<string, float>
     */
    public function returnedBaseUnits(int $storeId, string $invoiceNumber, ?int $excludeInvoiceId = null): array
    {
        $prior = Invoice::where('store_id', $storeId)
            ->whereIn('module_key', ['credit_note', 'sales_return'])
            ->where('original_invoice_number', $invoiceNumber)
            ->where('status', '!=', 'cancelled')
            ->when($excludeInvoiceId !== null, fn ($q) => $q->where('id', '!=', $excludeInvoiceId))
            ->with('items')
            ->get();

        $map = [];
        foreach ($prior as $doc) {
            foreach ($doc->items as $item) {
                $key = $item->product_id . '_' . ($item->batch_no ?? '');
                $map[$key] = ($map[$key] ?? 0)
                    + self::baseUnits($item->qty, $item->loose_qty, $item->units_per_pack);
            }
        }

        return $map;
    }

    /**
     * The component's share of the tax returned so far, less what earlier
     * returns already credited. The closing return hands over everything left.
     */
    private function componentShare(int $original, int $originalTax, int $cumTax, int $priorTax, bool $closing): int
    {
        if ($original <= 0) {
            return 0;
        }

        if ($originalTax <= 0) {
            return $closing ? $original : 0;
        }

        $cumComponent = $closing ? $original : (int) round($original * $cumTax / $originalTax);
        $priorComponent = $priorTax > 0 ? (int) round($original * $priorTax / $originalTax) : 0;

        return max(0, $cumComponent - $priorComponent);
    }

    private function share(int $paise, float $base, float $sold): int
    {
        return (int) round($paise * $base / $sold);
    }

    private function paise(mixed $value): int
    {
        return (int) round(((float) ($value ?? 0)) * 100);
    }

    private function rupees(int $paise): float
    {
        return round($paise / 100, 2);
    }

    /**
     * @return array{taxable_amount: float, cgst_amount: float, sgst_amount: float, igst_amount: float, cess_amount: float, tax_amount: float, total_amount: float, discount_amount: float}
     */
    private function emptyLine(): array
    {
        return [
            'taxable_amount' => 0.0,
            'cgst_amount' => 0.0,
            'sgst_amount' => 0.0,
            'igst_amount' => 0.0,
            'cess_amount' => 0.0,
            'tax_amount' => 0.0,
            'total_amount' => 0.0,
            'discount_amount' => 0.0,
        ];
    }
}
