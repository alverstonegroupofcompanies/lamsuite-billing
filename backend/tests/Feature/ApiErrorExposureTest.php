<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Tests\TestCase;

class ApiErrorExposureTest extends TestCase
{
    public function test_api_error_omits_stack_trace_even_when_debug_is_enabled(): void
    {
        config(['app.debug' => true]);

        $response = $this->getJson('/api/__does_not_exist__');

        $response->assertStatus(404);

        $payload = $response->json();

        $this->assertIsArray($payload);
        $this->assertArrayHasKey('message', $payload);
        $this->assertArrayNotHasKey('trace', $payload);
        $this->assertArrayNotHasKey('file', $payload);
        $this->assertArrayNotHasKey('line', $payload);
        $this->assertArrayNotHasKey('exception', $payload);
        $this->assertStringNotContainsString(base_path(), (string) $response->getContent());
    }

    public function test_api_error_with_debug_off_is_json_without_trace(): void
    {
        config(['app.debug' => false]);

        $response = $this->getJson('/api/__does_not_exist__');

        $response->assertStatus(404);

        $payload = $response->json();

        $this->assertIsArray($payload);
        $this->assertArrayHasKey('message', $payload);
        $this->assertArrayNotHasKey('trace', $payload);
        $this->assertArrayNotHasKey('file', $payload);
        $this->assertArrayNotHasKey('line', $payload);
    }

    public function test_env_example_ships_with_debug_disabled(): void
    {
        $contents = File::get(base_path('.env.example'));

        $this->assertMatchesRegularExpression('/^APP_DEBUG=false$/m', $contents);
        $this->assertDoesNotMatchRegularExpression('/^APP_DEBUG=true$/m', $contents);
    }

    public function test_staging_compose_does_not_force_debug_on(): void
    {
        $path = dirname(base_path()) . '/docker-compose.staging.yml';
        $contents = File::get($path);

        $this->assertStringNotContainsString('APP_DEBUG=true', $contents);
        $this->assertStringContainsString('APP_DEBUG=${APP_DEBUG:-false}', $contents);
    }
}
