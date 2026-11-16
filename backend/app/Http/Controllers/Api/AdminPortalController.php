<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Party;
use App\Models\PortalAccessToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminPortalController
{
    private function resolveStoreId(Request $request): ?int
    {
        $candidate = $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->input('store_id')
            ?? $request->user()?->store_id;

        return is_numeric($candidate) ? (int) $candidate : null;
    }

    private function findCustomer(Request $request, string $id): ?Party
    {
        return Party::query()
            ->where('type', 'customer')
            ->when($this->resolveStoreId($request), fn ($q, $storeId) => $q->where('store_id', $storeId))
            ->find($id);
    }

    public function issue(Request $request, string $id): JsonResponse
    {
        $party = $this->findCustomer($request, $id);
        if (!$party) {
            return response()->json(['success' => false, 'message' => 'Customer not found in the selected store.'], 404);
        }
        if (!$party->is_active) {
            return response()->json(['success' => false, 'message' => 'This customer is inactive.'], 422);
        }

        $validated = $request->validate([
            'days' => 'nullable|integer|min:1|max:365',
            'portal_base_url' => 'nullable|url|max:255',
        ]);

        PortalAccessToken::where('party_id', $party->id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        [$record, $plain] = PortalAccessToken::issue($party, $request->user(), (int) ($validated['days'] ?? 30));

        $base = rtrim($validated['portal_base_url'] ?? config('app.url'), '/');
        $url = $base . '/portal?token=' . urlencode($plain);

        AuditLog::log('issue_portal_token', 'Party', (string) $party->id, null, [
            'expires_at' => $record->expires_at?->toIso8601String(),
        ], $party->store_id);

        return response()->json([
            'success' => true,
            'token' => $plain,
            'portal_url' => $url,
            'expires_at' => $record->expires_at?->toIso8601String(),
            'party' => [
                'id' => $party->id,
                'name' => $party->name,
                'phone' => $party->phone,
                'gstin' => $party->gstin,
            ],
        ]);
    }

    public function revoke(Request $request, string $id): JsonResponse
    {
        $party = $this->findCustomer($request, $id);
        if (!$party) {
            return response()->json(['success' => false, 'message' => 'Customer not found in the selected store.'], 404);
        }

        $revoked = PortalAccessToken::where('party_id', $party->id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        AuditLog::log('revoke_portal_token', 'Party', (string) $party->id, ['active_tokens' => $revoked], ['active_tokens' => 0], $party->store_id);

        return response()->json(['success' => true, 'revoked' => $revoked]);
    }

    public function status(Request $request, string $id): JsonResponse
    {
        $party = $this->findCustomer($request, $id);
        if (!$party) {
            return response()->json(['success' => false, 'message' => 'Customer not found in the selected store.'], 404);
        }

        $token = PortalAccessToken::where('party_id', $party->id)
            ->orderByDesc('id')
            ->first();

        return response()->json([
            'success' => true,
            'active' => $token?->isUsable() ?? false,
            'last_used_at' => $token?->last_used_at?->toIso8601String(),
            'expires_at' => $token?->expires_at?->toIso8601String(),
        ]);
    }
}
