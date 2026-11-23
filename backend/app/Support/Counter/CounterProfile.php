<?php

namespace App\Support\Counter;

use App\Models\Counter;

/**
 * PRF-001 — the one canonical permission document a counter works inside.
 *
 * The document replaces the signed-in person's role at the till: it names one
 * key per control the requirement lists (visible screens, cash drawer, discount
 * limits, price override, selling beyond stock, edits, cancellations, returns,
 * purchase entry, stock adjustments, transfers, reports, counter-changeable
 * settings, printers) and nothing else is carried. Reading it never rewrites
 * it, so a partial document an owner saved years ago still reads complete.
 *
 * Module ids are the store's menu ids. CFG-002 keeps `enabled_menu_items` as the
 * store-level switch, and the till intersects the two, so one vocabulary is a
 * correctness requirement rather than a taste.
 */
class CounterProfile
{
    /** PRF-001/PRF-004: bumped whenever a document is saved. */
    public const VERSION = 1;

    public const MODULES = [
        'dashboard',
        'pos',
        'bills',
        'sales_returns',
        'customer_debit_notes',
        'purchases',
        'purchase_returns',
        'expenses',
        'stock',
        'stock_transfers',
        'reports',
        'masters',
        'import_export',
        'migration',
        'settings',
        'counters',
    ];

    /** The settings a counter is allowed to change at the till. */
    public const SETTINGS = [
        'printer',
        'paper_size',
        'payment_modes',
        'language',
        'theme',
        'cart',
        'counter_code_display',
    ];

    /** Wave C lights these up; the key exists so an owner can set it today. */
    public const APPROVAL_METHODS = ['approver_pin', 'one_time_pin', 'salesperson_pin', 'remote'];

    private const BOOLEANS = ['cash_drawer', 'purchase_entry'];

    private const LISTS = [
        'modules' => self::MODULES,
        'screens' => null,
        'reports' => null,
        'settings_editable' => null,
        'payment_modes_allowed' => null,
        'approval_methods' => self::APPROVAL_METHODS,
    ];

    /** Nested controls: key => sub-key => kind. */
    private const OBJECTS = [
        'discount' => ['max_pct' => 'percent', 'approval_pct' => 'percent', 'max_amount' => 'amount'],
        'price_override' => ['allowed' => 'bool', 'approval_pct' => 'percent'],
        'sell_beyond_stock' => ['allowed' => 'bool', 'approval_required' => 'bool'],
        'edits' => ['allowed' => 'bool', 'approval_required' => 'bool', 'window_days' => 'days'],
        'cancellations' => ['allowed' => 'bool', 'approval_required' => 'bool'],
        'returns' => ['allowed' => 'bool', 'approval_value_limit' => 'amount'],
        'stock_adjustments' => ['allowed' => 'bool', 'approval_limit_qty' => 'amount'],
        'transfers' => ['dispatch' => 'bool', 'receive' => 'bool'],
        'printers' => ['profile' => 'string', 'paper_sizes' => 'list', 'default' => 'string'],
        'salesperson' => ['manage' => 'bool'],
    ];

    public static function defaults(): array
    {
        return [
            'version' => self::VERSION,
            'modules' => self::MODULES,
            'screens' => [],
            'cash_drawer' => true,
            'discount' => ['max_pct' => 20, 'approval_pct' => 10, 'max_amount' => null],
            'price_override' => ['allowed' => true, 'approval_pct' => 10],
            'sell_beyond_stock' => ['allowed' => true, 'approval_required' => false],
            'edits' => ['allowed' => true, 'approval_required' => false, 'window_days' => null],
            'cancellations' => ['allowed' => true, 'approval_required' => false],
            'returns' => ['allowed' => true, 'approval_value_limit' => null],
            'purchase_entry' => true,
            'stock_adjustments' => ['allowed' => true, 'approval_limit_qty' => null],
            'transfers' => ['dispatch' => true, 'receive' => true],
            'reports' => ['*'],
            'settings_editable' => self::SETTINGS,
            'printers' => ['profile' => 'thermal_80mm', 'paper_sizes' => ['80mm'], 'default' => 'thermal_80mm'],
            'payment_modes_allowed' => ['cash', 'upi', 'card', 'credit'],
            'salesperson' => ['manage' => false],
            // Empty means "every method this build knows" — the vocabulary
            // above is the allow-list, not a stored copy of it.
            'approval_methods' => [],
        ];
    }

