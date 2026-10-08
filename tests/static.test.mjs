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
      chipWeights: Object.fromEntries([...document.querySelectorAll('.skill-chips li')].map(node => [node.innerText, getComputedStyle(node).fontWeight])),
      profileFacts: [...document.querySelectorAll('.facts li')].map(node => node.innerText),
      profileEducation: document.querySelector('.sidebar [aria-labelledby="profile-heading"] [aria-labelledby="education-heading"]')?.innerText,
      mainEducationCount: document.querySelectorAll('.main [aria-labelledby="education-heading"]').length,
    };
  })()`);
  assert.equal(screen.favicon, 'assets/nailong.svg');
  assert.equal(screen.pageTransition, '0s');
  assert.notEqual(screen.buttonTransition, '0s');
  assert.deepEqual(screen.buttons, [0, 1, 1, 0, 0]);
  assert.equal(screen.editable, false);
  assert.deepEqual(screen.skills, ['英语六级', '粤语', 'C/C++', 'JS', 'Python', 'Rust', 'Markdown']);
  assert.equal(screen.chipWeights.uv, '400');
  assert.equal(screen.chipWeights.UV, undefined);
  assert.equal(screen.chipWeights.U8g2, '400');
  assert.equal(screen.chipWeights.U8G2, undefined);
  assert.equal(screen.chipWeights['原理图设计'], '700');
  assert.equal(screen.chipWeights['焊接调试'], '400');
  assert.equal(screen.chipWeights.CNN, '400');
  assert.equal(screen.chipWeights.MuJoCo, undefined);
  assert.deepEqual(screen.profileFacts, ['性别：男', '年龄：21岁', '籍贯：广州']);
  assert.equal(screen.mainEducationCount, 0);
  assert(screen.profileEducation.includes('惠州学院'));
  assert(screen.profileEducation.includes('27届'));
  assert(screen.profileEducation.includes('电子信息工程（本科）'));
  assert(screen.profileEducation.includes('2023.09 — 至今'));
  assert(!screen.profileEducation.includes('主修课程'));
  await agentBrowser('screenshot', resolve(artifacts, 'desktop.png'));

  const markdownPath = resolve(artifacts, 'resume.md');
  await agentBrowser('download', '#markdown-button', markdownPath);
  const markdown = await readFile(markdownPath, 'utf8');
  assert(markdown.includes('# 曹锐旋'));
  assert(markdown.includes('> 意向：嵌入式软件实习'));
  assert(markdown.includes('## 个人概况'));
  assert(!markdown.includes('MBTI'));
  assert(!markdown.includes('INTP'));
  const profileMarkdown = markdown.split('## 个人概况')[1].split('## 联系方式')[0];
  assert(!profileMarkdown.includes('- 届别：27届'));
  assert.match(profileMarkdown, /^### 教育经历$/m);
  assert(profileMarkdown.includes('**惠州学院** · **27届**'));
  assert(profileMarkdown.includes('电子信息工程（本科）'));
  assert(profileMarkdown.includes('*2023.09 — 至今*'));
  assert(!profileMarkdown.includes('主修课程'));
  assert.doesNotMatch(profileMarkdown, /^>\s*$/m);
  assert.doesNotMatch(markdown, /^## 教育经历$/m);
  assert(markdown.includes('- 手机：+86 131 1332 8451'));
  assert(markdown.includes('| 能力方向 | 技能 |'));
  assert(markdown.includes('| --- | --- |'));
  assert(markdown.includes('| 语言能力 |'));
  assert(markdown.includes('Rust · **Markdown**'));
  assert(markdown.includes(' · uv · '));
  assert(markdown.includes(' · U8g2 |'));
  assert(markdown.includes('| 硬件开发 | **原理图设计** · **PCB 布局** · 焊接调试 |'));
  assert(markdown.includes('| AI/ML | **Agent** · Skill · **PyTorch** · CNN |'));
  assert(!markdown.includes('### 语言能力'));
  assert(markdown.includes('[GitHub](https://github.com/ckrvxr)'));
  assert(markdown.includes('## 个人简介'));
  assert(markdown.includes('### RoboMaster 战队｜硬件组组长'));
  assert(markdown.includes('- 负责电源模块设计、单片机核心板设计与机器人布线工作。'));
  assert(markdown.includes('- 负责电控底盘代码编写，拥有软硬件协同调试经验。'));
  assert(markdown.includes('- 制定硬件组技术规范、教学文档，负责培训新成员。'));
  assert(!markdown.includes('（非甲级队伍）'));
  const awards = markdown.split('## 获奖情况')[1].split('## 代表项目')[0].trim().split('\n');
  assert.deepEqual(awards, [
    '- RoboMaster 2026 高校联盟赛 华南站 工程挑战赛 一等奖',
    '- RoboMaster 2024 高校联盟赛 华南站 步兵对抗赛 二等奖',
    '- RoboMaster 2026 高校联盟赛 华南站 3v3 对抗赛 三等奖',
    '- RoboMaster 2025 高校联盟赛 福建站 3v3 对抗赛 三等奖',
  ]);
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
        profileFits: [...document.querySelectorAll('.profile-layout, .profile-education')].every(node => node.scrollWidth <= node.clientWidth + 1),
      };
    })()`);
    assert.equal(mobile.columns, 1, `columns at ${width}px`);
    assert.equal(mobile.printVisible, false);
    assert.equal(mobile.markdownVisible, false);
    assert.equal(mobile.marginTop, '0px');
    assert.equal(mobile.entryDirection, 'column');
    assert(mobile.documentFits, `page overflow at ${width}px`);
    assert(mobile.titlesFit, `title overflow at ${width}px`);
    assert(mobile.profileFits, `profile overflow at ${width}px`);
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
  assert(!text.includes('MBTI'));
  assert(!text.includes('INTP'));
  assert(text.includes('电子信息工程(本科)'));
  assert(text.includes('2023.09'));
  assert(text.includes('27届'));
  assert(!text.includes('主修课程'));
  assert(!text.includes('数字信号处理'));
  assert(text.includes('项目细节和更多项目'));
  assert(!text.includes('打印 / 另存为 PDF'));
  assert(text.replace(/\s+/g, '').includes('RoboMaster2026高校联盟赛华南站工程挑战赛一等奖'));
  const links = await sheet.getAnnotations();
  assert(links.some(annotation => annotation.url?.includes('github.com/ckrvxr')));
  assert(links.some(annotation => annotation.url?.includes('ckrvxr.notion.site')));
  assert.deepEqual((await agentBrowser('errors')).errors, []);
});
