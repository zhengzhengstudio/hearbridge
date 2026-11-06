'use strict';

const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(projectRoot, 'release', 'web-desktop');
const evidencePath = path.join(projectRoot, 'build-evidence', 'web-asset-partition.json');
const screenshotRoot = path.join(projectRoot, '..', 'docs', 'spacefight', 'screenshots');
const captureStamp = process.env.SPACEFIGHT_CAPTURE_STAMP || '2026-08-04-cocos';
const chrome = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const contentTypes = {
  '.bin': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

function startServer() {
  const server = createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
    const absolute = path.resolve(releaseRoot, relative);
    if (!absolute.startsWith(`${releaseRoot}${path.sep}`) || !existsSync(absolute) || !statSync(absolute).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    const body = readFileSync(absolute);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(absolute)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

class DevToolsClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }
}

function launchChrome(profileRoot) {
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileRoot}`,
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const debuggerUrl = new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chrome DevTools endpoint timed out')), 15000);
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready (${code})`));
    });
  });
  return { child, debuggerUrl };
}

async function pageClient(browserWebSocketUrl) {
  const endpoint = new URL(browserWebSocketUrl);
  const targets = await (await fetch(`http://${endpoint.host}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome page target is unavailable');
  const client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

async function waitForExpression(client, expression, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    if (result.result?.value) return result.result.value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for page expression: ${expression}`);
}

async function captureScreenshot(client, fileName) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  mkdirSync(screenshotRoot, { recursive: true });
  writeFileSync(path.join(screenshotRoot, fileName), Buffer.from(result.data, 'base64'));
}