    /**
     * Read a stored document as a complete one. Undocumented keys — including
     * anything that looks like a credential — are dropped rather than carried
     * (IS5), and a value of the wrong type falls back to its documented default
     * instead of poisoning the gate.
     *
     * @return array<string,mixed>
     */
    public static function normalize(?array $stored, ?int $version = null): array
    {
        $document = self::defaults();
        $document['version'] = $version ?? self::VERSION;

        foreach ($stored ?? [] as $key => $value) {
            if (in_array($key, self::BOOLEANS, true)) {
                $document[$key] = self::cast($value, 'bool', $document[$key]);

                continue;
            }

            if (array_key_exists($key, self::LISTS)) {
                $document[$key] = self::cast($value, 'list', $document[$key], self::LISTS[$key]);

                continue;
            }

            if (isset(self::OBJECTS[$key]) && is_array($value)) {
                foreach (self::OBJECTS[$key] as $sub => $kind) {
                    if (!array_key_exists($sub, $value)) {
                        continue;
                    }

                    // An omitted key means "whatever the document says"; an
                    // explicit null means the owner removed the limit, which is
                    // a value in its own right and not a wrong type.
                    $document[$key][$sub] = $value[$sub] === null && in_array($kind, ['percent', 'amount', 'days'], true)
                        ? null
                        : self::cast($value[$sub], $kind, $document[$key][$sub]);
                }
            }
        }

        return $document;
    }

    /** The document as it stands, without touching the row. */
    public static function resolve(Counter $counter): array
    {
        return self::normalize(
            is_array($counter->permission_profile) ? $counter->permission_profile : null,
            (int) ($counter->permission_profile_version ?? self::VERSION)
        );
    }

    /**
     * PRF-001: a counter that has never had a document gets the canonical one,
     * carrying whatever its owner already set through the older role flags, so
     * raising the profile does not silently widen a restricted counter.
     */
    public static function seed(Counter $counter): array
    {
        if (is_array($counter->permission_profile)) {
            return self::resolve($counter);
        }

        $document = self::fromLegacy($counter);

        $counter->update([
            'permission_profile' => $document,
            'permission_profile_version' => self::VERSION,
        ]);

        return self::normalize($document, self::VERSION);
    }

    /**
     * The retired role_profile booleans and visible_menus translated into
     * documented keys. Absent flags read as the default, which is what they
     * meant before there was a profile.
     */
    public static function fromLegacy(Counter $counter): array
    {
        $document = self::defaults();
        $flags = is_array($counter->role_profile) ? $counter->role_profile : [];

        if (array_key_exists('allow_cancel', $flags)) {
            $document['cancellations']['allowed'] = (bool) $flags['allow_cancel'];
        }

        if (array_key_exists('allow_price_change', $flags)) {
            $document['price_override']['allowed'] = (bool) $flags['allow_price_change'];
        }

        if (array_key_exists('allow_stock_adj', $flags)) {
            $document['stock_adjustments']['allowed'] = (bool) $flags['allow_stock_adj'];
        }

        if (!empty($flags['require_manager_pin'])) {
            foreach (['cancellations', 'edits', 'returns'] as $control) {
                $document[$control]['approval_required'] = true;
            }
        }

        $menus = is_array($counter->visible_menus) ? $counter->visible_menus : [];
        $modules = array_values(array_intersect(
            self::MODULES,
            array_map(static fn ($menu) => trim((string) $menu), $menus)
        ));

        if ($modules !== []) {
            $document['modules'] = $modules;
        }

        return $document;
    }

    /**
     * A save changes what it names and nothing else. Nested controls merge key
     * by key because an owner editing a discount ceiling should not have to
     * resend the approval threshold beside it; lists replace whole, because
     * merging a list of granted screens would silently keep the ones the owner
     * just removed.
     *
     * @param  array<string,mixed>  $current
     * @param  array<string,mixed>  $incoming
     * @return array<string,mixed>
     */
    public static function merge(array $current, array $incoming): array
    {
        foreach ($incoming as $key => $value) {
            if (isset(self::OBJECTS[$key]) && is_array($value) && is_array($current[$key] ?? null)) {
                $current[$key] = array_replace($current[$key], $value);

                continue;
            }

            $current[$key] = $value;
        }

        return $current;
    }

