<?php

namespace App\Http\Controllers\Api;

use App\Models\CompanySetting;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Provider-agnostic payment intents.
 *
 * No gateway API is called: the endpoint renders a UPI intent that any UPI app
 * or an external gateway can scan/handle. Settlement is reconciled separately
 * from imported bank/UPI statements.
 */
class PaymentIntentController
{
    private function resolveStore(Request $request): ?Store
    {
        $candidate = $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->input('store_id')
            ?? ($request->user() ? $request->user()->store_id : null);

        if ($candidate !== null && $candidate !== '' && $candidate !== 'all') {
            return Store::find((int) $candidate);
        }

        return Store::query()->orderBy('id')->first();
    }

    /**
     * Build a dynamic UPI intent URI for an exact bill amount.
     */
    public function upiIntent(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'amount' => 'required|numeric|min:0.01',
            'invoice_number' => 'nullable|string|max:64',
            'counter_code' => 'nullable|string|max:32',
        ]);

        $payments = CompanySetting::where('store_id', $store->id)->where('key', 'payments')->first()?->value;
        $account = $this->resolveUpiAccount(is_array($payments) ? $payments : [], $validated['counter_code'] ?? null);

        if ($account === null) {
            return response()->json([
                'success' => false,
                'message' => 'UPI is not configured for this store. Add a UPI ID and payee name in payment settings.',
            ], 422);
        }

        $amount = number_format((float) $validated['amount'], 2, '.', '');
        $invoiceNumber = $validated['invoice_number'] ?? null;
        $note = $invoiceNumber ? 'Inv ' . $invoiceNumber : 'LamSuite payment';

        $query = [
            'pa' => $account['vpa'],
            'pn' => $account['payee_name'],
            'am' => $amount,
            'cu' => 'INR',
            'tn' => $note,
        ];
        if (!empty($validated['invoice_number'])) {
            $query['tr'] = $validated['invoice_number'];
        }
        if (!empty($account['merchant_code'])) {
            $query['mc'] = $account['merchant_code'];
        }

        $uri = 'upi://pay?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);

        return response()->json([
            'success' => true,
            'provider' => 'upi_intent',
            'store_id' => $store->id,
            'vpa' => $account['vpa'],
            'payee_name' => $account['payee_name'],
            'amount' => (float) $amount,
            'currency' => 'INR',
            'invoice_number' => $validated['invoice_number'] ?? null,
            'qr_subtext' => $account['qr_subtext'],
            'upi_uri' => $uri,
            'intent' => [
                'type' => 'upi',
                'reference' => $validated['invoice_number'] ?? null,
                'status' => 'pending',
            ],
        ]);
    }

    private function resolveUpiAccount(array $payments, ?string $counterCode): ?array
    {
        $upi = is_array($payments['upi'] ?? null) ? $payments['upi'] : [];
        if (($upi['enabled'] ?? true) === false) {
            return null;
        }

        $accounts = is_array($upi['accounts'] ?? null) ? $upi['accounts'] : [];
        $chosen = null;

        if ($counterCode) {
            foreach ($accounts as $account) {
                $overrides = array_map('strval', $account['counterOverrides'] ?? []);
                if (in_array($counterCode, $overrides, true)) {
                    $chosen = $account;
                    break;
                }
            }
        }

        if ($chosen === null && !empty($upi['defaultUpiId'])) {
            foreach ($accounts as $account) {
                if (($account['upiId'] ?? null) === $upi['defaultUpiId']) {
                    $chosen = $account;
                    break;
                }
            }
        }

        if ($chosen === null) {
            foreach ($accounts as $account) {
                if (!empty($account['isDefault'])) {
                    $chosen = $account;
                    break;
                }
            }
        }

        if ($chosen === null && !empty($accounts)) {
            $chosen = $accounts[0];
        }

        $vpa = trim((string) ($chosen['upiId'] ?? $upi['defaultUpiId'] ?? $payments['upiVpa'] ?? ''));
        $payee = trim((string) ($chosen['payeeName'] ?? $upi['defaultPayeeName'] ?? $payments['upiPayeeName'] ?? ''));

        if ($vpa === '' || $payee === '') {
            return null;
        }
        if (!preg_match('/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/', $vpa)) {
            return null;
        }

        return [
            'vpa' => $vpa,
            'payee_name' => $payee,
            'merchant_code' => $chosen['merchantCode'] ?? null,
            'qr_subtext' => $chosen['qrSubtext'] ?? ($upi['qrSubtext'] ?? 'Scan with any UPI app'),
        ];
    }
}
