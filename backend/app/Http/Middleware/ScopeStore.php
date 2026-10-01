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

        // Determine requested store ID
        $requestedStoreId = $request->header('X-Store-Id')
            ?? $request->query('store_id')
            ?? $request->input('store_id')
            ?? $user->store_id;

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
}
