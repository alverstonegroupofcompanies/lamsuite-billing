<?php

namespace Tests\Unit;

use App\Models\CompanySetting;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StoreNegativeStockAccessorTest extends TestCase
{
    use RefreshDatabase;

    public function test_returns_false_when_stock_allow_negative_stock_setting_is_not_configured(): void
    {
        $store = Store::create([
            'name' => 'Demo Pharmacy',
            'code' => 'DEMO-01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->assertFalse($store->allow_negative_stock);
    }

    public function test_returns_true_when_setting_is_configured_true(): void
    {
        $store = Store::create([
            'name' => 'Demo Supermarket',
            'code' => 'DEMO-02',
            'state_code' => '32',
            'is_active' => true,
        ]);

        CompanySetting::create([
            'store_id' => $store->id,
            'key' => 'stock.allow_negative_stock',
            'value' => 'true',
        ]);

        $store->refresh();
        $this->assertTrue($store->allow_negative_stock);
    }

    public function test_returns_false_when_setting_is_configured_false(): void
    {
        $store = Store::create([
            'name' => 'Demo Store Strict',
            'code' => 'DEMO-03',
            'state_code' => '32',
            'is_active' => true,
        ]);

        CompanySetting::create([
            'store_id' => $store->id,
            'key' => 'stock.allow_negative_stock',
            'value' => 'false',
        ]);

        $store->refresh();
        $this->assertFalse($store->allow_negative_stock);
    }

    public function test_accessor_appends_to_array_and_json(): void
    {
        $store = Store::create([
            'name' => 'Demo Appends Store',
            'code' => 'DEMO-04',
            'state_code' => '32',
            'is_active' => true,
        ]);

        CompanySetting::create([
            'store_id' => $store->id,
            'key' => 'stock.allow_negative_stock',
            'value' => '1',
        ]);

        $storeArray = $store->toArray();
        $this->assertArrayHasKey('allow_negative_stock', $storeArray);
        $this->assertTrue($storeArray['allow_negative_stock']);

        $jsonEncoded = json_encode($store);
        $this->assertStringContainsString('"allow_negative_stock":true', $jsonEncoded);
    }
}
