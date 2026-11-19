<?php

namespace Tests\Feature\Constitution;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution guard — static query-scope scan (specs/constitution.md R5/R6).
 *
 * Every named function that touches the Product or ProductBatch model must show
 * store-scope intent (a store token) or the file/function must carry an explicit
 * `@store-scope-ok: <reason>` annotation for reviewed cross-store admin code.
 */
class ProductQueryScopeTest extends TestCase
{
    use RefreshDatabase;

    private const STORE_TOKENS = ['store_id', 'storeId', 'forStore', 'active_store_id', 'resolveStoreId', 'X-Store-Id', '@store-scope-ok'];

    public function test_all_product_queries_show_store_scope_intent(): void
    {
        $violations = [];

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($this->appPath(), \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $path = $file->getPathname();
            if (str_contains($path, DIRECTORY_SEPARATOR . 'Models' . DIRECTORY_SEPARATOR)) {
                continue;
            }

            $content = file_get_contents($path);
            if (!str_contains($content, 'App\\Models\\Product')) {
                continue;
            }

            $fileExempt = str_contains($content, '@store-scope-ok');
            if ($fileExempt) {
                continue;
            }

            foreach ($this->functionChunks($content) as $chunk) {
                if (!preg_match('/\\b(Product|ProductBatch)::(?!class\\b)/', $chunk['body'])) {
                    continue;
                }
                if (!$this->hasStoreToken($chunk['body'])) {
                    $violations[] = sprintf(
                        '%s:%d in %s() — Product/ProductBatch usage without store scoping',
                        str_replace($this->appPath() . DIRECTORY_SEPARATOR, 'app/', $path),
                        $chunk['startLine'],
                        $chunk['name']
                    );
                }
            }
        }

        $this->assertSame(
            [],
            $violations,
            "P-STORE-SCOPE violation: unscoped Product/ProductBatch queries found.\n"
            . "Scope them by store or annotate reviewed cross-store code with `@store-scope-ok: <reason>`.\n"
            . implode("\n", $violations)
        );
    }

    /** @return array<int, array{name: string, body: string, startLine: int}> */
    private function functionChunks(string $content): array
    {
        $lines = preg_split('/\R/', $content) ?: [];
        $chunks = [];
        $current = null;
        $openBraces = 0;

        foreach ($lines as $i => $line) {
            if ($current === null) {
                if (preg_match('/function\s+\w+\s*\(/', $line)) {
                    $current = ['name' => '?', 'body' => '', 'startLine' => $i + 1, 'braceDepth' => 0];
                    if (preg_match('/function\s+(\w+)\s*\(/', $line, $m)) {
                        $current['name'] = $m[1];
                    }
                }
                continue;
            }

            $current['body'] .= $line . "\n";
            $openBraces += substr_count($line, '{') - substr_count($line, '}');

            if ($openBraces <= 0 && str_contains($current['body'], '{')) {
                $chunks[] = ['name' => $current['name'], 'body' => $current['body'], 'startLine' => $current['startLine']];
                $current = null;
                $openBraces = 0;
            }
        }

        if ($current !== null) {
            $chunks[] = ['name' => $current['name'], 'body' => $current['body'], 'startLine' => $current['startLine']];
        }

        return $chunks;
    }

    private function hasStoreToken(string $body): bool
    {
        foreach (self::STORE_TOKENS as $token) {
            if (str_contains($body, $token)) {
                return true;
            }
        }
        return false;
    }

    private function appPath(): string
    {
        return realpath(__DIR__ . '/../../../app');
    }
}
