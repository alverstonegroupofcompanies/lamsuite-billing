<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class ScheduledReportMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $reportName,
        public string $reportHtml,
        public string $csvFilename,
        public string $csvContent,
    ) {
    }

    public function build(): self
    {
        return $this
            ->subject($this->reportName)
            ->html($this->reportHtml)
            ->attachData($this->csvContent, $this->csvFilename, ['mime' => 'text/csv']);
    }
}
