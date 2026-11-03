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
    private const CURRENT_APP_VERSION = '2.0.25';
    private const DEFAULT_MIN_VERSION = '2.0.21';

    /**
     * Get the latest desktop updater manifest (latest.json).
     * Serves from storage if present, or dynamically synthesizes standard Tauri v1 manifest.
     */
    public function getLatestManifest(Request $request): JsonResponse
    {
        $manifestPath = storage_path('app/updates/latest.json');
        if (File::exists($manifestPath)) {
            $content = json_decode(File::get($manifestPath), true);
            if ($content && is_array($content)) {
                return response()->json($this->rewriteManifestUrls($content));
            }
        }

        // Check fallback host path if mounted
        $hostPath = '/opt/lamsuite/updates/latest.json';
        if (File::exists($hostPath)) {
            $content = json_decode(File::get($hostPath), true);
            if ($content && is_array($content)) {
                return response()->json($this->rewriteManifestUrls($content));
            }
        }

        // Check public storage updates
        $publicPath = storage_path('app/public/updates/latest.json');
        if (File::exists($publicPath)) {
            $content = json_decode(File::get($publicPath), true);
            if ($content && is_array($content)) {
                return response()->json($this->rewriteManifestUrls($content));
            }
        }

        // Return synthesized valid manifest for current release
        return response()->json($this->synthesizeManifest(false));
    }

    /**
     * Get legacy Windows 7/8.1 manifest (latest-legacy-win7.json).
     */
    public function getLegacyManifest(Request $request): JsonResponse
    {
        $manifestPath = storage_path('app/updates/latest-legacy-win7.json');
        if (File::exists($manifestPath)) {
            $content = json_decode(File::get($manifestPath), true);
            if ($content && is_array($content)) {
                return response()->json($this->rewriteManifestUrls($content));
            }
        }

        $hostPath = '/opt/lamsuite/updates/latest-legacy-win7.json';
        if (File::exists($hostPath)) {
            $content = json_decode(File::get($hostPath), true);
            if ($content && is_array($content)) {
                return response()->json($this->rewriteManifestUrls($content));
            }
        }

        $publicPath = storage_path('app/public/updates/latest-legacy-win7.json');
        if (File::exists($publicPath)) {
            $content = json_decode(File::get($publicPath), true);
            if ($content && is_array($content)) {
                return response()->json($this->rewriteManifestUrls($content));
            }
        }

        return response()->json($this->synthesizeManifest(true));
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

        $candidates = [
            storage_path("app/updates/{$filename}"),
            "/opt/lamsuite/updates/{$filename}",
            storage_path("app/public/updates/{$filename}"),
        ];

        foreach ($candidates as $filePath) {
            if (File::exists($filePath)) {
                return response()->file($filePath, [
                    'Content-Type' => 'application/octet-stream',
                    'Content-Disposition' => 'attachment; filename="' . $filename . '"',
                    'Cache-Control' => 'public, max-age=86400',
                ]);
            }
        }

        abort(404, "Updater package '{$filename}' is not found on this server.");
    }

    /**
     * Dynamic target/version endpoint for Tauri updater.
     * If client has latest version -> returns 204 No Content.
     * If an update is available -> returns 200 with update payload.
     */
    public function checkDynamicUpdate(string $target, string $current_version): Response|JsonResponse
    {
        $cleanCurrent = ltrim(trim($current_version), 'v');
        $latest = $this->getLatestVersion();

        if (version_compare($cleanCurrent, $latest, '>=')) {
            // Already up to date: Tauri specification requires HTTP 204
            return response()->noContent();
        }

        $isLegacy = str_contains(strtolower($target), 'legacy') || str_contains(strtolower($target), 'win7');
        $fileName = $isLegacy
            ? 'LamSuite-Billing-windows-legacy-x64-setup.nsis.zip'
            : "LamSuite-Billing_{$latest}_x64-setup.nsis.zip";

        $downloadUrl = $this->buildDownloadUrl($fileName);

        return response()->json([
            'url' => $downloadUrl,
            'version' => $latest,
            'notes' => "LamSuite Billing update v{$latest}\nIncludes security enhancements, GST rules parity, and updater reliability.",
            'pub_date' => now()->toIso8601String(),
            'signature' => $isLegacy
                ? 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRR09ENStxSU9JbDhadnVreTZOck5jamh1OTJTUkZuZFM0VUhzUXRoT1JwRzFrWW52REVyRUFkVmpSRUgvdUdvemYwanJ1YUpDQm91bDFFcmw2eFpodTJCNEUxWkxuTkFvPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNjU3ODQ4CWZpbGU6TGFtU3VpdGUtQmlsbGluZy1MZWdhY3lfMi4wLjIzX3g2NC1zZXR1cC5uc2lzLnppcAozbG5Uc1QxSkl2TVZrTDdIcU5rNkRJK212K3Z6ZXpvQ2lXTnVVTWtwUVVvTFUyWTAwZTVGOENwMlN2c0RVKzZGME5VQ1dhV3FyL3c0L2tFc0pkS2FDUT09Cg=='
                : 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRR09ENStxSU9JbDhjZlVyMXdZYjRIbUY5dmRsbXlJZW9sL2MyaTlMTTFNNGdjbUpqUkRQa0VzbTFVeXl5dWdxR0FWSytEaUZmeGlVaVlSa0ovOTJlN0tlUWtPUTJmS2dNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNjU3MjE3CWZpbGU6TGFtU3VpdGUtQmlsbGluZ18yLjAuMjNfeDY0LXNldHVwLm5zaXMuemlwClBmT1RuZGREK1gvRXgrM0I0UkJET24vb0FpTXNUbVE5VHo2V1FmOTh6aWxjYWlLM2w1ZXVxRmpWSndRZUdsa3RDNnlkRzNnc2VDRDFnejdzSGJCcEFBPT0K',
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
     * Helper to retrieve currently released latest version.
     */
    private function getLatestVersion(): string
    {
        $manifestPath = storage_path('app/updates/latest.json');
        if (!File::exists($manifestPath)) {
            $manifestPath = '/opt/lamsuite/updates/latest.json';
        }
        if (File::exists($manifestPath)) {
            $manifest = json_decode(File::get($manifestPath), true);
            if (!empty($manifest['version'])) {
                return (string)$manifest['version'];
            }
        }

        $latest = CompanySetting::where('key', 'latest_desktop_release_version')
            ->latest()
            ->first();

        if ($latest && !empty($latest->value['version'])) {
            return (string)$latest->value['version'];
        }

        return self::CURRENT_APP_VERSION;
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

    /**
     * Synthesizes a valid multi-platform manifest with local direct download endpoints.
     */
    private function synthesizeManifest(bool $isLegacy): array
    {
        $version = $this->getLatestVersion();
        $date = now()->toIso8601String();

        if ($isLegacy) {
            $legacyFile = 'LamSuite-Billing-windows-legacy-x64-setup.nsis.zip';
            return [
                'version' => $version,
                'notes' => "LamSuite Billing Legacy Windows 7/8.1 v{$version} Update\nBundled Fixed WebView2 109 Runtime with zero Win8+ API imports.",
                'pub_date' => $date,
                'platforms' => [
                    'windows-x86_64' => [
                        'signature' => 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRR09ENStxSU9JbDhadnVreTZOck5jamh1OTJTUkZuZFM0VUhzUXRoT1JwRzFrWW52REVyRUFkVmpSRUgvdUdvemYwanJ1YUpDQm91bDFFcmw2eFpodTJCNEUxWkxuTkFvPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNjU3ODQ4CWZpbGU6TGFtU3VpdGUtQmlsbGluZy1MZWdhY3lfMi4wLjIzX3g2NC1zZXR1cC5uc2lzLnppcAozbG5Uc1QxSkl2TVZrTDdIcU5rNkRJK212K3Z6ZXpvQ2lXTnVVTWtwUVVvTFUyWTAwZTVGOENwMlN2c0RVKzZGME5VQ1dhV3FyL3c0L2tFc0pkS2FDUT09Cg==',
                        'url' => $this->buildDownloadUrl($legacyFile),
                    ],
                ],
            ];
        }

        $winFile = "LamSuite-Billing_{$version}_x64-setup.nsis.zip";
        return [
            'version' => $version,
            'notes' => "LamSuite Billing v{$version} Update\n- Full offline-first transaction support\n- Automated sync queue with live reconciliation\n- Modernized printing engine with integrated preview",
            'pub_date' => $date,
            'platforms' => [
                'windows-x86_64' => [
                    'signature' => 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRR09ENStxSU9JbDhjZlVyMXdZYjRIbUY5dmRsbXlJZW9sL2MyaTlMTTFNNGdjbUpqUkRQa0VzbTFVeXl5dWdxR0FWSytEaUZmeGlVaVlSa0ovOTJlN0tlUWtPUTJmS2dNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNjU3MjE3CWZpbGU6TGFtU3VpdGUtQmlsbGluZ18yLjAuMjNfeDY0LXNldHVwLm5zaXMuemlwClBmT1RuZGREK1gvRXgrM0I0UkJET24vb0FpTXNUbVE5VHo2V1FmOTh6aWxjYWlLM2w1ZXVxRmpWSndRZUdsa3RDNnlkRzNnc2VDRDFnejdzSGJCcEFBPT0K',
                    'url' => $this->buildDownloadUrl($winFile),
                ],
                'windows-x86_64-nsis' => [
                    'signature' => 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRR09ENStxSU9JbDhjZlVyMXdZYjRIbUY5dmRsbXlJZW9sL2MyaTlMTTFNNGdjbUpqUkRQa0VzbTFVeXl5dWdxR0FWSytEaUZmeGlVaVlSa0ovOTJlN0tlUWtPUTJmS2dNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNjU3MjE3CWZpbGU6TGFtU3VpdGUtQmlsbGluZ18yLjAuMjNfeDY0LXNldHVwLm5zaXMuemlwClBmT1RuZGREK1gvRXgrM0I0UkJET24vb0FpTXNUbVE5VHo2V1FmOTh6aWxjYWlLM2w1ZXVxRmpWSndRZUdsa3RDNnlkRzNnc2VDRDFnejdzSGJCcEFBPT0K',
                    'url' => $this->buildDownloadUrl($winFile),
                ],
            ],
        ];
    }
}
