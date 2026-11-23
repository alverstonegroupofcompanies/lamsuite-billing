<?php

namespace App\Services\Payments;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\PaymentAllocation;
use App\Models\Purchase;
use DomainException;
use Illuminate\Database\Eloquent\Collection;

/**
 * A receipt moves a party's balance, but until it is tied to the documents it
 * settles, the invoice it paid still reads "unpaid". Every receipt (panel or
 * till) is allocated here: explicit documents when the operator picked them,
 * oldest-open-first when they did not.
 */
class PaymentAllocationService
{
    public const EPSILON = 0.005;

    /**
     * @param array<int,array<string,mixed>>|null $allocations
     * @return array{allocations: array<int,array<string,mixed>>, allocated: float, unallocated: float}
     */
    public function allocateCustomerPayment(
        int $paymentId,
        int $storeId,
        int $customerId,
        float $amount,
        ?array $allocations = null
    ): array {
        return $this->allocate(
            PaymentAllocation::TYPE_CUSTOMER_PAYMENT,
            $paymentId,
            $storeId,
            $customerId,
            $amount,
            $allocations
        );
    }

    /**
     * @param array<int,array<string,mixed>>|null $allocations
     * @return array{allocations: array<int,array<string,mixed>>, allocated: float, unallocated: float}
     */
    public function allocateSupplierPayment(
        int $paymentId,
        int $storeId,
        int $supplierId,
        float $amount,
        ?array $allocations = null
    ): array {
        return $this->allocate(
            PaymentAllocation::TYPE_SUPPLIER_PAYMENT,
            $paymentId,
            $storeId,
            $supplierId,
            $amount,
            $allocations
        );
    }

    /**
     * @param array<int,array<string,mixed>>|null $explicit
     * @return array{allocations: array<int,array<string,mixed>>, allocated: float, unallocated: float}
     */
    private function allocate(
        string $paymentType,
        int $paymentId,
        int $storeId,
        int $partyId,
        float $amount,
        ?array $explicit
    ): array {
        $remaining = $this->money($amount);
        if ($remaining <= 0) {
            return ['allocations' => [], 'allocated' => 0.0, 'unallocated' => 0.0];
        }

        $written = [];
        $seen = [];

        foreach ($explicit ?? [] as $line) {
            $pick = $this->explicitPick($paymentType, $storeId, $line);
            if ($pick === null) {
                continue;
            }

            [$document, $wanted] = $pick;
            if (isset($seen[$document::class . ':' . $document->id])) {
                throw new DomainException('The same document appears twice in the allocations.');
            }
            $seen[$document::class . ':' . $document->id] = true;

            $this->assertBelongsToParty($document, $paymentType, $partyId);

            $outstanding = $this->outstanding($document);
            if ($wanted > $outstanding + self::EPSILON) {
                throw new DomainException(sprintf(
                    'Allocation of ₹%s exceeds the ₹%s still open on %s.',
                    number_format($wanted, 2, '.', ''),
                    number_format($outstanding, 2, '.', ''),
                    $document->invoice_number ?? ('document #' . $document->id)
                ));
            }
            if ($wanted > $remaining + self::EPSILON) {
                throw new DomainException(sprintf(
                    'Allocations total more than the receipt amount of ₹%s.',
                    number_format($amount, 2, '.', '')
                ));
            }

            $applied = $this->money(min($wanted, $outstanding, $remaining));
            if ($applied <= 0) {
                continue;
            }

            $written[] = $this->writeAllocation($paymentType, $paymentId, $document, $applied);
            $remaining = $this->money($remaining - $applied);
        }

        if ($explicit !== null && $explicit !== []) {
            // The operator named the documents; a remainder stays on account
            // rather than being spread over bills they did not choose.
            return [
                'allocations' => $written,
                'allocated' => $this->money(array_sum(array_column($written, 'amount'))),
                'unallocated' => $remaining,
            ];
        }

        $steps = $this->plan($paymentType, $storeId, $partyId, $remaining);
        foreach ($steps as $step) {
            $written[] = $this->writeAllocation($paymentType, $paymentId, $step['document'], $step['amount']);
            $remaining = $this->money($remaining - $step['amount']);
        }

        return [
            'allocations' => $written,
            'allocated' => $this->money(array_sum(array_column($written, 'amount'))),
            'unallocated' => $remaining,
        ];
    }

