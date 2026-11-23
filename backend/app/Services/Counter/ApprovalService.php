<?php

namespace App\Services\Counter;

use App\Exceptions\BusinessRuleException;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\InvoiceApproval;
use Illuminate\Support\Str;

/**
 * APR-003..010 — the credential that lets one over-threshold document through.
 *
 * The profile answers "needs a grant" before a bill exists, so the grant cannot
 * name an invoice id: it names the till's own document identity, the counter
 * that asked and the action keys it settles. Issuing mints an opaque token and
 * stores only its hash; settling redeems it exactly once, inside the same
 * transaction that writes the document, so a failed save leaves the grant
 * usable and a successful one can never be replayed.
 */
final class ApprovalService
{
    public const DOCUMENT_INVOICE = 'invoice';

    public const MODES = ['approver_pin', 'one_time_pin'];

    /** A grant outlives the counter conversation, not the coffee break. */
    public const GRANT_MINUTES = 5;

    /**
     * Mint a single-use grant and hand back the plaintext token, which is the
     * only time it exists.
     *
     * @param  array{
     *   store_id:int,
     *   counter_id?:int|null,
     *   document_type:string,
     *   document_external_id?:string|null,
     *   actions:list<string>,
     *   mode:string,
     *   invoice_id?:int|null,
     *   approved_by_user_id?:int|null,
     *   approved_by_name?:string|null,
     *   requested_by_user_id?:int|null,
     *   requested_by_name?:string|null,
     *   requested_by_counter?:string|null,
     *   reason?:string|null,
     *   rule_snapshot?:array<string,mixed>|null
     * }  $facts
     * @return array{token:string, approval:InvoiceApproval}
     */
    public function issue(array $facts): array
    {
        $actions = array_values(array_unique(array_map('strval', $facts['actions'])));
        $token = Str::random(48);

        $approval = InvoiceApproval::create([
            'store_id' => (int) $facts['store_id'],
            'counter_id' => $facts['counter_id'] ?? null,
            'invoice_id' => $facts['invoice_id'] ?? null,
            'action' => $actions[0] ?? null,
            'actions' => $actions,
            'document_type' => (string) $facts['document_type'],
            'document_external_id' => $facts['document_external_id'] ?? null,
            'mode' => (string) $facts['mode'],
            'status' => 'used',
            'requested_by_user_id' => $facts['requested_by_user_id'] ?? null,
            'requested_by_name' => $facts['requested_by_name'] ?? null,
            'requested_by_counter' => $facts['requested_by_counter'] ?? null,
            'approved_by_user_id' => $facts['approved_by_user_id'] ?? null,
            'approved_by_name' => $facts['approved_by_name'] ?? null,
            'token_hash' => hash('sha256', $token),
            'reason' => $facts['reason'] ?? null,
            'rule_snapshot' => $facts['rule_snapshot'] ?? null,
            'expires_at' => now()->addMinutes(self::GRANT_MINUTES),
            'used_at' => now(),
        ]);

        AuditLog::log('counter_approval_granted', 'InvoiceApproval', (string) $approval->id, null, [
            'mode' => $approval->mode,
            'actions' => $actions,
            'document_type' => $approval->document_type,
            'document_external_id' => $approval->document_external_id,
            'counter_id' => $approval->counter_id,
            'approved_by' => $approval->approved_by_name,
            'expires_at' => $approval->expires_at?->toIso8601String(),
        ], (int) $facts['store_id']);

        return ['token' => $token, 'approval' => $approval];
    }

