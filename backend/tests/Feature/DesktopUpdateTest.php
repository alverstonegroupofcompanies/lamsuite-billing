<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Tests\TestCase;

class DesktopUpdateTest extends TestCase
{
    private function updatesDir(): string
    {
        $dir = storage_path('app/updates');
        if (! File::isDirectory($dir)) {
            File::makeDirectory($dir, 0755, true);
        }

        return $dir;
    }

    /**
     * @return array{0: array, 1: string}
     */
    private function registerRelease(string $version = '2.0.99'): array
    {
        $dir = $this->updatesDir();
        $zip = "LamSuite-Billing_{$version}_x64-setup.nsis.zip";
        $signature = base64_encode("untrusted comment: fixture signature\nFIXTURE-SIGNATURE-{$version}");

        $manifest = [
            'version' => $version,
            'notes' => 'fixture notes',
            'pub_date' => '2026-01-01T00:00:00+00:00',
            'platforms' => [
                'windows-x86_64' => [
                    'signature' => $signature,
                    'url' => "https://updates.example.test/download/{$zip}",
                ],
            ],
        ];

        File::put("{$dir}/latest.json", json_encode($manifest));
        File::put("{$dir}/{$zip}", 'DUMMY_ZIP_CONTENT');

        return [$manifest, $zip];
    }

    private function forgetRelease(?string $zip = null): void
    {
        $dir = $this->updatesDir();
        File::delete("{$dir}/latest.json");
        File::delete("{$dir}/latest-legacy-win7.json");
        if ($zip) {
            File::delete("{$dir}/{$zip}");
        }
    }

    public function test_manifest_returns_204_when_no_signed_artefact_is_registered(): void
    {
        $this->forgetRelease();

        $this->getJson('/api/app/update/latest.json')
            ->assertStatus(204)
            ->assertContent('');
    }

    public function test_legacy_manifest_returns_204_when_no_signed_artefact_is_registered(): void
    {
        $this->forgetRelease();

        $this->getJson('/api/app/update/latest-legacy-win7.json')
            ->assertStatus(204)
            ->assertContent('');
    }

    public function test_dynamic_update_returns_204_when_no_signed_artefact_is_registered(): void
    {
        $this->forgetRelease();

        $this->getJson('/api/app/update/windows-x86_64/2.0.27')
            ->assertStatus(204)
            ->assertContent('');
    }

    public function test_manifest_is_not_served_when_its_package_is_missing(): void
    {
        $dir = $this->updatesDir();
        File::put("{$dir}/latest.json", json_encode([
            'version' => '2.1.1',
            'notes' => 'phantom release',
            'pub_date' => '2026-01-01T00:00:00+00:00',
            'platforms' => [
                'windows-x86_64' => [
                    'signature' => base64_encode('untrusted comment: phantom'),
                    'url' => 'https://updates.example.test/download/LamSuite-Billing_2.1.1_x64-setup.nsis.zip',
                ],
            ],
        ]));

        try {
            $this->getJson('/api/app/update/latest.json')
                ->assertStatus(204)
                ->assertContent('');

            $this->getJson('/api/app/update/windows-x86_64/2.1.0')
                ->assertStatus(204)
                ->assertContent('');
        } finally {
            $this->forgetRelease();
        }
    }

    public function test_manifest_and_dynamic_update_serve_a_registered_signed_package(): void
    {
        [$manifest, $zip] = $this->registerRelease('2.0.99');

        try {
            $this->getJson('/api/app/update/latest.json')
                ->assertStatus(200)
                ->assertJsonPath('version', '2.0.99')
                ->assertJsonPath('platforms.windows-x86_64.signature', $manifest['platforms']['windows-x86_64']['signature'])
                ->assertJsonPath(
                    'platforms.windows-x86_64.url',
                    url("/api/app/update/download/{$zip}")
                );

            $this->getJson('/api/app/update/windows-x86_64/2.0.27')
                ->assertStatus(200)
                ->assertJsonPath('version', '2.0.99')
                ->assertJsonPath('signature', $manifest['platforms']['windows-x86_64']['signature'])
                ->assertJsonPath('url', url("/api/app/update/download/{$zip}"));

            $this->getJson('/api/app/update/windows-x86_64/2.0.99')
                ->assertStatus(204);
        } finally {
            $this->forgetRelease($zip);
        }
    }

    public function test_dynamic_update_omits_platforms_whose_package_is_missing(): void
    {
        $dir = $this->updatesDir();
        $zip = 'LamSuite-Billing_2.0.98_x64-setup.nsis.zip';
        File::put("{$dir}/latest.json", json_encode([
            'version' => '2.0.98',
            'notes' => 'partial release',
            'pub_date' => '2026-01-01T00:00:00+00:00',
            'platforms' => [
                'windows-x86_64' => [
                    'signature' => base64_encode('untrusted comment: windows'),
                    'url' => "https://updates.example.test/download/{$zip}",
                ],
                'darwin-aarch64' => [
                    'signature' => base64_encode('untrusted comment: darwin'),
                    'url' => 'https://updates.example.test/download/LamSuite-Billing_2.0.98_aarch64.app.tar.gz',
                ],
            ],
        ]));

        try {
            File::put("{$dir}/{$zip}", 'DUMMY_ZIP_CONTENT');

            $this->getJson('/api/app/update/latest.json')
                ->assertStatus(200)
                ->assertJsonMissingPath('platforms.darwin-aarch64')
                ->assertJsonPath('platforms.windows-x86_64.signature', base64_encode('untrusted comment: windows'));

            $this->getJson('/api/app/update/darwin-aarch64/2.0.27')
                ->assertStatus(204);
        } finally {
            $this->forgetRelease($zip);
        }
    }

    public function test_it_downloads_updater_binary_file(): void
    {
        $fakeDir = $this->updatesDir();
        $fakeFile = "{$fakeDir}/LamSuite-Billing_2.0.35_x64-setup.nsis.zip";
        File::put($fakeFile, "DUMMY_ZIP_CONTENT");

        try {
            $response = $this->get('/api/app/update/download/LamSuite-Billing_2.0.35_x64-setup.nsis.zip');
            $response->assertStatus(200);
            $response->assertHeader('Content-Type', 'application/octet-stream');
        } finally {
            File::delete($fakeFile);
        }
    }
}
