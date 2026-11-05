import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = '.convo-sync.json';

export const DEFAULTS = Object.freeze({
  outputDir: '.agents/conversations',
  redact: true,
  copyRaw: false,
  includeThinking: false,
  includeTools: false,
});

/** Defaults merged with <projectRoot>/.convo-sync.json (ignored if missing or invalid). */
export function loadConfig(projectRoot) {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, CONFIG_FILE), 'utf8').replace(/^﻿/, '');
    const user = JSON.parse(raw);
    if (!user || typeof user !== 'object' || Array.isArray(user)) return { ...DEFAULTS };
    const merged = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (key in user && typeof user[key] === typeof DEFAULTS[key]) merged[key] = user[key];
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}
