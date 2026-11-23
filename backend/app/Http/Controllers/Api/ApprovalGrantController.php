<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\InvoiceApproval;
use App\Models\User;
use App\Services\Auth\PinPolicy;
use App\Services\Counter\ApprovalService;
use App\Services\Counter\CounterActionRegistry;
use App\Support\RequestTenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

/**
 * APR-003..010 — the two ways a grant is minted.
 *
 * A person standing at the counter vouches for one save with their approver
 * PIN; or an administrator pre-authorises a set of actions and hands over a
 * one-time PIN, which the counter redeems when the bill is actually keyed.
 * Neither path knows what the bill is worth yet: the grant is bound to the
 * till's document identity and the action keys, and settled by
 * {@see ApprovalService} inside the save that consumes it.
 */
class ApprovalGrantController extends Controller
{
    public const ISSUER_ROLES = ['super_admin', 'store_owner', 'admin'];

    public function __construct(private readonly ApprovalService $approvals)
    {
    }

    /**
     * The counter exchanges an approver PIN (or a one-time PIN) for a
     * single-use grant token.
     */
    public function grant(Request $request): JsonResponse
    {
        $storeId = RequestTenant::requireStoreId($request);
        $counter = $this->counter($request, $storeId);

        if ($counter === null) {
            return response()->json([
                'success' => false,
                'code' => 'COUNTER_REQUIRED',
                'error' => 'An approval is granted at one counter of this store.',
            ], 422);
        }

        $validated = $request->validate([
            'document_type' => ['required', 'string', Rule::in([ApprovalService::DOCUMENT_INVOICE])],
            'document_external_id' => 'required|string|max:100',
            'actions' => 'required|array|min:1',
            'actions.*' => ['string', Rule::in(CounterActionRegistry::approvableActions())],
            'mode' => ['required', Rule::in(ApprovalService::MODES)],
            'identifier' => 'nullable|string|max:191',
            'pin' => 'required|string|min:4|max:64',
            'reason' => 'nullable|string|max:1000',
            'requested_by' => 'nullable|string|max:191',
        ]);

        $actions = array_values(array_unique($validated['actions']));

        if ($validated['mode'] === 'one_time_pin') {
            $issued = $this->approvals->redeemOneTimePin(
                (int) $storeId,
                $counter->id,
                (string) $validated['pin'],
                $actions,
                $validated['document_type'],
                $validated['document_external_id'],
                $counter->counter_code,
                $validated['reason'] ?? null
            );

            return $this->granted($issued);
        }

        return $this->grantWithApproverPin((int) $storeId, $counter, $validated, $actions);
    }

    /**
     * An administrator issues a one-time PIN for a set of actions; it is shown
     * exactly once and stored only as a hash.
     */
    public function issueOneTimePin(Request $request): JsonResponse
    {
        $actor = $request->user();

        if (!$actor || !in_array($actor->role, self::ISSUER_ROLES, true)) {
            return response()->json([
                'success' => false,
                'code' => 'ISSUER_NOT_PERMITTED',
                'error' => 'Only an administrator or store owner can issue an approval PIN.',
            ], 403);
        }

        $storeId = RequestTenant::requireStoreId($request);

        $validated = $request->validate([
            'counter_id' => 'required',
            'actions' => 'required|array|min:1',
            'actions.*' => ['string', Rule::in(CounterActionRegistry::approvableActions())],
            'minutes' => 'nullable|integer|min:1|max:60',
            'reason' => 'nullable|string|max:1000',
        ]);

        $counter = Counter::where('store_id', $storeId)->find($validated['counter_id']);

        if (!$counter) {
            return response()->json([
                'success' => false,
                'code' => 'COUNTER_NOT_FOUND',
                'error' => 'Select a counter of this store.',
            ], 422);
        }

        $actions = array_values(array_unique($validated['actions']));
        $minutes = (int) ($validated['minutes'] ?? 10);

        do {
            $pin = (string) random_int(100000, 999999);
        } while (PinPolicy::validate($pin, PinPolicy::DOMAIN_APPROVER) !== null);

        $approval = InvoiceApproval::create([
            'store_id' => $storeId,
            'counter_id' => $counter->id,
            'action' => $actions[0],
            'actions' => $actions,
            'mode' => 'one_time_pin',
            'status' => 'pending',
            'approved_by_user_id' => $actor->id,
            'approved_by_name' => $actor->name,
            'pin_hash' => Hash::make($pin),
            'reason' => $validated['reason'] ?? null,
            'rule_snapshot' => ApprovalService::ruleSnapshot($counter, $actions),
            'expires_at' => now()->addMinutes($minutes),
        ]);

        AuditLog::log('counter_approval_pin_issued', 'InvoiceApproval', (string) $approval->id, null, [
            'counter_id' => $counter->id,
            'actions' => $actions,
            'expires_at' => $approval->expires_at?->toIso8601String(),
        ], (int) $storeId);

        return response()->json([
            'success' => true,
            // Shown exactly once. Only the hash is stored.
            'pin' => $pin,
            'approval' => $this->present($approval),
            'message' => "One-time approval PIN issued. It expires in {$minutes} minute(s) and works for one save.",
        ], 201);
    }

