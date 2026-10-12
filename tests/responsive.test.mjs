import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createArtifacts, openResume } from './helpers.mjs';

test('resume layout adapts across mobile, tablet, and desktop viewports', { timeout: 120_000 }, async t => {
  const artifacts = await createArtifacts('resume-responsive');
  const { browser, evaluate } = await openResume(t);
  await browser('screenshot', resolve(artifacts, 'desktop.png'));

  for (const width of [320, 390, 760]) {
    await browser('set', 'viewport', String(width), '844');
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
        educationMetaInline: (() => {
          const major = document.querySelector('.education-major').getBoundingClientRect();
          const period = document.querySelector('.education-period').getBoundingClientRect();
          return major.top < period.bottom && period.top < major.bottom;
        })(),
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
    assert(mobile.educationMetaInline, `education metadata should share a row at ${width}px`);
  }

  for (const width of [768, 1024, 1440]) {
    await browser('set', 'viewport', String(width), '1000');
    assert.equal(await evaluate("document.querySelector('#print-button').checkVisibility()"), true);
    assert.equal(await evaluate("document.querySelector('#markdown-button').checkVisibility()"), true);
  }
  await browser('set', 'viewport', '390', '844');
  await browser('screenshot', resolve(artifacts, 'mobile.png'));
});
