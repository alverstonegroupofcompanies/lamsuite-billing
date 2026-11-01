#!/usr/bin/env node

/**
 * Reconciles and verifies the unified latest.json manifest for Tauri auto-updater.
 * Inspects all uploaded assets on the GitHub release, extracts signature contents,
 * and uploads/updates latest.json so all platforms (Windows, macOS ARM/Intel, Linux) are present.
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

  const assets = release.assets || [];
  console.log(`Release has ${assets.length} total assets.`);

  let manifest = {
    version: release.tag_name ? release.tag_name.replace(/^v/, '') : '',
    notes: release.body || `LamSuite Billing update ${release.tag_name}`,
    pub_date: release.published_at || release.created_at || new Date().toISOString(),
    platforms: {},
  };

  // Check if latest.json already exists in assets
  const existingLatest = assets.find(a => a.name === 'latest.json');
  if (existingLatest) {
    try {
      const current = await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/assets/${existingLatest.id}`, 'GET', null, {
        Accept: 'application/octet-stream',
      });
      if (current && typeof current === 'object' && current.platforms) {
        manifest = current;
      }
    } catch (e) {
      console.warn('Could not read existing latest.json, building fresh manifest:', e.message);
    }
  }

  const UPDATES_BASE_URL = (process.env.UPDATES_BASE_URL || 'https://updates.lamstonehealthcare.com').replace(/\/+$/, '');

  // Map asset extensions to platforms
  for (const asset of assets) {
    const name = asset.name;
    const downloadUrl = `${UPDATES_BASE_URL}/${name}`;

    // Windows (NSIS or MSI update zip)
    if (name.endsWith('.nsis.zip') || (name.endsWith('.zip') && !name.endsWith('.app.tar.gz') && !name.endsWith('.AppImage.tar.gz'))) {
      const sigAsset = assets.find(a => a.name === `${name}.sig`);
      if (sigAsset && (!manifest.platforms['windows-x86_64'] || !manifest.platforms['windows-x86_64'].signature)) {
        console.log(`Fetching signature for windows-x86_64 from ${sigAsset.name}...`);
        const sig = await downloadRaw(sigAsset.url);
        manifest.platforms['windows-x86_64'] = {
          signature: sig,
          url: downloadUrl,
        };
      }
    }

    // macOS Apple Silicon
    if (name.includes('aarch64') && name.endsWith('.app.tar.gz')) {
      const sigAsset = assets.find(a => a.name === `${name}.sig`);
      if (sigAsset && (!manifest.platforms['darwin-aarch64'] || !manifest.platforms['darwin-aarch64'].signature)) {
        console.log(`Fetching signature for darwin-aarch64 from ${sigAsset.name}...`);
        const sig = await downloadRaw(sigAsset.url);
        manifest.platforms['darwin-aarch64'] = {
          signature: sig,
          url: downloadUrl,
        };
      }
    }

    // macOS Intel / Universal
    if ((name.includes('x64') || name.includes('x86_64') || name.includes('universal')) && name.endsWith('.app.tar.gz')) {
      const sigAsset = assets.find(a => a.name === `${name}.sig`);
      if (sigAsset && (!manifest.platforms['darwin-x86_64'] || !manifest.platforms['darwin-x86_64'].signature)) {
        console.log(`Fetching signature for darwin-x86_64 from ${sigAsset.name}...`);
        const sig = await downloadRaw(sigAsset.url);
        manifest.platforms['darwin-x86_64'] = {
          signature: sig,
          url: downloadUrl,
        };
      }
    }

    // Linux
    if (name.endsWith('.AppImage.tar.gz')) {
      const sigAsset = assets.find(a => a.name === `${name}.sig`);
      if (sigAsset && (!manifest.platforms['linux-x86_64'] || !manifest.platforms['linux-x86_64'].signature)) {
        console.log(`Fetching signature for linux-x86_64 from ${sigAsset.name}...`);
        const sig = await downloadRaw(sigAsset.url);
        manifest.platforms['linux-x86_64'] = {
          signature: sig,
          url: downloadUrl,
        };
      }
    }
  }

  console.log('\nConsolidated latest.json platforms:', Object.keys(manifest.platforms));
  fs.writeFileSync('latest.json', JSON.stringify(manifest, null, 2), 'utf8');

  // If latest.json asset exists, delete old one before re-uploading
  if (existingLatest) {
    console.log(`Deleting previous latest.json asset (ID: ${existingLatest.id})...`);
    await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/assets/${existingLatest.id}`, 'DELETE');
  }

  // Upload new latest.json
  const uploadUrl = release.upload_url.replace(/\{(\?.*)?\}/, '');
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

    const legacyManifest = {
      version: release.tag_name ? release.tag_name.replace(/^v/, '') : '',
      notes: release.body || `LamSuite Billing Legacy Windows 7/8.1 update ${release.tag_name}`,
      pub_date: release.published_at || release.created_at || new Date().toISOString(),
      platforms: {
        'windows-x86_64': {
          signature: legacySig,
          url: `${UPDATES_BASE_URL}/${legacySetupAsset.name}`,
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
  console.error('[ERROR] Reconciling latest.json failed:', err);
  process.exit(1);
});
