<?php

namespace App\Services\Counter;

/**
 * PRF-003 — the one table that says which gated action each API route is.
 *
 * The profile is only worth having if the server, not the screen, applies it.
 * That needs a name for every call a counter can make, so this registry holds
 * three things and nothing else:
 *
 *  - ACTIONS: every action key and the profile control that answers for it.
 *  - ROUTES:  "METHOD uri" => the action it is, plus any per-route facts the
 *             control needs (which report, which transfer leg).
 *  - UNGATED: routes a counter must reach whatever its profile says — claiming,
 *             reading its own context, unlocking, heartbeats and the offline
 *             sync ingest. Q1 keeps those accepts-and-flags, never refuses.
 *
 * A route that is in neither list fails closed: adding a device-scoped endpoint
 * without deciding what it is cannot read as a granted permission.
 */
final class CounterActionRegistry
{
    /**
     * Action key => the documented control that decides it.
     *
     * `module` is checked first for every action: a profile that does not carry
     * the screen refuses the call outright. `control` then applies the control's
     * own rule (a boolean, a limit, a list membership).
     */
    private const ACTIONS = [
        'pos.save_bill' => ['control' => 'modules', 'module' => 'pos'],
        'pos.discount' => ['control' => 'discount', 'module' => 'pos'],
        'pos.price_override' => ['control' => 'price_override', 'module' => 'pos'],
        'pos.payment_mode' => ['control' => 'payment_modes_allowed', 'module' => 'pos'],
        'pos.cash_drawer' => ['control' => 'cash_drawer', 'module' => 'pos'],
        'pos.tender' => ['control' => 'modules', 'module' => 'pos'],
        'catalog.view' => ['control' => 'modules', 'module' => 'pos'],
        'catalog.manage' => ['control' => 'modules', 'module' => 'masters'],
        'customer.view' => ['control' => 'modules', 'module' => 'pos'],
        'customer.manage' => ['control' => 'modules', 'module' => 'pos'],
        'invoice.view' => ['control' => 'modules', 'module' => 'bills'],
        'invoice.edit' => ['control' => 'edits', 'module' => 'bills'],
        'invoice.cancel' => ['control' => 'cancellations', 'module' => 'bills'],
        'invoice.hold' => ['control' => 'modules', 'module' => 'pos'],
        'return.create' => ['control' => 'returns', 'module' => 'sales_returns'],
        'return.purchase' => ['control' => 'returns', 'module' => 'purchase_returns'],
        'purchase.view' => ['control' => 'modules', 'module' => 'purchases'],
        'purchase.entry' => ['control' => 'purchase_entry', 'module' => 'purchases'],
        'payment.customer' => ['control' => 'modules', 'module' => 'bills'],
        'payment.supplier' => ['control' => 'modules', 'module' => 'purchases'],
        'stock.view' => ['control' => 'modules', 'module' => 'stock'],
        'stock.adjust' => ['control' => 'stock_adjustments', 'module' => 'stock'],
        'transfer.view' => ['control' => 'modules', 'module' => 'stock_transfers'],
        'transfer.dispatch' => ['control' => 'transfers', 'module' => 'stock_transfers'],
        'transfer.receive' => ['control' => 'transfers', 'module' => 'stock_transfers'],
        'report.view' => ['control' => 'reports', 'module' => 'reports'],
        'dashboard.view' => ['control' => 'modules', 'module' => 'dashboard'],
        'sales_order.manage' => ['control' => 'modules', 'module' => 'bills'],
        'loyalty.use' => ['control' => 'modules', 'module' => 'pos'],
        'data_exchange.run' => ['control' => 'modules', 'module' => 'import_export'],
        'settings.change' => ['control' => 'settings_editable', 'module' => 'settings'],
        'store.update' => ['control' => 'modules', 'module' => 'settings'],
        'staff.manage' => ['control' => 'modules', 'module' => 'counters'],
        'salesperson.manage' => ['control' => 'salesperson', 'module' => 'counters'],
        // GAP-01: reading the people a bill may name is part of billing, not
        // of managing the master, so it answers to the POS screen.
        'salesperson.view' => ['control' => 'modules', 'module' => 'pos'],
        'shift.open' => ['control' => 'cash_drawer', 'module' => 'pos'],
        'shift.close' => ['control' => 'cash_drawer', 'module' => 'pos'],
        // EXP-01: an expense is money out of the drawer, so it answers to the
        // same control that lets a counter open and close that drawer, and to
        // the Expenses screen itself.
        'expense.create' => ['control' => 'cash_drawer', 'module' => 'expenses'],
        'day_close.run' => ['control' => 'modules', 'module' => 'bills'],
        'migration.run' => ['control' => 'modules', 'module' => 'migration'],
    ];

