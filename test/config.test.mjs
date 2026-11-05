import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, DEFAULTS } from '../scripts/lib/config.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cfg-'));

test('defaults when no config file', () => {
  assert.deepEqual(loadConfig(tmp()), {
    outputDir: '.agents/conversations', redact: true, copyRaw: false, includeThinking: false, includeTools: false,
  });
  assert.deepEqual(loadConfig(tmp()), DEFAULTS);
});

test('merges project config', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, '.convo-sync.json'), '﻿{"outputDir":"notes/ai","redact":false}');
  assert.deepEqual(loadConfig(d), { ...DEFAULTS, outputDir: 'notes/ai', redact: false });
});

test('invalid config falls back to defaults', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, '.convo-sync.json'), '{bad json');
  assert.deepEqual(loadConfig(d), DEFAULTS);
});