async function applyViewport(client, viewport) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: Boolean(viewport.touch),
  });
  await client.send('Emulation.setTouchEmulationEnabled', {
    enabled: Boolean(viewport.touch),
    maxTouchPoints: 5,
  });
  await client.send('Runtime.evaluate', {
    expression: `document.body.dataset.inputMode = '${viewport.touch ? 'touch' : 'desktop'}'; window.dispatchEvent(new Event('resize')); true`,
    returnByValue: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function inspectTier(origin, tier, options = {}) {
  const viewport = options.viewport || { width: 1440, height: 900, touch: false };
  const profileRoot = mkdtempSync(path.join(os.tmpdir(), `spacefight-${tier}-chrome-`));
  const { child, debuggerUrl } = launchChrome(profileRoot);
  let client;
  try {
    client = await pageClient(await debuggerUrl);
    const requests = [];
    client.on('Network.requestWillBeSent', ({ request }) => requests.push(request.url));
    await Promise.all([
      client.send('Network.enable'),
      client.send('Page.enable'),
      client.send('Runtime.enable'),
    ]);
    await client.send('Page.navigate', { url: `${origin}/?graphics=${tier}` });
    await waitForExpression(client, "document.body && document.body.dataset.engineReady === 'true'");
    if (viewport.width !== 1440 || viewport.height !== 900 || viewport.touch) {
      await applyViewport(client, viewport);
    }
    if (options.captureLabel) {
      await captureScreenshot(
        client,
        `${captureStamp}-${options.captureLabel}-launch-${viewport.width}x${viewport.height}.png`,
      );
      for (const extraCapture of options.extraCaptures || []) {
        await applyViewport(client, extraCapture.viewport);
        await captureScreenshot(
          client,
          `${captureStamp}-${extraCapture.label}-launch-${extraCapture.viewport.width}x${extraCapture.viewport.height}.png`,
        );
      }
      if (options.extraCaptures?.length) await applyViewport(client, viewport);
      await client.send('Runtime.evaluate', {
        expression: "document.querySelector('[data-hub-view=\"settings\"]').click(); true",
        returnByValue: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 320));
      await captureScreenshot(
        client,
        `${captureStamp}-${options.captureLabel}-settings-${viewport.width}x${viewport.height}.png`,
      );
      for (const extraCapture of options.extraCaptures || []) {
        await applyViewport(client, extraCapture.viewport);
        await captureScreenshot(
          client,
          `${captureStamp}-${extraCapture.label}-settings-${extraCapture.viewport.width}x${extraCapture.viewport.height}.png`,
        );
      }
      if (options.extraCaptures?.length) await applyViewport(client, viewport);
      await client.send('Runtime.evaluate', {
        expression: "document.getElementById('HubClose').click(); true",
        returnByValue: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 240));
      await client.send('Runtime.evaluate', {
        expression: "document.getElementById('LoadoutOpen').click(); true",
        returnByValue: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 240));
      await captureScreenshot(
        client,
        `${captureStamp}-${options.captureLabel}-loadout-${viewport.width}x${viewport.height}.png`,
      );
      for (const extraCapture of options.extraCaptures || []) {
        await applyViewport(client, extraCapture.viewport);
        await captureScreenshot(
          client,
          `${captureStamp}-${extraCapture.label}-loadout-${extraCapture.viewport.width}x${extraCapture.viewport.height}.png`,
        );
      }
      if (options.extraCaptures?.length) await applyViewport(client, viewport);
      await client.send('Runtime.evaluate', {
        expression: "document.getElementById('LoadoutClose').click(); true",
        returnByValue: true,
      });
    }
    const beforeLaunch = [...new Set(requests)];
    await client.send('Runtime.evaluate', {
      expression: "document.getElementById('LaunchButton').click(); true",
      returnByValue: true,
    });
    await waitForExpression(client, "document.body.dataset.playing === 'true'");
    if (tier === 'high') {
      await waitForExpression(client, 'performance.getEntriesByType(\'resource\').some((entry) => entry.name.includes(\'/spacefight-high/\'))');
    } else {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (options.captureLabel) {
      await captureScreenshot(
        client,
        `${captureStamp}-${options.captureLabel}-combat-${viewport.width}x${viewport.height}.png`,
      );
      for (const extraCapture of options.extraCaptures || []) {
        await applyViewport(client, extraCapture.viewport);
        await captureScreenshot(
          client,
          `${captureStamp}-${extraCapture.label}-combat-${extraCapture.viewport.width}x${extraCapture.viewport.height}.png`,
        );
      }
    }
    const afterLaunch = [...new Set(requests)];
    const highRequests = afterLaunch.filter((url) => url.includes('/spacefight-high/'));
    return {
      tier,
      engineReady: true,
      highRequestsBeforeLaunch: beforeLaunch.filter((url) => url.includes('/spacefight-high/')),
      highRequestsAfterLaunch: highRequests,
      requestCount: afterLaunch.length,
      requests: afterLaunch.map((url) => url.replace(origin, '')),
    };
  } finally {
    client?.close();
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
    try {
      rmSync(profileRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 160 });
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY') throw error;
    }
  }
}

async function main() {
  if (!existsSync(path.join(releaseRoot, 'index.html'))) {
    throw new Error('Run npm run build:web:release before verifying asset partitioning.');
  }
  if (!existsSync(chrome)) throw new Error(`Chrome executable not found: ${chrome}`);

  const server = await startServer();
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const low = await inspectTier(origin, 'low', {
      viewport: { width: 1440, height: 900, touch: false },
      captureLabel: 'desktop',
      extraCaptures: [
        {
          viewport: { width: 844, height: 390, touch: true },
          label: 'mobile',
        },
        {
          viewport: { width: 667, height: 375, touch: true },
          label: 'narrow-mobile',
        },
      ],
    });
    const high = process.env.SPACEFIGHT_VERIFY_LOW_ONLY === '1'
      ? null
      : await inspectTier(origin, 'high');
    if (low.highRequestsBeforeLaunch.length || low.highRequestsAfterLaunch.length) {
      throw new Error('Low graphics mode requested the optional high-quality bundle.');
    }
    if (high?.highRequestsBeforeLaunch.length) {
      throw new Error('High-quality bundle loaded before the player launched combat.');
    }
    if (high && !high.highRequestsAfterLaunch.length) {
      throw new Error('High graphics mode did not request the optional bundle after launch.');
    }
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), low, high }, null, 2)}\n`);
    process.stdout.write(`Verified Web asset partitioning: ${evidencePath}\n`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
