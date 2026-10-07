// Dependency-free regression tests for lib/detect.js (v2 API).
// Runs the REAL extension source inside a node:vm sandbox — no build step.
//
//   node tests/detect.test.mjs

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'lib', 'detect.js'), 'utf8');
const PF = runInNewContext(src + '\nglobalThis.PFDetect', {});

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}

// ---------------------------------------------------------------------------
// H1 regression (claude.ai) — a Persian-capable font listed as a FALLBACK, or
// a generic system font in the chain, must not make the element look
// "already Persian". v2 contract: per-family normalized exact/prefix match
// against a Persian-font-only list (no Tahoma/Arial/Roboto/Segoe).

const CLAUDE_CHAIN = 'Styrene B, Styrene A, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

t('hasKnownPersianFamily: claude.ai fallback chain is NOT Persian', () => {
  assert.equal(PF.hasKnownPersianFamily(CLAUDE_CHAIN), false);
});
t('hasKnownPersianFamily: generic system chain is NOT Persian', () => {
  assert.equal(PF.hasKnownPersianFamily('-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'), false);
});
t('hasKnownPersianFamily: Persian primaries are detected', () => {
  for (const chain of ['Vazirmatn, sans-serif', '"IRANSansX", Arial', 'B Nazanin', 'Estedad', 'Noto Naskh Arabic']) {
    assert.equal(PF.hasKnownPersianFamily(chain), true, chain);
  }
});
t('hasKnownPersianFamily: Tahoma is treated as generic (v2 contract)', () => {
  // v2 intentionally drops Tahoma/Arial/Roboto from the list: with unicode-range
  // fonts only Persian glyphs swap, so generic-but-Persian-capable system fonts
  // no longer need to be skipped.
  assert.equal(PF.hasKnownPersianFamily('Tahoma'), false);
});
t('hasKnownPersianFamily: normalized matching (spaces/dashes/case)', () => {
  assert.equal(PF.hasKnownPersianFamily('Iran Sans Web'), true);   // iransans prefix
  assert.equal(PF.hasKnownPersianFamily('IRANYekan'), true);
});
t('hasKnownPersianFamily: no substring false positive on Latin names', () => {
  // "Droid" would substring-match "Droid Sans"; normalized exact/prefix must not match unrelated names
  assert.equal(PF.hasKnownPersianFamily('DurantLight, Arial'), false);
  assert.equal(PF.hasKnownPersianFamily('Sahel Black'), true); // prefix of 'sahel' is intended
});

// ---------------------------------------------------------------------------
// Mono/icon classification — fallback-only occurrences must not classify.

t('isMonoFamily: monospace only as fallback is NOT mono', () => {
  assert.equal(PF.isMonoFamily('MySiteFont, monospace'), false);
});
t('isMonoFamily: mono primary IS mono', () => {
  assert.equal(PF.isMonoFamily('Consolas, monospace'), true);
  assert.equal(PF.isMonoFamily('monospace'), true);
  assert.equal(PF.isMonoFamily('JetBrains Mono'), true);
});
t('isIconFamily: icon font primary IS icon', () => {
  assert.equal(PF.isIconFamily('Font Awesome 6 Free, sans-serif'), true);
  assert.equal(PF.isIconFamily('Material Symbols Outlined'), true);
});
t('isIconFamily: fail-closed — icon font anywhere in chain skips element (v2 contract)', () => {
  // Deliberate: turning an icon into letters is far worse than leaving text
  // unstyled, so icon patterns match ANY family in the chain.
  assert.equal(PF.isIconFamily('MyFont, "Font Awesome 6 Free"'), true);
});

// ---------------------------------------------------------------------------
// Exclusion contract (v2): ALL editable content is excluded from the text
// pipeline (the composer gets its own restricted path via data-pf-input in
// content.js); password/code/mono contexts stay excluded.

