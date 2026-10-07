import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pageUrl = pathToFileURL(resolve(root, 'index.html')).href;
const session = `live-resume-test-${process.pid}`;
const run = promisify(execFile);

async function agentBrowser(...args) {
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
  const { result } = await agentBrowser('eval', '-b', Buffer.from(script).toString('base64'));
  return result;
}

// The CLI does not expose print-media emulation or A4 PDF options.
// Use its own browser's CDP endpoint only for those printing operations.
async function printingCommands(t, targetId) {
  const { cdpUrl } = await agentBrowser('get', 'cdp-url');
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

test('static resume stays read-only and supports export and printing via agent-browser', { timeout: 120_000 }, async t => {
  const source = await readFile(resolve(root, 'index.html'), 'utf8');
  assert(!source.includes('export.js'));
  assert(!source.includes('server.mjs'));
  assert(!source.includes('/api/pdf'));

  await mkdir(resolve(root, 'test-results'), { recursive: true });
  const artifacts = await mkdtemp(resolve(root, 'test-results', 'agent-browser-'));
  t.after(() => agentBrowser('close'));
  const { targetId } = await agentBrowser('--headed', 'false', '--allow-file-access', '--hide-scrollbars', 'false', 'open', pageUrl);
  await agentBrowser('set', 'viewport', '1280', '1000');
  await agentBrowser('wait', '--fn', "document.querySelectorAll('.qr svg').length === 2");
  const screen = await evaluate(`(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    return {
      favicon: document.querySelector('link[rel="icon"]').getAttribute('href'),
      pageTransition: style('.page').transitionDuration,
      buttonTransition: style('#print-button').transitionDuration,
      buttons: ['pdf', 'print', 'markdown', 'theme', 'lock'].map(name => document.querySelectorAll('#' + name + '-button').length),
      editable: document.querySelector('.name').isContentEditable,
      skills: [...document.querySelector('.skill-group .skill-chips').children].map(node => node.innerText),
    };
  })()`);
  assert.equal(screen.favicon, 'assets/nailong.svg');
  assert.equal(screen.pageTransition, '0s');
  assert.notEqual(screen.buttonTransition, '0s');
  assert.deepEqual(screen.buttons, [0, 1, 1, 0, 0]);
  assert.equal(screen.editable, false);
  assert.deepEqual(screen.skills, ['英语六级', '粤语', 'C/C++', 'JS', 'Python', 'Rust', 'Markdown']);
  await agentBrowser('screenshot', resolve(artifacts, 'desktop.png'));

  const markdownPath = resolve(artifacts, 'resume.md');
  await agentBrowser('download', '#markdown-button', markdownPath);
  const markdown = await readFile(markdownPath, 'utf8');
  assert(markdown.includes('# 曹锐旋'));
  assert(markdown.includes('> 意向：嵌入式软件实习'));
  assert(markdown.includes('## 个人概况'));
  assert(markdown.includes('- 手机：+86 131 1332 8451'));
  assert(markdown.includes('| 能力方向 | 技能 |'));
  assert(markdown.includes('| --- | --- |'));
  assert(markdown.includes('| 语言能力 |'));
  assert(markdown.includes('Rust · **Markdown**'));
  assert(!markdown.includes('### 语言能力'));
  assert(markdown.includes('[GitHub](https://github.com/ckrvxr)'));
  assert(markdown.includes('## 代表项目'));
  assert(markdown.includes('**团队** · *2026.05 — 2026.07*'));
  await evaluate('window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; true');
  await agentBrowser('click', '#print-button');
  assert.equal(await evaluate('window.__printCalls'), 1);

  for (const width of [320, 390, 760]) {
    await agentBrowser('set', 'viewport', String(width), '844');
    const mobile = await evaluate(`(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      return {
        columns: style('.resume').gridTemplateColumns.split(' ').length,
        printVisible: document.querySelector('#print-button').checkVisibility(),
        markdownVisible: document.querySelector('#markdown-button').checkVisibility(),
        marginTop: style('.page').marginTop,
        entryDirection: style('.entry-head').flexDirection,
        documentFits: document.documentElement.scrollWidth <= innerWidth,
        titlesFit: [...document.querySelectorAll('.entry-title')].every(node => node.scrollWidth <= node.clientWidth + 1),
      };
    })()`);
    assert.equal(mobile.columns, 1, `columns at ${width}px`);
    assert.equal(mobile.printVisible, false);
    assert.equal(mobile.markdownVisible, false);
    assert.equal(mobile.marginTop, '0px');
    assert.equal(mobile.entryDirection, 'column');
    assert(mobile.documentFits, `page overflow at ${width}px`);
    assert(mobile.titlesFit, `title overflow at ${width}px`);
  }
  for (const width of [768, 1024, 1440]) {
    await agentBrowser('set', 'viewport', String(width), '1000');
    assert.equal(await evaluate("document.querySelector('#print-button').checkVisibility()"), true);
    assert.equal(await evaluate("document.querySelector('#markdown-button').checkVisibility()"), true);
  }
  await agentBrowser('set', 'viewport', '390', '844');
  await agentBrowser('screenshot', resolve(artifacts, 'mobile.png'));
  const print = await printingCommands(t, targetId);
  await print('Emulation.setEmulatedMedia', { media: 'print' });
  const printStyles = await evaluate(`(() => {
    const root = getComputedStyle(document.documentElement);
    const title = getComputedStyle(document.querySelector('.main .section-title'));
    const chip = getComputedStyle(document.querySelector('.skill-chips li'));
    const decoration = getComputedStyle(document.querySelector('.page'), '::before');
    return {
      ink: root.getPropertyValue('--ink').trim(),
      titleBackground: title.backgroundColor,
      titleBorder: title.borderLeftColor,
      chipBackground: chip.backgroundColor,
      chipBackgroundImage: chip.backgroundImage,
      chipShadow: chip.boxShadow,
      decorationDisplay: decoration.display,
      pageTransition: getComputedStyle(document.querySelector('.page')).transitionDuration,
    };
  })()`);
  assert.equal(printStyles.ink, '#22313a');
  assert.equal(printStyles.titleBackground, 'rgb(229, 241, 247)');
  assert.equal(printStyles.titleBorder, 'rgb(47, 120, 128)');
  assert.equal(printStyles.chipBackground, 'rgb(229, 240, 237)');
  assert.match(printStyles.chipBackgroundImage, /linear-gradient/);
  assert.match(printStyles.chipShadow, /inset/);
  assert.equal(printStyles.decorationDisplay, 'block');
  assert.equal(printStyles.pageTransition, '0s');
  const { data } = await print('Page.printToPDF', {
    paperWidth: 210 / 25.4,
    paperHeight: 297 / 25.4,
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  });
  const pdfBytes = new Uint8Array(Buffer.from(data, 'base64'));
  await writeFile(resolve(artifacts, 'resume.pdf'), pdfBytes);
  const loadingTask = getDocument({ data: pdfBytes, useSystemFonts: true });
  t.after(() => loadingTask.destroy());
  const pdf = await loadingTask.promise;
  assert.equal(pdf.numPages, 1);
  const sheet = await pdf.getPage(1);
  assert(Math.abs(sheet.view[2] - 210 / 25.4 * 72) < 1, 'PDF width is A4');
  assert(Math.abs(sheet.view[3] - 297 / 25.4 * 72) < 1, 'PDF height is A4');
  const text = (await sheet.getTextContent()).items.map(item => item.str).join('').normalize('NFKC');
  assert(text.includes('曹锐旋'));
  assert(text.includes('项目细节和更多项目'));
  assert(!text.includes('打印 / 另存为 PDF'));
  const links = await sheet.getAnnotations();
  assert(links.some(annotation => annotation.url?.includes('github.com/ckrvxr')));
  assert(links.some(annotation => annotation.url?.includes('ckrvxr.notion.site')));
  assert.deepEqual((await agentBrowser('errors')).errors, []);
});
