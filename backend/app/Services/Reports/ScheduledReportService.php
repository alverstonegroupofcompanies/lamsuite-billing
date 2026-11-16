<?php

namespace App\Services\Reports;

use App\Http\Controllers\Api\AdminReportController;
use App\Mail\ScheduledReportMail;
use App\Models\ScheduledReport;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use App\Services\Notifications\StoreSmtpConfigurator;
use InvalidArgumentException;

class ScheduledReportService
{
    public function __construct(private AdminReportController $reports)
    {
    }

    /**
     * Compile the report payload for a schedule using the admin report endpoints,
     * so emailed numbers always match what the panel shows.
     */
    public function build(ScheduledReport $schedule): array
    {
        $request = Request::create('/api/admin/reports/' . $schedule->report_type, 'GET');

        if ($schedule->store_id !== null) {
            $request->attributes->set('active_store_id', (int) $schedule->store_id);
        }

        return match ($schedule->report_type) {
            'daily_sales' => $this->reports->salesSummary($this->forToday($request))->getData(true),
            'gstr1' => $this->reports->gstr1($request)->getData(true),
            'customer_aging' => $this->reports->customerAging($request)->getData(true),
            'pharmacy' => $this->reports->pharmacyReport($request)->getData(true),
            default => throw new InvalidArgumentException('Unsupported report type: ' . $schedule->report_type),
        };
    }

    /**
     * Build, email and record delivery of one scheduled report.
     */
    public function deliver(ScheduledReport $schedule): array
    {
        $payload = $this->build($schedule);
        $html = $this->renderHtml($schedule, $payload);
        $filename = sprintf('%s-%s.csv', $schedule->report_type, now()->format('Ymd-His'));

        $this->configureMailer($schedule);

        Mail::to($schedule->recipients)->send(new ScheduledReportMail(
            $schedule->name,
            $html,
            $filename,
            $this->renderCsv($schedule, $payload),
        ));

        $schedule->forceFill([
            'last_sent_at' => now(),
            'last_status' => 'sent',
            'last_error' => null,
        ])->save();

        return [
            'status' => 'sent',
            'recipients' => $schedule->recipients,
            'filename' => $filename,
        ];
    }

    public function markFailed(ScheduledReport $schedule, \Throwable $e): void
    {
        $schedule->forceFill([
            'last_status' => 'failed',
            'last_error' => mb_substr($e->getMessage(), 0, 500),
        ])->save();
    }

    private function forToday(Request $request): Request
    {
        $today = Carbon::today()->toDateString();
        $request->query->set('start_date', $today);
        $request->query->set('end_date', $today);

        return $request;
    }

    private function configureMailer(ScheduledReport $schedule): void
    {
        StoreSmtpConfigurator::configure($schedule->store_id);
    }

    private function reportTitle(ScheduledReport $schedule): string
    {
        return match ($schedule->report_type) {
            'daily_sales' => 'Daily Sales & Collection Digest',
            'gstr1' => 'GSTR-1 Compliance Summary',
            'customer_aging' => 'Customer Outstanding & Aging',
            'pharmacy' => 'Pharmacy Statutory Report',
            default => $schedule->name,
        };
    }

