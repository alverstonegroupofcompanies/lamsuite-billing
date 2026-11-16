/**
 * Tauri Desktop End-to-End Test Suite using W3C WebDriver / tauri-driver
 * 
 * Flows Tested:
 * 1. Store Login / Activation
 * 2. Staff Login (Cashier / Manager PIN Auth)
 * 3. Billing Flow (Item search, pack/loose unit, tax, payment)
 * 4. Print to PDF (Receipt PDF generation & print job dispatch)
 * 5. Update Check against Mock Feed (Tauri updater schema validation)
 * 
 * Target Platforms:
 * - Windows 10/11: tauri-driver with msedgedriver.exe
 * - Linux (Ubuntu 22.04+): tauri-driver with WebKitWebDriver
 * - macOS: Platform diagnostic & webview test runner
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// Platform Capabilities configuration for WebDriver
const DRIVER_CONFIGS = {
  windows: {
    driverUrl: 'http://127.0.0.1:4444',
    capabilities: {
      'tauri:options': {
        application: path.resolve(__dirname, '../../frontend/src-tauri/target/release/LamSuite-Billing.exe')
      },
      browserName: 'wry'
    }
  },
  linux: {
    driverUrl: 'http://127.0.0.1:4444',
    capabilities: {
      'tauri:options': {
        application: path.resolve(__dirname, '../../frontend/src-tauri/target/release/LamSuite-Billing')
      },
      browserName: 'wry'
    }
  },
  macos: {
    driverUrl: 'http://127.0.0.1:4444',
    notes: 'macOS WKWebView does not natively bind to safaridriver without specialized entitlements. Use web mock runner or execute in Windows/Linux runner.'
  }
};

/**
 * Mock Update Feed Server for Flow 5
 */
function createMockUpdateServer(port = 8899) {
  const updatePayload = {
    version: '2.0.37',
    date: new Date().toISOString(),
    notes: 'QA Release 2.0.37 - Critical tax calculation hotfix and stability updates',
    pub_date: new Date().toISOString(),
    platforms: {
      'darwin-aarch64': {
        signature: 'mock_signature_base64==',
        url: `http://127.0.0.1:${port}/downloads/lamsuite_2.0.37_aarch64.tar.gz`
      },
      'windows-x86_64': {
        signature: 'mock_signature_base64==',
        url: `http://127.0.0.1:${port}/downloads/lamsuite_2.0.37_x64_en-US.msi.zip`
      },
      'linux-x86_64': {
        signature: 'mock_signature_base64==',
        url: `http://127.0.0.1:${port}/downloads/lamsuite_2.0.37_amd64.AppImage.tar.gz`
      }
    }
  };

  const server = http.createServer((req, res) => {
    if (req.url === '/api/app/update/latest.json' || req.url === '/update.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updatePayload));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port, payload: updatePayload });
    });
  });
}

/**
 * Standard WebDriver client implementation for Tauri desktop apps
 */
class TauriWebDriverClient {
  constructor(baseUrl = 'http://127.0.0.1:4444') {
    this.baseUrl = baseUrl;
    this.sessionId = null;
  }

  async request(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const postData = body ? JSON.stringify(body) : null;
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json'
        }
      };
      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });

      req.on('error', (err) => reject(err));
      if (postData) req.write(postData);
      req.end();
    });
  }

  async startSession(capabilities) {
    const res = await this.request('POST', '/session', { capabilities: { alwaysMatch: capabilities } });
    if (res.status === 200 && res.data && res.data.value) {
      this.sessionId = res.data.value.sessionId;
      return this.sessionId;
    }
    throw new Error(`Failed to create session: ${JSON.stringify(res.data)}`);
  }

  async stopSession() {
    if (this.sessionId) {
      await this.request('DELETE', `/session/${this.sessionId}`);
      this.sessionId = null;
    }
  }

  async findElement(selector) {
    const res = await this.request('POST', `/session/${this.sessionId}/element`, {
      using: 'css selector',
      value: selector
    });
    return res.data ? res.data.value : null;
  }

  async clickElement(elementId) {
    return await this.request('POST', `/session/${this.sessionId}/element/${elementId}/click`, {});
  }

  async sendKeys(elementId, text) {
    return await this.request('POST', `/session/${this.sessionId}/element/${elementId}/value`, {
      text: text,
      value: text.split('')
    });
  }
}

module.exports = {
  DRIVER_CONFIGS,
  createMockUpdateServer,
  TauriWebDriverClient
};
