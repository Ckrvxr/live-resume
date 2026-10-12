import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const root = fileURLToPath(new URL('../', import.meta.url));
const pageUrl = pathToFileURL(resolve(root, 'index.html')).href;
const run = promisify(execFile);

export async function createArtifacts(prefix) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  return mkdtemp(resolve(root, 'test-results', `${prefix}-`));
}

export async function openResume(t, width = 1280, height = 1000) {
  const session = `live-resume-test-${process.pid}`;
  async function browser(...args) {
    const { stdout } = await run('agent-browser', ['--session', session, '--json', ...args], {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const response = JSON.parse(stdout);
    assert.equal(response.success, true, response.error);
    return response.data;
  }
  async function evaluate(script) {
    const { result } = await browser('eval', '-b', Buffer.from(script).toString('base64'));
    return result;
  }

  t.after(() => browser('close'));
  const { targetId } = await browser('--headed', 'false', '--allow-file-access', '--hide-scrollbars', 'false', 'open', pageUrl);
  await browser('set', 'viewport', String(width), String(height));
  await browser('wait', '--fn', "document.querySelectorAll('.qr svg').length === 2");
  return { browser, evaluate, targetId };
}

// The CLI does not expose print-media emulation or A4 PDF options.
// Use its own browser's CDP endpoint only for those printing operations.
export async function printingCommands(t, browser, targetId) {
  const { cdpUrl } = await browser('get', 'cdp-url');
  const socket = new WebSocket(cdpUrl);
  t.after(() => socket.close());
  await once(socket, 'open', { signal: AbortSignal.timeout(10_000) });
  let nextId = 0;
  function send(method, params = {}, sessionId) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener('message', onMessage);
        reject(new Error(`CDP ${method} timed out`));
      }, 10_000);
      function onMessage(event) {
        const response = JSON.parse(event.data);
        if (response.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage);
        if (response.error) reject(new Error(`CDP ${method}: ${response.error.message}`));
        else resolve(response.result);
      }
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return (method, params) => send(method, params, sessionId);
}
