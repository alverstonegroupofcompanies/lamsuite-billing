<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->validateCsrfTokens(except: [
            'api/*',
            'lan/*',
            'sanctum/csrf-cookie',
        ]);

        $middleware->alias([
            'rbac' => \App\Http\Middleware\CheckRoleAndPermission::class,
            'scope.store' => \App\Http\Middleware\ScopeStore::class,
            'ip.allowlist' => \App\Http\Middleware\CheckIpAllowlist::class,
            'session.timeout' => \App\Http\Middleware\CheckSessionTimeout::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
