<?php

use App\Exceptions\BusinessRuleException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->trustProxies(at: '*');

        // Older POS builds send local registry keys ("store_main") in place of
        // server store ids. Normalize them once for every API request so public
        // terminal endpoints never fall back to another tenant's store.
        $middleware->api(prepend: [
            \App\Http\Middleware\NormalizeStoreContext::class,
        ]);

        $middleware->validateCsrfTokens(except: [
            'api/*',
            'lan/*',
            'sanctum/csrf-cookie',
        ]);

        $middleware->alias([
            'rbac' => \App\Http\Middleware\CheckRoleAndPermission::class,
            'scope.store' => \App\Http\Middleware\ScopeStore::class,
            'ip.allowlist' => \App\Http\Middleware\CheckIpAllowlist::class,
            'portal.auth' => \App\Http\Middleware\AuthenticatePortal::class,
            'device.auth' => \App\Http\Middleware\AuthenticateDevice::class,
            // 'session.timeout' => \App\Http\Middleware\CheckSessionTimeout::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->render(function (BusinessRuleException $e) {
            return $e->render();
        });
    })->create();
