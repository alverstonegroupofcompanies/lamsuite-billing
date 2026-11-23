<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\RetiredRouteController;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * G1-SEC / SEC-01..03 — every /api route is authenticated unless it is on this
 * list on purpose. A new route that forgets its middleware fails here, not in a
 * penetration test.
 */
class RouteAuthAllowlistTest extends TestCase
{
    /** Routes that must answer before anyone or any counter is authenticated. */
    private const PUBLIC_BY_DESIGN = [
        'api/login',
        'api/auth/login',
        'api/auth/forgot-password',
        'api/auth/reset-password',
        'api/staff/login',
        'api/devices/validate',
        'api/counters/claim',
        // The till's own revocation probe; read by a till that may already be revoked.
        'api/counters/{id}/watch',
        // The till checks each store registered on the machine, each with its own token.
        'api/license/check',
        'api/public-ip',
        'api/network/public-ip',
        'api/app/update/latest.json',
        'api/app/update/latest-legacy-win7.json',
        'api/app/update/download/{filename}',
        'api/app/update/{target}/{current_version}',
    ];

    private const AUTH_MIDDLEWARE = ['auth:sanctum', 'counter.auth', 'device.auth', 'portal.auth'];

    public function test_every_api_route_is_authenticated_unless_public_by_design(): void
    {
        $unprotected = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (!str_starts_with($uri, 'api/')) {
                continue;
            }
            if (in_array($uri, self::PUBLIC_BY_DESIGN, true)) {
                continue;
            }
            if (($route->getAction('controller') ?? '') === RetiredRouteController::class) {
                continue;
            }

            $middleware = $route->gatherMiddleware();
            if (array_intersect(self::AUTH_MIDDLEWARE, $middleware) === []) {
                $unprotected[] = implode('|', $route->methods()) . ' ' . $uri;
            }
        }

        $this->assertSame([], array_values(array_unique($unprotected)), "Unauthenticated API routes:\n" . implode("\n", $unprotected));
    }
}
