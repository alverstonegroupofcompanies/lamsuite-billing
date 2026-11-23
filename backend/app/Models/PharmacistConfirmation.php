<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * PHR-004, PHR-005 — one pharmacist standing behind one act.
 *
 * A row is written when a registered pharmacist's own PIN released a document
 * that carries a restricted drug: the sale, its return, its cancellation, or
 * the same document arriving from a till that worked in the dark. The names it
 * holds are stamps of that moment, not live references, so the register still
 * reads correctly after the person is renamed, renewed or archived.
 *
 * No credential is kept here. What a row proves is that a credential was
 * verified, by whom, and when.
 */
class PharmacistConfirmation extends Model
{
    protected $fillable = [
        'store_id',
        'counter_id',
        'document_type',
        'document_id',
        'document_reference',
        'pharmacist_id',
        'pharmacist_name',
        'pharmacist_reg_no',
        'restricted_items',
        'mode',
        'reason',
        'confirmed_at',
    ];

    protected $casts = [
        'restricted_items' => 'array',
        'confirmed_at' => 'datetime',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function pharmacist(): BelongsTo
    {
        return $this->belongsTo(Salesperson::class, 'pharmacist_id');
    }
}
