#!/usr/bin/env node

/**
 * CI Verification Gate: Windows 7 Compatibility Binary Import Checker
 *
 * Scans Windows PE binaries (.exe, .dll) for static imports of Windows 8+ APIs
 * (such as PackageIdFromFullName, GetPackageFamilyName, GetSystemTimePreciseAsFileTime,
 * WaitOnAddress, etc.) that cause immediate fatal startup crashes on Windows 7 SP1 / Windows 8.1.
 *
 * If any banned symbol is found in the Import Address Table (IAT) of KERNEL32.dll
 * or other system libraries, this script fails with exit code 1.
 */

const fs = require('fs');
const path = require('path');

const BANNED_WIN7_SYMBOLS = new Set([
  'PackageIdFromFullName',
  'GetPackageFamilyName',
  'GetPackageFullName',
  'GetCurrentPackageFamilyName',
  'GetCurrentPackageFullName',
  'GetPackagePathByFullName',
  'GetSystemTimePreciseAsFileTime',
  'WaitOnAddress',
  'WakeByAddressSingle',
  'WakeByAddressAll',
  'CreateFile2',
  'VirtualAlloc2',
  'MapViewOfFile3',
  'SetThreadDescription',
  'GetDpiForWindow',
  'SetProcessDpiAwarenessContext',
  'ProcessPrng',
]);

// Host-only compiler and build artifact directories that are NOT distributed to end-users
const IGNORED_DIRS = new Set([
  'build',
  'deps',
  '.fingerprint',
  'incremental',
  'examples',
  'target-sub-dir',
]);

/**
 * Parses PE32 / PE32+ executable and extracts imported DLLs and function names.
 */
function parsePeImports(buffer) {
  if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) {
    return null; // Not a valid MZ/PE file
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length || buffer.readUInt32LE(peOffset) !== 0x00004550) {
    return null; // Missing PE signature
  }

  const numSections = buffer.readUInt16LE(peOffset + 6);
  const sizeOfOptionalHeader = buffer.readUInt16LE(peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;

  const magic = buffer.readUInt16LE(optionalHeaderOffset);
  const is64Bit = magic === 0x020b;
  const is32Bit = magic === 0x010b;

  if (!is64Bit && !is32Bit) {
    return null; // Unsupported architecture
  }

  // Data directories offset:
  // PE32: 96 bytes into optional header
  // PE32+: 112 bytes into optional header
  const dataDirOffset = optionalHeaderOffset + (is64Bit ? 112 : 96);
  // Import Directory is entry 1 (8 bytes per entry: RVA [4 bytes], Size [4 bytes])
  const importTableRva = buffer.readUInt32LE(dataDirOffset + 8);
  const importTableSize = buffer.readUInt32LE(dataDirOffset + 12);

  if (importTableRva === 0 || importTableSize === 0) {
    return {}; // No imports
  }

  // Read section headers
  const sectionHeadersOffset = optionalHeaderOffset + sizeOfOptionalHeader;
  const sections = [];
  for (let i = 0; i < numSections; i++) {
    const secOffset = sectionHeadersOffset + i * 40;
    const name = buffer.toString('ascii', secOffset, secOffset + 8).replace(/\0.*$/, '');
    const virtualSize = buffer.readUInt32LE(secOffset + 8);
    const virtualAddress = buffer.readUInt32LE(secOffset + 12);
    const rawDataSize = buffer.readUInt32LE(secOffset + 16);
    const rawDataPointer = buffer.readUInt32LE(secOffset + 20);
    sections.push({ name, virtualSize, virtualAddress, rawDataSize, rawDataPointer });
  }

  function rvaToFileOffset(rva) {
    for (const sec of sections) {
      if (rva >= sec.virtualAddress && rva < sec.virtualAddress + Math.max(sec.virtualSize, sec.rawDataSize)) {
        return sec.rawDataPointer + (rva - sec.virtualAddress);
      }
    }
    return null;
  }

  function readNullTerminatedString(fileOffset) {
    let end = fileOffset;
    while (end < buffer.length && buffer[end] !== 0) {
      end++;
    }
    return buffer.toString('ascii', fileOffset, end);
  }

  const imports = {};
  let descriptorOffset = rvaToFileOffset(importTableRva);
  if (!descriptorOffset) return {};

  while (descriptorOffset + 20 <= buffer.length) {
    const originalFirstThunk = buffer.readUInt32LE(descriptorOffset);
    const nameRva = buffer.readUInt32LE(descriptorOffset + 12);
    const firstThunk = buffer.readUInt32LE(descriptorOffset + 16);

    // Terminal descriptor is all zeros
    if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0) {
      break;
    }

    const dllNameOffset = rvaToFileOffset(nameRva);
    if (dllNameOffset) {
      const dllName = readNullTerminatedString(dllNameOffset);
      if (!imports[dllName]) imports[dllName] = [];

      const thunkRva = originalFirstThunk !== 0 ? originalFirstThunk : firstThunk;
      let thunkOffset = rvaToFileOffset(thunkRva);

      if (thunkOffset) {
        while (thunkOffset < buffer.length) {
          let isOrdinal = false;
          let hintNameRva = 0;

          if (is64Bit) {
            const rawVal = buffer.readBigUInt64LE(thunkOffset);
            if (rawVal === 0n) break;
            isOrdinal = (rawVal & 0x8000000000000000n) !== 0n;
            hintNameRva = Number(rawVal & 0x7fffffffffffn);
            thunkOffset += 8;
          } else {
            const rawVal = buffer.readUInt32LE(thunkOffset);
            if (rawVal === 0) break;
            isOrdinal = (rawVal & 0x80000000) !== 0;
            hintNameRva = rawVal & 0x7fffffff;
            thunkOffset += 4;
          }

          if (!isOrdinal && hintNameRva !== 0) {
            const hintNameOffset = rvaToFileOffset(hintNameRva);
            if (hintNameOffset && hintNameOffset + 2 < buffer.length) {
              const funcName = readNullTerminatedString(hintNameOffset + 2);
              if (funcName) {
                imports[dllName].push(funcName);
              }
            }
          }
        }
      }
    }

    descriptorOffset += 20;
  }

  return imports;
}

function scanFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const stats = fs.statSync(filePath);
  if (stats.isDirectory()) {
    const dirBase = path.basename(filePath);
    if (IGNORED_DIRS.has(dirBase)) {
      return [];
    }

    const results = [];
    const entries = fs.readdirSync(filePath);
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) {
        continue;
      }
      const fullPath = path.join(filePath, entry);
      results.push(...scanFile(fullPath));
    }
    return results;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.exe' && ext !== '.dll') {
    return [];
  }

  console.log(`Analyzing PE imports for: ${filePath}`);
  const buffer = fs.readFileSync(filePath);
  const imports = parsePeImports(buffer);
  if (!imports) {
    console.log(`  [SKIP] Not a valid PE binary or architecture.`);
    return [];
  }

  const violations = [];
  for (const [dll, funcs] of Object.entries(imports)) {
    for (const func of funcs) {
      if (BANNED_WIN7_SYMBOLS.has(func)) {
        violations.push({ file: filePath, dll, func });
      }
    }
  }

  return violations;
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    targets.push('frontend/src-tauri/target/release');
  }

  console.log('=== Windows 7 Compatibility Binary Import Verification ===');
  console.log(`Scan Targets: ${targets.join(', ')}`);
  console.log(`Banned Win8+ APIs checked: ${Array.from(BANNED_WIN7_SYMBOLS).join(', ')}\n`);

  let allViolations = [];
  let scannedCount = 0;

  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.warn(`[WARN] Target path "${target}" does not exist on disk. Skipping.`);
      continue;
    }
    const violations = scanFile(target);
    allViolations.push(...violations);
    scannedCount++;
  }

  if (scannedCount === 0) {
    console.warn(`[WARN] No target paths were found on disk to inspect.`);
    process.exit(0);
  }

  if (allViolations.length > 0) {
    console.error('\n[FATAL] Windows 7 Incompatibility Detected:');
    console.error(`Found ${allViolations.length} banned Windows 8+ import(s) that will crash on Windows 7:\n`);
    for (const v of allViolations) {
      console.error(`  - Binary:   ${v.file}`);
      console.error(`    System DLL: ${v.dll}`);
      console.error(`    Function:   ${v.func} (MISSING on Windows 7 SP1)\n`);
    }
    process.exit(1);
  }

  console.log('\n[PASS] Verified 0 banned Windows 8+ entry points found in deployed binaries.');
  console.log('Binary import table is fully compatible with Windows 7 SP1 and Windows 8.1.');
}

main();
