<?php

namespace Tests\Support;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\InvoicePayment;
use App\Models\Store;
use App\Models\User;

/**
 * G14-REPORTS fixtures: one store whose sale invoices store an inclusive
 * `subtotal` and a credit note that stores an exclusive one, with payment
 * rows that carry a tender larger than the bill (the PAY-02 change case).
 */
trait BuildsG14Fixtures
{
    protected function g14Store(array $overrides = []): Store
    {
        return Store::create(array_merge([
            'name' => 'G14 Reports Store',
            'code' => 'G14-' . uniqid(),
            'state_code' => '32',
            'timezone' => 'Asia/Kolkata',
            'tax_mode' => 'inclusive',
            'is_active' => true,
        ], $overrides));
    }

    protected function g14User(Store $store): User
    {
        return User::create([
            'name' => 'G14 Admin',
            'email' => 'g14-' . uniqid() . '@example.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $store->id,
            'allowed_store_ids' => [$store->id],
        ]);
    }

    protected function g14Invoice(Store $store, array $attrs = [], array $lines = [], array $payments = []): Invoice
    {
        $invoice = Invoice::create(array_merge([
            'store_id' => $store->id,
            'module_key' => 'invoice',
            'invoice_number' => 'G14-INV-' . uniqid(),
            'invoice_date' => '2026-11-15',
            'customer_name' => 'Walk-in Customer',
            'subtotal' => 0,
            'taxable_subtotal' => 0,
            'tax_total' => 0,
            'cgst_total' => 0,
            'sgst_total' => 0,
            'igst_total' => 0,
            'cess_total' => 0,
            'round_off' => 0,
            'grand_total' => 0,
            'paid_amount' => 0,
            'payment_mode' => 'Cash',
            'payment_status' => 'paid',
            'status' => 'issued',
        ], $attrs));

        foreach ($lines as $line) {
            InvoiceItem::create(array_merge([
                'invoice_id' => $invoice->id,
                'product_name' => 'G14 Item',
                'qty' => 1,
                'units_per_pack' => 1,
                'unit_price' => 0,
                'gst_percent' => 12,
                'taxable_amount' => 0,
                'cgst_amount' => 0,
                'sgst_amount' => 0,
                'igst_amount' => 0,
                'cess_amount' => 0,
                'tax_amount' => 0,
                'total_amount' => 0,
            ], $line));
        }

        foreach ($payments as $payment) {
            InvoicePayment::create(array_merge([
                'store_id' => $store->id,
                'invoice_id' => $invoice->id,
                'payment_mode' => 'Cash',
                'amount' => 0,
                'status' => 'received',
            ], $payment));
        }

        return $invoice;
    }

    protected function g14CreditNote(Store $store, array $attrs = [], array $lines = [], array $payments = []): Invoice
    {
        return $this->g14Invoice(
            $store,
            array_merge(['module_key' => 'credit_note', 'invoice_number' => 'G14-CN-' . uniqid()], $attrs),
            $lines,
            $payments
        );
    }

    /**
     * Two inclusive sale bills (210.00 and 1,080.00) and a 34.00 credit note
     * against them. A 500 note paid the 210 bill, so 290 is change.
     */
    protected function g14StandardDay(Store $store): array
    {
        $billA = $this->g14Invoice($store, [
            'invoice_number' => 'G14-BILL-A',
            'subtotal' => 210.00,
            'taxable_subtotal' => 187.50,
            'tax_total' => 22.50,
            'cgst_total' => 11.25,
            'sgst_total' => 11.25,
            'grand_total' => 210.00,
            'paid_amount' => 210.00,
        ], [[
            'product_name' => 'G14 Paracetamol',
            'qty' => 1,
            'unit_price' => 210.00,
            'taxable_amount' => 187.50,
            'cgst_amount' => 11.25,
            'sgst_amount' => 11.25,
            'tax_amount' => 22.50,
            'total_amount' => 210.00,
        ]], [[
            'payment_mode' => 'Cash',
            'amount' => 500.00,
        ]]);

        $billB = $this->g14Invoice($store, [
            'invoice_number' => 'G14-BILL-B',
            'subtotal' => 1080.00,
            'taxable_subtotal' => 964.29,
            'tax_total' => 115.71,
            'cgst_total' => 57.86,
            'sgst_total' => 57.85,
            'grand_total' => 1080.00,
            'paid_amount' => 1080.00,
        ], [[
            'product_name' => 'G14 Cough Syrup',
            'qty' => 1,
            'unit_price' => 1080.00,
            'taxable_amount' => 964.29,
            'cgst_amount' => 57.86,
            'sgst_amount' => 57.85,
            'tax_amount' => 115.71,
            'total_amount' => 1080.00,
        ]], [[
            'payment_mode' => 'Cash',
            'amount' => 1080.00,
        ]]);

        $note = $this->g14CreditNote($store, [
            'invoice_number' => 'G14-CN-1',
            'subtotal' => 30.00,
            'taxable_subtotal' => 30.00,
            'tax_total' => 3.60,
            'cgst_total' => 1.80,
            'sgst_total' => 1.80,
            'round_off' => 0.40,
            'grand_total' => 34.00,
            'paid_amount' => 33.60,
            'payment_mode' => 'Cash',
        ], [[
            'product_name' => 'G14 Paracetamol',
            'qty' => 1,
            'unit_price' => 34.00,
            'taxable_amount' => 30.00,
            'cgst_amount' => 1.80,
            'sgst_amount' => 1.80,
            'tax_amount' => 3.60,
            'total_amount' => 34.00,
        ]], [[
            'payment_mode' => 'Cash',
            'amount' => 33.60,
        ]]);

        return [$billA, $billB, $note];
    }
}