    private function renderHtml(ScheduledReport $schedule, array $payload): string
    {
        $storeName = $schedule->store?->name ?: 'All Stores (Consolidated)';
        $rows = '';

        switch ($schedule->report_type) {
            case 'daily_sales':
                $rows = $this->metricTable([
                    'Date range' => ($payload['date_range']['start_date'] ?? '') . ' to ' . ($payload['date_range']['end_date'] ?? ''),
                    'Invoices' => $payload['total_invoices_count'] ?? 0,
                    'Gross sales' => $this->money($payload['gross_sales'] ?? 0),
                    'Returns' => $this->money($payload['returns'] ?? 0),
                    'Net sales' => $this->money($payload['net_sales'] ?? 0),
                    'Taxable value' => $this->money($payload['total_taxable'] ?? 0),
                    'Tax' => $this->money($payload['total_tax'] ?? 0),
                    'Cash' => $this->money($payload['by_tender']['cash'] ?? 0),
                    'UPI' => $this->money($payload['by_tender']['upi'] ?? 0),
                    'Card' => $this->money($payload['by_tender']['card'] ?? 0),
                    'Credit' => $this->money($payload['by_tender']['credit'] ?? 0),
                ]);
                break;

            case 'gstr1':
                $rows = $this->metricTable([
                    'Period' => ($payload['date_range']['start_date'] ?? '') . ' to ' . ($payload['date_range']['end_date'] ?? ''),
                    'B2B invoices' => $payload['table_4_b2b']['count'] ?? 0,
                    'B2B taxable' => $this->money($payload['table_4_b2b']['taxable_value'] ?? 0),
                    'B2B tax' => $this->money($payload['table_4_b2b']['tax_amount'] ?? 0),
                    'B2C invoices' => $payload['table_7_b2cs']['count'] ?? 0,
                    'B2C taxable' => $this->money($payload['table_7_b2cs']['taxable_value'] ?? 0),
                    'Documents issued' => $payload['table_13_docs']['total_number'] ?? 0,
                    'Cancelled' => $payload['table_13_docs']['cancelled_number'] ?? 0,
                ]) . $this->hsnTable($payload['table_12_hsn'] ?? []);
                break;

            case 'customer_aging':
                $rows = $this->metricTable([
                    'Customers with dues' => $payload['total_customers_with_dues'] ?? 0,
                    'Total outstanding' => $this->money($payload['total_outstanding'] ?? 0),
                ]) . $this->agingTable($payload['customers'] ?? []);
                break;

            case 'pharmacy':
                $rows = $this->doctorTable($payload['doctor_sales'] ?? []);
                break;
        }

        return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;max-width:760px">'
            . '<h2 style="margin:0 0 4px">' . e($this->reportTitle($schedule)) . '</h2>'
            . '<p style="margin:0 0 16px;color:#64748b;font-size:12px">' . e($storeName)
            . ' · ' . e($schedule->frequencyLabel()) . '</p>'
            . $rows
            . '<p style="margin-top:20px;color:#94a3b8;font-size:11px">Generated by LamSuite Billing on '
            . e(now()->format('d M Y, h:i A')) . '. The attached CSV contains the full report data.</p>'
            . '</div>';
    }

