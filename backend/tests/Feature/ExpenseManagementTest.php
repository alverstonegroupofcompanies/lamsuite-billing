<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExpenseManagementTest extends TestCase
{
    use RefreshDatabase;

    private Store $store1;
    private Store $store2;
    private User $manager;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateDevice::class);

        $this->store1 = Store::create([
            'name' => 'Store Palakkad',
            'code' => 'EXP-ST-01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->store2 = Store::create([
            'name' => 'Store Kochi',
            'code' => 'EXP-ST-02',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->manager = User::create([
            'name' => 'Palakkad Manager',
            'email' => 'exp.manager@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->store1->id,
            'allowed_store_ids' => [$this->store1->id],
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'exp.super@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => null,
            'allowed_store_ids' => [$this->store1->id, $this->store2->id],
        ]);
    }

    public function test_manager_can_record_expense_voucher(): void
    {
        $response = $this->actingAs($this->manager, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store1->id])
            ->postJson('/api/admin/expenses', [
                'expense_head' => 'Shop Rent',
                'amount' => 12500.50,
                'payment_mode' => 'Bank Transfer',
                'reference_no' => 'RENT-2026-11',
                'notes' => 'November shop rent',
                'expense_date' => '2026-11-17',
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('expense.expense_head', 'Shop Rent')
            ->assertJsonPath('expense.expense_number', 'EXP-00001');

        $this->assertDatabaseHas('expenses', [
            'store_id' => $this->store1->id,
            'expense_number' => 'EXP-00001',
            'created_by' => $this->manager->id,
        ]);
    }

    public function test_expense_numbers_are_sequential_per_store(): void
    {
        foreach ([['Electricity & Power', 800], ['Tea & Refreshments', 150]] as [$head, $amount]) {
            $this->actingAs($this->manager, 'sanctum')
                ->withHeaders(['X-Store-Id' => $this->store1->id])
                ->postJson('/api/admin/expenses', [
                    'expense_head' => $head,
                    'amount' => $amount,
                    'expense_date' => '2026-11-17',
                ])->assertStatus(201);
        }

        $otherStore = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store2->id])
            ->postJson('/api/admin/expenses', [
                'expense_head' => 'Shop Rent',
                'amount' => 9000,
                'expense_date' => '2026-11-17',
            ]);

        $otherStore->assertStatus(201)->assertJsonPath('expense.expense_number', 'EXP-00001');

        $numbers = Expense::where('store_id', $this->store1->id)->orderBy('id')->pluck('expense_number')->all();
        $this->assertSame(['EXP-00001', 'EXP-00002'], $numbers);
    }

    public function test_manager_cannot_record_expense_for_another_store(): void
    {
        $response = $this->actingAs($this->manager, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store2->id])
            ->postJson('/api/admin/expenses', [
                'expense_head' => 'Shop Rent',
                'amount' => 5000,
                'expense_date' => '2026-11-17',
                'store_id' => $this->store2->id,
            ]);

        $response->assertStatus(403);
        $this->assertSame(0, Expense::count());
    }

    public function test_expense_validation_rejects_invalid_amount(): void
    {
        $this->actingAs($this->manager, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store1->id])
            ->postJson('/api/admin/expenses', [
                'expense_head' => 'Shop Rent',
                'amount' => 0,
                'expense_date' => '2026-11-17',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['amount']);
    }

    public function test_manager_can_update_and_delete_expense(): void
    {
        $expense = Expense::create([
            'store_id' => $this->store1->id,
            'expense_number' => 'EXP-00001',
            'expense_head' => 'Shop Rent',
            'amount' => 1000,
            'payment_mode' => 'Cash',
            'expense_date' => '2026-11-17',
            'created_by' => $this->manager->id,
        ]);

        $this->actingAs($this->manager, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store1->id])
            ->putJson("/api/admin/expenses/{$expense->id}", [
                'expense_head' => 'Shop Rent (Revised)',
                'amount' => 1200,
                'payment_mode' => 'UPI',
                'expense_date' => '2026-11-16',
            ])
            ->assertStatus(200)
            ->assertJsonPath('expense.amount', '1200.00');

        $this->assertDatabaseHas('expenses', [
            'id' => $expense->id,
            'expense_head' => 'Shop Rent (Revised)',
            'payment_mode' => 'UPI',
        ]);

        $this->actingAs($this->manager, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store1->id])
            ->deleteJson("/api/admin/expenses/{$expense->id}")
            ->assertStatus(200);

        $this->assertDatabaseMissing('expenses', ['id' => $expense->id]);
    }

    public function test_cross_store_update_and_delete_are_rejected(): void
    {
        $expense = Expense::create([
            'store_id' => $this->store2->id,
            'expense_number' => 'EXP-00001',
            'expense_head' => 'Kochi Rent',
            'amount' => 3000,
            'payment_mode' => 'Cash',
            'expense_date' => '2026-11-17',
            'created_by' => $this->superAdmin->id,
        ]);

        $this->actingAs($this->manager, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store1->id])
            ->putJson("/api/admin/expenses/{$expense->id}", [
                'expense_head' => 'Hijacked',
                'amount' => 1,
                'expense_date' => '2026-11-17',
            ])
            ->assertStatus(403);

        $this->actingAs($this->manager, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store1->id])
            ->deleteJson("/api/admin/expenses/{$expense->id}")
            ->assertStatus(403);

        $this->assertDatabaseHas('expenses', ['id' => $expense->id, 'expense_head' => 'Kochi Rent']);
    }

    public function test_expense_listing_supports_search_and_pagination(): void
    {
        foreach ([
            ['Electricity & Power', 400],
            ['Staff Salary & Wages', 20000],
            ['Tea & Refreshments', 120],
        ] as $i => [$head, $amount]) {
            Expense::create([
                'store_id' => $this->store1->id,
                'expense_number' => 'EXP-0000' . ($i + 1),
                'expense_head' => $head,
                'amount' => $amount,
                'payment_mode' => 'Cash',
                'expense_date' => '2026-11-1' . ($i + 1),
                'created_by' => $this->manager->id,
            ]);
        }

        Expense::create([
            'store_id' => $this->store2->id,
            'expense_number' => 'EXP-00001',
            'expense_head' => 'Kochi Rent',
            'amount' => 7000,
            'payment_mode' => 'Cash',
            'expense_date' => '2026-11-17',
            'created_by' => $this->superAdmin->id,
        ]);

        $response = $this->actingAs($this->manager, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store1->id])
            ->getJson('/api/admin/expenses?search=Tea&per_page=1');

        $response->assertStatus(200)
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.expense_head', 'Tea & Refreshments')
            ->assertJsonPath('per_page', 1);
    }

    public function test_all_stores_scope_cannot_record_expense(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->postJson('/api/admin/expenses', [
                'expense_head' => 'Shop Rent',
                'amount' => 500,
                'expense_date' => '2026-11-17',
            ]);

        $response->assertStatus(422);
        $this->assertSame(0, Expense::count());
    }

    public function test_sync_push_batch_ingests_expenses_idempotently(): void
    {
        $payload = [
            'store_id' => $this->store1->id,
            'items' => [
                [
                    'entity_type' => 'expense',
                    'action' => 'create',
                    'entity_id' => 'local-exp-1',
                    'payload' => [
                        'id' => 'local-exp-1',
                        'store_id' => $this->store1->id,
                        'expense_number' => 'EXP-00090',
                        'expense_head' => 'Freight & Courier Inward',
                        'amount' => 250,
                        'payment_mode' => 'Cash',
                        'expense_date' => '2026-11-17',
                    ],
                ],
            ],
        ];

        $this->postJson('/api/sync/push/batch', $payload)
            ->assertStatus(200)
            ->assertJsonPath('results.processed', 1)
            ->assertJsonPath('results.failed', 0);

        // Re-pushing the same voucher updates instead of duplicating
        $payload['items'][0]['payload']['amount'] = 300;
        $this->postJson('/api/sync/push/batch', $payload)->assertStatus(200);

        $this->assertSame(1, Expense::where('expense_number', 'EXP-00090')->count());
        $this->assertDatabaseHas('expenses', [
            'expense_number' => 'EXP-00090',
            'amount' => 300,
        ]);
    }
}
