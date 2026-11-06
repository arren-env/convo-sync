import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitFacts } from '../scripts/lib/git.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-git-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'T');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'commit.gpgsign', 'false');
  return root;
}

const outDir = (root) => path.join(root, '.agents', 'conversations');

test('gitFacts returns null outside a git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-nogit-'));
  assert.equal(gitFacts(dir, null, outDir(dir)), null);
});

test('gitFacts returns null for a fake .git folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fakegit-'));
  fs.mkdirSync(path.join(dir, '.git'));
  assert.equal(gitFacts(dir, null, outDir(dir)), null);
});

test('gitFacts lists commits since the given time and uncommitted files', () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'a.txt'), '1');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'first');
  fs.writeFileSync(path.join(root, 'a.txt'), '2');
  fs.writeFileSync(path.join(root, 'new.txt'), 'x');
  const facts = gitFacts(root, new Date(Date.now() - 60_000), outDir(root));
  assert.equal(facts.commits.length, 1);
  assert.match(facts.commits[0], /^[0-9a-f]{7,} first$/);
  assert.ok(facts.files.some((f) => f.endsWith('a.txt') && f.includes('M')), facts.files.join('|'));
  assert.ok(facts.files.some((f) => f.endsWith('new.txt')), facts.files.join('|'));
});

test('gitFacts leaves out commits made before the session started', () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'a.txt'), '1');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'old');
  assert.deepEqual(gitFacts(root, new Date(Date.now() + 3_600_000), outDir(root)).commits, []);
});

test('gitFacts excludes files under the notes folder', () => {
  const root = repo();
  fs.mkdirSync(outDir(root), { recursive: true });
  fs.writeFileSync(path.join(outDir(root), 'x.md'), 'note');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b');
  const files = gitFacts(root, null, outDir(root)).files;
  assert.ok(!files.some((f) => f.includes('conversations')), files.join('|'));
  assert.ok(files.some((f) => f.endsWith('b.txt')));
});

test('gitFacts caps each list at 20', () => {
  const root = repo();
  for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), String(i));
  assert.equal(gitFacts(root, null, outDir(root)).files.length, 20);
});

test('gitFacts works when the project is reached through a link', () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'a.txt'), '1');
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-link-')), 'proj');
  fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  const facts = gitFacts(link, null, outDir(link));
  assert.ok(facts, 'not null through a link');
  assert.ok(facts.files.some((f) => f.endsWith('a.txt')));
});

test('gitFacts excludes the notes folder regardless of letter case on case-insensitive systems', { skip: !['win32', 'darwin'].includes(process.platform) }, () => {
  const root = repo();
  fs.mkdirSync(outDir(root), { recursive: true });
  fs.writeFileSync(path.join(outDir(root), 'x.md'), 'note');
  const files = gitFacts(root, null, path.join(root, '.Agents', 'Conversations')).files;
  assert.ok(!files.some((f) => f.toLowerCase().includes('conversations')), files.join('|'));
});
