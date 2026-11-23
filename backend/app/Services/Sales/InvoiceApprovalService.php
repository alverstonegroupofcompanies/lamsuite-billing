<?php

namespace App\Services\Sales;

use App\Exceptions\BusinessRuleException;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\InvoiceApproval;

/**
 * G12: a verified approval is a credential, not a receipt. The till presents the
 * raw token minted by InvoiceApprovalController::verify and this service redeems
 * it exactly once, inside the transaction that performs the change.
 */
class InvoiceApprovalService
{
    /**
     * Redeem the grant issued for this invoice and action.
     *
     * Throws when no token is presented, or when the token is unknown, expired,
     * revoked, already consumed, belongs to another invoice or was issued for a
     * different action.
     */
    public function consume(Invoice $invoice, string $action, ?string $token, ?int $actorId = null): InvoiceApproval
    {
        $token = trim((string) $token);

        if ($token === '') {
            throw new BusinessRuleException(
                'CANCEL_APPROVAL_REQUIRED',
                "Cancelling invoice {$invoice->invoice_number} needs an approver's grant.",
                'invoice_cancel',
                null,
                'approval_token',
                'Ask a manager to approve the cancellation at the till, or an administrator to issue a one-time PIN.',
                403
            );
        }

        $approval = InvoiceApproval::query()
            ->where('store_id', $invoice->store_id)
            ->where('invoice_id', $invoice->id)
            ->where('action', $action)
            ->where('status', 'used')
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->lockForUpdate()
            ->get()
            ->first(fn (InvoiceApproval $candidate) => $candidate->token_hash
                && hash_equals($candidate->token_hash, hash('sha256', $token)));

        if (! $approval) {
            throw new BusinessRuleException(
                'CANCEL_APPROVAL_INVALID',
                'The approval for this cancellation is invalid, already used or expired.',
                'invoice_cancel',
                null,
                'approval_token',
                'Ask the approver to verify again at the till; a grant works once and only for the invoice it was issued for.',
                403
            );
        }

        $approval->forceFill([
            'consumed_at' => now(),
            'token_hash' => null,
        ])->save();

        AuditLog::log('invoice_approval_consumed', 'InvoiceApproval', (string) $approval->id, null, [
            'invoice_id' => $invoice->id,
            'invoice_number' => $invoice->invoice_number,
            'action' => $action,
            'mode' => $approval->mode,
            'approved_by' => $approval->approved_by_name,
            'requested_by_user_id' => $approval->requested_by_user_id,
            'consumed_at' => $approval->consumed_at?->toIso8601String(),
        ], $invoice->store_id, $actorId);

        return $approval;
    }
}
