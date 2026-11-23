<?php
// QA round 3: seed the throwaway DB with DatabaseSeeder but stub `data:sync-actual`,
// which would otherwise import ../lamsuite_desktop.sqlite (possibly real data).
$base = realpath(__DIR__ . '/../../../backend');
require $base . '/vendor/autoload.php';
$app = require $base . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();
Illuminate\Support\Facades\Artisan::command('data:sync-actual', function () { $this->info('stubbed by QA'); });
Illuminate\Support\Facades\Artisan::call('migrate:fresh', ['--force' => true]);
echo Illuminate\Support\Facades\Artisan::output();
(new Database\Seeders\DatabaseSeeder())->setContainer($app)->setCommand(new Illuminate\Console\Command())->__invoke();
echo "seeded\n";
