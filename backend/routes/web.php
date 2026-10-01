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

