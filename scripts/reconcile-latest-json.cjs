#!/usr/bin/env node

/**
 * Reconciles and verifies the unified latest.json manifest for Tauri auto-updater.
 * Inspects all uploaded assets on the GitHub release, extracts signature contents,
 * and uploads/updates latest.json with final public URLs.
 * 
 * Guarantees:
 * 1. Fails immediately if the release is still marked as a DRAFT.
 * 2. Merges entries from the current run only (never preserves stale entries from previous runs).
 * 3. Builds canonical, URL-safe download URLs using the published release tag.
 * 4. Reconciles both standard latest.json and legacy latest-legacy-win7.json.
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const RELEASE_ID = process.env.RELEASE_ID;
const RELEASE_TAG = process.env.RELEASE_TAG;

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.error('[ERROR] GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
  process.exit(1);
}

function githubApi(endpoint, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`;
    const parsed = new URL(url);
    const isApiGithub = parsed.hostname === 'api.github.com';
    const req = https.request(parsed, {
      method,
      headers: {
        'User-Agent': 'LamSuite-Updater-Reconciler',
        Accept: 'application/vnd.github.v3+json',
        ...(isApiGithub ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
        ...headers,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(githubApi(res.headers.location, method, body, headers));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}: ${data}`));
        }
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function downloadRaw(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const isApiGithub = parsed.hostname === 'api.github.com';
    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': 'LamSuite-Updater-Reconciler',
        Accept: 'application/octet-stream',
        ...(isApiGithub ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadRaw(res.headers.location));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
        }
        resolve(data.trim());
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log(`Reconciling latest.json for release ID: ${RELEASE_ID || RELEASE_TAG}...`);
  const release = await githubApi(RELEASE_ID ? `/repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}` : `/repos/${GITHUB_REPOSITORY}/releases/tags/${RELEASE_TAG}`);

  if (release.draft) {
    throw new Error(`CRITICAL: Release ${release.tag_name || RELEASE_ID} is still marked as DRAFT. The release must be published before reconciling updater manifests so URLs are permanent and public.`);
  }

  const tagName = release.tag_name;
  if (!tagName || tagName.includes('untagged')) {
    throw new Error(`CRITICAL: Invalid release tag name "${tagName}". Must be a valid published tag.`);
  }

  const assets = release.assets || [];
  console.log(`Published release ${tagName} has ${assets.length} total assets.`);

  // Build clean manifest for current run ONLY (never merge from older runs)
  const manifest = {
    version: tagName.replace(/^v/, ''),
    notes: release.body || `LamSuite Billing update ${tagName}`,
    pub_date: release.published_at || new Date().toISOString(),
    platforms: {},
  };

  const uploadUrl = release.upload_url.replace(/\{(\?.*)?\}/, '');

  // Map asset extensions to platforms using canonical public URLs
  for (const asset of assets) {
    const name = asset.name;

    // Safety check: ensure file names are URL-safe
    if (name.includes(' ')) {
      console.warn(`[WARNING] Asset "${name}" contains spaces! Ensure product and artifact names avoid spaces.`);
    }

    const publicDownloadUrl = `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tagName}/${encodeURIComponent(name).replace(/%2E/g, '.')}`;

    // Standard Windows x86_64
    if (
      (name.endsWith('.nsis.zip') || (name.endsWith('.zip') && !name.endsWith('.app.tar.gz') && !name.endsWith('.AppImage.tar.gz'))) &&
      !name.toLowerCase().includes('legacy')
    ) {
      const sigAsset = assets.find(a => a.name === `${name}.sig`);
      if (sigAsset) {
        console.log(`Fetching signature for windows-x86_64 from ${sigAsset.name}...`);
        const sig = await downloadRaw(sigAsset.url);
        if (sig && sig.length > 0) {
          manifest.platforms['windows-x86_64'] = {
            signature: sig,
            url: publicDownloadUrl,
          };
          manifest.platforms['windows-x86_64-nsis'] = {
            signature: sig,
            url: publicDownloadUrl,
          };
        }
      }
    }

    // macOS Apple Silicon
    if (name.includes('aarch64') && name.endsWith('.app.tar.gz')) {
      const sigAsset = assets.find(a => a.name === `${name}.sig`);
      if (sigAsset) {
        console.log(`Fetching signature for darwin-aarch64 from ${sigAsset.name}...`);
        const sig = await downloadRaw(sigAsset.url);
        if (sig && sig.length > 0) {
          manifest.platforms['darwin-aarch64'] = {
            signature: sig,
            url: publicDownloadUrl,
          };
        }
      }
    }

    // macOS Intel / Universal
    if ((name.includes('x64') || name.includes('x86_64') || name.includes('universal')) && name.endsWith('.app.tar.gz') && !name.includes('aarch64')) {
      const sigAsset = assets.find(a => a.name === `${name}.sig`);
      if (sigAsset) {
        console.log(`Fetching signature for darwin-x86_64 from ${sigAsset.name}...`);
        const sig = await downloadRaw(sigAsset.url);
        if (sig && sig.length > 0) {
          manifest.platforms['darwin-x86_64'] = {
            signature: sig,
            url: publicDownloadUrl,
          };
        }
      }
    }

    // Linux x86_64
    if (name.endsWith('.AppImage.tar.gz')) {
      const sigAsset = assets.find(a => a.name === `${name}.sig`);
      if (sigAsset) {
        console.log(`Fetching signature for linux-x86_64 from ${sigAsset.name}...`);
        const sig = await downloadRaw(sigAsset.url);
        if (sig && sig.length > 0) {
          manifest.platforms['linux-x86_64'] = {
            signature: sig,
            url: publicDownloadUrl,
          };
        }
      }
    }
  }

  console.log('\nConsolidated latest.json platforms (current run only):', Object.keys(manifest.platforms));
  if (Object.keys(manifest.platforms).length === 0) {
    throw new Error('CRITICAL: No valid platforms with non-empty signatures were detected in current release assets.');
  }

  fs.writeFileSync('latest.json', JSON.stringify(manifest, null, 2), 'utf8');

  // If latest.json asset already exists, delete old one before re-uploading
  const existingLatest = assets.find(a => a.name === 'latest.json');
  if (existingLatest) {
    console.log(`Deleting previous latest.json asset (ID: ${existingLatest.id})...`);
    await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/assets/${existingLatest.id}`, 'DELETE');
  }

  // Upload new latest.json
  const manifestData = fs.readFileSync('latest.json');
  console.log(`Uploading consolidated latest.json to ${uploadUrl}...`);

  await new Promise((resolve, reject) => {
    const parsed = new URL(`${uploadUrl}?name=latest.json`);
    const req = https.request(parsed, {
      method: 'POST',
      headers: {
        'User-Agent': 'LamSuite-Updater-Reconciler',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': manifestData.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[SUCCESS] Uploaded consolidated latest.json!');
          resolve();
        } else {
          reject(new Error(`Upload failed (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(manifestData);
    req.end();
  });

  // Reconcile and upload dedicated legacy manifest (latest-legacy-win7.json)
  const legacyZipAsset = assets.find(a => /windows-legacy.*\.nsis\.zip$/i.test(a.name) || /windows-legacy.*\.zip$/i.test(a.name));
  const legacySetupAsset = legacyZipAsset || assets.find(a => /windows-legacy.*\.exe$/i.test(a.name));
  const legacySigAsset = assets.find(a => /windows-legacy.*\.sig$/i.test(a.name));
  const existingLegacyLatest = assets.find(a => a.name === 'latest-legacy-win7.json');

  if (legacySetupAsset) {
    console.log(`\nReconciling latest-legacy-win7.json for ${legacySetupAsset.name}...`);
    let legacySig = '';
    if (legacySigAsset) {
      console.log(`Fetching legacy signature from ${legacySigAsset.name}...`);
      legacySig = await downloadRaw(legacySigAsset.url);
    }

    if (!legacySig) {
      throw new Error(`CRITICAL: Legacy asset ${legacySetupAsset.name} exists but signature is missing or empty!`);
    }

    const legacyDownloadUrl = `https://github.com/${GITHUB_REPOSITORY}/releases/download/${tagName}/${encodeURIComponent(legacySetupAsset.name).replace(/%2E/g, '.')}`;

    const legacyManifest = {
      version: tagName.replace(/^v/, ''),
      notes: release.body || `LamSuite Billing Legacy Windows 7/8.1 update ${tagName}`,
      pub_date: release.published_at || new Date().toISOString(),
      platforms: {
        'windows-x86_64': {
          signature: legacySig,
          url: legacyDownloadUrl,
        },
      },
    };

    fs.writeFileSync('latest-legacy-win7.json', JSON.stringify(legacyManifest, null, 2), 'utf8');

    if (existingLegacyLatest) {
      console.log(`Deleting previous latest-legacy-win7.json asset (ID: ${existingLegacyLatest.id})...`);
      await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/assets/${existingLegacyLatest.id}`, 'DELETE');
    }

    const legacyData = fs.readFileSync('latest-legacy-win7.json');
    console.log(`Uploading latest-legacy-win7.json to ${uploadUrl}...`);

    await new Promise((resolve, reject) => {
      const parsed = new URL(`${uploadUrl}?name=latest-legacy-win7.json`);
      const req = https.request(parsed, {
        method: 'POST',
        headers: {
          'User-Agent': 'LamSuite-Updater-Reconciler',
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': legacyData.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[SUCCESS] Uploaded latest-legacy-win7.json!');
            resolve();
          } else {
            reject(new Error(`Legacy manifest upload failed (${res.statusCode}): ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.write(legacyData);
      req.end();
    });
  }
}

run().catch(err => {
  console.error('[ERROR] Reconciling manifests failed:', err.message);
  process.exit(1);
});
