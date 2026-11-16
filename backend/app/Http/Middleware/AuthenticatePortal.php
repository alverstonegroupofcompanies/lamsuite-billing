<?php

namespace App\Http\Middleware;

use App\Models\PortalAccessToken;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticatePortal
{
    public function handle(Request $request, Closure $next): Response
    {
        $plain = $request->bearerToken();

        if (!$plain) {
            return response()->json(['message' => 'Portal token missing.'], 401);
        }

        $token = PortalAccessToken::with(['party', 'store'])
            ->where('token_hash', hash('sha256', $plain))
            ->first();

        if (!$token || !$token->isUsable()) {
            return response()->json(['message' => 'Portal link is invalid or has expired.'], 401);
        }

        $party = $token->party;
        $store = $token->store;

        if (!$party || !$store || !$party->is_active) {
            return response()->json(['message' => 'Portal access is no longer available.'], 403);
        }

        $token->forceFill(['last_used_at' => now()])->save();

        $request->attributes->set('portal_token', $token);
        $request->attributes->set('portal_party', $party);
        $request->attributes->set('portal_store', $store);

        return $next($request);
    }
}
