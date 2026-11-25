<?php

namespace App\Http\Controllers\Api;

use App\Models\CompanySetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\File;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class DesktopUpdateController
{
    private const CURRENT_APP_VERSION = '2.1.7';
    private const DEFAULT_MIN_VERSION = '2.0.21';

    /**
     * Get the latest desktop updater manifest (latest.json).
     * Serves a signed release that is actually present, or 204 when none is published.
     */
    public function getLatestManifest(Request $request): Response|JsonResponse
    {
        $manifest = $this->registeredManifest(false);

        return $manifest
            ? response()->json($this->rewriteManifestUrls($manifest))
            : response()->noContent();
    }

    /**
     * Get legacy Windows 7/8.1 manifest (latest-legacy-win7.json).
     */
    public function getLegacyManifest(Request $request): Response|JsonResponse
    {
        $manifest = $this->registeredManifest(true);

        return $manifest
            ? response()->json($this->rewriteManifestUrls($manifest))
            : response()->noContent();
    }

    /**
     * Serve raw updater binary files (.nsis.zip, .sig, .exe) to client workstations.
     */
    public function downloadUpdateBinary(string $filename): BinaryFileResponse
    {
        $filename = basename($filename);
        if (!preg_match('/^[A-Za-z0-9._-]+\.(zip|exe|sig|tar\.gz|AppImage)$/i', $filename)) {
            abort(404, 'Invalid updater asset filename.');
        }

        $filePath = $this->locateUpdateFile($filename);
        if ($filePath !== null) {
            return response()->file($filePath, [
                'Content-Type' => 'application/octet-stream',
                'Content-Disposition' => 'attachment; filename="' . $filename . '"',
                'Cache-Control' => 'public, max-age=86400',
            ]);
        }

        abort(404, "Updater package '{$filename}' is not found on this server.");
    }

    /**
     * Dynamic target/version endpoint for Tauri updater.
     * If the client is current, or no signed package is published, returns 204.
     */
    public function checkDynamicUpdate(string $target, string $current_version): Response|JsonResponse
    {
        $isLegacy = str_contains(strtolower($target), 'legacy') || str_contains(strtolower($target), 'win7');
        $manifest = $this->registeredManifest($isLegacy);
        if ($manifest === null) {
            return response()->noContent();
        }

        $latest = (string) $manifest['version'];
        $cleanCurrent = ltrim(trim($current_version), 'v');
        if (version_compare($cleanCurrent, $latest, '>=')) {
            // Already up to date: Tauri specification requires HTTP 204
            return response()->noContent();
        }

        $manifest = $this->rewriteManifestUrls($manifest);
        $platformKey = $this->resolvePlatformKey($manifest['platforms'], $target);
        if ($platformKey === null) {
            return response()->noContent();
        }

        $platform = $manifest['platforms'][$platformKey];

        return response()->json([
            'url' => $platform['url'],
            'version' => $latest,
            'notes' => (string) ($manifest['notes'] ?? ''),
            'pub_date' => (string) ($manifest['pub_date'] ?? now()->toIso8601String()),
            'signature' => $platform['signature'],
        ]);
    }

    /**
     * Admin route: Get minimum required desktop version.
     */
    public function getMinVersion(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id') ?: $request->user()?->store_id;
        $setting = CompanySetting::where('key', 'min_required_desktop_version')
            ->where(function ($q) use ($storeId) {
                if ($storeId) {
                    $q->where('store_id', $storeId)->orWhereNull('store_id');
                } else {
                    $q->whereNull('store_id');
                }
            })
            ->latest()
            ->first();

        $minVersion = $setting ? ($setting->value['version'] ?? self::DEFAULT_MIN_VERSION) : self::DEFAULT_MIN_VERSION;

        return response()->json([
            'min_version' => $minVersion,
            'latest_version' => $this->getLatestVersion(),
            'current_build_version' => self::CURRENT_APP_VERSION,
        ]);
    }

    /**
     * Admin route: Update minimum required desktop version.
     */
    public function setMinVersion(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'min_version' => 'required|string|regex:/^\d+\.\d+\.\d+$/',
        ]);

        $storeId = $request->get('active_store_id') ?: $request->user()?->store_id;

        CompanySetting::updateOrCreate(
            [
                'store_id' => $storeId,
                'key' => 'min_required_desktop_version',
            ],
            [
                'value' => [
                    'version' => $validated['min_version'],
                    'updated_at' => now()->toIso8601String(),
                    'updated_by' => $request->user()?->email ?: 'admin',
                ],
                'is_secret' => false,
            ]
        );

        return response()->json([
            'message' => 'Minimum desktop version updated successfully',
            'min_version' => $validated['min_version'],
            'latest_version' => $this->getLatestVersion(),
        ]);
    }

    /**
     * Helper to retrieve currently released latest version, preferring a
     * manifest whose signatures and packages are actually present.
     */
    private function getLatestVersion(): string
    {
        foreach ([false, true] as $legacy) {
            $manifest = $this->registeredManifest($legacy);
            if ($manifest && !empty($manifest['version'])) {
                return (string) $manifest['version'];
            }
        }

        $latest = CompanySetting::where('key', 'latest_desktop_release_version')
            ->latest()
            ->first();

        if ($latest && !empty($latest->value['version'])) {
            return (string) $latest->value['version'];
        }

        return self::CURRENT_APP_VERSION;
    }

    /**
     * Load the first manifest that describes at least one real, signed package.
     * Platforms whose download is missing or unsigned are dropped; a manifest
     * with nothing left is treated as not published.
     */
    private function registeredManifest(bool $legacy): ?array
    {
        foreach ($this->manifestLocations($legacy) as $manifestPath) {
            if (!File::isFile($manifestPath)) {
                continue;
            }

            $manifest = json_decode(File::get($manifestPath), true);
            if (!is_array($manifest) || !is_string($manifest['version'] ?? null) || $manifest['version'] === '') {
                continue;
            }
            if (empty($manifest['platforms']) || !is_array($manifest['platforms'])) {
                continue;
            }

            $platforms = [];
            foreach ($manifest['platforms'] as $platform => $data) {
                if (!is_array($data)) {
                    continue;
                }

                $signature = $data['signature'] ?? null;
                $url = $data['url'] ?? null;
                if (!is_string($signature) || trim($signature) === '' || !is_string($url) || trim($url) === '') {
                    continue;
                }

                $filename = basename(parse_url($url, PHP_URL_PATH) ?: $url);
                if ($filename === '' || $this->locateUpdateFile($filename) === null) {
                    continue;
                }

                $platforms[$platform] = $data;
            }

            if ($platforms === []) {
                continue;
            }

            $manifest['platforms'] = $platforms;

            return $manifest;
        }

        return null;
    }

    /**
     * Pick the manifest platform that matches the updater's target string.
     */
    private function resolvePlatformKey(array $platforms, string $target): ?string
    {
        $normalized = strtolower($target);
        if (isset($platforms[$target])) {
            return $target;
        }
        if (isset($platforms[$normalized])) {
            return $normalized;
        }

        $family = null;
        foreach (['windows', 'darwin', 'linux'] as $candidate) {
            if (str_contains($normalized, $candidate) || ($candidate === 'darwin' && str_contains($normalized, 'mac'))) {
                $family = $candidate;
                break;
            }
        }

        foreach (array_keys($platforms) as $key) {
            if ($family !== null && str_starts_with(strtolower((string) $key), $family)) {
                return (string) $key;
            }
        }

        return $family === null ? (string) array_key_first($platforms) : null;
    }

    /**
     * @return string[]
     */
    private function manifestLocations(bool $legacy): array
    {
        $name = $legacy ? 'latest-legacy-win7.json' : 'latest.json';

        return [
            storage_path("app/updates/{$name}"),
            "/opt/lamsuite/updates/{$name}",
            storage_path("app/public/updates/{$name}"),
        ];
    }

    private function locateUpdateFile(string $filename): ?string
    {
        foreach ([
            storage_path("app/updates/{$filename}"),
            "/opt/lamsuite/updates/{$filename}",
            storage_path("app/public/updates/{$filename}"),
        ] as $filePath) {
            if (File::isFile($filePath)) {
                return $filePath;
            }
        }

        return null;
    }

    /**
     * Rewrites manifest download URLs to serve from the LamStone API server.
     */
    private function rewriteManifestUrls(array $manifest): array
    {
        if (isset($manifest['platforms']) && is_array($manifest['platforms'])) {
            foreach ($manifest['platforms'] as $platform => &$data) {
                if (isset($data['url']) && is_string($data['url'])) {
                    $url = $data['url'];
                    $filename = basename(parse_url($url, PHP_URL_PATH) ?: $url);
                    if ($filename) {
                        $data['url'] = $this->buildDownloadUrl($filename);
                    }
                }
            }
        }

        return $manifest;
    }

    /**
     * Builds a full HTTPS download URL for the requested asset.
     */
    private function buildDownloadUrl(string $filename): string
    {
        $baseUrl = config('app.url');
        if (empty($baseUrl) || str_contains($baseUrl, 'localhost')) {
            $baseUrl = url('/');
        }
        $baseUrl = rtrim($baseUrl, '/');

        // Enforce HTTPS scheme on production lamstonehealthcare.com domain
        if (str_contains($baseUrl, 'lamstonehealthcare.com') || request()->header('X-Forwarded-Proto') === 'https') {
            $baseUrl = preg_replace('/^http:/i', 'https:', $baseUrl);
        }

        return "{$baseUrl}/api/app/update/download/{$filename}";
    }
}
