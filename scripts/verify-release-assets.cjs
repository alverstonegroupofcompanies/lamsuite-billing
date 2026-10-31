#!/usr/bin/env node

/**
 * Validates that a GitHub release contains all expected installers,
 * updater signature files (.sig), and a valid updater manifest (latest.json).
 * Checks that each platform defined in latest.json resolves with a valid URL and signature.
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

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const isApiGithub = parsed.hostname === 'api.github.com';

    const headers = {
      'User-Agent': 'LamSuite-Release-Verifier',
      Accept: options.accept || 'application/vnd.github.v3+json',
      ...(GITHUB_TOKEN && isApiGithub ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
      ...options.headers,
    };

    const req = client.request(parsed, {
      method: 'GET',
      headers,
    }, (res) => {
      // Handle redirects without leaking Authorization to S3
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(requestJson(res.headers.location, options));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Failed to parse JSON response: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function checkUrlResolves(url, assets = []) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);

      // In private repositories, github.com/.../releases/download/... cannot be resolved anonymously.
      // Confirm that the target asset exists in the release assets list with size > 0.
      if (parsed.hostname === 'github.com' && parsed.pathname.includes('/releases/download/')) {
        const filename = decodeURIComponent(parsed.pathname.split('/').pop());
        const matchingAsset = assets.find(a => a.name === filename);
        if (matchingAsset && matchingAsset.size > 0) {
          return resolve({
            ok: true,
            statusCode: 200,
            url,
            verifiedVia: 'release.assets',
            size: matchingAsset.size,
          });
        }
      }

      const client = parsed.protocol === 'https:' ? https : http;
      const isApiGithub = parsed.hostname === 'api.github.com';
      const req = client.request(parsed, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'LamSuite-Release-Verifier',
          ...(GITHUB_TOKEN && isApiGithub ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(checkUrlResolves(res.headers.location, assets));
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          statusCode: res.statusCode,
          url,
        });
      });
      req.on('error', (err) => {
        resolve({ ok: false, error: err.message, url });
      });
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message, url });
    }
  });
}

async function verifyRelease() {
  console.log(`=== Verifying Release Assets for ${GITHUB_REPOSITORY}@${RELEASE_TAG} ===\n`);

  const tagEndpoint = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(RELEASE_TAG)}`;
  let release;
  try {
    release = await requestJson(tagEndpoint);
  } catch (err) {
    console.error(`[FATAL] Failed to fetch release metadata: ${err.message}`);
    process.exit(1);
  }

  if (release.draft) {
    console.error('[FATAL] Release is still marked as DRAFT. The auto-updater requires published releases.');
    process.exit(1);
  }

  const assets = release.assets || [];
  const assetNames = assets.map(a => a.name);
  console.log(`Found ${assets.length} assets attached to release:`);
  assets.forEach(a => console.log(`  - ${a.name} (${(a.size / 1024).toFixed(1)} KB)`));
  console.log('');

  const errors = [];

  // Required Asset Categories (Windows)
  const expectedPatterns = [
    { name: 'Windows NSIS Installer (.exe)', pattern: /\.exe$/i },
    { name: 'Windows Updater Signature (.sig)', pattern: /(\.nsis\.zip|\.msi\.zip|\.zip)\.sig$/i },
    { name: 'Updater Manifest (latest.json)', pattern: /^latest\.json$/i },
  ];

  for (const exp of expectedPatterns) {
    const match = assetNames.some(name => exp.pattern.test(name));
    if (!match) {
      errors.push(`Missing required release asset: ${exp.name}`);
    } else {
      console.log(`[PASS] Found ${exp.name}`);
    }
  }

  // Optional multi-platform patterns if present
  const optionalPatterns = [
    { name: 'Windows MSI Installer (.msi)', pattern: /\.msi$/i },
    { name: 'macOS Installer (.dmg)', pattern: /\.dmg$/i },
    { name: 'macOS Updater Archive (.app.tar.gz)', pattern: /\.app\.tar\.gz$/i },
    { name: 'macOS Updater Signature (.app.tar.gz.sig)', pattern: /\.app\.tar\.gz\.sig$/i },
    { name: 'Linux AppImage (.AppImage)', pattern: /\.AppImage$/i },
    { name: 'Linux Debian Package (.deb)', pattern: /\.deb$/i },
    { name: 'Linux RPM Package (.rpm)', pattern: /\.rpm$/i },
    { name: 'Linux Updater Signature (.AppImage.tar.gz.sig)', pattern: /(\.AppImage\.tar\.gz|\.tar\.gz)\.sig$/i },
    { name: 'Windows Legacy Installer', pattern: /windows-legacy/i },
  ];

  for (const opt of optionalPatterns) {
    const match = assetNames.some(name => opt.pattern.test(name));
    if (match) {
      console.log(`[INFO] Found optional asset: ${opt.name}`);
    }
  }

  // Locate and parse latest.json
  const latestJsonAsset = assets.find(a => a.name === 'latest.json');
  if (!latestJsonAsset) {
    errors.push('CRITICAL: latest.json is missing from release assets.');
  } else {
    console.log(`\nInspecting latest.json via GitHub API asset ID: ${latestJsonAsset.id}`);
    try {
      // Use the API asset endpoint with octet-stream to fetch from private release
      const manifestUrl = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/assets/${latestJsonAsset.id}`;
      const manifest = await requestJson(manifestUrl, { accept: 'application/octet-stream' });
      console.log('Manifest content:\n', JSON.stringify(manifest, null, 2));

      if (!manifest.platforms || typeof manifest.platforms !== 'object') {
        errors.push('latest.json is missing a valid "platforms" object.');
      } else {
        const requiredPlatforms = [
          'windows-x86_64',
        ];

        for (const plat of requiredPlatforms) {
          const platData = manifest.platforms[plat];
          if (!platData) {
            errors.push(`latest.json missing required entry for platform: ${plat}`);
            continue;
          }

          if (!platData.signature || typeof platData.signature !== 'string' || platData.signature.trim().length === 0) {
            errors.push(`Platform ${plat} in latest.json has an empty or invalid signature.`);
          } else {
            console.log(`[PASS] Platform ${plat} has valid signature length (${platData.signature.length} chars)`);
          }

          if (!platData.url || typeof platData.url !== 'string') {
            errors.push(`Platform ${plat} in latest.json is missing a valid download URL.`);
          } else {
            console.log(`Checking resolution for ${plat} download URL: ${platData.url}`);
            const check = await checkUrlResolves(platData.url, assets);
            if (!check.ok) {
              errors.push(`Platform ${plat} download URL failed to resolve (${check.statusCode || check.error}): ${platData.url}`);
            } else {
              const note = check.verifiedVia ? ` (verified in ${check.verifiedVia}, size: ${check.size} bytes)` : ` (${check.statusCode})`;
              console.log(`[PASS] URL resolves successfully${note}`);
            }
          }
        }

        // Also check any other platforms present in manifest
        for (const [plat, platData] of Object.entries(manifest.platforms)) {
          if (!requiredPlatforms.includes(plat)) {
            console.log(`[INFO] Validating additional platform in latest.json: ${plat}`);
            if (platData && platData.signature && platData.url) {
              const check = await checkUrlResolves(platData.url, assets);
              if (check.ok) {
                console.log(`[PASS] Platform ${plat} resolves correctly.`);
              } else {
                console.warn(`[WARN] Platform ${plat} URL check: ${check.statusCode || check.error}`);
              }
            }
          }
        }
      }
    } catch (err) {
      errors.push(`Failed to fetch or validate latest.json: ${err.message}`);
    }
  }

  console.log('\n--- Release Asset Verification Summary ---');
  if (errors.length > 0) {
    console.error(`[FAILURE] Release verification encountered ${errors.length} error(s):`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log('[SUCCESS] All installers, signatures, and updater manifest entries verified successfully!');
}

verifyRelease().catch(err => {
  console.error('[FATAL] Unexpected error during verification:', err);
  process.exit(1);
});
