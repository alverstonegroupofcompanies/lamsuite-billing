<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\StoreController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\PurchaseController;
use App\Http\Controllers\Api\StockController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\Api\ReportController;

/*
|--------------------------------------------------------------------------
| LamSuite / Alverstone Billing API Routes (OpenAPI 3.0.3 Contract)
|--------------------------------------------------------------------------
*/

// Public Authentication & Device Onboarding
Route::post('/login', [AuthController::class, 'login']);
Route::post('/devices/register', [AuthController::class, 'registerDevice']);

// Protected Store Operations (Sanctum Authenticated)
Route::middleware('auth:sanctum')->group(function () {
    // Store Profile & Hardware
    Route::get('/store', [StoreController::class, 'show']);
    Route::put('/store', [StoreController::class, 'update']);

    // Catalog & Batches
    Route::get('/products', [ProductController::class, 'index']);
    Route::post('/products', [ProductController::class, 'store']);
    Route::get('/products/{id}', [ProductController::class, 'show']);
    Route::put('/products/{id}', [ProductController::class, 'update']);
    Route::delete('/products/{id}', [ProductController::class, 'destroy']);
    Route::post('/products/{id}/batches', [ProductController::class, 'addBatch']);

    // POS Invoices & Sales Documents
    Route::get('/invoices', [InvoiceController::class, 'index']);
    Route::post('/invoices', [InvoiceController::class, 'store']);
    Route::get('/invoices/{id}', [InvoiceController::class, 'show']);
    Route::post('/invoices/{id}/cancel', [InvoiceController::class, 'cancel']);

    // Purchases & Inward Stock
    Route::get('/purchases', [PurchaseController::class, 'index']);
    Route::post('/purchases', [PurchaseController::class, 'store']);
    Route::get('/purchases/{id}', [PurchaseController::class, 'show']);

    // Stock & Inventory Control
    Route::post('/stock/adjustments', [StockController::class, 'recordAdjustment']);
    Route::post('/stock/transfers', [StockController::class, 'dispatchTransfer']);
    Route::get('/stock/batches/near-expiry', [StockController::class, 'nearExpiry']);
    Route::get('/stock/products/low-stock', [StockController::class, 'lowStock']);

    // Offline Sync Engine (Idempotent Batch Push / Pull)
    Route::post('/sync/push/invoices', [SyncController::class, 'pushInvoices']);
    Route::post('/sync/push/stock-events', [SyncController::class, 'pushStockEvents']);
    Route::get('/sync/pull/deltas', [SyncController::class, 'pullDeltas']);

    // Indian Statutory GST & Financial Reports
    Route::get('/reports/daily-collection', [ReportController::class, 'dailyCollection']);
    Route::get('/reports/gstr-1', [ReportController::class, 'gstr1']);
    Route::get('/reports/hsn-summary', [ReportController::class, 'hsnSummary']);
    Route::get('/reports/customer-aging', [ReportController::class, 'customerAging']);
});
