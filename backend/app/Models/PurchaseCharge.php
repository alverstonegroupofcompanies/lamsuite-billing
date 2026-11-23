<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * CR-C: one charge line of a supplier bill (freight, packing, loading, …). The head
 * identity is denormalised so a posted charge outlives rename or deletion of its
 * master row, and `amount` is signed because a negative charge is a legal cash
 * discount, round-off or TCS on the bill.
 */
class PurchaseCharge extends Model
{
    protected $table = 'purchase_charges';

    protected $fillable = [
        'store_id',
        'purchase_id',
        'external_id',
        'seq',
        'head_code',
        'head_name',
        'note',
        'treatment',
        'spread_method',
        'spread_basis_used',
        'itc_eligibility',
        'is_rcm',
        'paid_separately',
        'in_payable',
        'paid_to_label',
        'place_of_supply',
        'sac_code',
        'amount',
        'gst_percent',
        'taxable_amount',
        'cgst_amount',
        'sgst_amount',
        'igst_amount',
        'cess_amount',
        'total_amount',
        'allocated_amount',
        'source',
        'expense_id',
        'reversed_amount',
        'created_by',
    ];

    protected $casts = [
        'seq' => 'integer',
        'is_rcm' => 'boolean',
        'paid_separately' => 'boolean',
        'in_payable' => 'boolean',
        'amount' => 'decimal:2',
        'gst_percent' => 'decimal:2',
        'taxable_amount' => 'decimal:2',
        'cgst_amount' => 'decimal:2',
        'sgst_amount' => 'decimal:2',
        'igst_amount' => 'decimal:2',
        'cess_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'allocated_amount' => 'decimal:2',
        'reversed_amount' => 'decimal:2',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function purchase(): BelongsTo
    {
        return $this->belongsTo(Purchase::class);
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(PurchaseChargeAllocation::class);
    }

    public function expense(): BelongsTo
    {
        return $this->belongsTo(Expense::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Whether this line was inside the supplier's payable when the bill was posted (CR-C-11).
     * Read from the row and never re-derived from today's policy, because a policy change must
     * not restate a bill that has already been printed (PUR-016).
     */
    public function isInPayable(): bool
    {
        return (bool) $this->in_payable;
    }

    /** The GST this charge line carried, in all four components. */
    public function taxAmount(): float
    {
        return round(
            (float) $this->cgst_amount + (float) $this->sgst_amount
            + (float) $this->igst_amount + (float) $this->cess_amount,
            2
        );
    }

    /**
     * REP-009: one rule for what the working papers credit as input tax. Anything but `eligible`
     * - and anything on reverse charge, which the papers list for review instead - is not
     * creditable there; `partial` is not a half-credit because the contract carries no
     * creditable share.
     *
     * Note the deliberate difference from `reversibleAmount()` and the tax engines, which decide
     * cost and expense postings by eligibility alone: a reverse-charge charge's tax is still
     * money the books must put somewhere, so it capitalises or expenses as usual and only the
     * statutory credit treats it as self-paid.
     */
    public function isCreditableItc(): bool
    {
        return !$this->is_rcm && ($this->itc_eligibility ?? 'eligible') === 'eligible';
    }

    public function creditableTax(): float
    {
        return $this->isCreditableItc() ? $this->taxAmount() : 0.0;
    }

    public function nonCreditableTax(): float
    {
        return round($this->taxAmount() - $this->creditableTax(), 2);
    }

    /**
     * The money this charge actually put into the books, which is what a return gives back:
     * the landed cost it spread for an add-to-cost line, and the ex-tax amount plus the tax
     * that can never be claimed for an expensed one. Creditable GST is not here because the
     * return claims it back through the input-tax ledger, not through this charge.
     */
    public function reversibleAmount(): float
    {
        $allocated = round((float) $this->allocated_amount, 2);
        if (abs($allocated) >= 0.005) {
            return $allocated;
        }

        if ($this->treatment !== 'expense') {
            return 0.0;
        }

        $nonCreditable = $this->itc_eligibility === 'eligible'
            ? 0.0
            : round((float) $this->cgst_amount + (float) $this->sgst_amount
                + (float) $this->igst_amount + (float) $this->cess_amount, 2);

        return round((float) $this->taxable_amount + $nonCreditable, 2);
    }

    /**
     * A charge line is fully reversed once returns have taken back everything it put in.
     */
    public function isFullyReversed(): bool
    {
        return abs($this->reversibleAmount() - round((float) $this->reversed_amount, 2)) < 0.005;
    }
}
