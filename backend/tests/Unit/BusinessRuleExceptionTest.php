<?php

namespace Tests\Unit;

use App\Exceptions\BusinessRuleException;
use Tests\TestCase;

class BusinessRuleExceptionTest extends TestCase
{
    public function test_renders_structured_payload_with_fix_hint(): void
    {
        $exception = new BusinessRuleException(
            errorCode: 'QTY_LOOSE_NOT_ALLOWED',
            message: 'This product is sealed; loose tablets cannot be sold.',
            rule: 'loose_sale',
            line: 3,
            field: 'loose_qty',
            fix: 'Enter a whole number of strips.',
        );

        $response = $exception->render();
        $payload = $response->getData(true);

        $this->assertSame(422, $response->getStatusCode());
        $this->assertFalse($payload['success']);
        $this->assertSame('QTY_LOOSE_NOT_ALLOWED', $payload['code']);
        $this->assertSame('loose_sale', $payload['rule']);
        $this->assertSame(3, $payload['line']);
        $this->assertSame('loose_qty', $payload['field']);
        $this->assertSame('Enter a whole number of strips.', $payload['fix']);
        $this->assertArrayHasKey('message', $payload);
    }

    public function test_render_is_used_for_api_requests(): void
    {
        $this->app['router']->get('/api/testing/business-rule', function () {
            throw new BusinessRuleException('TEST_RULE', 'Rule failed.', 'test', null, 'qty', 'Fix it.');
        });

        $response = $this->getJson('/api/testing/business-rule');

        $response->assertStatus(422)
            ->assertJsonPath('code', 'TEST_RULE')
            ->assertJsonPath('fix', 'Fix it.');
    }
}
