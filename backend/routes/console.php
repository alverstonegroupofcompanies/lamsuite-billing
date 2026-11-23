<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('reports:send-scheduled')
    ->everyMinute()
    ->withoutOverlapping();

Schedule::command('webhooks:dispatch')
    ->everyMinute()
    ->withoutOverlapping();

Schedule::command('alerts:sweep')
    ->everyFiveMinutes()
    ->withoutOverlapping();

Schedule::command('backup:database')
    ->dailyAt(env('BACKUP_SCHEDULE', '02:00'))
    ->withoutOverlapping();
