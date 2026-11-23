<?php

namespace App\Services\Sales;

use App\Exceptions\BusinessRuleException;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\PharmacistConfirmation;
use App\Models\Salesperson;
use App\Support\PharmacistRule;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

/**
 * GAP-02 / PHR-004, PHR-005 — the gate a restricted drug cannot pass alone.
 *
 * A bill, a return or a cancellation that carries a line the owner's schedule
 * list marks restricted goes through only after a registered pharmacist has
 * confirmed it with their own PIN. The screen's prompt is not the defence:
 * every one of these questions is answered here, on the server, from the
 * registration and the credential as they stand at this moment.
 *
 * Two answers come out of a check. The snapshot the document stamps — the
 * person, the number the council gave them, the instant they vouched — and,
 * when it refuses, the plain reason an operator can act on. Nothing about the
 * PIN survives the call: it is verified against the hash and dropped.
 *
 * The offline upload asks the same question and takes the other half of Q1:
 * {@see review()} never refuses a document a till wrote in the dark, it only
 * says whether the confirmation it carries holds, so ingest can stamp a real
 * one and file the rest for the owner.
 */
final class PharmacistGate
{
    /** What the refusal tells the till to open. */
    public const ACTION = 'pos.pharmacist_confirmation';

    public const REQUIRED = 'PHARMACIST_CONFIRMATION_REQUIRED';

    public const INVALID = 'PHARMACIST_CONFIRMATION_INVALID';

    public const MODE_PIN = 'pharmacist_pin';

    public const DOCUMENT_SALE = 'invoice';

    public const DOCUMENT_RETURN = 'sales_return';

    public const DOCUMENT_CANCEL = 'invoice_cancel';

    /**
     * The live gate: null when nothing on the document needs a pharmacist,
     * otherwise the snapshot to stamp — or a refusal that stops the save.
     *
     * @param  list<array<string,mixed>>  $restricted
     * @return array{pharmacist_id:int, pharmacist_name:string, pharmacist_reg_no:string, pharmacist_confirmed_at:Carbon}|null
     */
    public static function require(
        int $storeId,
        ?int $counterId,
        array $restricted,
        mixed $pharmacistId,
        mixed $pin,
        string $what = 'bill',
        ?Invoice $original = null
    ): ?array {
        if ($restricted === []) {
            return null;
        }

        $check = self::check($storeId, $pharmacistId, $pin, $what, $original);

        if ($check['code'] !== null) {
            self::auditRefusal($storeId, $counterId, $restricted, $check);

            throw self::refusal($restricted, $check, $what);
        }

        return $check['snapshot'];
    }

    /**
     * Who the document says confirmed, without deciding whether that holds.
     *
     * An offline till wrote the bill in the dark and can only report what it
     * was told, so ingest stamps that answer and files it for review rather
     * than losing it. {@see review()} is the half that judges it.
     *
     * @return array{pharmacist_id:int, pharmacist_name:string, pharmacist_reg_no:string, pharmacist_confirmed_at:Carbon}|null
     */
    public static function identity(int $storeId, mixed $pharmacistId, mixed $confirmedAt = null): ?array
    {
        $person = self::person($storeId, $pharmacistId);

        return $person === null ? null : self::stamp($person, $confirmedAt);
    }

    /**
     * The same question for a document that is already queued: the answer is
     * reported, never thrown.
     *
     * @param  list<array<string,mixed>>  $restricted
     * @return array{snapshot:array<string,mixed>|null, code:string|null, reason:string|null, field:string|null}
     */
    public static function review(
        int $storeId,
        array $restricted,
        mixed $pharmacistId,
        mixed $pin,
        string $what = 'bill'
    ): array {
        if ($restricted === []) {
            return self::accepted();
        }

        return self::check($storeId, $pharmacistId, $pin, $what);
    }

    /**
     * Write the confirmation for the act that just went through.
     *
     * @param  list<array<string,mixed>>  $restricted
     * @param  array<string,mixed>  $snapshot
     */
    public static function record(
        int $storeId,
        ?int $counterId,
        string $documentType,
        ?string $documentId,
        ?string $documentReference,
        array $snapshot,
        array $restricted,
        ?string $reason = null
    ): void {
        $row = PharmacistConfirmation::create([
            'store_id' => $storeId,
            'counter_id' => $counterId,
            'document_type' => $documentType,
            'document_id' => $documentId,
            'document_reference' => $documentReference,
            'pharmacist_id' => $snapshot['pharmacist_id'],
            'pharmacist_name' => $snapshot['pharmacist_name'],
            'pharmacist_reg_no' => $snapshot['pharmacist_reg_no'],
            'restricted_items' => $restricted,
            'mode' => self::MODE_PIN,
            'reason' => $reason,
            'confirmed_at' => $snapshot['pharmacist_confirmed_at'],
        ]);

        // The credential is deliberately absent: a confirmation is evidence
        // that a PIN was verified, never the PIN itself.
        AuditLog::log('pharmacist_confirmed', 'PharmacistConfirmation', (string) $row->id, null, [
            'document_type' => $documentType,
            'document_id' => $documentId,
            'document_reference' => $documentReference,
            'pharmacist_id' => $snapshot['pharmacist_id'],
            'pharmacist_name' => $snapshot['pharmacist_name'],
            'pharmacist_reg_no' => $snapshot['pharmacist_reg_no'],
            'restricted_products' => array_column($restricted, 'product_name'),
            'mode' => self::MODE_PIN,
            'confirmed_at' => Carbon::parse($snapshot['pharmacist_confirmed_at'])->toIso8601String(),
        ], $storeId);
    }

