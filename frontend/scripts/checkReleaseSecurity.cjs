#!/usr/bin/env node

/**
 * Release Security Gate Check for LamSuite Billing.
 * Validates that production builds do not contain mock activation keys,
 * hardcoded demo provisioning, or unverified fail-open fallbacks.
 */

const fs = require('fs');
const path = require('path');

const ROOT_SRC = path.join(__dirname, '..', 'src');

const FORBIDDEN_PATTERNS = [
  { pattern: /LAM-DEMO-2026-KEY/g, description: 'Hardcoded demo activation key' },
  { pattern: /registerWithActivationKey\s*\(\s*["']LAM-DEMO/g, description: 'Auto-provisioning demo activation in production' },
  { pattern: /const keyUpper = activationKey\.toUpperCase\(\);\s*let matchedBranch/g, description: 'Client-side offline activation key parsing fallback' },
];

let hasErrors = false;

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'target') {
        scanDir(fullPath);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js'))) {
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
        continue; // skip test files themselves
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const check of FORBIDDEN_PATTERNS) {
        if (check.pattern.test(content)) {
          console.error(`[SECURITY FAILURE] ${check.description} detected in: ${path.relative(ROOT_SRC, fullPath)}`);
          hasErrors = true;
        }
      }
    }
  }
}

console.log('--- Running LamSuite Release Security Gate Check ---');
scanDir(ROOT_SRC);

if (hasErrors) {
  console.error('\n[ERROR] Production release build security check FAILED.');
  console.error('All activation must go strictly through server verification with no demo fallbacks.');
  process.exit(1);
} else {
  console.log('[SUCCESS] All production source files passed security gate checks. Zero demo bypasses found.');
  process.exit(0);
}
