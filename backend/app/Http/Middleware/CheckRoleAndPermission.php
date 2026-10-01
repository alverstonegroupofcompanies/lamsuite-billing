<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckRoleAndPermission
{
    public function handle(Request $request, Closure $next, string $module, string $action = 'view'): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->hasPermission($module, $action)) {
            return response()->json([
                'message' => "Access denied. You lack '{$action}' permission for '{$module}'.",
                'role' => $user->role,
                'required' => ['module' => $module, 'action' => $action],
            ], 403);
        }

        return $next($request);
    }
}
