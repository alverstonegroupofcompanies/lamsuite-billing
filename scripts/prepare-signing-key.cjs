#!/usr/bin/env node

/**
 * Prepares and validates the Tauri Minisign signing private key and password
 * before running the full build, giving immediate actionable diagnostic feedback.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rawKey = process.env.RAW_KEY || '';
const rawPassword = process.env.RAW_PASSWORD || '';
const githubEnvPath = process.env.GITHUB_ENV;

if (!rawKey.trim()) {
  console.error('[FATAL] Neither TAURI_SIGNING_PRIVATE_KEY nor TAURI_PRIVATE_KEY is set in GitHub Secrets.');
  process.exit(1);
}

// 1. Format the private key as Base64-encoded string
let encodedKey = '';
if (rawKey.includes('untrusted comment')) {
  console.log('[INFO] Private key detected in raw plain-text format. Base64-encoding for Tauri CLI...');
  encodedKey = Buffer.from(rawKey.trim(), 'utf8').toString('base64');
} else {
  // Strip any newlines or spaces that may have been introduced
  encodedKey = rawKey.replace(/[\r\n\s]+/g, '');
}

// Write the key to $HOME/.tauri/private.key
const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
const tauriDir = path.join(homeDir, '.tauri');
if (!fs.existsSync(tauriDir)) {
  fs.mkdirSync(tauriDir, { recursive: true });
}
const keyFilePath = path.join(tauriDir, 'private.key');
fs.writeFileSync(keyFilePath, encodedKey, 'utf8');

// 2. Test decrypting and signing a dummy file using tauri signer
const dummyFile = path.join(process.cwd(), 'frontend', '.signing-probe.txt');
fs.writeFileSync(dummyFile, 'tauri-signing-probe', 'utf8');

// Candidate passwords to test:
// a) Raw password as passed
// b) Trimmed password (strip surrounding spaces and whitespace)
// c) Surrounding quotes stripped (in case user entered "mypassword" in secrets)
// d) Empty password (in case key was generated with empty password)
const candidates = [];

if (rawPassword) {
  candidates.push({ label: 'raw secret password', val: rawPassword });
  const trimmed = rawPassword.trim();
  if (trimmed !== rawPassword) {
    candidates.push({ label: 'whitespace-trimmed secret password', val: trimmed });
  }
  const unquoted = trimmed.replace(/^["']|["']$/g, '');
  if (unquoted !== trimmed && unquoted !== rawPassword) {
    candidates.push({ label: 'unquoted secret password', val: unquoted });
  }
}
// Always test empty password as a fallback
candidates.push({ label: 'empty password (unencrypted key)', val: '' });

let successfulPassword = null;
let winningLabel = null;

const tauriCli = path.join(process.cwd(), 'frontend', 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');

for (const candidate of candidates) {
  try {
    execFileSync(tauriCli, ['signer', 'sign', '-f', keyFilePath, '-p', candidate.val, dummyFile], {
      cwd: path.join(process.cwd(), 'frontend'),
      stdio: 'pipe',
    });
    successfulPassword = candidate.val;
    winningLabel = candidate.label;
    break;
  } catch (err) {
    // continue trying candidates
  }
}

// Clean up probe files
try {
  if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
  const sigFile = dummyFile + '.sig';
  if (fs.existsSync(sigFile)) fs.unlinkSync(sigFile);
} catch {}

if (successfulPassword === null) {
  console.error('\n================================================================================');
  console.error('[FATAL] MINISIGN PRIVATE KEY DECRYPTION FAILED!');
  console.error('The private key in TAURI_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY could not');
  console.error('be unlocked with the password in TAURI_KEY_PASSWORD / TAURI_SIGNING_PRIVATE_KEY_PASSWORD.');
  console.error('Tested variations:');
  candidates.forEach(c => console.error(`  - ${c.label}`));
  console.error('');
  console.error('Action Required:');
  console.error('1. Check the GitHub repository Secrets (Settings > Secrets and variables > Actions).');
  console.error('2. Ensure `TAURI_KEY_PASSWORD` matches the passphrase used when the Minisign keypair was generated.');
  console.error('3. If you forgot the password, generate a new keypair locally using:');
  console.error('     npm run tauri signer generate -w ~/.tauri/lamsuite.key');
  console.error('   and update `pubkey` in `tauri.conf.json` as well as `TAURI_PRIVATE_KEY` and `TAURI_KEY_PASSWORD` in GitHub Secrets.');
  console.error('================================================================================\n');
  process.exit(1);
}

console.log(`[SUCCESS] Private key verified and unlocked successfully using: ${winningLabel}`);

// Export to GITHUB_ENV if running in GitHub Actions
if (githubEnvPath && fs.existsSync(githubEnvPath)) {
  let winKeyPath = keyFilePath;
  try {
    winKeyPath = execFileSync('cygpath', ['-w', keyFilePath], { encoding: 'utf8' }).trim();
  } catch {}

  const delim = 'ENV_DELIM_' + Math.random().toString(36).substring(2);
  fs.appendFileSync(githubEnvPath, `TAURI_SIGNING_KEY_STRING=${encodedKey}\n`);
  fs.appendFileSync(githubEnvPath, `TAURI_KEY_PATH=${winKeyPath}\n`);
  fs.appendFileSync(githubEnvPath, `TAURI_VERIFIED_KEY_PASSWORD<<${delim}\n${successfulPassword}\n${delim}\n`);
}
