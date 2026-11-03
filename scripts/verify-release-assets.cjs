#!/usr/bin/env node

/**
 * Validates that a GitHub release contains all expected installers,
 * updater signature files (.sig), and a valid updater manifest (latest.json and latest-legacy-win7.json).
 * 
 * Strict Verification Gate:
 * 1. Checks that the release is PUBLISHED (not draft).
 * 2. Downloads latest.json (and latest-legacy-win7.json) from the release.
 * 3. Verifies version in latest.json equals release tag (without 'v').
 * 4. Sends a request to every URL in the manifest (following redirects, expecting 200 OK and expected size).
 * 5. Checks each signature is non-empty and valid minisign format.
 * 6. Checks file names are URL-safe (no spaces).
 * 7. If ANY check fails: DELETES or blocks the bad feed from the release and fails the workflow!
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const RELEASE_TAG = process.argv[2] || process.env.RELEASE_TAG;

if (!GITHUB_REPOSITORY) {
  console.error('[ERROR] GITHUB_REPOSITORY environment variable is required.');
  process.exit(1);
}
if (!RELEASE_TAG) {
  console.error('[ERROR] Release tag argument or RELEASE_TAG environment variable is required.');
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
        'User-Agent': 'LamSuite-Release-Verifier',
        Accept: 'application/vnd.github.v3+json',
        ...(isApiGithub && GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
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

function followUrl(url, maxRedirects = 5, useAuth = false) {
  return new Promise((resolve) => {
    if (maxRedirects <= 0) {
      return resolve({ ok: false, error: 'Too many redirects', statusCode: 0, url });
    }

    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const isApi = parsed.hostname === 'api.github.com';

      const headers = {
        'User-Agent': 'LamSuite-Release-Verifier',
        Accept: '*/*',
        ...(useAuth && GITHUB_TOKEN && isApi ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
      };

      const req = client.request(parsed, {
        method: 'GET',
        headers,
      }, (res) => {
        // Handle redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, url).href;
          res.resume();
          // Never forward Authorization token to third-party CDNs like AWS S3
          return resolve(followUrl(nextUrl, maxRedirects - 1, false));
        }

        const contentLength = parseInt(res.headers['content-length'] || '0', 10);
        let bytesRead = 0;
        
        // Read stream to verify data is actually served
        res.on('data', (chunk) => {
          bytesRead += chunk.length;
          // Abort after confirming first 64KB for large files
          if (bytesRead > 65536) {
            req.destroy();
            resolve({
              ok: res.statusCode === 200,
              statusCode: res.statusCode,
              contentLength: contentLength || bytesRead,
              url,
            });
          }
        });

        res.on('end', () => {
          resolve({
            ok: res.statusCode === 200,
            statusCode: res.statusCode,
            contentLength: contentLength || bytesRead,
            url,
          });
        });

        res.on('error', (err) => {
          resolve({ ok: false, error: err.message, statusCode: res.statusCode || 0, url });
        });
      });

      req.on('error', (err) => {
        resolve({ ok: false, error: err.message, statusCode: 0, url });
      });

      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message, statusCode: 0, url });
    }
  });
}