    /**
     * @param  array<string,mixed>  $validated
     * @param  list<string>  $actions
     */
    private function grantWithApproverPin(int $storeId, Counter $counter, array $validated, array $actions): JsonResponse
    {
        $identifier = trim((string) ($validated['identifier'] ?? ''));

        if ($identifier === '') {
            return response()->json([
                'success' => false,
                'code' => 'CREDENTIALS_REQUIRED',
                'error' => 'Enter the approving manager\'s username or email.',
            ], 422);
        }

        $approver = User::where('store_id', $storeId)
            ->where(fn ($q) => $q->where('username', $identifier)->orWhere('email', $identifier))
            ->first();

        if (!$approver || !$approver->is_approver || empty($approver->pin_hash)) {
            $this->auditRefusal($storeId, $counter, 'approver_not_found_or_not_flagged', $actions);

            return response()->json([
                'success' => false,
                'code' => 'INVALID_APPROVER',
                'error' => 'This account is not set up to approve.',
            ], 422);
        }

        if (PinPolicy::isLocked($approver->locked_until)) {
            return response()->json([
                'success' => false,
                'code' => 'APPROVER_LOCKED',
                'error' => 'The approving account is temporarily locked. Ask an administrator to unlock it.',
            ], 423);
        }

        if (!Hash::check((string) $validated['pin'], $approver->pin_hash)) {
            $approver->increment('failed_login_attempts');
            $lockedUntil = PinPolicy::lockoutUntil(
                (int) $approver->failed_login_attempts,
                PinPolicy::attemptsAllowed($approver->max_failed_logins)
            );

            if ($lockedUntil !== null) {
                $approver->update(['locked_until' => $lockedUntil, 'failed_login_attempts' => 0]);
            }

            $this->auditRefusal($storeId, $counter, 'invalid_approver_pin', $actions, $approver->id);

            return response()->json([
                'success' => false,
                'code' => 'INVALID_APPROVER_PIN',
                'error' => 'Incorrect approver PIN.',
            ], 422);
        }

        $approver->update(['failed_login_attempts' => 0]);

        $issued = $this->approvals->issue([
            'store_id' => $storeId,
            'counter_id' => $counter->id,
            'document_type' => $validated['document_type'],
            'document_external_id' => $validated['document_external_id'],
            'actions' => $actions,
            'mode' => 'approver_pin',
            'approved_by_user_id' => $approver->id,
            'approved_by_name' => $approver->name,
            'requested_by_name' => $validated['requested_by'] ?? null,
            'requested_by_counter' => $counter->counter_code,
            'reason' => $validated['reason'] ?? null,
            'rule_snapshot' => ApprovalService::ruleSnapshot($counter, $actions),
        ]);

        return $this->granted($issued);
    }

    /**
     * The counter a grant is minted at. A device token names its own counter;
     * a person on a till route must name one of the store's.
     */
    private function counter(Request $request, int $storeId): ?Counter
    {
        $counterId = RequestTenant::counterId($request) ?? $request->input('counter_id');

        if ($counterId === null || $counterId === '') {
            return null;
        }

        return is_numeric($counterId)
            ? Counter::where('store_id', $storeId)->find((int) $counterId)
            : null;
    }

    /**
     * @param  array{token:string, approval:InvoiceApproval}  $issued
     */
    private function granted(array $issued): JsonResponse
    {
        return response()->json([
            'success' => true,
            'token' => $issued['token'],
            'approval' => $this->present($issued['approval']),
            'message' => 'Approval granted for one save.',
        ], 201);
    }

    private function present(InvoiceApproval $approval): array
    {
        return [
            'id' => (string) $approval->id,
            'counter_id' => $approval->counter_id !== null ? (string) $approval->counter_id : null,
            'document_type' => $approval->document_type,
            'document_external_id' => $approval->document_external_id,
            'actions' => array_values((array) $approval->actions),
            'mode' => $approval->mode,
            'status' => $approval->status,
            'approved_by_name' => $approval->approved_by_name,
            'expires_at' => $approval->expires_at?->toIso8601String(),
        ];
    }

    /**
     * @param  list<string>  $actions
     */
    private function auditRefusal(int $storeId, Counter $counter, string $reason, array $actions, ?int $approverId = null): void
    {
        AuditLog::log('counter_approval_refused', 'Counter', (string) $counter->id, null, [
            'reason' => $reason,
            'actions' => $actions,
            'approver_user_id' => $approverId,
        ], $storeId);
    }
}
