<?php

namespace App\Services\Counter;

use App\Support\Counter\CounterProfile;
use Illuminate\Support\Carbon;

/**
 * PRF-003 — what a counter's permission profile says about one action.
 *
 * Pure: it takes the resolved document, an action key from
 * CounterActionRegistry, and the facts the caller already has (the discount on
 * the bill, the report being read, the value being returned). It never reads
 * the database and never answers for a person's role — the profile replaced
 * that at the till.
 *
 * Three answers, not two. `allow`; `counter_action_not_permitted` for what the
 * profile simply does not carry; and `counter_action_approval_required` for
 * what sits above a threshold the owner set. The third is not a refusal the
 * till can talk its way around: under Q9 nothing that needs a grant is saved
 * before the grant lands, which is why Wave C's approval screens answer it and
 * nothing else does.
 *
 * A list control (modules, reports, settings_editable, payment_modes_allowed)
 * restricts only what it names, so a profile that carries no list at all
 * imposes no limit. Only a stored list is a whitelist; hiding a screen means
 * naming the ones that stay.
 */
final class CounterProfilePolicy
{
    public const DENIED = 'counter_action_not_permitted';
    public const APPROVAL_REQUIRED = 'counter_action_approval_required';

    /**
     * Tenders an owner can choose between in a profile. Anything else the till
     * accepts (bank transfer, cheque, a mode the store invented) is outside
     * that vocabulary, so "cash and UPI only" does not silently forbid it.
     */
    private const RESTRICTABLE_MODES = ['cash', 'upi', 'card', 'credit'];

    private const MODE_ALIASES = [
        'on_account' => 'credit',
        'on_account_credit' => 'credit',
        'ledger' => 'credit',
        'terms' => 'credit',
        'upi_qr' => 'upi',
        'qr' => 'upi',
        'qr_code' => 'upi',
    ];

    /**
     * @param  array<string,mixed>  $profile  a CounterProfile::resolve() document
     * @param  array<string,mixed>  $context
     * @return array{allowed:bool, action:string, code?:string, message?:string}
     */
    public function decide(array $profile, string $action, array $context = []): array
    {
        $control = CounterActionRegistry::controlFor($action);

        if ($control === null) {
            // A typo in a declaration must not read as a granted permission.
            return $this->deny($action, 'There is no gated action named this.');
        }

        $screens = (array) ($context['modules'] ?? (isset($control['module']) ? [$control['module']] : []));
        $named = $this->restricts($profile, 'modules');

        if ($screens !== [] && $named !== [] && array_intersect($named, $screens) === []) {
            return $this->deny($action, 'This counter\'s profile does not carry the '
                .implode(' or ', $screens).' screen.');
        }

        return match ($control['control']) {
            'modules' => $this->allow($action),

            'cash_drawer' => $this->boolean($profile, 'cash_drawer', $action,
                'This counter is not allowed to open the cash drawer or run a shift.'),

            'purchase_entry' => $this->boolean($profile, 'purchase_entry', $action,
                'This counter is not allowed to enter purchase bills.'),

            'discount' => $this->discount($profile, $context),
            'price_override' => $this->priceOverride($profile, $context),
            'payment_modes_allowed' => $this->paymentModes($profile, $context),
            'settings_editable' => $this->settingsEditable($profile, $action, $context),
            'edits' => $this->edits($profile, $action, $context),
            'cancellations' => $this->cancellations($profile, $action,
                'This counter is not allowed to cancel bills.'),
            'returns' => $this->returns($profile, $action, $context),
            'stock_adjustments' => $this->quantityGate($profile, 'stock_adjustments', $action,
                'This counter is not allowed to adjust stock.',
                'An adjustment of that size needs an approver\'s grant.'),
            'transfers' => $this->transfer($profile, $action),
            'reports' => $this->reports($profile, $context),
            'salesperson' => $this->salesperson($profile, $action),
            'sell_beyond_stock' => $this->sellBeyondStock($profile, $context),
            default => $this->deny($action, 'This action has no rule the server can apply.'),
        };
    }

    /**
     * Q1/PRF-007 helper for the callers that are not HTTP gates: the stock
     * check inside billing has to know whether this counter may sell a line it
     * does not have, and the answer comes from the same document.
     *
     * A control that asks for approval is not a free pass either: under Q9 a
     * bill that needs a grant is not saved before the grant lands, so until
     * Wave C's approvals answer for it, the sale does not go through.
     *
     * @param  array<string,mixed>  $profile
     */
    public function sellBeyondStockAllowed(array $profile): bool
    {
        $rules = (array) ($profile['sell_beyond_stock'] ?? []);

        return ($rules['allowed'] ?? true) === true
            && empty($rules['approval_required']);
    }