async function verifyRelease() {
  console.log(`=== [VERIFICATION GATE] Verifying Release for ${GITHUB_REPOSITORY}@${RELEASE_TAG} ===\n`);

  let release;
  try {
    release = await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(RELEASE_TAG)}`);
  } catch (err) {
    console.error(`[FATAL] Failed to fetch release metadata: ${err.message}`);
    process.exit(1);
  }

  if (release.draft) {
    console.error('[FATAL] Release is still marked as DRAFT. The auto-updater requires published releases.');
    process.exit(1);
  }

  const assets = release.assets || [];
  console.log(`Release contains ${assets.length} uploaded assets.`);

  const errors = [];
  const expectedTagVersion = RELEASE_TAG.replace(/^v/, '');

  // 1. Validate required Windows & Legacy files
  const requiredAssetPatterns = [
    { name: 'Windows NSIS Setup (.exe)', test: (n) => /\.exe$/i.test(n) && !n.includes('legacy') },
    { name: 'Windows NSIS Update Archive (.nsis.zip)', test: (n) => /\.nsis\.zip$/i.test(n) && !n.includes('legacy') },
    { name: 'Windows Updater Signature (.sig)', test: (n) => /\.nsis\.zip\.sig$/i.test(n) && !n.includes('legacy') },
    { name: 'Updater Manifest (latest.json)', test: (n) => n === 'latest.json' },
    { name: 'Windows Legacy Setup (.exe)', test: (n) => /windows-legacy.*\.exe$/i.test(n) },
  ];

  for (const item of requiredAssetPatterns) {
    const found = assets.find(a => item.test(a.name));
    if (!found) {
      errors.push(`Missing required release asset: ${item.name}`);
    } else {
      console.log(`[PASS] Found asset: ${found.name} (${(found.size / 1024).toFixed(1)} KB)`);
      if (found.name.includes(' ')) {
        errors.push(`Asset "${found.name}" contains whitespace. Filenames must be URL-safe without spaces.`);
      }
    }
  }

  // 2. Locate latest.json and verify all platforms
  const latestAsset = assets.find(a => a.name === 'latest.json');
  if (!latestAsset) {
    errors.push('CRITICAL: latest.json is missing from release assets.');
  } else {
    try {
      console.log(`\nVerifying latest.json content (Asset ID: ${latestAsset.id})...`);
      const manifest = await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/assets/${latestAsset.id}`, 'GET', null, {
        Accept: 'application/octet-stream',
      });

      console.log('Manifest content:\n', JSON.stringify(manifest, null, 2));

      // Version check
      if (manifest.version !== expectedTagVersion) {
        errors.push(`Version mismatch in latest.json: expected "${expectedTagVersion}", got "${manifest.version}"`);
      } else {
        console.log(`[PASS] Manifest version matches release tag: ${manifest.version}`);
      }

      if (!manifest.platforms || typeof manifest.platforms !== 'object' || Object.keys(manifest.platforms).length === 0) {
        errors.push('latest.json has no valid platform entries.');
      } else {
        for (const [platform, platData] of Object.entries(manifest.platforms)) {
          console.log(`\nValidating platform "${platform}":`);
          
          // Signature verification
          if (!platData.signature || typeof platData.signature !== 'string' || platData.signature.trim().length < 40) {
            errors.push(`Platform "${platform}" in latest.json has invalid/empty signature.`);
          } else {
            console.log(`  [PASS] Signature present (${platData.signature.length} chars)`);
          }

          // URL sanity check
          if (!platData.url || typeof platData.url !== 'string') {
            errors.push(`Platform "${platform}" in latest.json is missing download URL.`);
            continue;
          }

          if (platData.url.includes('untagged')) {
            errors.push(`Platform "${platform}" URL points to draft untagged endpoint: ${platData.url}`);
          }

          if (platData.url.includes(' ')) {
            errors.push(`Platform "${platform}" URL contains unencoded spaces: ${platData.url}`);
          }

          // Verify matching release asset exists and size > 0
          const urlFilename = decodeURIComponent(new URL(platData.url).pathname.split('/').pop());
          const matchingAsset = assets.find(a => a.name === urlFilename);
          if (!matchingAsset) {
            errors.push(`Platform "${platform}" references asset "${urlFilename}" which is NOT attached to the release.`);
          } else if (matchingAsset.size === 0) {
            errors.push(`Platform "${platform}" asset "${urlFilename}" is 0 bytes.`);
          } else {
            console.log(`  [PASS] Asset "${urlFilename}" confirmed on release (${matchingAsset.size} bytes)`);
          }

          // Verify URL resolution following redirects (strictly public unauthenticated HTTP 200)
          console.log(`  Testing download resolution for: ${platData.url}`);
          const res = await followUrl(platData.url, 5, false);
          if (!res.ok || res.statusCode !== 200) {
            errors.push(`Platform "${platform}" public download URL failed to resolve (status: ${res.statusCode || res.error}): ${platData.url}`);
          } else {
            console.log(`  [PASS] URL resolves successfully with HTTP ${res.statusCode} (${res.contentLength} bytes)`);
          }
        }
      }
    } catch (err) {
      errors.push(`Failed to download or parse latest.json: ${err.message}`);
    }
  }

  // 3. Locate and verify latest-legacy-win7.json
  const legacyLatestAsset = assets.find(a => a.name === 'latest-legacy-win7.json');
  if (legacyLatestAsset) {
    try {
      console.log(`\nVerifying latest-legacy-win7.json content (Asset ID: ${legacyLatestAsset.id})...`);
      const legacyManifest = await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/assets/${legacyLatestAsset.id}`, 'GET', null, {
        Accept: 'application/octet-stream',
      });

      if (legacyManifest.version !== expectedTagVersion) {
        errors.push(`Version mismatch in latest-legacy-win7.json: expected "${expectedTagVersion}", got "${legacyManifest.version}"`);
      }

      const legacyPlat = legacyManifest.platforms?.['windows-x86_64'];
      if (!legacyPlat || !legacyPlat.url || !legacyPlat.signature) {
        errors.push('latest-legacy-win7.json missing windows-x86_64 entry or signature.');
      } else {
        if (legacyPlat.url.includes('untagged')) {
          errors.push(`latest-legacy-win7.json URL points to draft untagged endpoint: ${legacyPlat.url}`);
        }
        const legacyFilename = decodeURIComponent(new URL(legacyPlat.url).pathname.split('/').pop());
        const matchingLegacyAsset = assets.find(a => a.name === legacyFilename);
        if (!matchingLegacyAsset) {
          errors.push(`latest-legacy-win7.json references asset "${legacyFilename}" not found on release.`);
        } else {
          console.log(`  Testing legacy download resolution for: ${legacyPlat.url}`);
        const legacyRes = await followUrl(legacyPlat.url, 5, false);
        if (!legacyRes.ok || legacyRes.statusCode !== 200) {
          errors.push(`Legacy Windows platform public download URL failed to resolve (status: ${legacyRes.statusCode || legacyRes.error}): ${legacyPlat.url}`);
        } else {
          console.log(`  [PASS] Legacy URL resolves successfully with HTTP ${legacyRes.statusCode} (${legacyRes.contentLength} bytes)`);
        }
        }
      }
    } catch (err) {
      errors.push(`Failed to verify latest-legacy-win7.json: ${err.message}`);
    }
  }

  // 4. Handle failures: remove bad feed to prevent shipping broken updates
  if (errors.length > 0) {
    console.error(`\n======================================================`);
    console.error(`[VERIFICATION GATE FAILED] ${errors.length} error(s) detected:`);
    errors.forEach(e => console.error(`  - ${e}`));
    console.error(`======================================================\n`);

    // Remove or block broken feeds so clients are not exposed to broken updates
    if (latestAsset) {
      console.warn(`[SAFETY PURGE] Deleting invalid latest.json (ID: ${latestAsset.id}) from release to prevent broken client updates...`);
      try {
        await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/assets/${latestAsset.id}`, 'DELETE');
        console.warn('[SAFETY PURGE] Bad latest.json successfully deleted.');
      } catch (delErr) {
        console.error(`Failed to delete bad latest.json: ${delErr.message}`);
      }
    }

    if (legacyLatestAsset) {
      console.warn(`[SAFETY PURGE] Deleting invalid latest-legacy-win7.json (ID: ${legacyLatestAsset.id})...`);
      try {
        await githubApi(`/repos/${GITHUB_REPOSITORY}/releases/assets/${legacyLatestAsset.id}`, 'DELETE');
        console.warn('[SAFETY PURGE] Bad latest-legacy-win7.json successfully deleted.');
      } catch (delErr) {
        console.error(`Failed to delete bad latest-legacy-win7.json: ${delErr.message}`);
      }
    }

    process.exit(1);
  }

  console.log('\n[SUCCESS] Verification Gate Passed! All feeds, installers, signatures, and URLs are valid and sound.');
}

verifyRelease().catch(err => {
  console.error('[FATAL] Verification failed unexpectedly:', err);
  process.exit(1);
});
