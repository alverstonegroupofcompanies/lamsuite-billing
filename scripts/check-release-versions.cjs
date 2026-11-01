#!/usr/bin/env node

/**
 * Validates version synchronization across:
 * - frontend/package.json
 * - frontend/src-tauri/Cargo.toml
 * - frontend/src-tauri/tauri.conf.json
 * Optionally checks against a provided git tag argument (e.g. "v2.0.11" or "2.0.11").
 */

const fs = require('fs');
const path = require('path');

const targetTag = process.argv[2] ? process.argv[2].replace(/^refs\/tags\//, '').replace(/^v/, '') : null;

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'frontend', 'package.json');
const cargoPath = path.join(rootDir, 'frontend', 'src-tauri', 'Cargo.toml');
const tauriConfPath = path.join(rootDir, 'frontend', 'src-tauri', 'tauri.conf.json');
const tauriLegacyConfPath = path.join(rootDir, 'frontend', 'src-tauri', 'tauri.legacy.conf.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const cargoContent = fs.readFileSync(cargoPath, 'utf8');
const cargoMatch = cargoContent.match(/\[package\][\s\S]*?version\s*=\s*"([^"]+)"/);
const cargoVersion = cargoMatch ? cargoMatch[1] : null;

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
const tauriVersion = tauriConf.package ? tauriConf.package.version : null;

let tauriLegacyVersion = null;
if (fs.existsSync(tauriLegacyConfPath)) {
  const tauriLegacyConf = JSON.parse(fs.readFileSync(tauriLegacyConfPath, 'utf8'));
  tauriLegacyVersion = tauriLegacyConf.package ? tauriLegacyConf.package.version : null;
}

console.log('--- LamSuite Billing Version Integrity Check ---');
console.log(`frontend/package.json:            ${pkg.version}`);
console.log(`frontend/Cargo.toml:              ${cargoVersion}`);
console.log(`frontend/tauri.conf.json:         ${tauriVersion}`);
if (tauriLegacyVersion) {
  console.log(`frontend/tauri.legacy.conf.json:  ${tauriLegacyVersion}`);
}
if (targetTag) {
  console.log(`Release Tag Argument:             ${targetTag}`);
}

const errors = [];
if (!cargoVersion) errors.push('Could not parse version from Cargo.toml');
if (!tauriVersion) errors.push('Could not parse version from tauri.conf.json');

if (pkg.version !== cargoVersion) {
  errors.push(`Version mismatch: package.json (${pkg.version}) does not match Cargo.toml (${cargoVersion})`);
}
if (pkg.version !== tauriVersion) {
  errors.push(`Version mismatch: package.json (${pkg.version}) does not match tauri.conf.json (${tauriVersion})`);
}
if (tauriLegacyVersion && pkg.version !== tauriLegacyVersion) {
  errors.push(`Version mismatch: package.json (${pkg.version}) does not match tauri.legacy.conf.json (${tauriLegacyVersion})`);
}
if (targetTag && pkg.version !== targetTag) {
  errors.push(`Version mismatch: Codebase version (${pkg.version}) does not match git release tag (${targetTag})`);
}

if (errors.length > 0) {
  console.error('\n[FATAL] Version integrity check FAILED:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`\n[SUCCESS] All components cleanly synchronized at version ${pkg.version}`);
