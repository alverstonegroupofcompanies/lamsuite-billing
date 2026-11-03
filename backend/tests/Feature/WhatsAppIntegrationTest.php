<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\WhatsAppController;
use App\Models\CompanySetting;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WhatsAppIntegrationTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $adminUser;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'id' => 'store_main',
            'name' => 'Alverstone Pharmacy',
            'code' => 'ALV-01',
            'state_code' => '32',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->adminUser = User::create([
            'name' => 'Admin User',
            'email' => 'admin@alverstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    public function test_format_chat_id(): void
    {
        // 10 digits
        $this->assertEquals('919876543210@c.us', WhatsAppController::formatChatId('9876543210'));
        // With leading +91 and spaces
        $this->assertEquals('919876543210@c.us', WhatsAppController::formatChatId('+91 98765 43210'));
        // With leading 0
        $this->assertEquals('919876543210@c.us', WhatsAppController::formatChatId('09876543210'));
        // With dashes
        $this->assertEquals('919876543210@c.us', WhatsAppController::formatChatId('9876-543-210'));
    }

    public function test_send_invoice_fails_when_no_api_key_configured(): void
    {
        $response = $this->postJson('/api/whatsapp/send-invoice', [
            'phone' => '9876543210',
            'caption' => 'Test Invoice',
        ]);

        $response->assertStatus(422)
            ->assertJson([
                'success' => false,
            ]);
    }

    public function test_send_invoice_pdf_via_openwa(): void
    {
        Http::fake([
            'https://wa-api.alverstone.in/api/sessions/default/messages/send-document' => Http::response([
                'id' => 'msg_12345',
                'status' => 'PENDING',
            ], 200),
        ]);

        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'whatsapp',
            'value' => [
                'enabled' => true,
                'api_url' => 'https://wa-api.alverstone.in',
                'api_key' => 'secret_openwa_key_test',
                'session_id' => 'default',
            ],
            'is_secret' => true,
        ]);

        $response = $this->postJson('/api/whatsapp/send-invoice', [
            'phone' => '9876543210',
            'caption' => '*Invoice #INV-1001* Total: Rs 500',
            'pdf_base64' => base64_encode('%PDF-1.4 test pdf content'),
            'filename' => 'Invoice_INV-1001.pdf',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'chatId' => '919876543210@c.us',
                'sessionId' => 'default',
            ]);

        Http::assertSent(function ($request) {
            return $request->url() === 'https://wa-api.alverstone.in/api/sessions/default/messages/send-document'
                && $request->header('X-API-Key')[0] === 'secret_openwa_key_test'
                && $request['chatId'] === '919876543210@c.us'
                && $request['mimetype'] === 'application/pdf';
        });
    }

    public function test_fetch_whatsapp_sessions(): void
    {
        Http::fake([
            'https://wa-api.alverstone.in/api/sessions' => Http::response([
                [
                    'id' => 'billing-counter-1',
                    'name' => 'Billing Counter 1',
                    'status' => 'ready',
                ],
                [
                    'id' => 'billing-counter-2',
                    'name' => 'Billing Counter 2',
                    'status' => 'ready',
                ],
            ], 200),
        ]);

        $response = $this->getJson('/api/whatsapp/sessions?api_key=test_key&api_url=https://wa-api.alverstone.in');

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'sessions' => [
                    ['id' => 'billing-counter-1', 'name' => 'Billing Counter 1', 'status' => 'ready'],
                    ['id' => 'billing-counter-2', 'name' => 'Billing Counter 2', 'status' => 'ready'],
                ],
            ]);
    }

    public function test_test_whatsapp_connection(): void
    {
        Http::fake([
            'https://wa-api.alverstone.in/api/auth/validate' => Http::response([
                'valid' => true,
                'role' => 'operator',
                'engineType' => 'GOWS',
            ], 200),
        ]);

        $response = $this->postJson('/api/whatsapp/test-connection', [
            'api_url' => 'https://wa-api.alverstone.in',
            'api_key' => 'valid_operator_key',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'valid' => true,
                'role' => 'operator',
            ]);
    }

    public function test_admin_settings_mask_and_rotate_whatsapp_key(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'whatsapp',
            'value' => [
                'enabled' => true,
                'api_url' => 'https://wa-api.alverstone.in',
                'api_key' => 'my_super_secret_openwa_key',
                'session_id' => 'default',
            ],
            'is_secret' => true,
        ]);

        // Test index masks the key
        $response = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson('/api/admin/settings?active_store_id=' . $this->store->id);

        $response->assertStatus(200);
        $this->assertEquals('••••••••••••', $response->json('whatsapp.api_key'));

        // Test secret rotation
        $rotateResponse = $this->actingAs($this->adminUser, 'sanctum')
            ->postJson('/api/admin/settings/rotate-secret', [
                'active_store_id' => $this->store->id,
                'secret_type' => 'whatsapp_api_key',
                'new_value' => 'new_rotated_key_12345',
            ]);

        $rotateResponse->assertStatus(200)
            ->assertJson(['success' => true]);

        $saved = CompanySetting::where('store_id', $this->store->id)->where('key', 'whatsapp')->first();
        $this->assertEquals('new_rotated_key_12345', $saved->value['api_key']);
    }

    public function test_send_invoice_falls_back_to_text_when_pdf_fails(): void
    {
        Http::fake([
            'https://wa-api.alverstone.in/api/sessions/default/messages/send-document' => Http::response([
                'error' => 'Media transfer rejected',
            ], 400),
            'https://wa-api.alverstone.in/api/sessions/default/messages/send-text' => Http::response([
                'id' => 'msg_text_fallback_123',
                'status' => 'SENT',
            ], 200),
        ]);

        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'whatsapp',
            'value' => [
                'enabled' => true,
                'api_url' => 'https://wa-api.alverstone.in',
                'api_key' => 'secret_openwa_key_test',
                'session_id' => 'default',
            ],
            'is_secret' => true,
        ]);

        $response = $this->postJson('/api/whatsapp/send-invoice', [
            'phone' => '9876543210',
            'caption' => '*Invoice #INV-1002* Total: Rs 850',
            'pdf_base64' => base64_encode('%PDF-1.4 dummy pdf content'),
            'filename' => 'Invoice_INV-1002.pdf',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'chatId' => '919876543210@c.us',
                'message' => 'Invoice summary dispatched successfully via WhatsApp',
            ]);

        Http::assertSent(function ($request) {
            return $request->url() === 'https://wa-api.alverstone.in/api/sessions/default/messages/send-text'
                && $request['chatId'] === '919876543210@c.us';
        });
    }

    public function test_get_whatsapp_config(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'whatsapp',
            'value' => [
                'enabled' => true,
                'api_url' => 'https://wa-api.alverstone.in',
                'api_key' => 'secret_key',
                'session_id' => 'default',
                'send_pdf' => true,
            ],
            'is_secret' => true,
        ]);

        $response = $this->getJson('/api/whatsapp/config');
        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'enabled' => true,
                'api_url' => 'https://wa-api.alverstone.in',
                'has_api_key' => true,
            ]);
    }
}