    /**
     * PAY-05 backfill: the documents a receipt of this size would settle, oldest
     * debt first, without writing anything. The allocator above places exactly
     * this list, which is what lets `payments:allocate-outstanding` show its work
     * before it touches a bill.
     *
     * @return array<int, array{document: Invoice|Purchase, amount: float}>
     */
    public function planCustomerAllocation(int $storeId, int $customerId, float $amount): array
    {
        return $this->plan(PaymentAllocation::TYPE_CUSTOMER_PAYMENT, $storeId, $customerId, $amount);
    }

    /** @return array<int, array{document: Invoice|Purchase, amount: float}> */
    public function planSupplierAllocation(int $storeId, int $supplierId, float $amount): array
    {
        return $this->plan(PaymentAllocation::TYPE_SUPPLIER_PAYMENT, $storeId, $supplierId, $amount);
    }

    /** @return array<int, array{document: Invoice|Purchase, amount: float}> */
    private function plan(string $paymentType, int $storeId, int $partyId, float $amount): array
    {
        $remaining = $this->money($amount);
        if ($remaining <= 0) {
            return [];
        }

        $steps = [];
        foreach ($this->openDocuments($paymentType, $storeId, $partyId) as $document) {
            if ($remaining <= self::EPSILON) {
                break;
            }

            $applied = $this->money(min($remaining, $this->outstanding($document)));
            if ($applied <= 0) {
                continue;
            }

            $steps[] = ['document' => $document, 'amount' => $applied];
            $remaining = $this->money($remaining - $applied);
        }

        return $steps;
    }

    /**
     * @param array<string,mixed> $line
     * @return array{0: Invoice|Purchase, 1: float}|null
     */
    private function explicitPick(string $paymentType, int $storeId, array $line): ?array
    {
        $isCustomer = $paymentType === PaymentAllocation::TYPE_CUSTOMER_PAYMENT;
        $id = (int) ($line[$isCustomer ? 'invoice_id' : 'purchase_id']
            ?? $line['document_id']
            ?? 0);
        if ($id <= 0) {
            return null;
        }

        $wanted = $this->money((float) ($line['amount'] ?? 0));
        if ($wanted <= 0) {
            throw new DomainException('Every allocation needs an amount greater than zero.');
        }

        $document = $isCustomer
            ? Invoice::find($id)
            : Purchase::find($id);

        $expectedType = $isCustomer
            ? PaymentAllocation::DOCUMENT_INVOICE
            : PaymentAllocation::DOCUMENT_PURCHASE;
        if (!$document || (int) $document->store_id !== $storeId) {
            throw new DomainException($expectedType === PaymentAllocation::DOCUMENT_INVOICE
                ? 'The invoice being allocated to does not exist in this store.'
                : 'The purchase being allocated to does not exist in this store.');
        }

        return [$document, $wanted];
    }

    private function assertBelongsToParty(object $document, string $paymentType, int $partyId): void
    {
        $isCustomer = $paymentType === PaymentAllocation::TYPE_CUSTOMER_PAYMENT;

        if ($isCustomer) {
            if ((string) ($document->module_key ?? '') !== 'invoice' || $document->status === 'cancelled') {
                throw new DomainException('Only a live sale invoice can receive a customer receipt.');
            }
            if ((int) $document->customer_id !== $partyId) {
                throw new DomainException('The invoice belongs to a different customer.');
            }

            return;
        }

        $module = strtolower((string) ($document->module_key ?: 'purchase'));
        if (in_array($module, ['purchase_order', 'order', 'purchase_return', 'debit_note'], true)
            || $document->status === 'cancelled') {
            throw new DomainException('Only a posted purchase bill can receive a supplier payment.');
        }
        if ((int) $document->supplier_id !== $partyId) {
            throw new DomainException('The purchase belongs to a different supplier.');
        }
    }

