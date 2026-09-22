import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getLocalStatus } from '../../commands/status';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'firecrawl-status-'));
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, '.firecrawl'));
  await writeFile(path.join(root, '.firecrawl', 'page.md'), 'page');
  await writeFile(path.join(root, '.gitignore'), '.firecrawl/\n');
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('reports the same repository cache and ignore rules from a subdirectory', async () => {
  const status = await getLocalStatus(path.join(root, 'src', 'nested'));
  expect(status).toEqual(await getLocalStatus(root));
  expect(status).toMatchObject({
    firecrawlDirExists: true,
    firecrawlFileCount: 1,
    gitignoreHasFirecrawl: true,
  });
});

it.each(['directory', 'file'])(
  'stops at a nested repository with a .git %s',
  async (kind) => {
    const nested = path.join(root, 'src');
    if (kind === 'directory') await mkdir(path.join(nested, '.git'));
    else await writeFile(path.join(nested, '.git'), 'gitdir: /some/worktree');
    expect(await getLocalStatus(path.join(nested, 'nested'))).toMatchObject({
      firecrawlDirExists: false,
      gitignoreExists: false,
    });
  }
);

it('prefers a nearer cache to the repository root cache', async () => {
  await mkdir(path.join(root, 'src', '.firecrawl'));
  expect(await getLocalStatus(path.join(root, 'src', 'nested'))).toMatchObject({
    firecrawlDirExists: true,
    firecrawlFileCount: 0,
    gitignoreExists: false,
  });
});

it('finds configured parent directories without git', async () => {
  await rm(path.join(root, '.git'), { recursive: true });
  expect(await getLocalStatus(path.join(root, 'src', 'nested'))).toMatchObject({
    firecrawlDirExists: true,
    gitignoreHasFirecrawl: true,
  });
});
