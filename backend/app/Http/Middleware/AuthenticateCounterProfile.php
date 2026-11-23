<?php

namespace App\Http\Middleware;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Device;
use App\Services\Counter\BillPriceFacts;
use App\Services\Counter\CounterActionRegistry;
use App\Services\Counter\CounterProfilePolicy;
use App\Support\Counter\CounterProfile;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * PRF-003 — the server, not the screen, applies a counter's profile.
 *
 * The gate runs wherever a request speaks for a counter: a device token that
 * resolves to one, or the `device_counter_id` the device guard already pinned.
 * A request that speaks for a person (the admin panel, a portal link) carries
 * no counter and is left to RBAC — the profile replaced the person's role at
 * the till, not the owner's console.
 *
 * It fails closed in both directions it can: an action key the registry does
 * not know is refused, and so is a route inside the gated set that nobody has
 * decided. Silence is not permission.
 */
class AuthenticateCounterProfile
{
    public function __construct(private readonly CounterProfilePolicy $policy)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $counter = $this->counter($request);

        if (!$counter) {
            return $next($request);
        }

        $route = $request->route();

        if (!$route) {
            return $next($request);
        }

        $method = $request->method();
        $uri = $this->uri($request, $route->uri());

        if (CounterActionRegistry::isUngated($method, $uri)) {
            return $next($request);
        }

        $declaration = CounterActionRegistry::declaration($method, $uri);

        if ($declaration === null) {
            return $this->refuse($request, $counter, null, [
                'code' => CounterProfilePolicy::DENIED,
                'message' => 'This endpoint has no declared counter action, so the profile cannot allow it.',
            ]);
        }

        $profile = CounterProfile::resolve($counter);
        $action = $declaration['action'];
        $context = $this->context($request, $declaration, $profile, $counter);

        $decision = $this->policy->decide($profile, $action, $context);

        if (!$decision['allowed']) {
            if (!$this->deferrable($decision, $declaration)) {
                return $this->refuse($request, $counter, $action, $decision);
            }

            $this->requireApproval($request, $action, $decision);
        }

        // One call, several permissions: a bill carries its discount, any
        // retyped rate and the tender it took.
        foreach ((array) ($declaration['bill_checks'] ?? []) as $check) {
            $decision = $this->policy->decide($profile, $check, $context);

            if (!$decision['allowed']) {
                if (!$this->deferrable($decision, $declaration)) {
                    return $this->refuse($request, $counter, $check, $decision);
                }

                $this->requireApproval($request, $check, $decision);
            }
        }

        $request->attributes->set('counter_profile', $profile);
        $request->attributes->set('counter_profile_version', (int) ($profile['version'] ?? CounterProfile::VERSION));

