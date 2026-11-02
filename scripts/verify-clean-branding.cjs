#!/usr/bin/env node

/**
 * CI Guardrail: Verify Clean Branding & Removal of Test/Demo Strings
 * Fails the build if any forbidden strings appear in source code or built artifacts.
 */

const fs = require('fs');
const path = require('path');

const FORBIDDEN_PATTERNS = [
  { pattern: /Tally-Style Multi-Store Workspace/i, label: 'Tally-Style Multi-Store Workspace' },
  { pattern: /Offline-First Multi-Store Retail Engine/i, label: 'Offline-First Multi-Store Retail Engine' },
  { pattern: /pharmacy@upi/i, label: 'pharmacy@upi (Hardcoded fake UPI ID)' },
  { pattern: /TESTSTORE/i, label: 'TESTSTORE (Demo store code)' },
  { pattern: /Palakkad Main/i, label: 'Palakkad Main (Demo store name)' },
];

const SCAN_DIRS = [
  'frontend/src',
  'admin-panel/src',
  'backend/app',
  'mcp-server/src',
];

const IGNORE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.ico', '.sqlite', '.dat'];

let violations = [];
let filesScanned = 0;

function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'vendor', 'coverage', '__snapshots__'].includes(entry.name)) {
        continue;
      }
      scanDirectory(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORE_EXTENSIONS.includes(ext)) continue;

      // Skip test files from string check since tests may test rejection of forbidden strings
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;

      filesScanned++;
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, lineNum) => {
        for (const rule of FORBIDDEN_PATTERNS) {
          if (rule.pattern.test(line)) {
            violations.push({
              file: fullPath,
              line: lineNum + 1,
              matched: rule.label,
              snippet: line.trim(),
            });
          }
        }
      });
    }
  }
}

console.log('🔍 Running Clean Branding CI Guardrail...');
for (const dir of SCAN_DIRS) {
  scanDirectory(path.resolve(__dirname, '..', dir));
}

if (violations.length > 0) {
  console.error(`\n❌ Found ${violations.length} branding violation(s):\n`);
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} [${v.matched}]`);
    console.error(`    Snippet: "${v.snippet}"\n`);
  }
  process.exit(1);
} else {
  console.log(`✓ Clean branding check passed: Scanned ${filesScanned} source files. 0 forbidden strings found.`);
  process.exit(0);
}
