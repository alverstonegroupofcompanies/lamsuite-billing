<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\InvoiceApproval;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Invoice edit/cancel approvals.
 *
 * Two legitimate paths:
 *  - manager: an active manager approves with their own password or PIN.
 *  - one_time_pin: an administrator pre-authorises one invoice + one user;
 *    the PIN is shown once, stored hashed, expires quickly and is single use.
 *
 * Every issue, success, failure and revocation is audited. No default PIN exists.
 */
class InvoiceApprovalController extends Controller
{
    public const ACTIONS = ['edit', 'cancel'];
    public const MODES = ['manager', 'one_time_pin'];
    public const APPROVER_ROLES = ['super_admin', 'store_owner', 'admin', 'manager'];
    public const ISSUER_ROLES = ['super_admin', 'store_owner', 'admin'];

    /**
     * Terminal verifies an approval before editing/cancelling an invoice.
     */
    public function verify(Request $request, string $id): JsonResponse
    {
        $invoice = $this->findInvoice($id);
        if (!$invoice) {
            return response()->json(['success' => false, 'error' => 'Invoice not found.'], 404);
        }

        $validated = $request->validate([
            'action' => 'required|in:' . implode(',', self::ACTIONS),
            'mode' => 'required|in:' . implode(',', self::MODES),
            'identifier' => 'nullable|string|max:191',
            'secret' => 'nullable|string|max:191',
            'pin' => 'nullable|string|min:6|max:6',
            'user_id' => 'nullable',
            'requested_by' => 'nullable|string|max:191',
            'counter_code' => 'nullable|string|max:40',
            'reason' => 'nullable|string|max:1000',
        ]);

        if (in_array($invoice->status, ['cancelled'], true) && $validated['action'] === 'edit') {
            return response()->json([
                'success' => false,
                'code' => 'INVOICE_CANCELLED',
                'error' => 'Cancelled invoices cannot be edited.',
            ], 422);
        }

        if ($validated['mode'] === 'manager') {
            return $this->verifyManager($request, $invoice, $validated);
        }

        return $this->verifyOneTimePin($request, $invoice, $validated);
    }

    /**
     * Administrator issues a one-time PIN that is shown exactly once.
     */
    public function issue(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        if (!$actor || !in_array($actor->role, self::ISSUER_ROLES, true)) {
            return response()->json([
                'success' => false,
                'error' => 'Only an administrator or store owner can issue an edit PIN.',
            ], 403);
        }

        $invoice = $this->findInvoice($id);
        if (!$invoice) {
            return response()->json(['success' => false, 'error' => 'Invoice not found.'], 404);
        }

        $validated = $request->validate([
            'action' => 'required|in:' . implode(',', self::ACTIONS),
            'user_id' => 'required',
            'minutes' => 'nullable|integer|min:1|max:60',
            'reason' => 'nullable|string|max:1000',
        ]);

        $target = User::where('id', $validated['user_id'])
            ->where('store_id', $invoice->store_id)
            ->first();

        if (!$target) {
            return response()->json([
                'success' => false,
                'error' => 'Select an active staff member from this store.',
            ], 422);
        }

        $minutes = (int)($validated['minutes'] ?? 10);
        $pin = (string)random_int(100000, 999999);
        $expiresAt = now()->addMinutes($minutes);

        $approval = InvoiceApproval::create([
            'store_id' => $invoice->store_id,
            'invoice_id' => $invoice->id,
            'action' => $validated['action'],
            'mode' => 'one_time_pin',
            'status' => 'pending',
            'requested_by_user_id' => $target->id,
            'requested_by_name' => $target->name,
            'approved_by_user_id' => $actor->id,
            'approved_by_name' => $actor->name,
            'pin_hash' => Hash::make($pin),
            'reason' => $validated['reason'] ?? null,
            'expires_at' => $expiresAt,
        ]);

        AuditLog::log('invoice_approval_issued', 'InvoiceApproval', (string)$approval->id, null, [
            'invoice_id' => $invoice->id,
            'invoice_number' => $invoice->invoice_number,
            'action' => $validated['action'],
            'mode' => 'one_time_pin',
            'target_user_id' => $target->id,
            'expires_at' => $expiresAt->toIso8601String(),
        ], $invoice->store_id);

        return response()->json([
            'success' => true,
            // Shown exactly once. Only the hash is stored.
            'pin' => $pin,
            'approval' => $this->presentApproval($approval),
            'message' => "One-time {$validated['action']} PIN issued. It expires in {$minutes} minute(s) and works once.",
        ], 201);
    }

