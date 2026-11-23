<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * The two principals a till can arrive with, in the order the CR puts them.
 *
 * Until B8 retires staff sign-in at the POS, a workstation still carries a
 * person's bearer token, so those requests keep resolving exactly as they do
 * today. Once it does not, the counter's device token speaks for the store:
 * AuthenticateDevice pins the tenant, refuses a locked or revoked counter and
 * rejects any request that names somebody else's store.
 *
 * Anything the endpoint needs from a *person* — their preferences, their own
 * password — stays behind plain auth:sanctum and is not this middleware's job.
 */
class AuthenticateCounterOrUser
{
    public function handle(Request $request, Closure $next): Response
    {
        $guard = Auth::guard('sanctum');

        if ($user = $guard->user()) {
            return $this->asPerson($guard, $user, $request, $next);
        }

        if ($user = $this->userFromBearerToken($request)) {
            return $this->asPerson($guard, $user, $request, $next);
        }

        // Resolved here rather than injected so a test that removes device
        // authentication still removes it through this route.
        return app(AuthenticateDevice::class)->handle($request, $next);
    }

    /**
     * Controllers call $request->user(), which reads the default guard, so the
     * guard that answered has to become the default one for this request.
     */
    private function asPerson($guard, mixed $user, Request $request, Closure $next): Response
    {
        $guard->setUser($user);
        Auth::shouldUse('sanctum');

        // G1-SEC: a person on a till route is held to the stores they may reach,
        // exactly as on the panel's routes — a cashier naming another store's id
        // is refused, and the store they land on is recorded as active_store_id.
        return app(ScopeStore::class)->handle($request, $next);
    }

    private function userFromBearerToken(Request $request): mixed
    {
        if (!$bearer = $request->bearerToken()) {
            return null;
        }

        try {
            return \Laravel\Sanctum\PersonalAccessToken::findToken($bearer)?->tokenable;
        } catch (\Throwable) {
            return null;
        }
    }
}