    /** @return array{allowed:bool, action:string, code?:string, message?:string} */
    public function allow(string $action): array
    {
        return ['allowed' => true, 'action' => $action];
    }

    /** @return array{allowed:false, action:string, code:string, message:string} */
    public function deny(string $action, string $message, string $code = self::DENIED): array
    {
        return ['allowed' => false, 'action' => $action, 'code' => $code, 'message' => $message];
    }

    /**
     * Both shapes Q8 settled on: `max_pct`/`max_amount` are ceilings the
     * counter can never cross, `approval_pct` is the point above which the
     * bill needs a grant but may still go through.
     */
    private function discount(array $profile, array $context): array
    {
        $action = 'pos.discount';
        $rules = (array) ($profile['discount'] ?? []);
        $percent = $this->number($context['discount_pct'] ?? null);
        $amount = $this->number($context['discount_amount'] ?? null);

        $maxPct = $this->number($rules['max_pct'] ?? null);
        $maxAmount = $this->number($rules['max_amount'] ?? null);

        if ($maxPct !== null && $percent !== null && $percent > $maxPct + 0.000001) {
            return $this->deny($action, "This counter may discount at most {$maxPct}% of a bill.");
        }

        if ($maxAmount !== null && $amount !== null && $amount > $maxAmount + 0.01) {
            return $this->deny($action, 'This counter may discount at most ₹'.$maxAmount.' on a bill.');
        }

        $approvalPct = $this->number($rules['approval_pct'] ?? null);

        if ($approvalPct !== null && $percent !== null && $percent > $approvalPct + 0.000001) {
            return $this->deny($action,
                "A discount above {$approvalPct}% needs an approver's grant.",
                self::APPROVAL_REQUIRED);
        }

        return $this->allow($action);
    }

    private function priceOverride(array $profile, array $context): array
    {
        $action = 'pos.price_override';
        $rules = (array) ($profile['price_override'] ?? []);

        if (empty($context['price_overridden'])) {
            return $this->allow($action);
        }

        if (($rules['allowed'] ?? true) === false) {
            return $this->deny($action, "This counter must bill at the item's own selling rate.");
        }

        $approvalPct = $this->number($rules['approval_pct'] ?? null);
        $changePct = $this->number($context['price_change_pct'] ?? null);

        if ($approvalPct !== null && $changePct !== null && $changePct > $approvalPct + 0.000001) {
            return $this->deny($action,
                "A price change above {$approvalPct}% needs an approver's grant.",
                self::APPROVAL_REQUIRED);
        }

        return $this->allow($action);
    }

    private function paymentModes(array $profile, array $context): array
    {
        $action = 'pos.payment_mode';
        $allowed = $this->restricts($profile, 'payment_modes_allowed');

        if ($allowed === []) {
            return $this->allow($action);
        }

        foreach ((array) ($context['payment_modes'] ?? []) as $mode) {
            $canonical = $this->mode($mode);

            if ($canonical !== null && !in_array($canonical, $allowed, true)) {
                return $this->deny($action, "This counter may not take payment as {$mode}.");
            }
        }

        return $this->allow($action);
    }

    /**
     * The only settings a counter may write are the ones the profile names.
     * Keys outside the profile's vocabulary are store configuration, which the
     * Settings screen gate answers for, not this list.
     */
    private function settingsEditable(array $profile, string $action, array $context): array
    {
        $allowed = $this->restricts($profile, 'settings_editable');

        if ($allowed === []) {
            return $this->allow($action);
        }

        foreach ((array) ($context['setting_keys'] ?? []) as $key) {
            $key = (string) $key;

            if (in_array($key, CounterProfile::SETTINGS, true) && !in_array($key, $allowed, true)) {
                return $this->deny($action, "This counter's profile does not allow changing {$key}.");
            }
        }

        return $this->allow($action);
    }

    private function edits(array $profile, string $action, array $context): array
    {
        $rules = (array) ($profile['edits'] ?? []);

        if (($rules['allowed'] ?? true) === false) {
            return $this->deny($action, 'This counter is not allowed to edit saved bills.');
        }

        $window = $rules['window_days'] ?? null;
        $date = $context['invoice_date'] ?? null;

        if ($window !== null && $window !== '' && $date !== null) {
            $days = (int) $window;
            $when = $date instanceof \DateTimeInterface ? Carbon::instance($date) : Carbon::parse((string) $date);

            if ($days >= 0 && $when->lt(Carbon::now()->subDays($days))) {
                return $this->deny($action, "This counter may only edit bills from the last {$days} days.");
            }
        }

        if (!empty($rules['approval_required'])) {
            return $this->deny($action, 'Editing a saved bill needs an approver\'s grant.', self::APPROVAL_REQUIRED);
        }

        return $this->allow($action);
    }