    private function outstanding(object $document): float
    {
        return $this->money(max(0, (float) $document->grand_total - (float) $document->paid_amount));
    }

    /**
     * The party's open documents, oldest debt first — the order a receipt settles in.
     *
     * @return Collection<int, Invoice|Purchase>
     */
    private function openDocuments(string $paymentType, int $storeId, int $partyId): Collection
    {
        if ($paymentType === PaymentAllocation::TYPE_CUSTOMER_PAYMENT) {
            return Invoice::where('store_id', $storeId)
                ->where('customer_id', $partyId)
                ->where('module_key', 'invoice')
                ->where('status', '!=', 'cancelled')
                ->whereRaw('paid_amount < grand_total - ?', [self::EPSILON])
                ->orderBy('invoice_date')
                ->orderBy('id')
                ->get();
        }

        return Purchase::where('store_id', $storeId)
            ->where('supplier_id', $partyId)
            ->where('status', '!=', 'cancelled')
            ->whereRaw('paid_amount < grand_total - ?', [self::EPSILON])
            ->where(function ($q) {
                $q->whereNull('module_key')->orWhereNotIn('module_key', [
                    'purchase_order', 'order', 'purchase_return', 'debit_note',
                ]);
            })
            ->orderBy('invoice_date')
            ->orderBy('id')
            ->get();
    }

    /**
     * @return array<string,mixed>
     */
    private function writeAllocation(string $paymentType, int $paymentId, object $document, float $amount): array
    {
        $isCustomer = $paymentType === PaymentAllocation::TYPE_CUSTOMER_PAYMENT;
        $documentType = $isCustomer
            ? PaymentAllocation::DOCUMENT_INVOICE
            : PaymentAllocation::DOCUMENT_PURCHASE;

        $allocation = PaymentAllocation::create([
            'store_id' => $document->store_id,
            'payment_type' => $paymentType,
            'payment_id' => $paymentId,
            'document_type' => $documentType,
            'document_id' => $document->id,
            'amount' => $amount,
        ]);

        $paid = $this->money((float) $document->paid_amount + $amount);
        $updates = ['paid_amount' => $paid];

        if ($isCustomer) {
            $updates['payment_status'] = $paid >= $this->money((float) $document->grand_total) - self::EPSILON
                ? 'paid'
                : 'partially_paid';
        }

        $document->forceFill($updates)->save();

        return [
            'id' => $allocation->id,
            'document_type' => $documentType,
            'document_id' => (int) $document->id,
            'document_number' => $document->invoice_number ?? null,
            'amount' => $amount,
        ];
    }

    /**
     * A cancelled document owes nothing, so the receipts that settled it are
     * freed: their allocation rows go, and the money stands unallocated on the
     * receipt until the next allocation applies it to a live bill. The party
     * balance is not touched here — the cancellation already reverses the debt
     * the document raised, and the receipt itself never stopped being money in.
     *
     * Call inside the cancellation's own transaction.
     */
    public function releaseForDocument(string $documentType, int $documentId, ?int $userId = null): float
    {
        $rows = PaymentAllocation::where('document_type', $documentType)
            ->where('document_id', $documentId)
            ->lockForUpdate()
            ->get();

        if ($rows->isEmpty()) {
            return 0.0;
        }

        $released = $this->money((float) $rows->sum('amount'));

        AuditLog::log(
            'payment_allocation_released',
            $documentType === PaymentAllocation::DOCUMENT_INVOICE ? 'Invoice' : 'Purchase',
            (string) $documentId,
            ['allocations' => $rows->map(fn (PaymentAllocation $row) => [
                'payment_type' => $row->payment_type,
                'payment_id' => (int) $row->payment_id,
                'amount' => (float) $row->amount,
            ])->values()->all()],
            ['released_amount' => $released, 'reason' => 'document_cancelled'],
            (int) $rows->first()->store_id,
            $userId
        );

        PaymentAllocation::whereIn('id', $rows->pluck('id'))->delete();

        return $released;
    }

    private function money(float $value): float
    {
        return round($value, 2);
    }
}
