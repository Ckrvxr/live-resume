import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createArtifacts, openResume, printingCommands } from './helpers.mjs';

test('printed PDF uses the A4 page-size constraint', { timeout: 120_000 }, async t => {
  const artifacts = await createArtifacts('resume-a4');
  const { browser, evaluate, targetId } = await openResume(t);
  const print = await printingCommands(t, browser, targetId);
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
      chipBorder: chip.borderColor,
      chipShadow: chip.boxShadow,
      decorationDisplay: decoration.display,
      pageTransition: getComputedStyle(document.querySelector('.page')).transitionDuration,
    };
  })()`);
  assert.equal(printStyles.ink, '#22313a');
  assert.equal(printStyles.titleBackground, 'rgb(229, 241, 247)');
  assert.equal(printStyles.titleBorder, 'rgb(47, 120, 128)');
  assert.equal(printStyles.chipBackground, 'rgb(255, 255, 255)');
  assert.equal(printStyles.chipBackgroundImage, 'none');
  assert.equal(printStyles.chipBorder, 'rgb(174, 184, 180)');
  assert.equal(printStyles.chipShadow, 'none');
  assert.equal(printStyles.decorationDisplay, 'block');
  assert.equal(printStyles.pageTransition, '0s');

  // Omit paperWidth and paperHeight so this assertion verifies the CSS @page A4 rule.
  const { data } = await print('Page.printToPDF', {
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
  assert(Math.abs(sheet.view[2] - 210 / 25.4 * 72) < 1, `PDF width should be A4, got ${sheet.view[2]}pt`);
  assert(Math.abs(sheet.view[3] - 297 / 25.4 * 72) < 1, `PDF height should be A4, got ${sheet.view[3]}pt`);

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
  assert(links.some(annotation => annotation.url?.includes('ckrvxr.notion.site/sets')));
  assert.deepEqual((await browser('errors')).errors, []);
});
