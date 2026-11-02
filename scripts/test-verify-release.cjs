#!/usr/bin/env node

/**
 * Test runner for scripts/verify-release-assets.cjs logic against deliberately broken releases:
 * 1. Missing asset
 * 2. Wrong tag (version in manifest != release tag)
 * 3. Draft URL (URL contains 'untagged-')
 * 4. Spaces in artifact name
 */

const assert = require('assert');

// Simulate the verification validator logic from scripts/verify-release-assets.cjs
function runVerificationLogic({ tag, releaseDraft, assets, manifest, legacyManifest }) {
  const errors = [];
  const expectedTagVersion = tag.replace(/^v/, '');

  if (releaseDraft) {
    errors.push('Release is still marked as DRAFT.');
  }

  const requiredAssetPatterns = [
    { name: 'Windows NSIS Setup (.exe)', test: (n) => /\.exe$/i.test(n) && !n.includes('legacy') },
    { name: 'Windows NSIS Update Archive (.nsis.zip)', test: (n) => /\.nsis\.zip$/i.test(n) && !n.includes('legacy') },
    { name: 'Windows Updater Signature (.sig)', test: (n) => /\.nsis\.zip\.sig$/i.test(n) && !n.includes('legacy') },
    { name: 'Updater Manifest (latest.json)', test: (n) => n === 'latest.json' },
  ];

  for (const item of requiredAssetPatterns) {
    const found = assets.find(a => item.test(a.name));
    if (!found) {
      errors.push(`Missing required release asset: ${item.name}`);
    } else {
      if (found.name.includes(' ')) {
        errors.push(`Asset "${found.name}" contains whitespace. Filenames must be URL-safe without spaces.`);
      }
    }
  }

  if (manifest) {
    if (manifest.version !== expectedTagVersion) {
      errors.push(`Version mismatch in latest.json: expected "${expectedTagVersion}", got "${manifest.version}"`);
    }

    for (const [platform, platData] of Object.entries(manifest.platforms || {})) {
      if (!platData.signature || platData.signature.length < 40) {
        errors.push(`Platform "${platform}" in latest.json has invalid/empty signature.`);
      }
      if (platData.url.includes('untagged')) {
        errors.push(`Platform "${platform}" URL points to draft untagged endpoint: ${platData.url}`);
      }
      if (platData.url.includes(' ')) {
        errors.push(`Platform "${platform}" URL contains unencoded spaces: ${platData.url}`);
      }
    }
  }

  if (legacyManifest) {
    for (const [platform, platData] of Object.entries(legacyManifest.platforms || {})) {
      if (platData.url.includes('untagged')) {
        errors.push(`legacyManifest URL points to draft untagged endpoint: ${platData.url}`);
      }
    }
  }

  return { success: errors.length === 0, errors };
}

console.log('--- Running Verification Gate Failure Tests ---\n');

// 1. Missing asset scenario
{
  const result = runVerificationLogic({
    tag: 'v2.0.22',
    releaseDraft: false,
    assets: [
      { name: 'LamSuite-Billing-windows-legacy-x64-setup.exe', size: 1000 },
      { name: 'latest.json', size: 500 },
      // Missing NSIS .exe and .nsis.zip
    ],
    manifest: {
      version: '2.0.22',
      platforms: {
        'windows-x86_64': {
          url: 'https://github.com/alverstonegroupofcompanies/lamsuite-billing/releases/download/v2.0.22/LamSuite-Billing_2.0.22_x64-setup.nsis.zip',
          signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIG1pbmlzaWduIHNlY3JldCBrZXkKUldRR09ENStxSU9JbDJpblJXQTV6am8zVDFuME1udVJkdUZXeExUSEF6aXNONDUvSE84YktXd3IK',
        },
      },
    },
  });

  assert.strictEqual(result.success, false, 'Expected failure on missing asset');
  assert.ok(result.errors.some(e => e.includes('Missing required release asset')), 'Missing asset caught');
  console.log('[TEST 1 PASSED] Successfully caught missing asset:');
  console.log(`  - ${result.errors.join('\n  - ')}\n`);
}