    /**
     * @return array{snapshot:array<string,mixed>|null, code:string|null, reason:string|null, field:string|null}
     */
    private static function check(int $storeId, mixed $pharmacistId, mixed $pin, string $what, ?Invoice $original = null): array
    {
        $id = is_scalar($pharmacistId) ? trim((string) $pharmacistId) : '';
        $secret = is_scalar($pin) ? trim((string) $pin) : '';

        if ($id === '' || $secret === '') {
            return self::refused(self::REQUIRED, 'No pharmacist confirmed it.', 'pharmacist_id');
        }

        $person = self::person($storeId, $pharmacistId);

        if ($person === null) {
            return self::refused(
                self::INVALID,
                'That person is not on this store\'s staff list, so they cannot confirm it.',
                'pharmacist_id'
            );
        }

        // The registration answers before the credential: an expired number is
        // the reason that matters, whoever types what.
        $why = PharmacistRule::refusal($person);

        if ($why !== null) {
            return self::refused(self::INVALID, $why, 'pharmacist_id');
        }

        // PHR-004: the pharmacist who vouched for the sale vouches for its
        // reversal too. A bill written before this rule recorded nobody, so any
        // live pharmacist of the store may still undo it.
        if ($original !== null
            && $original->pharmacist_id !== null
            && (int) $original->pharmacist_id !== (int) $person->id
        ) {
            return self::refused(
                self::INVALID,
                "Only {$original->pharmacist_name}, who confirmed {$original->invoice_number}, may confirm this {$what}.",
                'pharmacist_id'
            );
        }

        if (!Hash::check($secret, (string) $person->pin_hash)) {
            return self::refused(self::INVALID, "That is not {$person->name}'s PIN.", 'pharmacist_pin');
        }

        return [
            'snapshot' => self::stamp($person),
            'code' => null,
            'reason' => null,
            'field' => null,
        ];
    }

    /** The staff row behind whatever the document named it with. */
    private static function person(int $storeId, mixed $pharmacistId): ?Salesperson
    {
        $id = is_scalar($pharmacistId) ? trim((string) $pharmacistId) : '';

        return $id === '' ? null : Salesperson::ofStore($storeId)->find((int) $id);
    }

    /**
     * What the document keeps: the person, the number the council gave them and
     * the instant they vouched. The credential is never in it.
     *
     * @return array{pharmacist_id:int, pharmacist_name:string, pharmacist_reg_no:string, pharmacist_confirmed_at:Carbon}
     */
    private static function stamp(Salesperson $person, mixed $confirmedAt = null): array
    {
        $when = is_scalar($confirmedAt) && trim((string) $confirmedAt) !== ''
            ? Carbon::parse((string) $confirmedAt)
            : Carbon::now();

        return [
            'pharmacist_id' => (int) $person->id,
            'pharmacist_name' => (string) $person->name,
            'pharmacist_reg_no' => (string) $person->reg_no,
            'pharmacist_confirmed_at' => $when,
        ];
    }

    /**
     * @param  array{code:string|null, reason:string|null, field:string|null}  $check
     * @param  list<array<string,mixed>>  $restricted
     */
    private static function refusal(array $restricted, array $check, string $what): BusinessRuleException
    {
        $required = $check['code'] === self::REQUIRED;

        return new BusinessRuleException(
            (string) $check['code'],
            $required
                ? "A restricted drug is on this {$what}. It needs a pharmacist's confirmation with their own PIN before it goes through."
                : "A pharmacist's confirmation was refused: {$check['reason']}",
            'PHR-004',
            $restricted[0]['line'] ?? null,
            $check['field'],
            $required
                ? 'Ask the pharmacist on duty to enter their PIN. The owner registers pharmacists under Identity & Staff → Salespeople.'
                : 'Renew or correct the registration under Identity & Staff → Salespeople, or ask the pharmacist who confirmed the original bill.',
            BusinessRuleException::STATUS_UNPROCESSABLE,
            [
                'actions' => [self::ACTION],
                'restricted_items' => $restricted,
            ]
        );
    }

    /**
     * @param  array{code:string, reason:string, field:string, snapshot:mixed}  $check
     * @param  list<array<string,mixed>>  $restricted
     */
    private static function auditRefusal(int $storeId, ?int $counterId, array $restricted, array $check): void
    {
        AuditLog::log('pharmacist_confirmation_refused', 'Counter', (string) ($counterId ?? 0), null, [
            'code' => $check['code'],
            'reason' => $check['reason'],
            'field' => $check['field'],
            'restricted_products' => array_column($restricted, 'product_name'),
        ], $storeId);
    }

    /**
     * @return array{snapshot:null, code:null, reason:null, field:null}
     */
    private static function accepted(): array
    {
        return ['snapshot' => null, 'code' => null, 'reason' => null, 'field' => null];
    }

    /**
     * @return array{snapshot:null, code:string, reason:string, field:string}
     */
    private static function refused(string $code, string $reason, string $field): array
    {
        return ['snapshot' => null, 'code' => $code, 'reason' => $reason, 'field' => $field];
    }
}
