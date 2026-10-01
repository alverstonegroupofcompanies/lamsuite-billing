<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckIpAllowlist
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && !empty($user->ip_allowlist)) {
            $allowedIps = array_filter(array_map('trim', explode(',', $user->ip_allowlist)));
            $clientIp = $request->ip();

            if (!empty($allowedIps) && !in_array($clientIp, $allowedIps) && !in_array('127.0.0.1', $allowedIps)) {
                return response()->json([
                    'message' => 'IP address not authorized for this account.',
                    'client_ip' => $clientIp,
                ], 403);
            }
        }

        return $next($request);
    }
}
