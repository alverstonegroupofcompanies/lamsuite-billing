<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use App\Models\UserSession;

class CheckSessionTimeout
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user) {
            $timeoutMinutes = $user->idle_timeout_minutes ?? 15;

            // Find current active session or update last activity
            $session = UserSession::where('user_id', $user->id)
                ->where('is_active', true)
                ->latest('last_activity')
                ->first();

            if ($session && $session->last_activity) {
                $idleSeconds = now()->diffInSeconds($session->last_activity);
                if ($idleSeconds > ($timeoutMinutes * 60)) {
                    $session->update(['is_active' => false]);
                    // Revoke current access token
                    if ($request->user()->currentAccessToken()) {
                        $request->user()->currentAccessToken()->delete();
                    }
                    return response()->json([
                        'message' => 'Session timed out due to inactivity. Please log in again.',
                        'session_expired' => true,
                    ], 401);
                }
            }

            // Update or create active session record
            if ($session) {
                $session->update([
                    'last_activity' => now(),
                    'ip_address' => $request->ip(),
                ]);
            } else {
                UserSession::create([
                    'user_id' => $user->id,
                    'ip_address' => $request->ip(),
                    'user_agent' => substr($request->userAgent() ?? '', 0, 255),
                    'last_activity' => now(),
                    'is_active' => true,
                ]);
            }
        }

        return $next($request);
    }
}
