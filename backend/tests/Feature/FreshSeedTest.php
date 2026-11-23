<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use PDO;
use Tests\TestCase;

/**
 * SET-02: a seed is demo data, not a developer's desktop import. The import is
 * an explicit command, and re-running it matches on the unique key
 * (store_id, barcode) so it cannot collide with itself.
 */
class FreshSeedTest extends TestCase
{
    use RefreshDatabase;

    private ?string $fixture = null;

    protected function tearDown(): void
    {
        if ($this->fixture !== null && file_exists($this->fixture)) {
            unlink($this->fixture);
        }

        parent::tearDown();
    }

    public function test_database_seeder_does_not_run_the_desktop_import(): void
    {
        Artisan::spy();

        (new \Database\Seeders\DatabaseSeeder())->run();

        Artisan::shouldNotHaveReceived('call');
        $this->assertTrue(Store::where('code', 'STORE-01')->exists());
    }

    public function test_the_desktop_import_needs_an_explicit_source(): void
    {
        $this->createUser();

        $this->artisan('data:sync-actual')->assertFailed();

        $this->assertFalse(Store::where('code', 'STORE-01')->exists());
        $this->assertSame(0, Product::count());
    }

    public function test_the_desktop_import_refuses_to_run_in_production(): void
    {
        $this->createUser();
        $source = $this->fixtureWithProducts([
            ['id' => 'p1', 'name' => 'Paracetamol 500mg', 'barcode' => '8900000000001'],
        ]);

        $this->app['env'] = 'production';
        try {
            $this->artisan('data:sync-actual', ['--source' => $source])->assertFailed();
        } finally {
            $this->app['env'] = 'testing';
        }

        $this->assertSame(0, Product::count());
    }

    public function test_the_desktop_import_is_idempotent_on_a_duplicate_barcode(): void
    {
        $this->createUser();
        $source = $this->fixtureWithProducts([
            ['id' => 'p1', 'name' => 'Paracetamol 500mg', 'barcode' => '8900000000001'],
            ['id' => 'p2', 'name' => 'Paracetamol 650mg', 'barcode' => '8900000000001'],
        ]);

        $this->artisan('data:sync-actual', ['--source' => $source])->assertSuccessful();
        $firstRun = Product::where('store_id', Store::where('code', 'STORE-01')->value('id'))->count();

        $this->artisan('data:sync-actual', ['--source' => $source])->assertSuccessful();
        $secondRun = Product::where('store_id', Store::where('code', 'STORE-01')->value('id'))->count();

        $this->assertSame($firstRun, $secondRun, 'A second import must not add or duplicate rows.');
        $this->assertSame(1, $secondRun, 'Two desktop rows sharing a barcode collapse onto the unique key.');
    }

    public function test_the_desktop_import_dry_run_writes_nothing(): void
    {
        $this->createUser();
        $source = $this->fixtureWithProducts([
            ['id' => 'p1', 'name' => 'Paracetamol 500mg', 'barcode' => '8900000000001'],
        ]);

        $this->artisan('data:sync-actual', ['--source' => $source, '--dry-run' => true])->assertSuccessful();

        $this->assertSame(0, Product::count());
        $this->assertFalse(Store::where('code', 'STORE-01')->exists());
    }

    private function createUser(): void
    {
        User::create([
            'name' => 'Seed Admin',
            'email' => 'seed@fixture.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'super_admin',
        ]);
    }

    /** @param list<array<string, mixed>> $products */
    private function fixtureWithProducts(array $products): string
    {
        $path = tempnam(sys_get_temp_dir(), 'lamsuite-import-') . '.sqlite';
        $pdo = new PDO('sqlite:' . $path);
        $pdo->exec('CREATE TABLE kv_store (id TEXT PRIMARY KEY, table_name TEXT NOT NULL, data TEXT NOT NULL)');

        $insert = $pdo->prepare('INSERT INTO kv_store (id, table_name, data) VALUES (?, ?, ?)');
        foreach ($products as $product) {
            $insert->execute([
                $product['id'],
                'products',
                json_encode($product + ['mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 12, 'current_stock' => 5]),
            ]);
        }

        $this->fixture = $path;

        return $path;
    }
}
