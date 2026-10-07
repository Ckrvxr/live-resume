import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('browser tooling has no Playwright dependencies', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lockfile = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  for (const metadata of [manifest, ...Object.values(lockfile.packages)]) {
    for (const dependencies of [metadata.dependencies, metadata.devDependencies, metadata.optionalDependencies]) {
      assert.equal(dependencies?.playwright, undefined);
      assert.equal(dependencies?.['playwright-core'], undefined);
    }
  }
  assert.equal(lockfile.packages['node_modules/playwright'], undefined);
  assert.equal(lockfile.packages['node_modules/playwright-core'], undefined);
});