// 2. Wrong tag scenario
{
  const result = runVerificationLogic({
    tag: 'v2.0.22',
    releaseDraft: false,
    assets: [
      { name: 'LamSuite-Billing_2.0.22_x64-setup.exe', size: 1000 },
      { name: 'LamSuite-Billing_2.0.22_x64-setup.nsis.zip', size: 1000 },
      { name: 'LamSuite-Billing_2.0.22_x64-setup.nsis.zip.sig', size: 100 },
      { name: 'latest.json', size: 500 },
    ],
    manifest: {
      version: '2.0.21', // WRONG VERSION (older release tag)
      platforms: {
        'windows-x86_64': {
          url: 'https://github.com/alverstonegroupofcompanies/lamsuite-billing/releases/download/v2.0.22/LamSuite-Billing_2.0.22_x64-setup.nsis.zip',
          signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIG1pbmlzaWduIHNlY3JldCBrZXkKUldRR09ENStxSU9JbDJpblJXQTV6am8zVDFuME1udVJkdUZXeExUSEF6aXNONDUvSE84YktXd3IK',
        },
      },
    },
  });

  assert.strictEqual(result.success, false, 'Expected failure on version mismatch');
  assert.ok(result.errors.some(e => e.includes('Version mismatch')), 'Version mismatch caught');
  console.log('[TEST 2 PASSED] Successfully caught version mismatch:');
  console.log(`  - ${result.errors.join('\n  - ')}\n`);
}

// 3. Draft URL scenario
{
  const result = runVerificationLogic({
    tag: 'v2.0.22',
    releaseDraft: false,
    assets: [
      { name: 'LamSuite-Billing_2.0.22_x64-setup.exe', size: 1000 },
      { name: 'LamSuite-Billing_2.0.22_x64-setup.nsis.zip', size: 1000 },
      { name: 'LamSuite-Billing_2.0.22_x64-setup.nsis.zip.sig', size: 100 },
      { name: 'latest.json', size: 500 },
    ],
    manifest: {
      version: '2.0.22',
      platforms: {
        'windows-x86_64': {
          url: 'https://github.com/alverstonegroupofcompanies/lamsuite-billing/releases/download/untagged-999abc/LamSuite-Billing_2.0.22_x64-setup.nsis.zip',
          signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIG1pbmlzaWduIHNlY3JldCBrZXkKUldRR09ENStxSU9JbDJpblJXQTV6am8zVDFuME1udVJkdUZXeExUSEF6aXNONDUvSE84YktXd3IK',
        },
      },
    },
    legacyManifest: {
      platforms: {
        'windows-x86_64': {
          url: 'https://github.com/alverstonegroupofcompanies/lamsuite-billing/releases/download/untagged-c7f725ac7a6d28f439f6/LamSuite-Billing-windows-legacy-x64-setup.nsis.zip',
          signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIG1pbmlzaWduIHNlY3JldCBrZXkKUldRR09ENStxSU9JbDJpblJXQTV6am8zVDFuME1udVJkdUZXeExUSEF6aXNONDUvSE84YktXd3IK',
        },
      },
    },
  });

  assert.strictEqual(result.success, false, 'Expected failure on draft untagged URL');
  assert.ok(result.errors.some(e => e.includes('untagged')), 'Draft untagged URL caught');
  console.log('[TEST 3 PASSED] Successfully caught draft untagged URL:');
  console.log(`  - ${result.errors.join('\n  - ')}\n`);
}

// 4. Spaces in artifact name scenario
{
  const result = runVerificationLogic({
    tag: 'v2.0.22',
    releaseDraft: false,
    assets: [
      { name: 'LamSuite Billing_2.0.22_x64-setup.exe', size: 1000 }, // SPACE in name
      { name: 'LamSuite-Billing_2.0.22_x64-setup.nsis.zip', size: 1000 },
      { name: 'LamSuite-Billing_2.0.22_x64-setup.nsis.zip.sig', size: 100 },
      { name: 'latest.json', size: 500 },
    ],
    manifest: {
      version: '2.0.22',
      platforms: {
        'windows-x86_64': {
          url: 'https://github.com/alverstonegroupofcompanies/lamsuite-billing/releases/download/v2.0.22/LamSuite Billing_2.0.22_x64-setup.nsis.zip',
          signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIG1pbmlzaWduIHNlY3JldCBrZXkKUldRR09ENStxSU9JbDJpblJXQTV6am8zVDFuME1udVJkdUZXeExUSEF6aXNONDUvSE84YktXd3IK',
        },
      },
    },
  });

  assert.strictEqual(result.success, false, 'Expected failure on spaces in filename');
  assert.ok(result.errors.some(e => e.includes('whitespace') || e.includes('spaces')), 'Whitespace in filename caught');
  console.log('[TEST 4 PASSED] Successfully caught whitespace in artifact name:');
  console.log(`  - ${result.errors.join('\n  - ')}\n`);
}

console.log('[ALL VERIFICATION FAILURE TESTS PASSED CLEANLY]\n');
