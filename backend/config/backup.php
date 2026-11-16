<?php

return [
    'path' => env('BACKUP_PATH', storage_path('app/backups')),
    'retention_days' => (int) env('BACKUP_RETENTION_DAYS', 14),
    'keep_pre_restore' => (int) env('BACKUP_KEEP_PRE_RESTORE', 3),
    'schedule' => env('BACKUP_SCHEDULE', '02:00'),
];
