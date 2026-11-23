// Build the round-3 deliverables in test-reports/ from defects.json + results.json
const fs = require('fs');
const path = require('path');
const { J, write } = require('./catalogue.cjs');
const OUT = path.resolve(__dirname, '../../../test-reports');
const defects = JSON.parse(fs.readFileSync(path.join(__dirname, 'defects.json'), 'utf8'));
const results = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));
const SEV = ['Critical', 'High', 'Medium', 'Low'];

// fixing order + group metadata (title, shared root cause, plan-first prompt focus)
const GROUPS = [
  ['G1-SEC', 'Tenant security: anonymous and cross-store access', 'Routes outside any auth middleware and store resolution trusted from the request (body/header/query, fallback Store::first()); product/batch lookups not scoped by store.', 'backend/routes/api.php (lines ~137-215), InvoiceController::resolveStoreId/cancel, AdminSettingController, SyncController::pullDeltas, DeviceSessionController, stock posting lookups'],
  ['G11-TAX', 'Tax and GST computation', 'Client-supplied place of supply/discounts trusted; inclusive/exclusive basis lost on returns; discount fields double-applied.', 'frontend/src/lib/sync/onlineTransactionService.ts:558, frontend/src/lib/masters/partiesStore.ts:371,416, InvoiceController::store tax calc, salesReturnService/posSalesReturnService'],
  ['G10-PAYMENTS', 'Payments, receipts, shifts and expenses', 'Tender vs applied amount not separated; receipts/payments not allocated to documents; shift service crashes; no expense entry.', 'PosBillingPage settlement payload, InvoiceController::store payments, AdminTransactionController::storeCustomerPayment/storeSupplierPayment, CounterShiftService'],
  ['G3-PURCHASE-SYNC', 'Purchase posting on the server', 'Two posting paths (sync ingest and POST /purchases) with different behaviour; charge place-of-supply compared unnormalised; no idempotency/uniqueness; returns not posted.', 'SyncController::upsertSinglePurchase, PurchaseController::store, PurchaseChargeService::resolveForStore/cleanPos'],
  ['G3-PURCHASE-UI', 'Purchase entry screen', 'Draft-row state leaks into totals; existing-batch selection incomplete; margin units mismatched.', 'PurchaseEntryForm.tsx (totals, commitEntryRow), PurchaseGridRow.tsx (batch cell, margin)'],
  ['G2-STOCK', 'Stock integrity: opening stock, transfers, adjustments', 'Stock writes that bypass the ledger service; barcode-only product mapping; policy keyed to a person.', 'AdminMasterController product create (initial_batch), StockController::receiveTransfer, StockAdjustmentPolicy::validate, MastersPage.tsx'],
  ['G9-LEDGER', 'Party balances and audit trail', 'parties.current_balance maintained by some flows and not others; several sensitive services never call AuditLog.', 'purchase posting, AdminTransactionController, InvoiceCancellationService, CounterClaimService'],
  ['G14-REPORTS', 'Reports and dashboards disagree', 'Each report sums its own columns (subtotal vs taxable, module_key not filtered, raw tender rows).', 'AdminReportController::gstr1, AdminDashboardController, ReportController::dailyCollection, dashboard metrics serializer'],
  ['G4-NUMBERING', 'Document number series', 'Till leases a fresh block on every sync tick and the server accepts the client number.', 'frontend counterSequenceService / documentSequenceSync, CounterSequenceController::lease'],
  ['G13-SYNC', 'Offline sync and revocation', 'Renumbering on push, non-FIFO queue, 401/403 treated as transient.', 'syncQueueService, onlineTransactionService, storeDeviceService grace/revocation handling'],
  ['G12-APPROVALS', 'Approvals and closed periods', 'Cancel does not consume an approval; day-close state read by assertDayOpen differs from the admin close.', 'InvoiceController::cancel, StoreDayCloseService::assertDayOpen, AdminDayCloseController'],
  ['G5-COUNTER', 'Counter activation and monitoring', 'Lockout keyed on IP; counter resource lacks activity fields.', 'DeviceActivationAttempt::countRecentFailures, CounterClaimService::claim, admin counter resource'],
  ['G6-SETUP', 'Master data and settings defaults', 'Missing validation and Kerala-centric defaults; till writes settings back.', 'AdminStoreController validation, party create defaults, till settings persistence, CustomerCombobox, DatabaseSeeder'],
  ['G7-ENV', 'Environment, updater and error exposure', 'Hard-coded production endpoints; placeholder signatures; debug traces.', 'tauri.conf.json/updater config, DesktopUpdateController, backend .env'],
  ['G15-GAPS', 'Required features not yet implemented (planned Waves C-E)', 'Salesperson, approvals and pharmacist rule are scheduled for v2.3/v2.4 per specs/cr/2026-11-19-counter-only-pos/task-delta.md.', 'Waves C, D, E task lists'],
  ['G8-KEYBOARD', 'Keyboard-only operation', 'Screen shortcuts missing or overridden by global navigation; list results not keyboard listboxes.', 'central key map, PurchasesPage, SalesReturnPage, PurchaseEntryForm, PosBillingPage settlement'],
  ['G8-UI', 'UI copy and layout', 'Controlled inputs with fallback values, unformatted dates, non-wrapping hint bar, stale labels.', 'StoresPage.tsx, SalesReturnPage, PosShortcutHintBar, MastersPage labels, Sidebar version'],
];
const order = GROUPS.map((g) => g[0]);
const gmeta = Object.fromEntries(GROUPS.map(([id, title, cause, files]) => [id, { title, cause, files }]));
const sevRank = (s) => SEV.indexOf(s);
defects.forEach((d) => { d.verdict = d.verdict || 'CONFIRMED'; });
const sorted = [...defects].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || sevRank(a.severity) - sevRank(b.severity) || a.id.localeCompare(b.id));

