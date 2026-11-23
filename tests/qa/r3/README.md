# QA round 3 harness (build 2.1.1)

Throwaway environment only: fake data, local hosts, no production URLs or real credentials.

## Start the environment

```bash
cd backend && DB_DATABASE=$PWD/../tests/qa/r3/r3.sqlite SEED_USER_PASSWORD='Qa-Throwaway-2026!' php ../tests/qa/r3/seed_fake_only.php
cd backend/public && DB_DATABASE=<repo>/tests/qa/r3/r3.sqlite MAIL_MAILER=log PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:8000 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
cd frontend && VITE_API_BASE_URL=http://127.0.0.1:8000 npx vite --port 5173 --strictPort
cd admin-panel && npx vite --port 5174 --strictPort
```

`seed_fake_only.php` runs `migrate:fresh` + `DatabaseSeeder` with `data:sync-actual` stubbed, so `lamsuite_desktop.sqlite` is never imported.

Since the G6-SETUP fix (SET-02), `DatabaseSeeder` no longer calls `data:sync-actual`, so a plain `DB_DATABASE=<file> php artisan migrate:fresh --seed` is equally safe. The import is now opt-in only: it needs `--source=<path>`, has no default path, and refuses to run when `APP_ENV=production`. `seed_fake_only.php` is kept so older builds can still be seeded.

## Files

- `lib.cjs` — read-only SQL, API client, paise oracle (`P`, `R`, `inclusive`, `exclusive`), evidence writer.
- `driver.cjs` — puppeteer session with network capture and external-host blocking (copied from `tests/qa/driver.cjs`).
- `pos.cjs` — open a till, issue/re-issue a counter code through the admin API, claim like a user.
- `catalogue.cjs` — the journey catalogue (writes `test-reports/journeys.csv`); `results.json` holds statuses.
- `j*.cjs` — one script per journey step; `p_sec_*.cjs` security probes; `int_checks.cjs` integrity suite; `reconfirm.cjs` re-runs failures.
- `d_batch*.cjs` + `defects.cjs` → `defects.json`; `build_reports.cjs` writes `test-reports/{journeys.csv,defects.csv,fix-list.md,fix-prompts.md}`.
- `evidence/` — JSON evidence per step; screenshots in `test-reports/r3/screenshots/`.

Most journey scripts are written against the data created earlier in the run (store ids 4/5, counter ids 2-6); run them in the order of the catalogue on a fresh database.
