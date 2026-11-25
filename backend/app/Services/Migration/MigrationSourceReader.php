<?php

namespace App\Services\Migration;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class MigrationSourceReader
{
    /**
     * Entity keys the pipeline knows how to migrate. A bundle that carries none of
     * these is not a migration bundle, and saying so beats importing nothing.
     */
    private const ENTITY_KEYS = [
        'store_profile', 'stores', 'company_settings', 'store_settings',
        'groups', 'brands', 'units', 'banks', 'locations', 'departments', 'designations',
        'discount_schemas', 'expense_categories',
        'customers', 'suppliers', 'doctors', 'patients',
        'users', 'billing_app_users',
        'products', 'product_batches', 'batches',
        'invoices', 'sales_returns', 'returns', 'credit_notes', 'return_invoices',
        'purchases', 'purchase_documents', 'purchase_returns', 'debit_notes',
        'stock_adjustments', 'stock_transfers', 'stock_events',
        'expenses', 'expense_documents',
        'customer_payments', 'customer_loans', 'quotations', 'device_holds',
    ];

    public function readSource(string $sourceType, array $config): array
    {
        return match ($sourceType) {
            'api' => $this->readFromApi($config),
            'file' => $this->readFromFile($config),
            'device' => $this->readFromDevice($config),
            default => throw new RuntimeException("Unsupported source type: {$sourceType}"),
        };
    }

    /**
     * Which migration entities a payload carries, and how many rows of each.
     *
     * @return array<string,int>
     */
    public function presentEntities(array $data): array
    {
        $present = [];

        foreach (self::ENTITY_KEYS as $key) {
            $value = $data[$key] ?? null;
            if (is_array($value)) {
                $present[$key] = count($value);
            }
        }

        return $present;
    }

    /**
     * Read from the live legacy Laravel API.
     */
    public function readFromApi(array $config): array
    {
        $baseUrl = rtrim((string) ($config['url'] ?? ''), '/');
        $token = $config['token'] ?? null;
        $username = $config['username'] ?? null;
        $password = $config['password'] ?? null;
        $storeId = $config['store_id'] ?? null;

        if (!$baseUrl) {
            throw new RuntimeException('An API base URL is required.');
        }

        if (!preg_match('#^https?://#i', $baseUrl)) {
            throw new RuntimeException("The API base URL must start with http:// or https://. Received: {$baseUrl}");
        }

        $client = Http::timeout(120)->retry(3, 1000);

        if (!$token && $username && $password) {
            // The legacy panel signs people in at /api/login; there is no /api/auth/login.
            $loginRes = $client->post("{$baseUrl}/api/login", [
                'email' => $username,
                'password' => $password,
            ]);

            if (!$loginRes->successful()) {
                throw new RuntimeException(
                    "The legacy server refused this account (HTTP {$loginRes->status()}). "
                    . 'Legacy logins are email addresses, not usernames.'
                );
            }

            $token = $loginRes->json('data.token') ?? $loginRes->json('token');
            if (!$token) {
                throw new RuntimeException('The legacy login response carried no token.');
            }

            $client = Http::timeout(120)->retry(3, 1000)->withToken($token);
        } elseif ($token) {
            $client = $client->withToken($token);
        } else {
            throw new RuntimeException(
                'The legacy pull needs a token. Mint one on the legacy panel at /admin/migration-token '
                . 'against the store being migrated.'
            );
        }

        $res = $client->get("{$baseUrl}/api/sync/pull", [
            'store_id' => $storeId,
            'limit' => 0, // full snapshot
        ]);

        if ($res->status() === 401 || $res->status() === 403) {
            throw new RuntimeException(
                "The legacy server rejected this token (HTTP {$res->status()}). "
                . 'Mint a fresh one at /admin/migration-token — it has to carry the store:<id> ability, '
                . 'otherwise the pull answers for the account holder\'s primary store.'
            );
        }

        if ($res->status() === 404) {
            throw new RuntimeException(
                "{$baseUrl} has no /api/sync/pull (HTTP 404), so it is not the legacy v1 panel. "
                . 'Use the admin host, not the portal.'
            );
        }

        if (!$res->successful()) {
            throw new RuntimeException("The legacy pull failed: HTTP {$res->status()}.");
        }

        $payload = $res->json();
        if (!is_array($payload)) {
            throw new RuntimeException(
                "{$baseUrl} replied with something that is not JSON — that host is serving a web app, "
                . 'not the legacy API.'
            );
        }

        $data = $payload['data']['snapshot'] ?? $payload['data'] ?? $payload;

        $storeRes = $client->get("{$baseUrl}/api/store");
        if ($storeRes->successful() && is_array($storeRes->json())) {
            $data['store_profile'] = $storeRes->json('data') ?? $storeRes->json();
        }

        if ($this->presentEntities($data) === []) {
            throw new RuntimeException(
                'The legacy pull answered but carried no migration entities. '
                . 'Check that the token was minted for the store that actually holds the data.'
            );
        }

        return $data;
    }

    /**
     * Read a bundle this service uploaded. Only the reference the upload issued is
     * accepted, so a caller cannot name a file on this server.
     */
    public function readFromFile(array $config): array
    {
        $ref = (string) ($config['bundle_ref'] ?? '');

        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $ref)) {
            throw new RuntimeException(
                'A bundle_ref issued by the upload endpoint is required. Upload the bundle file first.'
            );
        }

        $disk = Storage::disk('local');
        $path = "migrations/{$ref}.json";

        if (!$disk->exists($path)) {
            throw new RuntimeException('That bundle is no longer on the server. Upload it again.');
        }

        $raw = $disk->get($path);
        if (str_starts_with($raw, "\x1f\x8b")) {
            $decoded = gzdecode($raw);
            if ($decoded === false) {
                throw new RuntimeException('The stored bundle could not be decompressed.');
            }
            $raw = $decoded;
        }

        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new RuntimeException('The stored bundle is not readable JSON: ' . json_last_error_msg());
        }

        if ($this->presentEntities($data) === []) {
            throw new RuntimeException(
                'The bundle holds no migration entities. Export it again with "php artisan lamsuite:export-store <store_id>".'
            );
        }

        return $data;
    }

    /**
     * Read from device recovery export (IndexedDB / sync queue / holds).
     */
    public function readFromDevice(array $config): array
    {
        if (isset($config['payload']) && is_array($config['payload'])) {
            return $config['payload'];
        }

        if (!empty($config['bundle_ref'])) {
            return $this->readFromFile($config);
        }

        throw new RuntimeException("Device recovery data must provide either a 'payload' array or a 'bundle_ref'.");
    }
}
