// Best-effort secret redaction. It catches common token shapes; it is not a guarantee.
const R = '[REDACTED]';

const RULES = [
  // PEM private key blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, () => R],
  // OpenAI / Anthropic style keys: sk-..., sk-ant-..., sk-proj-...
  [/\bsk-[A-Za-z0-9_-]{20,}/g, () => R],
  // GitHub tokens
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, () => R],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, () => R],
  // AWS access key ids
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, () => R],
  // Slack tokens
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, () => R],
  // Google API keys
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, () => R],
  // Bearer tokens
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, (_m, p) => p + R],
  // key = "value" / KEY=value assignments for secret-looking names.
  // Bare "token" is excluded (maxTokens, input_tokens); prefixed forms like access_token are kept.
  [
    /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|password|passwd|pwd|(?:access|auth|refresh|session|bearer|api|private|client|id)[_-]?token)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"'`,;()]{4,})\3/gi,
    (match, name, sep, q, value, offset, whole) => {
      if (whole[offset + match.length] === '(') return match; // a function call, e.g. getSecret()
      if (/^\d+$/.test(value)) return match; // plain numbers (limits, counts)
      if (!/[\d\W_]/.test(value)) return match; // a single plain word, e.g. a type name like `string`
      return `${name}${sep}${q}${R}${q}`;
    },
  ],
];

export function redact(text) {
  if (!text) return text;
  let out = String(text);
  for (const [re, fn] of RULES) out = out.replace(re, fn);
  return out;
}

function redactValue(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(v);
    return out;
  }
  return value;
}

/**
 * Redact a JSONL transcript line by line, on decoded string values, so escaped
 * quotes don't hide secrets and every output line stays valid JSON.
 */
export function redactJsonl(text) {
  return String(text)
    .split(/(\r?\n)/)
    .map((part) => {
      if (!part.trim() || /^\r?\n$/.test(part)) return part;
      try {
        return JSON.stringify(redactValue(JSON.parse(part.replace(/^﻿/, ''))));
      } catch {
        return redact(part);
      }
    })
    .join('');
}
