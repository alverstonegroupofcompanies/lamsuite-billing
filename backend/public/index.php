<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
if (file_exists(__DIR__.'/../vendor/autoload.php')) {
    require __DIR__.'/../vendor/autoload.php';
} else {
    header('Content-Type: application/json', true, 500);
    echo json_encode(['error' => 'Composer dependencies not installed. Please run composer install.']);
    exit(1);
}

// Bootstrap Laravel and handle the request...
/** @var \Illuminate\Foundation\Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
