#!/usr/bin/env node

/**
 * Prepares the Microsoft Edge WebView2 Fixed Version Runtime (v109.0.1518.78 x64)
 * for bundling into the Windows Legacy NSIS installer.
 *
 * WebView2 version 109 is the final supported release for Windows 7 SP1 and Windows 8.1.
 * When tauri.legacy.conf.json specifies webviewInstallMode: fixedRuntime,
 * Tauri packages this folder directly into the NSIS setup executable.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetDir = path.resolve(__dirname, '..', 'frontend', 'vendor', 'Microsoft.WebView2.FixedVersionRuntime');

console.log('=== Preparing WebView2 Fixed Version 109 Runtime for Legacy Build ===');
console.log(`Target Directory: ${targetDir}`);

const runtimeExe = path.join(targetDir, 'msedgewebview2.exe');
if (fs.existsSync(runtimeExe) && fs.statSync(runtimeExe).size > 100000) {
  console.log('[PASS] WebView2 Fixed Version Runtime already exists and is populated.');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

// Reliable fixed runtime archive URLs (Primary GitHub mirror + Microsoft CDN fallback)
const runtimeUrls = [
  'https://github.com/westinyang/WebView2RuntimeArchive/releases/download/109.0.1518.78/Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.x64.cab',
  'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/e97607f4-c5f1-4684-95c3-c61555f08f19/Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.x64.cab',
];
const cabFile = path.resolve(__dirname, '..', 'frontend', 'vendor', 'webview2_fixed_109.cab');

let downloaded = false;
for (const url of runtimeUrls) {
  try {
    console.log(`Attempting to retrieve WebView2 Fixed Runtime 109 from: ${url}...`);
    execSync(`curl -fsSL --connect-timeout 20 --max-time 300 "${url}" -o "${cabFile}"`, { stdio: 'inherit' });
    if (fs.existsSync(cabFile) && fs.statSync(cabFile).size > 50000000) {
      console.log(`[PASS] Successfully downloaded runtime archive (${Math.round(fs.statSync(cabFile).size / (1024 * 1024))} MB).`);
      downloaded = true;
      break;
    }
  } catch (e) {
    console.warn(`[WARN] Download from ${url} failed: ${e.message}`);
  }
}

if (!downloaded || !fs.existsSync(cabFile)) {
  throw new Error(`[FATAL] Failed to download WebView2 Fixed Version 109 CAB archive from all sources.`);
}

console.log('Extracting CAB archive into target runtime directory...');

let extracted = false;
if (process.platform === 'win32') {
  // 1. Try 7-Zip first if available (faster and handles large CABs reliably)
  const possible7z = [
    '7z',
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  for (const cmd7z of possible7z) {
    try {
      console.log(`Attempting extraction using: ${cmd7z}`);
      execSync(`"${cmd7z}" x "${cabFile}" -o"${targetDir}" -y`, { stdio: 'inherit' });
      extracted = true;
      break;
    } catch {
      // try next
    }
  }

  // 2. Fallback to native Windows expand.exe (must use System32 to avoid Git bash's expand)
  if (!extracted) {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const winExpand = path.join(sysRoot, 'System32', 'expand.exe');
    console.log(`Attempting extraction using native Windows expand: ${winExpand}`);
    try {
      execSync(`"${winExpand}" "${cabFile}" -F:* "${targetDir}"`, { stdio: 'inherit' });
      extracted = true;
    } catch (e) {
      console.error(`[ERROR] Native expand failed: ${e.message}`);
    }
  }
} else {
  // Non-Windows (macOS / Linux development environments)
  try {
    execSync(`cabextract -d "${targetDir}" "${cabFile}"`, { stdio: 'inherit' });
    extracted = true;
  } catch (e) {
    console.warn(`cabextract failed or missing: ${e.message}`);
  }
}

// Verification: Ensure the extracted runtime is valid
if (fs.existsSync(runtimeExe) && fs.statSync(runtimeExe).size > 100000) {
  console.log(`[PASS] Verified msedgewebview2.exe (${Math.round(fs.statSync(runtimeExe).size / 1024)} KB) successfully staged.`);
} else {
  // Check if files were extracted into a nested subfolder
  const entries = fs.readdirSync(targetDir);
  let foundNested = false;
  for (const entry of entries) {
    const candidate = path.join(targetDir, entry, 'msedgewebview2.exe');
    if (fs.existsSync(candidate) && fs.statSync(candidate).size > 100000) {
      console.log(`Found msedgewebview2.exe in subfolder: ${entry}. Moving contents up...`);
      const subDir = path.join(targetDir, entry);
      const subFiles = fs.readdirSync(subDir);
      for (const sf of subFiles) {
        fs.renameSync(path.join(subDir, sf), path.join(targetDir, sf));
      }
      foundNested = true;
      break;
    }
  }

  if (!foundNested && (!fs.existsSync(runtimeExe) || fs.statSync(runtimeExe).size < 100000)) {
    throw new Error(`[FATAL] WebView2 Fixed Version Runtime extraction failed! msedgewebview2.exe not found in ${targetDir}`);
  }
}

const versionFile = path.join(targetDir, 'version.txt');
fs.writeFileSync(versionFile, '109.0.1518.78');

console.log('[SUCCESS] WebView2 Fixed Version 109 directory staging completed successfully.');
