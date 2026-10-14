<?php

namespace App\Services\Migration;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class MigrationSourceReader
{
    /**
     * Reads data from the specified source (api, file, or device).
     * Returns an array of entities keyed by entity type.
     */
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
     * Read from live Laravel API.
     */
    public function readFromApi(array $config): array
    {
        $baseUrl = rtrim($config['url'] ?? '', '/');
        $token = $config['token'] ?? null;
        $username = $config['username'] ?? null;
        $password = $config['password'] ?? null;
        $storeId = $config['store_id'] ?? null;

        if (!$baseUrl) {
            throw new RuntimeException("API base URL is required.");
        }

        $client = Http::timeout(60)->retry(3, 1000);
        if ($token) {
            $client = $client->withToken($token);
        } elseif ($username && $password) {
            // First authenticate via login endpoint if token not provided
            $loginRes = $client->post("{$baseUrl}/api/auth/login", [
                'email' => $username,
                'password' => $password,
            ]);
            if (!$loginRes->successful()) {
                throw new RuntimeException("Failed to authenticate with old Laravel API: " . $loginRes->body());
            }
            $token = $loginRes->json('data.token') ?? $loginRes->json('token');
            $client = Http::timeout(60)->retry(3, 1000)->withToken($token);
        }

        // Pull full snapshot or entity by entity
        $res = $client->get("{$baseUrl}/api/sync/pull", [
            'store_id' => $storeId,
            'limit' => 0, // Request full snapshot
        ]);

        if (!$res->successful()) {
            throw new RuntimeException("API pull request failed: HTTP " . $res->status() . " - " . $res->body());
        }

        $payload = $res->json();
        $data = $payload['data']['snapshot'] ?? $payload['data'] ?? $payload;

        // Also fetch store profile & settings
        $storeRes = $client->get("{$baseUrl}/api/store");
        if ($storeRes->successful()) {
            $data['store_profile'] = $storeRes->json('data') ?? $storeRes->json();
        }

        return $data;
    }

    /**
     * Read from exported file bundle or JSON file.
     */
    public function readFromFile(array $config): array
    {
        $filePath = $config['file_path'] ?? '';
        if (!$filePath || !file_exists($filePath)) {
            throw new RuntimeException("Migration bundle file does not exist: {$filePath}");
        }

        $raw = file_get_contents($filePath);
        if (!$raw) {
            throw new RuntimeException("Migration bundle file is empty: {$filePath}");
        }

        // Check if gzipped
        if (str_ends_with(strtolower($filePath), '.gz')) {
            $raw = gzdecode($raw);
            if ($raw === false) {
                throw new RuntimeException("Failed to decompress gzip migration bundle.");
            }
        }

        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new RuntimeException("Invalid JSON structure in migration bundle: " . json_last_error_msg());
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

        $filePath = $config['file_path'] ?? '';
        if ($filePath && file_exists($filePath)) {
            return $this->readFromFile($config);
        }

        throw new RuntimeException("Device recovery data must provide either 'payload' array or 'file_path'.");
    }
}
