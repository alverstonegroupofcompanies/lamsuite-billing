<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'app' => 'LamSuite / Alverstone Billing API',
        'version' => '2.0.0',
        'status' => 'healthy',
        'admin_panel' => 'http://localhost:5174',
        'docs' => '/api/documentation',
    ]);
});

Route::get('/lan/v1/health', [\App\Http\Controllers\Api\SyncController::class, 'lanHealth']);
Route::get('/lan/v1/pull', [\App\Http\Controllers\Api\SyncController::class, 'lanPullSnapshot']);
Route::post('/lan/v1/pair', [\App\Http\Controllers\Api\SyncController::class, 'lanPairCounter']);
Route::get('/lan/v1/clients', [\App\Http\Controllers\Api\SyncController::class, 'lanGetClients']);
Route::post('/lan/v1/clients/{id}/status', [\App\Http\Controllers\Api\SyncController::class, 'lanUpdateClientStatus']);
Route::post('/lan/v1/hub/config', [\App\Http\Controllers\Api\SyncController::class, 'lanUpdateHubConfig']);

Route::get('/admin/{any?}', function () {
    $distPath = base_path('../admin-panel/dist/index.html');
    if (file_exists($distPath)) {
        return response()->file($distPath);
    }
    return response()->json([
        'message' => 'LamSuite Web Admin Panel',
        'dev_server' => 'http://localhost:5174',
        'instruction' => 'Run `npm --prefix admin-panel run dev` to launch the admin panel.',
    ]);
})->where('any', '.*');

