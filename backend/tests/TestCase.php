<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * G1-SEC: treat till requests in this test as coming from a claimed counter
     * of the store they name (see Tests\Support\FakeCounterGuard). Use this in
     * tests that are not about authentication; it replaces the old
     * withoutMiddleware(AuthenticateDevice::class) + "trust X-Store-Id" pattern.
     */
    protected function actAsClaimedCounterOfRequestedStore(): static
    {
        $this->app->instance(\App\Http\Middleware\AuthenticateDevice::class, new Support\FakeCounterGuard());

        return $this;
    }

    /**
     * G12: a cancellation is only allowed with a grant the server minted. This
     * drives the real verify endpoint so the tests exercise the same token the
     * till would hold, rather than fabricating one.
     */
    protected function grantCancellationToken(\App\Models\Invoice $invoice, array $payload): string
    {
        $response = $this->postJson("/api/invoices/{$invoice->id}/approvals/verify", $payload);

        $response->assertStatus(200);

        $token = (string) $response->json('token');
        $this->assertNotSame('', $token, 'The approval endpoint returned no grant token.');

        return $token;
    }
}
