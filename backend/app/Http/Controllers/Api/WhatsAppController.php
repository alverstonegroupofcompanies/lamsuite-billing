<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CompanySetting;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WhatsAppController extends Controller
{
    /**
     * Resolve the store's configured WhatsApp settings.
     */
    protected function resolveConfig(?string $storeId, ?string $apiUrl = null, ?string $apiKey = null, ?string $sessionId = null): array
    {
        $resolvedStoreId = $storeId;
        if (!$resolvedStoreId) {
            $store = Store::first();
            $resolvedStoreId = $store ? $store->id : 'store_main';
        }

        $setting = CompanySetting::where('store_id', $resolvedStoreId)->where('key', 'whatsapp')->first();
        $config = $setting ? ($setting->value ?? []) : [];

        $finalApiUrl = $apiUrl ?: ($config['api_url'] ?? 'https://wa-api.alverstone.in');
        $finalApiKey = $apiKey ?: ($config['api_key'] ?? '');
        $finalSessionId = $sessionId ?: ($config['session_id'] ?? 'default');
        $enabled = isset($config['enabled']) ? (bool)$config['enabled'] : false;

        return [
            'store_id' => $resolvedStoreId,
            'enabled' => $enabled,
            'api_url' => rtrim($finalApiUrl, '/'),
            'api_key' => $finalApiKey,
            'session_id' => $finalSessionId ?: 'default',
            'send_pdf' => $config['send_pdf'] ?? true,
        ];
    }

    /**
     * Clean phone number into international WhatsApp JID (<phone>@c.us)
     */
    public static function formatChatId(string $phone): string
    {
        $clean = preg_replace('/\D/', '', $phone);
        // If 10 digits (standard Indian mobile number), prepend 91
        if (strlen($clean) === 10) {
            $clean = '91' . $clean;
        } elseif (strlen($clean) === 11 && str_starts_with($clean, '0')) {
            $clean = '91' . substr($clean, 1);
        }
        return $clean . '@c.us';
    }

    /**
     * Dispatch an invoice via OpenWA REST API.
     */
    public function sendInvoice(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone' => 'required|string',
            'caption' => 'nullable|string',
            'pdf_base64' => 'nullable|string',
            'filename' => 'nullable|string',
            'store_id' => 'nullable|string',
            'api_url' => 'nullable|string',
            'api_key' => 'nullable|string',
            'session_id' => 'nullable|string',
        ]);

        $config = $this->resolveConfig(
            $validated['store_id'] ?? null,
            $validated['api_url'] ?? null,
            $validated['api_key'] ?? null,
            $validated['session_id'] ?? null
        );

        if (empty($config['api_key'])) {
            return response()->json([
                'success' => false,
                'error' => 'OpenWA API key is not configured. Please enter your API key in Admin Panel Settings.',
            ], 422);
        }

        $chatId = self::formatChatId($validated['phone']);
        $sessionId = $config['session_id'];
        $apiUrl = $config['api_url'];
        $apiKey = $config['api_key'];

        $hasPdf = !empty($validated['pdf_base64']);
        $endpoint = $hasPdf
            ? "{$apiUrl}/api/sessions/{$sessionId}/messages/send-document"
            : "{$apiUrl}/api/sessions/{$sessionId}/messages/send-text";

        $caption = $validated['caption'] ?? 'Your Tax Invoice';
        $filename = $validated['filename'] ?? 'Invoice.pdf';

        $payload = $hasPdf
            ? [
                'chatId' => $chatId,
                'base64' => $validated['pdf_base64'],
                'mimetype' => 'application/pdf',
                'filename' => $filename,
                'caption' => $caption,
            ]
            : [
                'chatId' => $chatId,
                'text' => $caption,
            ];

        try {
            $response = Http::withHeaders([
                'X-API-Key' => $apiKey,
                'Content-Type' => 'application/json',
            ])->timeout(30)->post($endpoint, $payload);

            if ($response->successful()) {
                $body = $response->json();
                return response()->json([
                    'success' => true,
                    'chatId' => $chatId,
                    'sessionId' => $sessionId,
                    'result' => $body,
                    'message' => 'Invoice dispatched successfully via WhatsApp',
                ]);
            }

            $status = $response->status();
            $errorBody = $response->json();
            $errorMessage = $errorBody['message'] ?? ($errorBody['error'] ?? 'Failed to send message via OpenWA');

            Log::warning('OpenWA invoice dispatch returned error', [
                'status' => $status,
                'error' => $errorMessage,
                'chatId' => $chatId,
            ]);

            return response()->json([
                'success' => false,
                'status' => $status,
                'error' => "OpenWA Error ({$status}): {$errorMessage}",
                'details' => $errorBody,
            ], $status >= 400 && $status < 500 ? $status : 502);

        } catch (\Throwable $e) {
            Log::error('OpenWA dispatch exception: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'error' => 'Unable to connect to OpenWA gateway: ' . $e->getMessage(),
            ], 503);
        }
    }

    /**
     * Test connection and validate API key against OpenWA.
     */
    public function testConnection(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'nullable|string',
            'api_url' => 'nullable|string',
            'api_key' => 'nullable|string',
        ]);

        $config = $this->resolveConfig(
            $validated['store_id'] ?? null,
            $validated['api_url'] ?? null,
            $validated['api_key'] ?? null
        );

        if (empty($config['api_key'])) {
            return response()->json([
                'success' => false,
                'valid' => false,
                'error' => 'API Key is required to test OpenWA connection.',
            ], 422);
        }

        $apiUrl = $config['api_url'];
        $apiKey = $config['api_key'];

        try {
            $response = Http::withHeaders([
                'X-API-Key' => $apiKey,
                'Content-Type' => 'application/json',
            ])->timeout(10)->post("{$apiUrl}/api/auth/validate");

            if ($response->successful()) {
                $body = $response->json();
                return response()->json([
                    'success' => true,
                    'valid' => $body['valid'] ?? true,
                    'role' => $body['role'] ?? 'operator',
                    'engineType' => $body['engineType'] ?? null,
                    'message' => 'OpenWA connection verified successfully',
                ]);
            }

            return response()->json([
                'success' => false,
                'valid' => false,
                'error' => 'OpenWA authentication failed: ' . ($response->json('message') ?? 'Invalid API Key'),
            ], 401);

        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'valid' => false,
                'error' => 'Cannot reach OpenWA instance at ' . $apiUrl . ': ' . $e->getMessage(),
            ], 503);
        }
    }

    /**
     * Fetch list of active/ready sessions from OpenWA instance.
     */
    public function sessions(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'nullable|string',
            'api_url' => 'nullable|string',
            'api_key' => 'nullable|string',
        ]);

        $config = $this->resolveConfig(
            $validated['store_id'] ?? null,
            $validated['api_url'] ?? null,
            $validated['api_key'] ?? null
        );

        if (empty($config['api_key'])) {
            return response()->json([
                'success' => false,
                'sessions' => [],
                'error' => 'API key is required to fetch OpenWA sessions.',
            ], 422);
        }

        $apiUrl = $config['api_url'];
        $apiKey = $config['api_key'];

        try {
            $response = Http::withHeaders([
                'X-API-Key' => $apiKey,
                'Accept' => 'application/json',
            ])->timeout(10)->get("{$apiUrl}/api/sessions");

            if ($response->successful()) {
                $rawSessions = $response->json();
                $normalized = [];

                if (is_array($rawSessions)) {
                    foreach ($rawSessions as $item) {
                        if (is_string($item)) {
                            $normalized[] = [
                                'id' => $item,
                                'name' => $item,
                                'status' => 'ready',
                            ];
                        } elseif (is_array($item)) {
                            $normalized[] = [
                                'id' => $item['id'] ?? ($item['name'] ?? 'default'),
                                'name' => $item['name'] ?? ($item['id'] ?? 'default'),
                                'status' => $item['status'] ?? 'unknown',
                            ];
                        }
                    }
                }

                // If empty but valid, provide 'default' as an option
                if (empty($normalized)) {
                    $normalized[] = [
                        'id' => 'default',
                        'name' => 'default',
                        'status' => 'default',
                    ];
                }

                return response()->json([
                    'success' => true,
                    'sessions' => $normalized,
                ]);
            }

            return response()->json([
                'success' => false,
                'sessions' => [],
                'error' => 'Failed to retrieve sessions: ' . ($response->json('message') ?? 'OpenWA returned status ' . $response->status()),
            ], $response->status());

        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'sessions' => [],
                'error' => 'Cannot connect to OpenWA: ' . $e->getMessage(),
            ], 503);
        }
    }
}
