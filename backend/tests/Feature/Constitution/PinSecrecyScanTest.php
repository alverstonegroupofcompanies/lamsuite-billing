<?php

namespace Tests\Feature\Constitution;

use Tests\TestCase;

/**
 * P-IDENTITY-SCOPE IS5 / CNT-006 — a secret has exactly one home.
 *
 * This is a source scan, not a behaviour test: it fails when a plaintext token or
 * PIN is written where it can be read back, no matter which screen produced it.
 * It covers the counter identity path end to end — the claim service, the admin
 * counter endpoints, the models that persist them, and the desktop vault that
 * used to keep workstation tokens in a JSON file.
 */
class PinSecrecyScanTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();

        $this->root = realpath(dirname(__DIR__, 4));
        $this->assertFileExists($this->root.'/backend/app/Services/CounterClaimService.php');
    }

    private function source(string $relative): string
    {
        $path = $this->root.'/'.$relative;
        $this->assertFileExists($path, "$relative is part of the identity path — move this rule with it, do not delete it");

        return file_get_contents($path);
    }

    /** @return array<string,array{0:string,1:string}> */
    public static function identityPathFiles(): array
    {
        return [
            'claim service' => ['backend/app/Services/CounterClaimService.php', '/device_token\s*=>\s*\$[\w>]/'],
            'claim endpoint' => ['backend/app/Http/Controllers/Api/CounterClaimController.php', '/device_token\s*=>\s*\$[\w>]/'],
            'admin counters' => ['backend/app/Http/Controllers/Api/AdminCounterController.php', '/device_token\s*=>\s*\$[\w>]/'],
            'activation code' => ['backend/app/Models/ActivationKey.php', '/device_token\s*=>\s*\$[\w>]/'],
        ];
    }

    /**
     * CNT-006: a workstation token is answered once and stored as a hash. A file
     * that still holds `'device_token' => $something` would hand every reader of
     * that row a usable token.
     */
    public function test_the_identity_path_never_persists_a_plaintext_token(): void
    {
        foreach (self::identityPathFiles() as $label => [$relative, $pattern]) {
            $this->assertDoesNotMatchRegularExpression(
                $pattern,
                $this->source($relative),
                "$label must store only the hash of a device token (IS5)"
            );
        }
    }

    /** IS5: the same files must not persist a PIN in the clear either. */
    public function test_the_identity_path_never_persists_a_plaintext_pin(): void
    {
        foreach (self::identityPathFiles() as $label => [$relative, $_]) {
            $source = $this->source($relative);

            $this->assertDoesNotMatchRegularExpression(
                '/(unlock_pin|approver_pin|salesperson_pin|pharmacist_pin)\s*=>\s*\$[\w>\'\"]/',
                $source,
                "$label may only store a hashed PIN (IS5)"
            );
        }
    }

    /** The models that hold secrets must not serialise them. */
    public function test_secret_columns_are_hidden_by_the_models_that_own_them(): void
    {
        $hidden = [
            'backend/app/Models/Counter.php' => ['device_token', 'device_token_hash', 'pairing_code', 'unlock_pin_hash'],
            'backend/app/Models/Device.php' => ['device_token', 'device_token_hash'],
            'backend/app/Models/ActivationKey.php' => ['key_hash'],
            'backend/app/Models/User.php' => ['password', 'totp_secret'],
        ];

        foreach ($hidden as $relative => $secrets) {
            $source = $this->source($relative);
            $this->assertMatchesRegularExpression('/\$hidden\s*=\s*\[/', $source, "$relative declares hidden fields");

            foreach ($secrets as $secret) {
                $this->assertMatchesRegularExpression(
                    '/\$hidden\s*=\s*\[[^\]]*\''.$secret.'\'/s',
                    $source,
                    "$relative must hide $secret"
                );
            }
        }
    }

    /**
     * CNT-013: the setup screen is the one place a till touches the cloud before
     * it has an identity, so it must hold no credential field at all — only a
     * counter code and the claim call that spends it.
     */
    public function test_the_setup_screen_offers_only_a_counter_code(): void
    {
        $setup = $this->source('frontend/src/pages/StoreSetupPage.tsx');

        foreach (['type="password"', 'type="email"', 'ownerPassword', 'ownerEmail', 'setupFirstAdmin', 'registerWithOwnerCredentials', 'activation_key', 'is_hub'] as $retired) {
            $this->assertStringNotContainsString($retired, $setup, "the setup screen still mentions {$retired}");
        }

        $this->assertStringContainsString('storeDeviceService.claimCounter(', $setup);
        $this->assertStringContainsString('counter-activation-code', $setup);
    }

    /**
     * CNT-006: the desktop vault keeps credentials in the OS credential store and
     * nothing else. The old file-only implementation is the thing that must not
     * come back.
     */
    public function test_the_desktop_writes_credentials_only_to_the_os_store(): void
    {
        $vault = $this->source('frontend/src-tauri/src/credential_vault.rs');

        $this->assertMatchesRegularExpression('/fn is_secret_name\(/', $vault);
        $this->assertMatchesRegularExpression('/SECRET_NAMES\s*:\s*\[&str;\s*3\]/', $vault);
        $this->assertMatchesRegularExpression('/"device_token",\s*"refresh_token",\s*"access_token"/', $vault);
        $this->assertMatchesRegularExpression('/CREDENTIAL_SERVICE/', $vault);

        // The commands the till calls must be the credential-aware ones.
        $main = $this->source('frontend/src-tauri/src/main.rs');
        $this->assertStringNotContainsString(
            '.lamsuite_secure_vault.dat',
            $main,
            'main.rs must not keep a second, file-only vault'
        );
        $this->assertStringContainsString('credential_vault::secure_store_set', $main);
    }

    /**
     * The browser/mock runtime has no OS credential store, so it must not fake one
     * with localStorage: a token that survives a reload in the web build would be
     * a plaintext token on any shared machine.
     */
    public function test_the_web_mock_does_not_persist_credentials_to_local_storage(): void
    {
        $bridge = $this->source('frontend/src/lib/ipc/ipcBridge.ts');

        $this->assertMatchesRegularExpression(
            '/isCredentialKey|isSecretKey/',
            $bridge,
            'the mock vault has to know which keys are credentials'
        );
        $this->assertMatchesRegularExpression(
            '/if\s*\(!isCredentialKey\(args\.key\)\)\s*\{[^}]*localStorage\.setItem/s',
            $bridge,
            'only non-secret keys may reach localStorage in the mock'
        );
    }

    /**
     * IS5: a PIN typed at a till travels as a PIN, and nothing writes one to
     * browser storage where any process reading the profile could pick it up.
     */
    public function test_till_storage_never_writes_a_pin_or_password(): void
    {
        $this->assertSame(
            [],
            $this->browserStorageWrites('/(localStorage|sessionStorage)\.setItem\([^;]*?[^A-Za-z0-9](pin|password)/is'),
            'IS5: no PIN or password may be written to browser storage'
        );
    }

    /**
     * IS5/CNT-006: tokens belong in the credential vault. B8 retired staff
     * sign-in at the till, which is what wrote the staff bearer token, so the
     * booked list is now empty: any browser-storage token write fails the build.
     */
    public function test_no_token_at_all_uses_browser_storage(): void
    {
        $booked = [];

        $found = $this->browserStorageWrites('/(localStorage|sessionStorage)\.setItem\([^;]*?[^A-Za-z0-9](secret|token)/is');

        $this->assertEqualsCanonicalizing(
            $booked,
            $found,
            'CNT-006: no token may be written to browser storage at the till'
        );
    }

    /**
     * B8b: the cached operator session carried a decrypted PIN and password
     * hash. With nobody signed in at the till there is nothing to cache, and
     * whatever an older build left behind is purged on boot.
     */
    public function test_the_cached_operator_session_is_not_kept_in_browser_storage(): void
    {
        $auth = $this->source('frontend/src/lib/auth/staffAuthService.ts');

        $this->assertStringNotContainsString(
            'localStorage.setItem("active_staff_session"',
            $auth,
            'IS5: a session holding credential hashes stays in memory only'
        );
        $this->assertStringNotContainsString(
            'localStorage.getItem("active_staff_session"',
            $auth,
            'IS5: nothing is read back as a signed-in operator'
        );
        $this->assertStringContainsString(
            'localStorage.removeItem("active_staff_session"',
            $auth,
            'B8b: the copy an older build left must be purged'
        );
        $this->assertStringContainsString(
            'localStorage.removeItem("staff_token"',
            $auth,
            'B8b: the bearer token an older build left must be purged'
        );
    }

    /** @return list<string> every browser-storage write of a secret in the POS source */
    private function browserStorageWrites(string $pattern): array
    {
        $offenders = [];

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($this->root.'/frontend/src', \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            $name = $file->getFilename();

            if (!$file->isFile() || !in_array($file->getExtension(), ['ts', 'tsx'], true)) {
                continue;
            }

            if (str_contains($name, '.test.') || str_contains($name, '.stories.')) {
                continue;
            }

            $path = str_replace($this->root.'/', '', $file->getPathname());

            if (preg_match_all($pattern, file_get_contents($file->getPathname()), $matches)) {
                foreach ($matches[0] as $match) {
                    $offenders[] = $path.': '.trim($match);
                }
            }
        }

        sort($offenders);

        return array_values(array_unique($offenders));
    }
}
