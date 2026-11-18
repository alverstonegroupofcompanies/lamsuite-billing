<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ScopeStore
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // Consolidated "All Stores" read scope (no single-store attribute)
        if (strtolower((string) $request->header('X-Store-Scope')) === 'all') {
            // Session/auth endpoints are store-independent and must keep working
            $storeIndependent = $request->is(
                'api/admin/logout',
                'api/admin/stop-impersonate',
                'api/admin/switch-store',
                'api/admin/impersonate',
                'api/admin/password-reset',
                'api/admin/me/preferences',
                'api/admin/2fa/*',
                'api/admin/reports/scheduled',
                'api/admin/reports/scheduled/*'
            );

            if (!$storeIndependent && !$request->isMethod('GET') && !$request->isMethod('HEAD')) {
                return response()->json([
                    'message' => 'All Stores scope is read-only. Select a specific store before making changes.',
                ], 422);
            }

            if (!$user->canViewAllStores()) {
                return response()->json([
                    'message' => 'All Stores scope requires access to every store.',
                ], 403);
            }

            $request->attributes->set('active_store_id', null);
            $request->attributes->set('store_scope_all', true);
            $request->attributes->set('accessible_store_ids', null);

            return $next($request);
        }

        // Determine requested store ID
        $requestedStoreId = $request->header('X-Store-Id')
            ?? $request->query('store_id')
            ?? $request->query('active_store_id')
            ?? $request->input('store_id')
            ?? $request->input('active_store_id')
            ?? $user->store_id;

        // Older POS builds send a local registry key ("store_main") that never
        // matches a server store. Ignore it and scope to the user's own store
        // instead of denying every request as a tenant violation.
        if ($this->isLocalRegistryKey($requestedStoreId)) {
            $requestedStoreId = $user->store_id;
        }

        if ($requestedStoreId !== null) {
            $requestedStoreId = (int) $requestedStoreId;

            if (!$user->canAccessStore($requestedStoreId)) {
                return response()->json([
                    'message' => 'Tenant isolation violation: cross-store access denied.',
                    'attempted_store_id' => $requestedStoreId,
                ], 403);
            }

            $request->attributes->set('active_store_id', $requestedStoreId);
        } else {
            // Super admin accessing globally or user has a default store
            $request->attributes->set('active_store_id', $user->store_id);
        }

        return $next($request);
    }

    private function isLocalRegistryKey(mixed $value): bool
    {
        return is_string($value) && preg_match('/^store_/i', trim($value)) === 1;
    }
}