        return $next($request);
    }

    /**
     * The profile document the request's counter works inside, or null when the
     * request does not speak for a counter. Controllers that know facts only
     * they can see — whether a line actually sells beyond stock — ask through
     * here so the answer always comes from the same document as the gate's.
     *
     * @return array<string,mixed>|null
     */
    public static function profile(Request $request): ?array
    {
        $cached = $request->attributes->get('counter_profile');

        if (is_array($cached)) {
            return $cached;
        }

        $counter = self::counterFor($request);

        return $counter ? CounterProfile::resolve($counter) : null;
    }

    public static function counterFor(Request $request): ?Counter
    {
        if ($id = $request->attributes->get('device_counter_id')) {
            return Counter::find($id);
        }

        $token = trim((string) ($request->header('X-Device-Token') ?: $request->input('device_token', '')));

        if ($token === '') {
            return null;
        }

        $hash = hash('sha256', $token);

        $counter = Counter::where('device_token_hash', $hash)->first()
            ?? Counter::where('device_token', $token)->first();

        if ($counter) {
            return $counter;
        }

        $device = Device::where('device_token_hash', $hash)->first()
            ?? Device::where('device_token', $token)->first();

        return $device?->counter_id ? Counter::find($device->counter_id) : null;
    }

    private function counter(Request $request): ?Counter
    {
        return self::counterFor($request);
    }

    /**
     * Route uris arrive prefixed; the registry is written the way api.php
     * reads, so the api prefix comes off before the lookup.
     */
    private function uri(Request $request, string $uri): string
    {
        $uri = trim($uri, '/');

        if (str_starts_with($uri, 'api/')) {
            $uri = substr($uri, 4);
        }

        return $uri === '' ? $request->path() : $uri;
    }

    /**
     * @param  array<string,mixed>  $declaration
     * @param  array<string,mixed>  $profile
     * @return array<string,mixed>
     */
    private function context(Request $request, array $declaration, array $profile, Counter $counter): array
    {
        $context = [];

        if (isset($declaration['modules'])) {
            $context['modules'] = (array) $declaration['modules'];
        }

        if (isset($declaration['report'])) {
            $context['report'] = $declaration['report'];
        }

        if (!empty($declaration['bill'])) {
            $context += $this->billContext($request, $profile, $counter);
        }

        if (!empty($declaration['value'])) {
            $context['value'] = $this->value($request);
        }

        if (!empty($declaration['qty'])) {
            $context['qty'] = $this->quantity($request);
        }

        if (!empty($declaration['modes'])) {
            $context['payment_modes'] = $this->paymentModes($request);
        }

        if (!empty($declaration['settings'])) {
            $context['setting_keys'] = array_keys($request->all());
        }

        if (!empty($declaration['invoice_date'])) {
            $context['invoice_date'] = $this->invoiceDate($request);
        }

        return $context;
    }

    /**
     * An approval cannot be granted before the request runs, so the route that
     * writes the document defers the "needs a grant" answer and asks the
     * controller to settle it inside the same transaction. A ceiling is not
     * deferrable: `counter_action_not_permitted` is still refused here.
     *
     * @param  array{allowed?:bool, code?:string}  $decision
     * @param  array<string,mixed>  $declaration
     */
    private function deferrable(array $decision, array $declaration): bool
    {
        return ($decision['code'] ?? null) === CounterProfilePolicy::APPROVAL_REQUIRED
            && !empty($declaration['settles_approval']);
    }

    /**
     * @param  array{message?:string}  $decision
     */
    private function requireApproval(Request $request, string $action, array $decision): void
    {
        $required = (array) $request->attributes->get('counter_approvals_required', []);
        $required[$action] = $decision['message'] ?? 'This action needs an approver\'s grant.';
        $request->attributes->set('counter_approvals_required', $required);
    }

    /**
     * The facts a saved bill carries that a profile is measured against.
     *
     * @param  array<string,mixed>  $profile
     * @return array<string,mixed>
     */
    private function billContext(Request $request, array $profile, Counter $counter): array
    {
        $items = (array) $request->input('items', []);
        $subtotal = 0.0;
        $discountAmount = (float) ($request->input('bill_discount_amount', 0));
        $discountPct = (float) ($request->input('bill_discount_percent', 0));

        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            $qty = (float) ($item['qty'] ?? 0);
            $rate = (float) ($item['unit_price'] ?? 0);
            $gross = round($qty * $rate, 2);
            $subtotal += $gross;

            $linePct = (float) ($item['discount_percent'] ?? 0);

            if ($linePct > $discountPct) {
                $discountPct = $linePct;
            }

            $discountAmount += (float) ($item['discount_amount'] ?? 0);
        }

        if ($subtotal > 0 && $discountAmount > 0) {
            $byAmount = $discountAmount / $subtotal * 100;

            if ($byAmount > $discountPct) {
                $discountPct = $byAmount;
            }
        }

        $context = [
            'discount_pct' => round($discountPct, 4),
            'discount_amount' => round($discountAmount, 2),
            'payment_modes' => $this->paymentModes($request),
        ];

        // The master comparison is only needed when the rule can ever apply:
        // an allowed override with no threshold costs nothing to skip.
        $overrideRule = (array) ($profile['price_override'] ?? []);
        $needsFacts = ($overrideRule['allowed'] ?? true) === false
            || ($overrideRule['approval_pct'] ?? null) !== null;

        if ($needsFacts && $items !== []) {
            $context += BillPriceFacts::overrideFacts($counter->store_id, $items);
        }

        return $context;
    }

    /** @return list<string> every tender this request names */
    private function paymentModes(Request $request): array
    {
        $modes = [];

        foreach (['payment_mode', 'mode', 'refund_mode'] as $field) {
            if ($value = $request->input($field)) {
                $modes[] = (string) $value;
            }
        }

        foreach ((array) $request->input('payments', []) as $payment) {
            if (is_array($payment) && !empty($payment['mode'])) {
                $modes[] = (string) $payment['mode'];
            }
        }

        return array_values(array_unique($modes));
    }

    private function value(Request $request): float
    {
        if ($request->input('refund_amount') !== null) {
            return (float) $request->input('refund_amount');
        }

        $value = 0.0;

        foreach ((array) $request->input('items', []) as $item) {
            if (!is_array($item)) {
                continue;
            }

            $rate = (float) ($item['rate'] ?? $item['unit_price'] ?? 0);
            $value += (float) ($item['qty'] ?? 0) * $rate;
        }

        return round($value, 2);
    }

    private function quantity(Request $request): float
    {
        $largest = 0.0;

        $lines = (array) $request->input('lines', []);

        if ($lines === []) {
            $lines = [['adjustment_qty' => $request->input('adjustment_qty')]];
        }

        foreach ($lines as $line) {
            if (!is_array($line)) {
                continue;
            }

            $qty = $line['adjustment_qty'] ?? null;

            if (is_numeric($qty)) {
                $largest = max($largest, abs((float) $qty));
            }
        }

        return $largest;
    }

    private function invoiceDate(Request $request): ?string
    {
        $id = $request->route('id');

        if (!is_numeric($id)) {
            return null;
        }

        $date = DB::table('invoices')->where('id', (int) $id)->value('invoice_date');

        return $date ? (string) $date : null;
    }

    /**
     * @param  array{allowed?:bool, code:string, message?:string}  $decision
     */
    private function refuse(Request $request, Counter $counter, ?string $action, array $decision): Response
    {
        $code = $decision['code'] ?? CounterProfilePolicy::DENIED;
        $message = $decision['message'] ?? 'This counter is not allowed to do that.';

        AuditLog::log(
            'counter_action_refused',
            'Counter',
            (string) $counter->id,
            null,
            [
                'action' => $action,
                'code' => $code,
                'route' => $request->method().' '.$this->uri($request, $request->route()?->uri() ?? $request->path()),
                'profile_version' => (int) ($counter->permission_profile_version ?? CounterProfile::VERSION),
            ],
            $counter->store_id,
            null
        );

        return response()->json([
            'success' => false,
            'code' => $code,
            'action' => $action,
            'message' => $message,
            'profile_version' => (int) ($counter->permission_profile_version ?? CounterProfile::VERSION),
        ], 403);
    }
}
