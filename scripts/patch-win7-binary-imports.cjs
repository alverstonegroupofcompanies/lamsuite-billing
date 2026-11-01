#!/usr/bin/env node

/**
 * Post-Build Windows 7 Compatibility Binary Import Patcher
 *
 * For MSVC builds where the toolchain injects Windows 8+ API import names
 * (specifically GetSystemTimePreciseAsFileTime in KERNEL32.dll) that have exact
 * signature-compatible Windows 7 equivalents (GetSystemTimeAsFileTime), this script
 * patches the Import Name Table in the PE binary in-place without altering file size
 * or section offsets.
 */

const fs = require('fs');
const path = require('path');

const PATCHES = [
  {
    original: Buffer.from('GetSystemTimePreciseAsFileTime\0', 'ascii'),
    // GetSystemTimeAsFileTime is 23 chars. 23 + 8 nulls = 31 bytes (exact match)
    replacement: Buffer.from('GetSystemTimeAsFileTime\0\0\0\0\0\0\0\0', 'ascii'),
    name: 'GetSystemTimePreciseAsFileTime -> GetSystemTimeAsFileTime',
  },
];

function patchBuffer(buffer, filePath) {
  let modified = false;

  for (const { original, replacement, name } of PATCHES) {
    let index = 0;
    while ((index = buffer.indexOf(original, index)) !== -1) {
      console.log(`[PATCH] Patching ${name} at offset 0x${index.toString(16)} in ${filePath}`);
      replacement.copy(buffer, index);
      modified = true;
      index += replacement.length;
    }
  }

  return modified;
}

function patchFile(filePath) {
  const stats = fs.statSync(filePath);
  if (stats.isDirectory()) {
    const dirBase = path.basename(filePath);
    if (['build', 'deps', '.fingerprint', 'incremental'].includes(dirBase)) {
      return;
    }
    const entries = fs.readdirSync(filePath);
    for (const entry of entries) {
      patchFile(path.join(filePath, entry));
    }
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.exe' && ext !== '.dll') {
    return;
  }

  const buffer = fs.readFileSync(filePath);
  // Basic PE check
  if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) {
    return;
  }

  const modified = patchBuffer(buffer, filePath);
  if (modified) {
    fs.writeFileSync(filePath, buffer);
    console.log(`[SUCCESS] Saved patched binary: ${filePath}`);
  }
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    targets.push('frontend/src-tauri/target/release');
  }

  console.log('=== Windows 7 Compatibility Binary Import Patcher ===');
  for (const target of targets) {
    const fullPath = path.resolve(target);
    if (fs.existsSync(fullPath)) {
      console.log(`Scanning and patching target: ${fullPath}`);
      patchFile(fullPath);
    } else {
      console.log(`Target not found (skipping): ${fullPath}`);
    }
  }
}

main();
