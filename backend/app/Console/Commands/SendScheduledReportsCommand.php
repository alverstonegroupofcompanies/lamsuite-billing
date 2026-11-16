<?php

namespace App\Console\Commands;

use App\Models\ScheduledReport;
use App\Services\Reports\ScheduledReportService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class SendScheduledReportsCommand extends Command
{
    protected $signature = 'reports:send-scheduled
                            {--dry-run : Show what would be sent without emailing or updating schedules}
                            {--id=* : Only evaluate the given schedule IDs}';

    protected $description = 'Send due scheduled report emails (daily/weekly/monthly).';

    public function handle(ScheduledReportService $service): int
    {
        $now = Carbon::now();
        $ids = array_filter(array_map('intval', (array) $this->option('id')));

        $schedules = ScheduledReport::query()
            ->where('is_active', true)
            ->when(!empty($ids), fn ($q) => $q->whereIn('id', $ids))
            ->orderBy('id')
            ->get()
            ->filter(fn (ScheduledReport $schedule) => $schedule->isDueAt($now));

        if ($schedules->isEmpty()) {
            $this->info('No scheduled reports are due.');
            return self::SUCCESS;
        }

        $failures = 0;

        foreach ($schedules as $schedule) {
            if ($this->option('dry-run')) {
                $this->line(sprintf(
                    '[dry-run] would send #%d "%s" (%s) to %s',
                    $schedule->id,
                    $schedule->name,
                    $schedule->frequencyLabel(),
                    implode(', ', $schedule->recipients ?? [])
                ));
                continue;
            }

            try {
                $result = $service->deliver($schedule);
                $this->info(sprintf(
                    'Sent #%d "%s" to %s (%s)',
                    $schedule->id,
                    $schedule->name,
                    implode(', ', $result['recipients']),
                    $result['filename']
                ));
            } catch (\Throwable $e) {
                $failures++;
                $service->markFailed($schedule, $e);
                $this->error(sprintf('Failed #%d "%s": %s', $schedule->id, $schedule->name, $e->getMessage()));
            }
        }

        return $failures === 0 ? self::SUCCESS : self::FAILURE;
    }
}
