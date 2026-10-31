#!/usr/bin/env node

/**
 * Prepares and validates the Tauri Minisign signing private key and password
 * before running the full build, giving immediate actionable diagnostic feedback.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Collect candidate keys from all possible secret names
const rawKeyCandidates = [
  process.env.TAURI_PRIVATE_KEY,
  process.env.TAURI_SIGNING_PRIVATE_KEY,
  process.env.RAW_KEY,
].filter(Boolean).map(k => k.trim()).filter(Boolean);

if (rawKeyCandidates.length === 0) {
  console.error('[FATAL] Neither TAURI_PRIVATE_KEY nor TAURI_SIGNING_PRIVATE_KEY is set in GitHub Secrets.');
  process.exit(1);
}

// Collect candidate passwords
const rawPasswordCandidates = [
  process.env.TAURI_KEY_PASSWORD,
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
  process.env.TAURI_PRIVATE_KEY_PASSWORD,
  process.env.RAW_PASSWORD,
].filter(Boolean);

const dummyFile = path.resolve('frontend', '.signing-probe.txt');
fs.writeFileSync(dummyFile, 'tauri-signing-probe', 'utf8');

const isWin = process.platform === 'win32';
const tauriCli = isWin
  ? path.resolve('frontend', 'node_modules', '.bin', 'tauri.cmd')
  : path.resolve('frontend', 'node_modules', '.bin', 'tauri');

const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
const tauriDir = path.join(homeDir, '.tauri');
if (!fs.existsSync(tauriDir)) {
  fs.mkdirSync(tauriDir, { recursive: true });
}
const keyFilePath = path.join(tauriDir, 'private.key');

let verifiedKey = null;
let verifiedPassword = null;
let winningPasswordLabel = null;

// Unique candidate keys
const uniqueKeys = [...new Set(rawKeyCandidates)];

for (const rawKey of uniqueKeys) {
  let encodedKey = '';
  if (rawKey.includes('untrusted comment')) {
    encodedKey = Buffer.from(rawKey.trim(), 'utf8').toString('base64');
  } else {
    encodedKey = rawKey.replace(/[\r\n\s]+/g, '');
  }

  fs.writeFileSync(keyFilePath, encodedKey, 'utf8');

  // Candidate passwords for this key
  const passCandidates = [];
  for (const pw of rawPasswordCandidates) {
    passCandidates.push({ label: 'configured secret password', val: pw });
    const trimmed = pw.trim();
    if (trimmed !== pw) {
      passCandidates.push({ label: 'whitespace-trimmed secret password', val: trimmed });
    }
    const unquoted = trimmed.replace(/^["']|["']$/g, '');
    if (unquoted !== trimmed && unquoted !== pw) {
      passCandidates.push({ label: 'unquoted secret password', val: unquoted });
    }
  }
  // Always test empty password as fallback (for unencrypted keys)
  passCandidates.push({ label: 'empty password (unencrypted key)', val: '' });

  for (const cand of passCandidates) {
    try {
      execFileSync(tauriCli, ['signer', 'sign', '-f', keyFilePath, '-p', cand.val, dummyFile], {
        cwd: path.resolve('frontend'),
        stdio: 'pipe',
        shell: isWin,
      });
      verifiedKey = encodedKey;
      verifiedPassword = cand.val;
      winningPasswordLabel = cand.label;
      break;
    } catch (err) {
      const errOut = (err.stderr ? err.stderr.toString() : '') + (err.stdout ? err.stdout.toString() : '') + err.message;
      // If it's a tool execution error (e.g. tauri not found), report it
      if (err.code === 'ENOENT' || (!errOut.includes('Wrong password') && !errOut.includes('incorrect updater private key'))) {
        console.warn(`[WARN] Probe execution note: ${errOut.trim()}`);
      }
    }
  }

  if (verifiedKey) break;
}

// Clean up probe files
try {
  if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
  const sigFile = dummyFile + '.sig';
  if (fs.existsSync(sigFile)) fs.unlinkSync(sigFile);
} catch {}

if (!verifiedKey) {
  console.error('\n================================================================================');
  console.error('[FATAL] MINISIGN PRIVATE KEY DECRYPTION FAILED!');
  console.error('The private key in GitHub Secrets could not be unlocked.');
  console.error('');
  console.error('Action Required:');
  console.error('1. Check the GitHub repository Secrets (Settings > Secrets and variables > Actions).');
  console.error('2. Ensure `TAURI_PRIVATE_KEY` contains the Base64-encoded private key.');
  console.error('3. If the key is unencrypted, leave `TAURI_KEY_PASSWORD` blank or delete it.');
  console.error('4. If the key has a password, ensure `TAURI_KEY_PASSWORD` matches the passphrase.');
  console.error('================================================================================\n');
  process.exit(1);
}

console.log(`[SUCCESS] Private key verified and unlocked successfully using: ${winningPasswordLabel}`);

// Export to GITHUB_ENV if running in GitHub Actions
const githubEnvPath = process.env.GITHUB_ENV;
if (githubEnvPath && fs.existsSync(githubEnvPath)) {
  let winKeyPath = keyFilePath;
  try {
    winKeyPath = execFileSync('cygpath', ['-w', keyFilePath], { encoding: 'utf8' }).trim();
  } catch {}

  const delim = 'ENV_DELIM_' + Math.random().toString(36).substring(2);
  fs.appendFileSync(githubEnvPath, `TAURI_SIGNING_KEY_STRING=${verifiedKey}\n`);
  fs.appendFileSync(githubEnvPath, `TAURI_KEY_PATH=${winKeyPath}\n`);
  fs.appendFileSync(githubEnvPath, `TAURI_VERIFIED_KEY_PASSWORD<<${delim}\n${verifiedPassword}\n${delim}\n`);
}