    /**
     * "METHOD uri" => ['action' => key, ...facts]. The uri is the route's own
     * pattern with the api prefix removed, exactly as routes/api.php declares it.
     */
    private const ROUTES = [
        // --- device.auth group: the counter speaks for itself ---------------
        'POST till/staff' => ['action' => 'staff.manage'],
        'GET till/staff' => ['action' => 'staff.manage'],
        'PUT till/staff/{id}' => ['action' => 'staff.manage'],
        'DELETE till/staff/{id}' => ['action' => 'staff.manage'],
        'POST till/staff/{id}/unlock' => ['action' => 'staff.manage'],
        'POST till/staff/{id}/reset-pin' => ['action' => 'staff.manage'],

        // --- live billing ---------------------------------------------------
        'GET invoices' => ['action' => 'invoice.view', 'modules' => ['bills', 'pos']],
        'GET invoices/{id}' => ['action' => 'invoice.view', 'modules' => ['bills', 'pos']],
        'POST invoices' => [
            'action' => 'pos.save_bill',
            'bill' => true,
            // A bill is one call but several permissions: the save itself, the
            // discount it carries, any rate the operator retyped, and the
            // tender it took. Each is answered by its own control.
            'bill_checks' => ['pos.discount', 'pos.price_override', 'pos.payment_mode'],
            // A bill that crosses an approval threshold is written only after
            // the controller redeems a grant, inside the same transaction.
            'settles_approval' => true,
        ],
        'POST invoices/{id}/cancel' => ['action' => 'invoice.cancel'],
        'POST invoices/{id}/lock' => ['action' => 'invoice.edit', 'invoice_date' => true],
        'POST invoices/{id}/unlock' => ['action' => 'invoice.edit', 'invoice_date' => true],

        // --- held bills are a POS screen ------------------------------------
        'GET held-bills' => ['action' => 'invoice.hold'],
        'POST held-bills' => ['action' => 'invoice.hold'],
        'POST held-bills/{id}/claim' => ['action' => 'invoice.hold'],
        'DELETE held-bills/{id}' => ['action' => 'invoice.hold'],

        // --- shifts and day close ------------------------------------------
        // PRF-007: the drawer is addressed through the counter's own token, so
        // the URI never names a counter. Reading it is the same control as
        // working it, because a till that may not touch the drawer has no
        // shift screen to show.
        'GET counter/shift' => ['action' => 'pos.cash_drawer'],
        'POST counter/shift/open' => ['action' => 'shift.open'],
        'POST counter/shift/close' => ['action' => 'shift.close'],
        'POST expenses' => ['action' => 'expense.create'],
        'POST stores/day-close' => ['action' => 'day_close.run'],

        // --- store settings the till may write ------------------------------
        'POST settings' => ['action' => 'settings.change', 'settings' => true],
        'PUT settings' => ['action' => 'settings.change', 'settings' => true],
        'PUT store' => ['action' => 'store.update'],

        // --- parties --------------------------------------------------------
        'GET customers' => ['action' => 'customer.view'],
        'GET customers/{id}' => ['action' => 'customer.view'],
        'POST customers' => ['action' => 'customer.manage'],
        'PUT customers/{id}' => ['action' => 'customer.manage'],

        // --- the salespeople this counter may put on a bill -----------------
        'GET salespeople/eligible' => ['action' => 'salesperson.view'],

        // --- catalog --------------------------------------------------------
        'GET products' => ['action' => 'catalog.view'],
        'GET products/{id}' => ['action' => 'catalog.view'],
        'POST products' => ['action' => 'catalog.manage'],
        'PUT products/{id}' => ['action' => 'catalog.manage'],
        'DELETE products/{id}' => ['action' => 'catalog.manage'],
        'POST products/{id}/batches' => ['action' => 'catalog.manage'],

        // --- purchases ------------------------------------------------------
        'GET purchases' => ['action' => 'purchase.view'],
        'GET purchases/{id}' => ['action' => 'purchase.view'],
        'POST purchases' => ['action' => 'purchase.entry'],

        // --- sales orders, loyalty, gift cards, UPI -------------------------
        'GET sales-orders' => ['action' => 'sales_order.manage'],
        'POST sales-orders' => ['action' => 'sales_order.manage'],
        'GET sales-orders/{id}' => ['action' => 'sales_order.manage'],
        'GET loyalty/balance' => ['action' => 'loyalty.use'],
        'POST loyalty/earn' => ['action' => 'loyalty.use'],
        'POST loyalty/redeem' => ['action' => 'loyalty.use'],
        'POST coupons/validate' => ['action' => 'loyalty.use'],
        'POST coupons/redeem' => ['action' => 'loyalty.use'],
        'GET gift-cards/lookup' => ['action' => 'pos.tender'],
        'GET payments/upi-intent' => ['action' => 'pos.tender'],

        // --- stock ----------------------------------------------------------
        'POST stock/adjustments' => ['action' => 'stock.adjust', 'qty' => true],
        'GET stock/transfers' => ['action' => 'transfer.view'],
        'POST stock/transfers' => ['action' => 'transfer.dispatch'],
        'POST stock/transfers/{id}/receive' => ['action' => 'transfer.receive'],
        'POST stock/transfers/{id}/cancel' => ['action' => 'transfer.dispatch'],
        'GET stock/batches/near-expiry' => ['action' => 'stock.view'],
        'GET stock/products/low-stock' => ['action' => 'stock.view'],

        // --- reports --------------------------------------------------------
        'GET reports/daily-collection' => ['action' => 'report.view', 'report' => 'daily-collection'],
        'GET reports/top-selling' => ['action' => 'report.view', 'report' => 'top-selling'],
        'GET reports/cash-book' => ['action' => 'report.view', 'report' => 'cash-book'],
        'GET reports/daily-summary' => ['action' => 'report.view', 'report' => 'daily-summary'],
        'GET reports/profit' => ['action' => 'report.view', 'report' => 'profit'],
        'GET reports/stock-ledger' => ['action' => 'report.view', 'report' => 'stock-ledger'],
        'GET reports/gstr-1' => ['action' => 'report.view', 'report' => 'gstr-1'],
        'GET reports/hsn-summary' => ['action' => 'report.view', 'report' => 'hsn-summary'],
        'GET reports/customer-aging' => ['action' => 'report.view', 'report' => 'customer-aging'],
        'GET reports/expense-register' => ['action' => 'report.view', 'report' => 'expense-register'],
        'GET reports/tax-reconciliation' => ['action' => 'report.view', 'report' => 'tax-reconciliation'],
        'GET dashboard/metrics' => ['action' => 'dashboard.view'],

        // --- the legacy-data migration wizard (MIG-01) ----------------------
        // Every step of the pipeline writes to the store's own database, so the
        // whole run answers to the Migration screen rather than to the masters it
        // happens to create. The store-level switch is checked again in the
        // controller: a profile says whether this counter may migrate, the store
        // says whether migration is still open here at all.
        'GET till/migrations' => ['action' => 'migration.run'],
        'POST till/migrations/bundle' => ['action' => 'migration.run'],
        'POST till/migrations/precheck' => ['action' => 'migration.run'],
        'POST till/migrations/start' => ['action' => 'migration.run'],
        'GET till/migrations/{uuid}' => ['action' => 'migration.run'],
        'POST till/migrations/{uuid}/reconcile' => ['action' => 'migration.run'],
        'POST till/migrations/{uuid}/rollback' => ['action' => 'migration.run'],
        'POST till/migrations/{uuid}/cutover' => ['action' => 'migration.run'],

        // --- import / export ------------------------------------------------
        'POST data-exchange/preview' => ['action' => 'data_exchange.run'],
        'POST data-exchange/commit' => ['action' => 'data_exchange.run'],
        'GET data-exchange/templates/{type}' => ['action' => 'data_exchange.run'],
        'GET data-exchange/export/{type}' => ['action' => 'data_exchange.run'],
        'GET data-exchange/history' => ['action' => 'data_exchange.run'],

        // --- payments and returns -------------------------------------------
        'POST payments/customer' => ['action' => 'payment.customer', 'modes' => true],
        'POST payments/supplier' => ['action' => 'payment.supplier', 'modes' => true],
        'POST returns/sales' => ['action' => 'return.create', 'value' => true],
        'POST returns/purchase' => ['action' => 'return.purchase', 'value' => true],
    ];

