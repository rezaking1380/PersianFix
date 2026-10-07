// Dependency-free regression tests for lib/textfix.js (pure text helpers).
// Runs the REAL extension source inside a node:vm sandbox — no build step.
//
//   node tests/textfix.test.mjs

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'lib', 'textfix.js'), 'utf8');
const TX = runInNewContext(src + '\nglobalThis.PFText', {});

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}

// Layout map (ISIRI 9147 COMMON): s=س g=ل h=ا l=م  => 'sghl' === 'سلام'

t('convertLayout toFa: latin typed with Persian layout -> Persian', () => {
  assert.equal(TX.convertLayout('sghl', 'toFa').text, 'سلام');
});
t('convertLayout toEn: Persian -> latin keys', () => {
  assert.equal(TX.convertLayout('سلام', 'toEn').text, 'sghl');
});
t('convertLayout auto: detects Latin input and converts to Persian', () => {
  const r = TX.convertLayout('sghl', 'auto');
  assert.equal(r.direction, 'toFa');
  assert.equal(r.text, 'سلام');
});
t('convertLayout auto: Persian input converts to English', () => {
  const r = TX.convertLayout('سلام', 'auto');
  assert.equal(r.direction, 'toEn');
  assert.equal(r.text, 'sghl');
});
t('convertLayout: Persian digits -> Latin (toEn)', () => {
  assert.equal(TX.convertLayout('۱۲۳', 'toEn').text, '123');
});
t('convertLayout: converts every Latin char (documented behavior)', () => {
  // 'salam' is itself Latin text, so every letter maps through the layout:
  // s=س a=ش l=م a=ش m=پ — exactly what typing "salam" on a Persian layout yields.
  assert.equal(TX.convertLayout('salam', 'toFa').text, 'سشمشپ');
});
t('convertLayout: empty input is a no-op', () => {
  const r = TX.convertLayout('');
  assert.equal(r.text, '');
  assert.equal(r.direction, null);
});
t('convertLayout: legacy layout maps m to ئ', () => {
  // 'سلام' typed on legacy layout ends with m=ئ variant path: 'sghl' identical
  // across layouts; the m difference shows in 'shoma'->'سئما' style tokens.
  const legacy = TX.convertLayout('m', 'toFa', 'legacy').text;
  const standard = TX.convertLayout('m', 'toFa', 'standard').text;
  assert.equal(legacy, 'ئ');
  assert.equal(standard, 'پ');
});

t('dominantScript: fa / en / null', () => {
  assert.equal(TX.dominantScript('سلام علیکم'), 'fa');
  assert.equal(TX.dominantScript('hello world'), 'en');
  assert.equal(TX.dominantScript('123 !!!'), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