t('shouldExcludeElement: contenteditable excluded from text pipeline', () => {
  const el = { nodeType: 1, tagName: 'DIV', isContentEditable: true, hasAttribute: () => false, classList: { contains: () => false } };
  assert.equal(PF.shouldExcludeElement(el), true);
});
t('shouldExcludeElement: form controls excluded', () => {
  for (const tag of ['TEXTAREA', 'INPUT', 'SELECT']) {
    const el = { nodeType: 1, tagName: tag, isContentEditable: false, hasAttribute: () => false, classList: { contains: () => false } };
    assert.equal(PF.shouldExcludeElement(el), true, tag);
  }
});
t('shouldExcludeElement: password/code/script excluded', () => {
  for (const tag of ['PRE', 'CODE', 'SCRIPT', 'STYLE']) {
    const el = { nodeType: 1, tagName: tag, isContentEditable: false, hasAttribute: () => false, classList: { contains: () => false } };
    assert.equal(PF.shouldExcludeElement(el), true, tag);
  }
});
t('isEditableRoot: root only, not inner elements', () => {
  const inner = { nodeType: 1, isContentEditable: true, parentElement: { isContentEditable: true } };
  const rootEl = { nodeType: 1, isContentEditable: true, parentElement: null };
  assert.equal(PF.isEditableRoot(rootEl), true);
  assert.equal(PF.isEditableRoot(inner), false);
});
t('isInExcludedContext: ancestor pre/code/mono excludes descendants', () => {
  const el = { nodeType: 1, tagName: 'SPAN', isContentEditable: false, hasAttribute: () => false, classList: { contains: () => false }, closest: (s) => (s.includes('pre') ? { fake: true } : null) };
  assert.equal(PF.isInExcludedContext(el), true);
});

// ---------------------------------------------------------------------------
// Text detection.

t('hasPersian: basics', () => {
  assert.equal(PF.hasPersian('سلام'), true);
  assert.equal(PF.hasPersian('hello'), false);
  assert.equal(PF.hasPersian(''), false);
  assert.equal(PF.hasPersian(undefined), false);
});
t('firstStrong: rtl vs ltr vs null', () => {
  assert.equal(PF.firstStrong('سلام hello'), 'rtl');
  assert.equal(PF.firstStrong('hello سلام'), 'ltr');
  assert.equal(PF.firstStrong('123'), null);
});
t('isPersianDominant: smart digits threshold', () => {
  assert.equal(PF.isPersianDominant('سلام ۱۲۳'), true);
  assert.equal(PF.isPersianDominant('this is mostly english متن'), false);
});

// ---------------------------------------------------------------------------
// Site enablement (v2 API: isSiteEnabled / isSiteAllowed / lookupHost).

t('isSiteEnabled: master off', () => {
  assert.equal(PF.isSiteEnabled('example.com', { masterEnabled: false, siteOverrides: {}, exclusionList: [] }), false);
});
t('isSiteEnabled: per-site override wins over exclusion list', () => {
  const s = { masterEnabled: true, siteOverrides: { 'claude.ai': true }, exclusionList: ['claude.ai'] };
  assert.equal(PF.isSiteEnabled('claude.ai', s), true);
});
t('isSiteEnabled: disabled override', () => {
  const s = { masterEnabled: true, siteOverrides: { 'claude.ai': false }, exclusionList: [] };
  assert.equal(PF.isSiteEnabled('claude.ai', s), false);
});
t('isSiteEnabled: wildcard subdomain (unmatched hosts follow master)', () => {
  const s = { masterEnabled: true, siteOverrides: { '*.example.com': true }, exclusionList: [] };
  assert.equal(PF.isSiteEnabled('a.example.com', s), true);
  assert.equal(PF.isSiteEnabled('other.com', s), true);      // no override match -> master decides
  assert.equal(PF.isSiteEnabled('a.example.com', { ...s, masterEnabled: false }), false);
});
t('isSiteEnabled: www. normalization', () => {
  const s = { masterEnabled: true, siteOverrides: {}, exclusionList: ['claude.ai'] };
  assert.equal(PF.isSiteEnabled('www.claude.ai', s), false);
});

// ---------------------------------------------------------------------------
// sanitize — stored/imported settings must not inject junk.

t('sanitize: defaults on garbage', () => {
  const s = PF.sanitize('not an object');
  assert.equal(s.masterEnabled, true);
  assert.equal(s.digitMode, 'auto');
});
t('sanitize: clamps fontScale and rejects bad digitMode', () => {
  const s = PF.sanitize({ fontScale: 999, digitMode: 'h4x', lineHeight: 99 });
  assert.equal(s.fontScale, 150);
  assert.equal(s.digitMode, 'auto');
  assert.equal(s.lineHeight, 3);
});
t('sanitize: filters invalid hosts in siteOverrides', () => {
  const s = PF.sanitize({ siteOverrides: { 'ok.com': true, 'bad host!': false } });
  // deepEqual across vm realms compares prototypes — compare JSON instead
  assert.equal(JSON.stringify(s.siteOverrides), JSON.stringify({ 'ok.com': true }));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
