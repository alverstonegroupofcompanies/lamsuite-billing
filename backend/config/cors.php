<?php

$domain = env('DOMAIN', 'example.com');
$customOrigins = array_filter(array_map('trim', explode(',', env('CORS_ALLOWED_ORIGINS', ''))));

$defaultOrigins = [
    "https://panel.{$domain}",
    "https://app.{$domain}",
    "https://{$domain}",
    'tauri://localhost',
    'https://tauri.localhost',
    'http://tauri.localhost',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
];

$allowedOrigins = !empty($customOrigins) ? $customOrigins : $defaultOrigins;

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'lan/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => env('APP_ENV') === 'local' && empty($customOrigins)
        ? array_merge($allowedOrigins, ['*'])
        : $allowedOrigins,

    'allowed_origins_patterns' => [
        '#^https://([a-zA-Z0-9-]+\.)*' . preg_quote($domain, '#') . '$#',
    ],

    'allowed_headers' => ['*'],

    'exposed_headers' => ['*'],

    'max_age' => 86400,

    'supports_credentials' => true,

];
