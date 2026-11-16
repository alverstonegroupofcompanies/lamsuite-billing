<?php

namespace App\Console\Commands;

use App\Services\Webhook\WebhookOutboxService;
use Illuminate\Console\Command;

class DispatchWebhooksCommand extends Command
{
    protected $signature = 'webhooks:dispatch
                            {--limit=50 : Maximum number of due deliveries to process}';

    protected $description = 'Deliver due signed webhook events from the outbox with retry backoff.';

    public function handle(WebhookOutboxService $service): int
    {
        $result = $service->dispatchPending((int) $this->option('limit'));

        if ($result['processed'] === 0) {
            $this->info('No webhook deliveries are due.');
            return self::SUCCESS;
        }

        $this->info(sprintf(
            'Processed %d webhook deliveries: %d delivered, %d failed.',
            $result['processed'],
            $result['delivered'],
            $result['failed']
        ));

        return $result['failed'] === 0 ? self::SUCCESS : self::FAILURE;
    }
}