    private function renderCsv(ScheduledReport $schedule, array $payload): string
    {
        $lines = [];

        switch ($schedule->report_type) {
            case 'daily_sales':
                $lines[] = $this->csvRow(['Metric', 'Value']);
                $lines[] = $this->csvRow(['Start date', $payload['date_range']['start_date'] ?? '']);
                $lines[] = $this->csvRow(['End date', $payload['date_range']['end_date'] ?? '']);
                $lines[] = $this->csvRow(['Invoices', $payload['total_invoices_count'] ?? 0]);
                $lines[] = $this->csvRow(['Gross sales', $payload['gross_sales'] ?? 0]);
                $lines[] = $this->csvRow(['Returns', $payload['returns'] ?? 0]);
                $lines[] = $this->csvRow(['Net sales', $payload['net_sales'] ?? 0]);
                $lines[] = $this->csvRow(['Taxable value', $payload['total_taxable'] ?? 0]);
                $lines[] = $this->csvRow(['Tax', $payload['total_tax'] ?? 0]);
                foreach (($payload['by_tender'] ?? []) as $tender => $amount) {
                    $lines[] = $this->csvRow(['Tender: ' . $tender, $amount]);
                }
                break;

            case 'gstr1':
                $lines[] = $this->csvRow(['HSN Code', 'Description', 'Qty', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Cess', 'Total Tax']);
                foreach (($payload['table_12_hsn'] ?? []) as $h) {
                    $lines[] = $this->csvRow([
                        $h['hsn_code'] ?? '',
                        $h['description'] ?? '',
                        $h['total_qty'] ?? 0,
                        $h['taxable_value'] ?? 0,
                        $h['cgst_amount'] ?? 0,
                        $h['sgst_amount'] ?? 0,
                        $h['igst_amount'] ?? 0,
                        $h['cess_amount'] ?? 0,
                        $h['total_tax'] ?? 0,
                    ]);
                }
                break;

            case 'customer_aging':
                $lines[] = $this->csvRow(['Customer', 'Phone', 'Credit Limit', 'Outstanding', '0-30', '31-60', '61-90', '90+']);
                foreach (($payload['customers'] ?? []) as $c) {
                    $lines[] = $this->csvRow([
                        $c['name'] ?? '',
                        $c['phone'] ?? '',
                        $c['credit_limit'] ?? 0,
                        $c['current_balance'] ?? 0,
                        $c['bracket_0_30'] ?? 0,
                        $c['bracket_31_60'] ?? 0,
                        $c['bracket_61_90'] ?? 0,
                        $c['bracket_90_plus'] ?? 0,
                    ]);
                }
                break;

            case 'pharmacy':
                $lines[] = $this->csvRow(['Doctor', 'Registration No', 'Prescriptions', 'Total Value']);
                foreach (($payload['doctor_sales'] ?? []) as $d) {
                    $lines[] = $this->csvRow([
                        $d['doctor_name'] ?? '',
                        $d['doctor_reg_no'] ?? '',
                        $d['rx_count'] ?? 0,
                        $d['total_value'] ?? 0,
                    ]);
                }
                break;
        }

        return implode("\n", $lines) . "\n";
    }

    private function metricTable(array $metrics): string
    {
        $html = '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">';
        foreach ($metrics as $label => $value) {
            $html .= '<tr>'
                . '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#64748b">' . e((string) $label) . '</td>'
                . '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">' . e((string) $value) . '</td>'
                . '</tr>';
        }

        return $html . '</table>';
    }

    private function hsnTable(array $rows): string
    {
        if (empty($rows)) {
            return '';
        }

        $html = '<h3 style="font-size:13px;margin:12px 0 6px">HSN Summary</h3>'
            . '<table style="width:100%;border-collapse:collapse;font-size:12px">'
            . '<tr style="background:#f1f5f9"><th align="left" style="padding:6px">HSN</th><th align="right" style="padding:6px">Taxable</th><th align="right" style="padding:6px">Tax</th></tr>';

        foreach (array_slice($rows, 0, 25) as $h) {
            $html .= '<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">' . e((string) ($h['hsn_code'] ?? '')) . '</td>'
                . '<td align="right" style="padding:6px;border-bottom:1px solid #e2e8f0">' . e($this->money($h['taxable_value'] ?? 0)) . '</td>'
                . '<td align="right" style="padding:6px;border-bottom:1px solid #e2e8f0">' . e($this->money($h['total_tax'] ?? 0)) . '</td></tr>';
        }

        return $html . '</table>';
    }

    private function agingTable(array $customers): string
    {
        if (empty($customers)) {
            return '';
        }

        $html = '<h3 style="font-size:13px;margin:12px 0 6px">Top Outstanding Customers</h3>'
            . '<table style="width:100%;border-collapse:collapse;font-size:12px">'
            . '<tr style="background:#f1f5f9"><th align="left" style="padding:6px">Customer</th><th align="right" style="padding:6px">Outstanding</th><th align="right" style="padding:6px">90+ days</th></tr>';

        foreach (array_slice($customers, 0, 20) as $c) {
            $html .= '<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">' . e((string) ($c['name'] ?? '')) . '</td>'
                . '<td align="right" style="padding:6px;border-bottom:1px solid #e2e8f0">' . e($this->money($c['current_balance'] ?? 0)) . '</td>'
                . '<td align="right" style="padding:6px;border-bottom:1px solid #e2e8f0">' . e($this->money($c['bracket_90_plus'] ?? 0)) . '</td></tr>';
        }

        return $html . '</table>';
    }

    private function doctorTable(array $doctors): string
    {
        if (empty($doctors)) {
            return '<p style="font-size:13px;color:#64748b">No doctor-linked sales in this period.</p>';
        }

        $html = '<table style="width:100%;border-collapse:collapse;font-size:12px">'
            . '<tr style="background:#f1f5f9"><th align="left" style="padding:6px">Doctor</th><th align="right" style="padding:6px">Rx</th><th align="right" style="padding:6px">Value</th></tr>';

        foreach (array_slice($doctors, 0, 25) as $d) {
            $html .= '<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">' . e((string) ($d['doctor_name'] ?? '')) . '</td>'
                . '<td align="right" style="padding:6px;border-bottom:1px solid #e2e8f0">' . e((string) ($d['rx_count'] ?? 0)) . '</td>'
                . '<td align="right" style="padding:6px;border-bottom:1px solid #e2e8f0">' . e($this->money($d['total_value'] ?? 0)) . '</td></tr>';
        }

        return $html . '</table>';
    }

    private function csvRow(array $values): string
    {
        return implode(',', array_map(function ($value) {
            $value = (string) $value;
            if (strpbrk($value, ",\"\n\r") === false) {
                return $value;
            }

            return '"' . str_replace('"', '""', $value) . '"';
        }, $values));
    }

    private function money($value): string
    {
        return '₹' . number_format((float) $value, 2);
    }
}
