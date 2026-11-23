<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\PermissionProfileTemplate;
use App\Services\Counter\CounterProfileSaver;
use App\Support\Counter\CounterProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PRF-002 — the store's named permission documents.
 *
 * A template is a starting point an owner copies onto counters, never a rule
 * the till consults, so it is store-scoped like any other master and holds
 * exactly the same document a counter does. Applying one is an ordinary
 * profile save (AdminCounterController), which is what makes the audit trail
 * and the version watermark behave identically however the document arrived.
 */
class AdminPermissionProfileTemplateController
{
    public function index(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        $templates = PermissionProfileTemplate::where('store_id', $storeId)
            ->orderBy('name')
            ->get()
            ->map(fn (PermissionProfileTemplate $t) => $this->present($t));

        return response()->json([
            'success' => true,
            'data' => $templates,
            'controls' => CounterProfile::controlKeys(),
            'settings' => CounterProfile::SETTINGS,
            'modules' => CounterProfile::MODULES,
            'defaults' => CounterProfile::defaults(),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return response()->json([
            'success' => true,
            'template' => $this->present($this->find($request, $id)),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        if (!$storeId) {
            return response()->json([
                'message' => 'Select a store before creating a profile template.',
                'errors' => ['store_id' => ['A single store must be selected.']],
            ], 422);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'profile' => 'required|array',
            'is_default' => 'nullable|boolean',
        ]);

        $name = trim($validated['name']);

        if (PermissionProfileTemplate::where('store_id', $storeId)->where('name', $name)->exists()) {
            return response()->json([
                'message' => 'This store already has a profile named that.',
                'errors' => ['name' => ["A template called \"{$name}\" already exists in this store."]],
            ], 422);
        }

        if ($errors = CounterProfile::errors($validated['profile'], 'profile')) {
            return response()->json(['message' => 'That is not a counter permission profile.', 'errors' => $errors], 422);
        }

        $template = PermissionProfileTemplate::create([
            'store_id' => $storeId,
            'name' => $name,
            // Stored complete, so an owner sees what the template actually grants
            // rather than a partial that silently means "the defaults".
            'profile' => CounterProfile::normalize($validated['profile']),
            'is_default' => false,
            'version' => 1,
        ]);

        if (!empty($validated['is_default'])) {
            $template->makeDefault();
            $template->refresh();
        }

        AuditLog::log(
            'permission_profile_template_created',
            'PermissionProfileTemplate',
            (string) $template->id,
            null,
            ['name' => $template->name, 'controls' => array_keys(CounterProfile::normalize($validated['profile']))],
            $storeId
        );

        return response()->json(['success' => true, 'template' => $this->present($template)], 201);
    }

    /**
     * A template edit changes the document but not any counter: counters keep
     * the document they were handed, at the version they were handed it.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $template = $this->find($request, $id);

        $validated = $request->validate([
            'name' => 'sometimes|string|max:100',
            'profile' => 'sometimes|array',
            'is_default' => 'sometimes|boolean',
            'version' => 'nullable|integer',
        ]);

        $old = ['name' => $template->name, 'is_default' => (bool) $template->is_default];
        $before = $template->profile ?? [];

        if (array_key_exists('profile', $validated)) {
            if ($errors = CounterProfile::errors($validated['profile'], 'profile')) {
                return response()->json(['message' => 'That is not a counter permission profile.', 'errors' => $errors], 422);
            }

            $current = array_key_exists('version', $validated) ? (int) $validated['version'] : null;

            if ($current !== null && $current !== (int) $template->version) {
                return response()->json([
                    'success' => false,
                    'code' => 'template_version_conflict',
                    'message' => 'This template changed while you were editing it. Reload it before saving.',
                    'current_version' => (int) $template->version,
                ], 409);
            }

            $template->profile = CounterProfile::normalize(
                CounterProfile::merge($template->profile ?? [], $validated['profile']),
                (int) $template->version + 1
            );
        }

        if (array_key_exists('name', $validated)) {
            $name = trim($validated['name']);

            $clash = PermissionProfileTemplate::where('store_id', $template->store_id)
                ->where('name', $name)
                ->where('id', '!=', $template->id)
                ->exists();

            if ($clash) {
                return response()->json([
                    'message' => 'This store already has a profile named that.',
                    'errors' => ['name' => ["A template called \"{$name}\" already exists in this store."]],
                ], 422);
            }

            $template->name = $name;
        }

        $template->save();

        if (array_key_exists('is_default', $validated)) {
            $validated['is_default'] ? $template->makeDefault() : $template->update(['is_default' => false]);
        }

        $template->refresh();

        AuditLog::log(
            'permission_profile_template_updated',
            'PermissionProfileTemplate',
            (string) $template->id,
            $old,
            ['name' => $template->name, 'is_default' => (bool) $template->is_default, 'version' => (int) $template->version],
            $template->store_id
        );

        return response()->json([
            'success' => true,
            'template' => $this->present($template),
            'changed' => array_keys(CounterProfile::diff($before, $template->profile)['after']),
        ]);
    }

    /** Hand this template to one counter, or every counter the owner names. */
    public function apply(Request $request, string $id): JsonResponse
    {
        $template = $this->find($request, $id);

        $validated = $request->validate([
            'counter_ids' => 'required|array|min:1',
            'counter_ids.*' => 'integer',
        ]);

        $counters = Counter::where('store_id', $template->store_id)
            ->whereIn('id', $validated['counter_ids'])
            ->get();

        if ($counters->count() !== count(array_unique($validated['counter_ids']))) {
            return response()->json([
                'message' => 'Some of those counters belong to another store.',
                'errors' => ['counter_ids' => ['Only counters in this store can take this template.']],
            ], 422);
        }

        $saver = app(CounterProfileSaver::class);
        $applied = [];

        foreach ($counters as $counter) {
            $saved = $saver->applyTemplate($counter, $template);

            $applied[] = [
                'counter_id' => (int) $counter->id,
                'counter_code' => $counter->counter_code,
                'version' => $saved['version'],
                'changed' => $saved['changed'],
            ];
        }

        AuditLog::log(
            'permission_profile_template_applied',
            'PermissionProfileTemplate',
            (string) $template->id,
            null,
            ['name' => $template->name, 'counters' => array_column($applied, 'counter_id')],
            $template->store_id
        );

        return response()->json(['success' => true, 'template_id' => (int) $template->id, 'applied' => $applied]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $template = $this->find($request, $id);

        AuditLog::log(
            'permission_profile_template_deleted',
            'PermissionProfileTemplate',
            (string) $template->id,
            ['name' => $template->name, 'is_default' => (bool) $template->is_default],
            null,
            $template->store_id
        );

        $template->delete();

        return response()->json(['success' => true, 'deleted' => (int) $id]);
    }

    private function present(PermissionProfileTemplate $template): array
    {
        return [
            'id' => (int) $template->id,
            'store_id' => (int) $template->store_id,
            'name' => $template->name,
            'is_default' => (bool) $template->is_default,
            'version' => (int) $template->version,
            'profile' => CounterProfile::normalize($template->profile, (int) $template->version),
            'updated_at' => $template->updated_at?->toIso8601String(),
        ];
    }

    private function find(Request $request, string $id): PermissionProfileTemplate
    {
        return PermissionProfileTemplate::where('store_id', $this->storeId($request))
            ->where('id', $id)
            ->firstOrFail();
    }

    private function storeId(Request $request): ?int
    {
        $storeId = $request->attributes->get('active_store_id') ?? $request->get('active_store_id');

        return $storeId ? (int) $storeId : null;
    }
}