    /**
     * Routes that carry no action: without them a counter could not find out
     * what it is allowed to do, get onto its own screen, stay alive, or hand
     * work it queued while offline to the server (Q1 — that ingest flags
     * violations, it does not refuse them).
     */
    private const UNGATED = [
        'POST counters/claim',
        'GET counters',
        'GET counters/{id}/watch',
        'ANY counters/{id}/status',
        'GET counter/context',
        // Reading your own watermark grants nothing; it only asks whether the
        // document the till already holds is still the one in force (PRF-004).
        'GET counter/profile-version',
        'GET counter/sequences',
        'POST counter/sequences/lease',
        'POST counters/{id}/lease-sequence',
        'POST counter/unlock',
        'GET credentials/offline-cache',
        'GET staff/offline-cache',
        'POST staff/admin-unlock',
        'POST staff/login',
        'POST staff/logout',
        'POST staff/change-password',
        'GET settings',
        'GET store',
        // G1-SEC: sibling branches for the store switcher / transfers; read-only, now counter-authenticated.
        'GET branches',
        'GET sync/pull/deltas',
        'GET sync/stream',
        'POST sync/push/batch',
        'POST sync/push/invoices',
        'POST sync/push/stock-events',
        'POST sync/push/purchases',
        'POST sync/push/parties',
        'POST sync/push/products',
        'POST sync/push/adjustments',
        'POST sync/push/transfers',
        'POST sync/push/staff',
        'POST sync/push/security-audit',
        'POST device-sessions/heartbeat',
        'POST devices/heartbeat',
        'POST device-sessions/logout',
        'POST devices/logout',
        'GET device-sessions',
        'GET devices/logged-in',
        'GET devices/connected',
        'GET public-ip',
        'GET network/public-ip',
        'POST invoices/{id}/approvals/verify',
        // Granting an approval is how the counter authorises a gated save; it
        // is judged by the approver PIN, not by the profile it will unlock.
        'POST approvals/grant',
        'GET price-lists/resolve',
    ];

