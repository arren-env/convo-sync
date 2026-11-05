import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../scripts/lib/redact.mjs';
import { readJsonl } from '../scripts/lib/session.mjs';

test('readJsonl strips BOM, handles CRLF, skips blank and bad lines', () => {
  assert.deepEqual(readJsonl('﻿{"a":1}\r\nnot json\r\n\r\n{"b":2}'), [{ a: 1 }, { b: 2 }]);
});

const secrets = [
  'sk-ant-api03-abcDEF1234567890abcdef',
  'sk-proj-abcdefghijklmnopqrstuv',
  'ghp_' + 'a1B2c3D4e5'.repeat(3) + 'x1y2z3',
  'AKIAIOSFODNN7EXAMPLE',
];
for (const s of secrets) {
  test(`redacts ${s.slice(0, 8)}…`, () => {
    const out = redact(`before ${s} after`);
    assert.equal(out, 'before [REDACTED] after');
  });
}

test('redacts bearer tokens', () => {
  assert.equal(redact('Authorization: Bearer eyJhbGciOi.abc.def'), 'Authorization: Bearer [REDACTED]');
});

test('redacts PEM private key blocks', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----';
  assert.equal(redact(`x\n${pem}\ny`), 'x\n[REDACTED]\ny');
});

test('redacts secret-like assignments', () => {
  assert.equal(redact('api_key = "abc123secret"'), 'api_key = "[REDACTED]"');
  assert.equal(redact('PASSWORD=hunter2'), 'PASSWORD=[REDACTED]');
});

test('leaves normal words alone', () => {
  assert.equal(redact('the word skeleton and task-runner'), 'the word skeleton and task-runner');
});