    /**
     * A profile may forbid cancellation outright. It does not decide whether an
     * approver is needed: since G12 every cancellation presents a grant, and the
     * ticket enforces that. Keeping the old hard denial here would let a store
     * with `approval_required` on issue a grant the till could never use.
     *
     * @param  array<string,mixed>  $profile
     */
    private function cancellations(array $profile, string $action, string $denied): array
    {
        $rules = (array) ($profile['cancellations'] ?? []);

        if (($rules['allowed'] ?? true) === false) {
            return $this->deny($action, $denied);
        }

        return $this->allow($action);
    }

    private function returns(array $profile, string $action, array $context): array
    {
        $rules = (array) ($profile['returns'] ?? []);

        if (($rules['allowed'] ?? true) === false) {
            return $this->deny($action, 'This counter is not allowed to take returns.');
        }

        $limit = $this->number($rules['approval_value_limit'] ?? null);
        $value = $this->number($context['value'] ?? null);

        if ($limit !== null && $value !== null && $value > $limit + 0.01) {
            return $this->deny($action,
                'A return worth more than ₹'.$limit.' needs an approver\'s grant.',
                self::APPROVAL_REQUIRED);
        }

        return $this->allow($action);
    }

    private function quantityGate(array $profile, string $key, string $action, string $denied, string $approval): array
    {
        $rules = (array) ($profile[$key] ?? []);

        if (($rules['allowed'] ?? true) === false) {
            return $this->deny($action, $denied);
        }

        $limit = $this->number($rules['approval_limit_qty'] ?? null);
        $quantity = $this->number($context['qty'] ?? null);

        if ($limit !== null && $quantity !== null && abs($quantity) > $limit + 0.000001) {
            return $this->deny($action, $approval, self::APPROVAL_REQUIRED);
        }

        return $this->allow($action);
    }

    private function transfer(array $profile, string $action): array
    {
        $leg = str_contains($action, 'receive') ? 'receive' : 'dispatch';
        $action = "transfer.{$leg}";

        if (($profile['transfers'][$leg] ?? true) === false) {
            return $this->deny($action, $leg === 'receive'
                ? 'This counter is not allowed to receive stock transfers.'
                : 'This counter is not allowed to send stock transfers.');
        }

        return $this->allow($action);
    }

    private function reports(array $profile, array $context): array
    {
        $action = 'report.view';
        $allowed = $this->restricts($profile, 'reports');

        if ($allowed === [] || count($allowed) === 1 && $allowed[0] === '*') {
            return $this->allow($action);
        }

        $report = (string) ($context['report'] ?? '');

        if ($report !== '' && !in_array($report, $allowed, true)) {
            return $this->deny($action, "This counter's profile does not include the {$report} report.");
        }

        return $this->allow($action);
    }

    private function salesperson(array $profile, string $action): array
    {
        return ($profile['salesperson']['manage'] ?? false) === true
            ? $this->allow($action)
            : $this->deny($action, 'This counter is not allowed to manage salespeople.');
    }

    private function sellBeyondStock(array $profile, array $context): array
    {
        $action = 'pos.sell_beyond_stock';

        if (empty($context['sell_beyond_stock'])) {
            return $this->allow($action);
        }

        $rules = (array) ($profile['sell_beyond_stock'] ?? []);

        if (($rules['allowed'] ?? true) === false) {
            return $this->deny($action, 'This counter may not sell stock it does not have.');
        }

        if (!empty($rules['approval_required'])) {
            return $this->deny($action, 'Selling beyond stock needs an approver\'s grant.', self::APPROVAL_REQUIRED);
        }

        return $this->allow($action);
    }

    private function boolean(array $profile, string $key, string $action, string $message): array
    {
        return ($profile[$key] ?? true) === false
            ? $this->deny($action, $message)
            : $this->allow($action);
    }

    /**
     * The list as a whitelist: `[]` when the profile names nothing, which this
     * class reads as "no limit recorded" rather than "nothing permitted".
     *
     * @return list<string>
     */
    private function restricts(array $profile, string $key): array
    {
        $value = $profile[$key] ?? null;

        if (!is_array($value) || $value === []) {
            return [];
        }

        $entries = array_values(array_filter(array_map(
            static fn ($entry) => is_scalar($entry) ? trim((string) $entry) : '',
            $value
        ), static fn (string $entry) => $entry !== ''));

        return in_array('*', $entries, true) ? [] : $entries;
    }

    private function mode(mixed $mode): ?string
    {
        $name = str_replace([' ', '-'], '_', strtolower(trim((string) $mode)));

        if ($name === '') {
            return null;
        }

        $canonical = self::MODE_ALIASES[$name] ?? $name;

        return in_array($canonical, self::RESTRICTABLE_MODES, true) ? $canonical : null;
    }

    private function number(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }
}