    /**
     * Redeem the grant a deferred save was told it needs.
     *
     * Called inside the document's transaction, after the row exists so the
     * grant can name it. Any failure throws and rolls the document back.
     *
     * @param  array<string,string>  $required  action key => refusal message
     * @return InvoiceApproval|null null when the save needed nothing
     */
    public function settle(
        array $required,
        ?string $token,
        int $storeId,
        ?int $counterId,
        string $documentType,
        ?string $documentExternalId,
        ?int $invoiceId = null
    ): ?InvoiceApproval {
        if ($required === []) {
            return null;
        }

        $actions = array_keys($required);
        $token = trim((string) $token);

        if ($token === '') {
            throw new BusinessRuleException(
                'approval_required',
                'This bill needs an approver\'s grant before it can be saved.',
                null,
                null,
                null,
                'Ask an approver to enter their PIN for this bill.',
                BusinessRuleException::STATUS_UNPROCESSABLE,
                ['actions' => $actions, 'reasons' => $required]
            );
        }

        $approval = InvoiceApproval::query()
            ->where('store_id', $storeId)
            ->where('document_type', $documentType)
            ->where('document_external_id', $documentExternalId)
            ->where('status', 'used')
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->where('token_hash', hash('sha256', $token))
            ->latest('id')
            ->lockForUpdate()
            ->first();

        if ($approval === null
            || ($approval->counter_id !== null && (int) $approval->counter_id !== (int) $counterId)
        ) {
            throw $this->invalid();
        }

        $granted = array_map('strval', (array) $approval->actions);
        $missing = array_values(array_diff($actions, $granted));

        if ($missing !== []) {
            throw $this->invalid();
        }

        $approval->update([
            'consumed_at' => now(),
            'invoice_id' => $invoiceId,
        ]);

        AuditLog::log('counter_approval_settled', 'InvoiceApproval', (string) $approval->id, null, [
            'actions' => $actions,
            'document_type' => $documentType,
            'document_external_id' => $documentExternalId,
            'invoice_id' => $invoiceId,
            'counter_id' => $counterId,
            'approved_by' => $approval->approved_by_name,
        ], $storeId);

        return $approval;
    }

    /**
     * The rule in force when the grant was minted, kept beside the grant so an
     * owner reviewing it later sees the ceiling that applied at the time.
     *
     * @return array<string,mixed>
     */
    public static function ruleSnapshot(Counter $counter, array $actions): array
    {
        $profile = \App\Support\Counter\CounterProfile::resolve($counter);
        $controls = array_unique(array_filter(array_map(
            static fn (string $action) => CounterActionRegistry::controlFor($action)['control'] ?? null,
            $actions
        )));

        $snapshot = ['profile_version' => (int) ($profile['version'] ?? 0)];

        foreach ($controls as $control) {
            $snapshot[$control] = $profile[$control] ?? null;
        }

        return $snapshot;
    }

    private function invalid(): BusinessRuleException
    {
        return new BusinessRuleException(
            'approval_invalid',
            'That approval has expired, was already used, or belongs to another bill.',
            null,
            null,
            null,
            'Ask the approver for a new grant for this bill.',
            BusinessRuleException::STATUS_UNPROCESSABLE
        );
    }

    /**
     * One grant may carry a document and a set of actions; a one-time PIN is
     * issued for actions before the document is known, so binding happens when
     * it is redeemed.
     */
    public function redeemOneTimePin(
        int $storeId,
        ?int $counterId,
        string $pin,
        array $actions,
        string $documentType,
        ?string $documentExternalId,
        ?string $counterCode,
        ?string $reason
    ): array {
        $candidates = InvoiceApproval::query()
            ->where('store_id', $storeId)
            ->where('mode', 'one_time_pin')
            ->where('status', 'pending')
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->where(fn ($q) => $q->whereNull('counter_id')->orWhere('counter_id', $counterId))
            ->latest('id')
            ->lockForUpdate()
            ->get();

        $approval = $candidates->first(function (InvoiceApproval $candidate) use ($pin, $actions) {
            $granted = array_map('strval', (array) $candidate->actions);

            return $candidate->pin_hash
                && \Illuminate\Support\Facades\Hash::check($pin, $candidate->pin_hash)
                && array_diff($actions, $granted) === [];
        });

        if ($approval === null) {
            throw new BusinessRuleException(
                'INVALID_ONE_TIME_PIN',
                'That one-time PIN is invalid, already used or expired. Ask an administrator for a new one.',
                null,
                null,
                null,
                null,
                BusinessRuleException::STATUS_UNPROCESSABLE
            );
        }

        $token = Str::random(48);

        $approval->update([
            'status' => 'used',
            'used_at' => now(),
            'pin_hash' => null,
            'token_hash' => hash('sha256', $token),
            'document_type' => $documentType,
            'document_external_id' => $documentExternalId,
            'actions' => array_values($actions),
            'action' => $actions[0] ?? $approval->action,
            'requested_by_counter' => $counterCode ?? $approval->requested_by_counter,
            'reason' => $reason ?? $approval->reason,
            'expires_at' => now()->addMinutes(self::GRANT_MINUTES),
        ]);

        AuditLog::log('counter_approval_one_time_pin_used', 'InvoiceApproval', (string) $approval->id, null, [
            'actions' => array_values($actions),
            'document_type' => $documentType,
            'document_external_id' => $documentExternalId,
            'counter_id' => $counterId,
            'counter_code' => $counterCode,
        ], $storeId);

        return ['token' => $token, 'approval' => $approval->fresh()];
    }
}
