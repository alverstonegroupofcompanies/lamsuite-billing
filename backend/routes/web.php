<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'app' => 'LamSuite / Alverstone Billing API',
        'version' => '2.0.0',
        'status' => 'healthy',
        'docs' => '/api/documentation',
    ]);
});