    public function index(Request $request, string $id): JsonResponse
    {
        $invoice = $this->findInvoice($id);
        if (!$invoice) {
            return response()->json(['success' => false, 'error' => 'Invoice not found.'], 404);
        }

        $rows = InvoiceApproval::where('invoice_id', $invoice->id)
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->map(fn(InvoiceApproval $a) => $this->presentApproval($a));

        return response()->json(['success' => true, 'approvals' => $rows]);
    }

    public function revoke(Request $request, string $id, string $approvalId): JsonResponse
    {
        $invoice = $this->findInvoice($id);
        if (!$invoice) {
            return response()->json(['success' => false, 'error' => 'Invoice not found.'], 404);
        }

        $approval = InvoiceApproval::where('invoice_id', $invoice->id)->find($approvalId);
        if (!$approval) {
            return response()->json(['success' => false, 'error' => 'Approval not found.'], 404);
        }

        if ($approval->status === 'used') {
            return response()->json(['success' => false, 'error' => 'This approval was already used.'], 422);
        }

        $approval->update(['status' => 'revoked', 'pin_hash' => null, 'token_hash' => null]);

        AuditLog::log('invoice_approval_revoked', 'InvoiceApproval', (string)$approval->id, null, [
            'invoice_id' => $invoice->id,
            'action' => $approval->action,
        ], $invoice->store_id);

        return response()->json(['success' => true, 'approval' => $this->presentApproval($approval)]);
    }

    private function verifyManager(Request $request, Invoice $invoice, array $data): JsonResponse
    {
        $identifier = trim((string)($data['identifier'] ?? ''));
        $secret = (string)($data['secret'] ?? '');

        if ($identifier === '' || $secret === '') {
            return response()->json([
                'success' => false,
                'code' => 'CREDENTIALS_REQUIRED',
                'error' => 'Enter the approving manager username/email and password or PIN.',
            ], 422);
        }

        $manager = User::where('store_id', $invoice->store_id)
            ->where(function ($q) use ($identifier) {
                $q->where('username', $identifier)
                    ->orWhere('email', $identifier);
            })
            ->first();

        if (!$manager || !in_array($manager->role, self::APPROVER_ROLES, true)) {
            $this->auditFailure($request, $invoice, $data, 'approver_not_found_or_role');
            return response()->json([
                'success' => false,
                'code' => 'INVALID_APPROVER',
                'error' => 'This account cannot approve invoice changes.',
            ], 422);
        }

        if ($manager->locked_until && $manager->locked_until->isFuture()) {
            return response()->json([
                'success' => false,
                'code' => 'APPROVER_LOCKED',
                'error' => 'The approving account is temporarily locked. Ask an administrator to unlock it.',
            ], 423);
        }

        $passwordOk = $manager->password ? Hash::check($secret, $manager->password) : false;
        $pinOk = $manager->pin_hash ? Hash::check($secret, $manager->pin_hash) : false;
        $permissionOk = $manager->hasPermission('transactions', 'edit')
            || in_array($manager->role, ['super_admin', 'store_owner', 'admin'], true);

        if (!$passwordOk && !$pinOk) {
            $manager->increment('failed_login_attempts');
            $max = (int)($manager->max_failed_logins ?? 5);
            if ($manager->failed_login_attempts >= $max) {
                $manager->update(['locked_until' => now()->addMinutes(15), 'failed_login_attempts' => 0]);
            }
            $this->auditFailure($request, $invoice, $data, 'invalid_manager_credentials');
            return response()->json([
                'success' => false,
                'code' => 'INVALID_CREDENTIALS',
                'error' => 'Invalid manager credentials.',
            ], 422);
        }

        if (!$permissionOk) {
            $this->auditFailure($request, $invoice, $data, 'missing_edit_permission');
            return response()->json([
                'success' => false,
                'code' => 'APPROVER_NOT_PERMITTED',
                'error' => 'The approving manager does not have invoice edit permission.',
            ], 403);
        }

        $manager->update(['failed_login_attempts' => 0]);

        $token = Str::random(48);
        $approval = InvoiceApproval::create([
            'store_id' => $invoice->store_id,
            'invoice_id' => $invoice->id,
            'action' => $data['action'],
            'mode' => 'manager',
            'status' => 'used',
            'requested_by_user_id' => $data['user_id'] ?? null,
            'requested_by_name' => $data['requested_by'] ?? null,
            'requested_by_counter' => $data['counter_code'] ?? null,
            'approved_by_user_id' => $manager->id,
            'approved_by_name' => $manager->name,
            'token_hash' => hash('sha256', $token),
            'reason' => $data['reason'] ?? null,
            'expires_at' => now()->addMinutes(5),
            'used_at' => now(),
        ]);

        AuditLog::log('invoice_approval_used', 'InvoiceApproval', (string)$approval->id, null, [
            'invoice_id' => $invoice->id,
            'invoice_number' => $invoice->invoice_number,
            'action' => $data['action'],
            'mode' => 'manager',
            'approved_by' => $manager->name,
        ], $invoice->store_id);

        return response()->json([
            'success' => true,
            'token' => $token,
            'approval' => $this->presentApproval($approval),
        ]);
    }