// ---- journeys.csv
write(results);

// ---- defects.csv
const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
const cols = ['id', 'group', 'title', 'severity', 'type', 'journey', 'verdict', 'steps', 'expected', 'actual', 'evidence', 'cause', 'fix', 'test'];
fs.writeFileSync(path.join(OUT, 'defects.csv'), [cols.join(','), ...sorted.map((d) => cols.map((c) => esc(d[c])).join(','))].join('\n') + '\n');

// ---- fix prompts
const prompt = (gid, items) => {
  const m = gmeta[gid];
  return [
    `You are fixing defect group ${gid} — ${m.title} — in the LamSuite Billing repo (Laravel backend in backend/, Tauri/React till in frontend/, admin panel in admin-panel/).`,
    '',
    'PLAN FIRST. Do not edit any file until I approve the plan.',
    '',
    'Defects in this group (full steps, expected/actual and evidence are in test-reports/fix-list.md and test-reports/defects.csv):',
    ...items.map((d) => `- ${d.id} [${d.severity}] ${d.title}`),
    '',
    `Shared root cause observed by QA: ${m.cause}`,
    `Start reading at: ${m.files}.`,
    '',
    'Your plan must:',
    '1. Confirm or correct the suspected cause for each defect by reading the code (cite file:line).',
    '2. Propose one change per root cause (not per symptom), naming every file you will touch and why.',
    '3. For each defect, write the failing test first (name, file, what it asserts) using the "test to add" in the fix list, and say how it fails today.',
    '4. List data already written wrongly by this defect in existing databases and propose a backfill/migration (dry-run first) or say none is needed.',
    '5. Call out any behaviour change visible to cashiers or owners, and any interaction with other groups in the fix list.',
    '6. Give the verification you will run after the change (tests + the QA scripts under tests/qa/r3/ that reproduce it).',
    '',
    'Stop after the plan and wait for approval.',
  ].join('\n');
};

