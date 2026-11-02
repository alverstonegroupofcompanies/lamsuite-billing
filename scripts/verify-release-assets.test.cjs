#!/usr/bin/env node

/**
 * Unit test for release asset verification script logic.
 * Ensures that verify-release-assets checks fail if latest.json or .sig files are missing.
 */

const assert = require('assert');

function evaluateAssets(assetNames, manifest) {
  const errors = [];
  const expectedPatterns = [
    { name: 'Windows NSIS Installer (.exe)', pattern: /\.exe$/i },
    { name: 'Windows Updater Signature (.sig)', pattern: /(\.nsis\.zip|\.msi\.zip|\.zip)\.sig$/i },
    { name: 'Updater Manifest (latest.json)', pattern: /^latest\.json$/i },
    { name: 'Windows Legacy Installer (Win 7/8.1)', pattern: /windows-legacy.*\.exe$/i },
  ];

  for (const exp of expectedPatterns) {
    const match = assetNames.some(name => exp.pattern.test(name));
    if (!match) {
      errors.push(`Missing required release asset: ${exp.name}`);
    }
  }

  if (!assetNames.includes('latest.json')) {
    errors.push('CRITICAL: latest.json is missing from release assets.');
  } else if (manifest) {
    if (!manifest.platforms || typeof manifest.platforms !== 'object') {
      errors.push('latest.json is missing a valid "platforms" object.');
    } else {
      const requiredPlatforms = ['windows-x86_64'];
      for (const plat of requiredPlatforms) {
        const platData = manifest.platforms[plat];
        if (!platData) {
          errors.push(`latest.json missing required entry for platform: ${plat}`);
        } else if (!platData.signature) {
          errors.push(`Platform ${plat} in latest.json has an empty or invalid signature.`);
        }
      }
    }
  }

  return errors;
}

console.log('Running verify-release-assets unit tests...');

// 1. All valid
const validAssets = [
  'LamSuite-Billing-Setup-2.0.17.exe',
  'LamSuite-Billing-Setup-2.0.17.nsis.zip.sig',
  'latest.json',
  'LamSuite-Billing-windows-legacy-x64-setup.exe',
];
const validManifest = {
  platforms: {
    'windows-x86_64': {
      signature: 'VALID_SIGNATURE_CONTENT',
      url: 'https://updates.lamstonehealthcare.com/setup.exe',
    },
  },
};
const errs1 = evaluateAssets(validAssets, validManifest);
assert.strictEqual(errs1.length, 0, 'Valid release should produce 0 errors');
console.log('✓ Valid release pass');

// 2. Missing latest.json
const missingLatest = [
  'LamSuite-Billing-Setup-2.0.17.exe',
  'LamSuite-Billing-Setup-2.0.17.nsis.zip.sig',
  'LamSuite-Billing-windows-legacy-x64-setup.exe',
];
const errs2 = evaluateAssets(missingLatest, null);
assert(errs2.some(e => e.includes('latest.json')), 'Should fail when latest.json is missing');
console.log('✓ Fails when latest.json is missing');

// 3. Missing .sig
const missingSig = [
  'LamSuite-Billing-Setup-2.0.17.exe',
  'latest.json',
  'LamSuite-Billing-windows-legacy-x64-setup.exe',
];
const errs3 = evaluateAssets(missingSig, validManifest);
assert(errs3.some(e => e.includes('.sig')), 'Should fail when .sig is missing');
console.log('✓ Fails when .sig file is missing');

// 4. Missing signature in manifest
const missingPlatSigManifest = {
  platforms: {
    'windows-x86_64': {
      signature: '',
      url: 'https://updates.lamstonehealthcare.com/setup.exe',
    },
  },
};
const errs4 = evaluateAssets(validAssets, missingPlatSigManifest);
assert(errs4.some(e => e.includes('signature')), 'Should fail when platform signature is empty');
console.log('✓ Fails when signature in manifest is missing/empty');

console.log('\n[PASS] All verify-release-assets checks verified successfully!');