    private function verifyOneTimePin(Request $request, Invoice $invoice, array $data): JsonResponse
    {
        $pin = trim((string)($data['pin'] ?? ''));
        $userId = $data['user_id'] ?? null;

        if ($pin === '' || $userId === null || $userId === '') {
            return response()->json([
                'success' => false,
                'code' => 'PIN_AND_USER_REQUIRED',
                'error' => 'Enter the one-time PIN issued for your account.',
            ], 422);
        }

        $user = User::where('id', $userId)
            ->where('store_id', $invoice->store_id)
            ->first();

        if (!$user) {
            $this->auditFailure($request, $invoice, $data, 'requesting_user_not_found');
            return response()->json([
                'success' => false,
                'code' => 'INVALID_REQUESTING_USER',
                'error' => 'The one-time PIN must be used by the staff member it was issued to.',
            ], 422);
        }

        $approval = InvoiceApproval::where('invoice_id', $invoice->id)
            ->where('action', $data['action'])
            ->where('mode', 'one_time_pin')
            ->where('status', 'pending')
            ->where('expires_at', '>', now())
            ->orderByDesc('id')
            ->get()
            ->first(function (InvoiceApproval $candidate) use ($user, $pin) {
                if ($candidate->requested_by_user_id && (int)$candidate->requested_by_user_id !== (int)$user->id) {
                    return false;
                }
                return $candidate->pin_hash && Hash::check($pin, $candidate->pin_hash);
            });

        if (!$approval) {
            $this->auditFailure($request, $invoice, $data, 'invalid_or_expired_one_time_pin');
            return response()->json([
                'success' => false,
                'code' => 'INVALID_ONE_TIME_PIN',
                'error' => 'The one-time PIN is invalid, already used or expired. Ask an administrator for a new one.',
            ], 422);
        }

        $token = Str::random(48);
        $approval->update([
            'status' => 'used',
            'used_at' => now(),
            'pin_hash' => null,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addMinutes(5),
            'requested_by_user_id' => $user->id,
            'requested_by_name' => $user->name,
            'requested_by_counter' => $data['counter_code'] ?? $approval->requested_by_counter,
            'reason' => $data['reason'] ?? $approval->reason,
        ]);

        AuditLog::log('invoice_approval_used', 'InvoiceApproval', (string)$approval->id, null, [
            'invoice_id' => $invoice->id,
            'invoice_number' => $invoice->invoice_number,
            'action' => $approval->action,
            'mode' => 'one_time_pin',
            'used_by_user_id' => $user->id,
            'approved_by' => $approval->approved_by_name,
        ], $invoice->store_id);

        return response()->json([
            'success' => true,
            'token' => $token,
            'approval' => $this->presentApproval($approval->fresh()),
        ]);
    }

    private function auditFailure(Request $request, Invoice $invoice, array $data, string $reason): void
    {
        AuditLog::log('invoice_approval_failed', 'Invoice', (string)$invoice->id, null, [
            'reason' => $reason,
            'action' => $data['action'] ?? null,
            'mode' => $data['mode'] ?? null,
            'requested_by' => $data['requested_by'] ?? null,
            'counter_code' => $data['counter_code'] ?? null,
        ], $invoice->store_id);
    }

    private function presentApproval(InvoiceApproval $approval): array
    {
        return [
            'id' => (string)$approval->id,
            'invoice_id' => (string)$approval->invoice_id,
            'action' => $approval->action,
            'mode' => $approval->mode,
            'status' => $approval->status,
            'approved_by_name' => $approval->approved_by_name,
            'expires_at' => $approval->expires_at?->toIso8601String(),
            'used_at' => $approval->used_at?->toIso8601String(),
        ];
    }

    private function findInvoice(string $id): ?Invoice
    {
        return Invoice::where('id', $id)
            ->orWhere('invoice_number', $id)
            ->first();
    }
}