// ---- fix-list.md
const lines = [];
lines.push('# Fix list — LamSuite Billing QA round 3 (build 2.1.1)', '');
lines.push(`Date: 2026-11-21 · Throwaway environment (backend 127.0.0.1:8000 on \`tests/qa/r3/r3.sqlite\`, fake data, no production hosts) · No application source was changed.`, '');
lines.push(`${defects.length} defects in ${new Set(defects.map((d) => d.group)).size} root-cause groups, listed in the recommended fixing order (money, tax, stock and data loss first; then sync and workflow; then UI). Every defect was reproduced at least twice unless marked PLAUSIBLE. Evidence paths are relative to the repo root.`, '');
lines.push('| Severity | Count |', '|---|---|');
for (const s of SEV) lines.push(`| ${s} | ${defects.filter((d) => d.severity === s).length} |`);
lines.push('');
lines.push('## Index', '');
for (const gid of order) {
  const items = sorted.filter((d) => d.group === gid); if (!items.length) continue;
  lines.push(`- **${gid} — ${gmeta[gid].title}**: ${items.map((d) => `${d.id} (${d.severity})`).join(', ')}`);
}
lines.push('');
let n = 0;
for (const gid of order) {
  const items = sorted.filter((d) => d.group === gid); if (!items.length) continue;
  n += 1;
  lines.push(`## ${n}. ${gid} — ${gmeta[gid].title}`, '');
  lines.push(`**Shared root cause:** ${gmeta[gid].cause}`, '');
  for (const d of items) {
    lines.push(`### ${d.id} — ${d.title}`, '');
    lines.push(`- **Severity:** ${d.severity} · **Type:** ${d.type} · **Journey:** ${d.journey} · **Verdict:** ${d.verdict}`);
    lines.push(`- **Steps to reproduce:** ${d.steps}`);
    lines.push(`- **Expected:** ${d.expected}`);
    lines.push(`- **Actual:** ${d.actual}`);
    lines.push(`- **Evidence:** ${d.evidence}`);
    lines.push(`- **Suspected cause:** ${d.cause}`);
    lines.push(`- **Suggested fix:** ${d.fix}`);
    lines.push(`- **Test to add:** ${d.test}`, '');
  }
  lines.push(`#### Fix prompt for ${gid} (paste as-is)`, '', '```text', prompt(gid, items), '```', '');
}
fs.writeFileSync(path.join(OUT, 'fix-list.md'), lines.join('\n'));

// ---- fix-prompts.md (prompts only, same order)
const fp = ['# Fix prompts — one per defect group, in fixing order', '', 'Each prompt is plan-first: the agent must stop after the plan. Paste one at a time, in this order.', ''];
for (const gid of order) { const items = sorted.filter((d) => d.group === gid); if (!items.length) continue; fp.push(`## ${gid} — ${gmeta[gid].title}`, '', '```text', prompt(gid, items), '```', ''); }
fs.writeFileSync(path.join(OUT, 'fix-prompts.md'), fp.join('\n'));

// ---- counts for summary
const byJourney = {};
for (const d of defects) { const k = d.journey; byJourney[k] = byJourney[k] || { Critical: 0, High: 0, Medium: 0, Low: 0 }; byJourney[k][d.severity]++; }
const status = {}; for (const [id] of J) { const s = (results[id] || {}).status || 'PLANNED'; status[s] = (status[s] || 0) + 1; }
const jStatus = {}; for (const [id, j] of J) { const s = (results[id] || {}).status || 'PLANNED'; jStatus[j] = jStatus[j] || {}; jStatus[j][s] = (jStatus[j][s] || 0) + 1; }
fs.writeFileSync(path.join(__dirname, 'summary_counts.json'), JSON.stringify({ status, byJourney, jStatus, bySeverity: Object.fromEntries(SEV.map((s) => [s, defects.filter((d) => d.severity === s).length])), byType: defects.reduce((a, d) => ((a[d.type] = (a[d.type] || 0) + 1), a), {}), order: order.filter((g) => sorted.some((d) => d.group === g)).map((g) => [g, gmeta[g].title, sorted.filter((d) => d.group === g).map((d) => d.id)]) }, null, 2));
console.log('written', defects.length, 'defects;', JSON.stringify(status));
