<?php

namespace App\Services\Counter;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\SyncEvent;
use App\Support\Counter\CounterProfile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * PRF-001 / PRF-002 / PRF-008 — the one way a counter's permission document
 * changes.
 *
 * Editing a profile by hand, applying a template and copying another counter's
 * document all arrive here, so the things every save owes the CR happen on
 * every path: the document is rejected before it lands if it names a control
 * the till does not know, a stale edit is refused instead of silently winning,
 * the version watermark moves by one, the diff is written to the audit trail,
 * and the attached counter is told to come and read the new document (PRF-004).
 */
class CounterProfileSaver
{
    /**
     * @param  array<string,mixed>  $incoming  partial document, or a whole one
     * @param  int|null  $expectedVersion  the version the editor read; null skips the check
     * @return array{profile: array<string,mixed>, version: int, changed: list<string>, counter: Counter}
     */
    public function save(
        Counter $counter,
        array $incoming,
        ?int $expectedVersion = null,
        string $source = 'manual',
        ?string $actor = null
    ): array {
        if ($errors = CounterProfile::errors($incoming)) {
            throw new CounterProfileSaveException($errors);
        }

        $read = $expectedVersion ?? (array_key_exists('version', $incoming) ? (int) $incoming['version'] : null);

        return DB::transaction(function () use ($counter, $incoming, $read, $source, $actor) {
            // Re-read under a row lock: two owners editing the same counter must
            // not both save from the version they each loaded.
            $locked = Counter::where('id', $counter->id)->lockForUpdate()->first();
            $current = (int) ($locked->permission_profile_version ?? CounterProfile::VERSION);

            if ($read !== null && $read !== $current) {
                throw new CounterProfileSaveException(
                    errors: [],
                    status: 409,
                    errorCode: 'profile_version_conflict',
                    currentVersion: $current,
                    message: "This counter's profile changed while you were editing it. Reload it before saving.",
                );
            }

            $before = CounterProfile::resolve($locked);
            $version = $current + 1;
            // normalize() re-stamps the version, so a document that echoes the
            // one it read cannot set its own watermark.
            $after = CounterProfile::normalize(CounterProfile::merge($before, $incoming), $version);

            $locked->update([
                'permission_profile' => $after,
                'permission_profile_version' => $version,
            ]);

            $diff = CounterProfile::diff($before, $after);

            AuditLog::log(
                'counter_profile_updated',
                'Counter',
                (string) $locked->id,
                $diff['before'],
                $diff['after'] + ['source' => $actor ?? $source, 'profile_version' => $version],
                $locked->store_id,
                Auth::id()
            );

            $this->propagate($locked, $version, $source);

            return [
                'profile' => $after,
                'version' => $version,
                'changed' => array_keys($diff['after']),
                'counter' => $locked,
            ];
        });
    }

    /**
     * PRF-002: a template is applied as a whole document, because an owner who
     * picks "Standard till" means the counter ends up inside it — not inside it
     * plus whatever restrictions the counter already had.
     */
    public function applyTemplate(Counter $counter, mixed $template): array
    {
        return $this->save(
            $counter,
            CounterProfile::normalize(is_array($template->profile) ? $template->profile : null),
            source: 'template',
            actor: (string) $template->name
        );
    }

    /** PRF-002: "copy from counter" is a server-side duplicate, then a save. */
    public function copyFrom(Counter $counter, Counter $source): array
    {
        return $this->save(
            $counter,
            CounterProfile::resolve($source),
            source: 'copy',
            actor: "{$source->counter_code} ({$source->counter_name})"
        );
    }

    /**
     * PRF-004: the notice an attached till reads to know its document moved.
     *
     * It rides the same event log the SSE stream replays, and the version in it
     * is the only thing a till needs: the document itself is pulled from
     * /api/counter/context, so a till never acts on a profile the server did
     * not hand it.
     */
    private function propagate(Counter $counter, int $version, string $source): void
    {
        try {
            SyncEvent::create([
                'store_id' => $counter->store_id,
                'entity_type' => 'counter_profile',
                'entity_id' => (string) $counter->id,
                'action' => 'updated',
                'client_version' => 1,
                'server_version' => 1,
                'client_data' => null,
                'server_data' => [
                    'permission_profile_version' => $version,
                    'counter_code' => $counter->counter_code,
                    'source' => $source,
                ],
                'status' => 'resolved',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            // A profile that saved without a notice is still the profile in
            // force; the till picks it up on its next context read.
            report($e);
        }
    }
}
