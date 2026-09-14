import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = resolve('.');
const pageUrl = pathToFileURL(resolve(root, 'index.html')).href;
const browserOptions = existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
  ? { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' }
  : {};
let browser;

before(async () => { browser = await chromium.launch(browserOptions); });
after(async () => { await browser.close(); });

test('static resume edits in place and uses the browser print flow', async () => {
  const source = await readFile(resolve(root, 'index.html'), 'utf8');
  assert(!source.includes('export.js'));
  assert(!source.includes('server.mjs'));
  assert(!source.includes('/api/pdf'));

  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => { window.__printCalls += 1; };
  });
  await page.goto(pageUrl);
  await page.waitForFunction(() => document.querySelectorAll('.qr svg').length === 2);
  assert.equal(await page.locator('.page').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  assert.notEqual(await page.locator('#lock-button').evaluate(node => getComputedStyle(node).transitionDuration), '0s');

  assert.equal(await page.locator('#pdf-button').count(), 0);
  assert.equal(await page.locator('#print-button').count(), 1);
  assert.equal(await page.locator('#markdown-button').count(), 1);
  assert.equal(await page.locator('#theme-button').count(), 0);
  await page.click('#lock-button');
  await page.locator('.name').fill('曹锐旋测试');
  const markdownDownload = page.waitForEvent('download');
  await page.click('#markdown-button');
  const markdown = await readFile(await (await markdownDownload).path(), 'utf8');
  assert(markdown.includes('# 曹锐旋测试'));
  assert(markdown.includes('> 意向：嵌入式软件工程师'));
  assert(markdown.includes('## 个人概况'));
  assert(markdown.includes('- 手机：13113328451'));
  assert(markdown.includes('| 能力方向 | 技能 |'));
  assert(markdown.includes('| --- | --- |'));
  assert(markdown.includes('| 语言能力 |'));
  assert(markdown.includes('**Markdown** · Rust'));
  assert(!markdown.includes('### 语言能力'));
  assert(markdown.includes('[GitHub](https://github.com/ckrvxr)'));
  assert(markdown.includes('## 项目经历'));
  assert(markdown.includes('**团队** · *2026.05 — 2026.07*'));
  await page.click('#print-button');
  assert.equal(await page.evaluate(() => window.__printCalls), 1);
  assert.deepEqual(pageErrors, []);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.resume').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
  await page.emulateMedia({ media: 'print' });
  const printStyles = await page.evaluate(() => {
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
    };
  });
  assert.equal(printStyles.ink, '#22313a');
  assert.equal(printStyles.titleBackground, 'rgb(229, 241, 247)');
  assert.equal(printStyles.titleBorder, 'rgb(47, 120, 128)');
  assert.equal(printStyles.chipBackground, 'rgb(229, 240, 237)');
  assert.match(printStyles.chipBackgroundImage, /linear-gradient/);
  assert.match(printStyles.chipShadow, /inset/);
  assert.equal(printStyles.decorationDisplay, 'block');
  assert.equal(await page.locator('.page').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  const pdfBytes = new Uint8Array(await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  }));
  const pdf = await getDocument({ data: pdfBytes, useSystemFonts: true }).promise;
  assert.equal(pdf.numPages, 1);
  const sheet = await pdf.getPage(1);
  const text = (await sheet.getTextContent()).items.map(item => item.str).join('').normalize('NFKC');
  assert(text.includes('曹锐旋测试'));
  assert(text.includes('项目细节和更多项目'));
  assert(!text.includes('打印 / 另存为 PDF'));
  const links = await sheet.getAnnotations();
  assert(links.some(annotation => annotation.url?.includes('github.com/ckrvxr')));
  assert(links.some(annotation => annotation.url?.includes('ckrvxr.notion.site')));
  await pdf.cleanup();
  await page.close();
});