    /** @return list<string> every declared action key */
    public static function keys(): array
    {
        return array_keys(self::ACTIONS);
    }

    public static function has(string $action): bool
    {
        return isset(self::ACTIONS[$action]);
    }

    /**
     * The actions a grant can settle: those whose control has a threshold an
     * owner chose, rather than a boolean the counter simply may or may not do.
     *
     * @return list<string>
     */
    public static function approvableActions(): array
    {
        $thresholded = ['discount', 'price_override', 'edits', 'cancellations', 'returns', 'stock_adjustments', 'sell_beyond_stock'];

        return array_keys(array_filter(
            self::ACTIONS,
            static fn (array $entry) => in_array($entry['control'] ?? null, $thresholded, true)
        ));
    }

    /** @return array{control:string,module?:string}|null */
    public static function controlFor(string $action): ?array
    {
        return self::ACTIONS[$action] ?? null;
    }

    /**
     * The declaration for a route, or null when the route has never been
     * decided. `ANY` entries cover routes that answer either verb.
     *
     * @return array{action:string, report?:string, bill?:bool, value?:bool, modes?:bool}|null
     */
    public static function declaration(string $method, string $uri): ?array
    {
        foreach ([$method, 'ANY'] as $candidate) {
            $declaration = self::ROUTES["{$candidate} {$uri}"] ?? null;

            if ($declaration !== null) {
                return $declaration;
            }
        }

        return null;
    }

    public static function isUngated(string $method, string $uri): bool
    {
        return in_array("{$method} {$uri}", self::UNGATED, true)
            || in_array("ANY {$uri}", self::UNGATED, true);
    }

    /** The report ids the route table names, for the profile editor's picker. */
    public static function reportIds(): array
    {
        $reports = [];

        foreach (self::ROUTES as $declaration) {
            if (($declaration['action'] ?? null) === 'report.view') {
                $reports[] = $declaration['report'];
            }
        }

        return array_values(array_unique($reports));
    }
}
