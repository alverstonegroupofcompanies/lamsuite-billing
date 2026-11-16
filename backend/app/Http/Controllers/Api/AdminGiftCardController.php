<?php

namespace App\Http\Controllers\Api;

use App\Models\GiftCard;
use App\Models\Store;
use App\Services\Payments\GiftCardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class AdminGiftCardController
{
    public function __construct(private readonly GiftCardService $cards)
    {
    }

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

    public function index(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $query = GiftCard::with('customer:id,name,phone')
            ->where('store_id', $store->id)
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->when($request->query('search'), function ($q, $search) {
                $q->where(function ($sub) use ($search) {
                    $sub->where('code', 'like', '%' . strtoupper($search) . '%')
                        ->orWhere('issued_to_name', 'like', '%' . $search . '%')
                        ->orWhere('issued_to_phone', 'like', '%' . $search . '%');
                });
            })
            ->orderByDesc('id');

        $cards = $query->limit(min(200, max(1, (int) $request->query('limit', 100))))->get();

        $summary = GiftCard::where('store_id', $store->id)
            ->selectRaw('status, COUNT(*) as total, COALESCE(SUM(balance),0) as balance')
            ->groupBy('status')
            ->get()
            ->keyBy('status');

        return response()->json([
            'success' => true,
            'summary' => [
                'active' => (int) ($summary[GiftCard::STATUS_ACTIVE]->total ?? 0),
                'exhausted' => (int) ($summary[GiftCard::STATUS_EXHAUSTED]->total ?? 0),
                'disabled' => (int) ($summary[GiftCard::STATUS_DISABLED]->total ?? 0),
                'outstanding_balance' => round((float) $summary->sum('balance'), 2),
            ],
            'cards' => $cards->map(fn (GiftCard $card) => $this->present($card))->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'initial_balance' => 'required|numeric|min:1|max:1000000',
            'code' => 'nullable|string|max:32',
            'issued_to_name' => 'nullable|string|max:150',
            'issued_to_phone' => 'nullable|string|max:20',
            'customer_id' => 'nullable|exists:parties,id',
            'expires_at' => 'nullable|date|after:today',
            'notes' => 'nullable|string|max:500',
        ]);

        $card = $this->cards->issue($store->id, $validated, $request->user()?->id);

        return response()->json([
            'success' => true,
            'gift_card' => $this->present($card->load('customer:id,name,phone')),
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $card = GiftCard::with(['customer:id,name,phone', 'transactions' => fn ($q) => $q->limit(100)])
            ->when($store, fn ($q) => $q->where('store_id', $store->id))
            ->find($id);

        if (!$card) {
            return response()->json(['success' => false, 'message' => 'Gift card not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'gift_card' => $this->present($card),
            'transactions' => $card->transactions->map(fn ($txn) => [
                'id' => $txn->id,
                'type' => $txn->type,
                'amount' => (float) $txn->amount,
                'balance_after' => (float) $txn->balance_after,
                'reference_type' => $txn->reference_type,
                'reference_id' => $txn->reference_id,
                'invoice_id' => $txn->invoice_id,
                'notes' => $txn->notes,
                'created_at' => optional($txn->created_at)->toIso8601String(),
            ])->values(),
        ]);
    }

    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $validated = $request->validate(['status' => 'required|in:active,disabled']);

        $card = GiftCard::when($store, fn ($q) => $q->where('store_id', $store->id))->find($id);
        if (!$card) {
            return response()->json(['success' => false, 'message' => 'Gift card not found.'], 404);
        }
        if ((float) $card->balance <= 0 && $validated['status'] === 'active') {
            return response()->json(['success' => false, 'message' => 'Cannot reactivate an exhausted card.'], 422);
        }

        $card->update(['status' => $validated['status']]);
        return response()->json(['success' => true, 'gift_card' => $this->present($card)]);
    }

    public function adjust(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $validated = $request->validate([
            'amount' => 'required|numeric|min:0.01',
            'direction' => 'required|in:credit,debit',
            'notes' => 'nullable|string|max:500',
        ]);

        $card = GiftCard::when($store, fn ($q) => $q->where('store_id', $store->id))->find($id);
        if (!$card) {
            return response()->json(['success' => false, 'message' => 'Gift card not found.'], 404);
        }

        $txn = $this->cards->adjust($card->store_id, $card, (float) $validated['amount'], $validated['direction'], $validated['notes'] ?? null, $request->user()?->id);

        return response()->json([
            'success' => true,
            'gift_card' => $this->present($card->fresh()),
            'transaction' => ['id' => $txn->id, 'type' => $txn->type, 'amount' => (float) $txn->amount, 'balance_after' => (float) $txn->balance_after],
        ]);
    }

    public function lookup(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        $code = trim((string) ($request->query('code') ?? $request->input('code', '')));
        if (!$store || $code === '') {
            return response()->json(['success' => false, 'message' => 'Store and card code are required.'], 422);
        }

        $card = $this->cards->findByCode($store->id, $code);
        if (!$card) {
            return response()->json(['success' => false, 'message' => 'Gift card not found for this store.'], 404);
        }

        $expired = $card->expires_at && $card->expires_at->lt(Carbon::today());

        return response()->json([
            'success' => true,
            'gift_card' => $this->present($card),
            'redeemable' => $card->status === GiftCard::STATUS_ACTIVE && !$expired && (float) $card->balance > 0,
            'expired' => $expired,
        ]);
    }

    private function present(GiftCard $card): array
    {
        return [
            'id' => $card->id,
            'code' => $card->code,
            'initial_balance' => (float) $card->initial_balance,
            'balance' => (float) $card->balance,
            'status' => $card->status,
            'issued_to_name' => $card->issued_to_name,
            'issued_to_phone' => $card->issued_to_phone,
            'customer' => $card->relationLoaded('customer') && $card->customer
                ? ['id' => $card->customer->id, 'name' => $card->customer->name, 'phone' => $card->customer->phone]
                : null,
            'expires_at' => $card->expires_at?->toDateString(),
            'notes' => $card->notes,
            'created_at' => optional($card->created_at)->toIso8601String(),
        ];
    }
}