    /**
     * Validate a document an owner is saving. Unknown controls are refused
     * rather than ignored: a typo in a permission name must not read as a
     * granted one.
     *
     * @return array<string,list<string>> field path => messages
     */
    public static function errors(array $partial, string $field = 'profile'): array
    {
        $errors = [];

        foreach ($partial as $key => $value) {
            // A reader echoes the version back; the server stamps the new one.
            if ($key === 'version' || $key === 'updated_at') {
                continue;
            }

            $path = "{$field}.{$key}";

            if (in_array($key, self::BOOLEANS, true)) {
                if (!is_bool($value)) {
                    $errors[$path] = ["{$key} is yes or no."];
                }

                continue;
            }

            if (array_key_exists($key, self::LISTS)) {
                if (!is_array($value)) {
                    $errors[$path] = ["{$key} is a list."];

                    continue;
                }

                $allowed = self::LISTS[$key];

                foreach ($value as $entry) {
                    if (!is_string($entry)) {
                        $errors[$path] = ["{$key} holds names, not numbers or objects."];

                        break;
                    }

                    if ($allowed !== null && !in_array(trim($entry), $allowed, true)) {
                        $errors[$path] = [
                            "There is no {$key} named \"{$entry}\". The till knows: ".implode(', ', $allowed).'.',
                        ];

                        break;
                    }
                }

                continue;
            }

            if (!isset(self::OBJECTS[$key])) {
                $errors[$field] = [
                    "There is no control named \"{$key}\" in a counter profile. The controls are: "
                    .implode(', ', self::controlKeys()).'.',
                ];

                continue;
            }

            if (!is_array($value)) {
                $errors[$path] = ["{$key} is a set of values, not a single one."];

                continue;
            }

            foreach ($value as $sub => $subValue) {
                $subPath = "{$path}.{$sub}";

                if (!isset(self::OBJECTS[$key][$sub])) {
                    $errors[$subPath] = ["{$key} has no \"{$sub}\". Its values are: "
                        .implode(', ', array_keys(self::OBJECTS[$key])).'.'];

                    continue;
                }

                $kind = self::OBJECTS[$key][$sub];

                if ($subValue === null && in_array($kind, ['percent', 'amount', 'days'], true)) {
                    continue;
                }

                if (self::cast($subValue, $kind, null) === null) {
                    $errors[$subPath] = ["{$sub} is not a valid value for {$key}."];
                }
            }
        }

        return $errors;
    }

    /**
     * PRF-008: what an owner actually changed, so the audit row is a diff and
     * not a second copy of the document.
     *
     * @return array{before:array<string,mixed>, after:array<string,mixed>}
     */
    public static function diff(?array $before, ?array $after): array
    {
        $changed = ['before' => [], 'after' => []];

        foreach (self::defaults() as $key => $unused) {
            $was = $before[$key] ?? null;
            $now = $after[$key] ?? null;

            if ($was !== $now) {
                $changed['before'][$key] = $was;
                $changed['after'][$key] = $now;
            }
        }

        return $changed;
    }

    /** @return list<string> every documented control */
    public static function controlKeys(): array
    {
        return array_merge(array_keys(self::BOOLEANS), array_keys(self::LISTS), array_keys(self::OBJECTS));
    }

    /**
     * One coercion for reading and one truth for validating, so the two can
     * never disagree about what a value means.
     */
    private static function cast(mixed $value, string $kind, mixed $default, ?array $allowed = null): mixed
    {
        return match (true) {
            $kind === 'bool' => is_bool($value)
                ? $value
                : (in_array($value, [0, 1, '0', '1'], true) ? (bool) $value : $default),

            $kind === 'percent' => is_numeric($value) && $value >= 0 && $value <= 100 ? self::number($value) : $default,

            $kind === 'amount' => is_numeric($value) && $value >= 0 ? self::number($value) : $default,

            $kind === 'days' => is_numeric($value) && $value >= 0 ? (int) $value : $default,

            $kind === 'string' => is_string($value) && trim($value) !== '' ? trim($value) : $default,

            $kind === 'list' => is_array($value)
                ? array_values(array_filter(array_map(
                    static fn ($entry) => is_scalar($entry) ? trim((string) $entry) : null,
                    $value
                ), static fn ($entry) => $entry !== null && $entry !== '' && ($allowed === null || in_array($entry, $allowed, true))))
                : $default,

            default => $default,
        };
    }

    private static function number(mixed $value): int|float
    {
        $number = $value + 0;

        return (int) $number == $number ? (int) $number : (float) $number;
    }
}
