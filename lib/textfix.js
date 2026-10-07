// Pure text helpers: keyboard-layout conversion (fa <-> en) and light Persian proofreading.
// No DOM access here, so it is unit-testable and shared by content scripts + options page.
var PFText = globalThis.PFText || (() => {
  // US QWERTY key -> Persian char. Shared by both Persian layouts.
  const COMMON = {
    q: 'ض', w: 'ص', e: 'ث', r: 'ق', t: 'ف', y: 'غ', u: 'ع', i: 'ه', o: 'خ', p: 'ح', '[': 'ج', ']': 'چ',
    a: 'ش', s: 'س', d: 'ی', f: 'ب', g: 'ل', h: 'ا', j: 'ت', k: 'ن', l: 'م', ';': 'ک', "'": 'گ',
    z: 'ظ', x: 'ط', c: 'ز', v: 'ر', b: 'ذ', n: 'د', ',': 'و',
    H: 'آ', C: 'ژ', '?': '؟'
  };
  // Persian Standard (ISIRI 9147, default on Windows 10/11 "Persian (Standard)", macOS, Android Gboard)
  const STANDARD = { ...COMMON, m: 'پ', M: 'ء', '\\': '\\' };
  // Legacy Windows "Persian" layout
  const LEGACY = { ...COMMON, m: 'ئ', '\\': 'پ' };
  const LAYOUTS = { standard: STANDARD, legacy: LEGACY };

  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹', AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const AR_LETTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const LATIN_LETTER = /[A-Za-z]/;

  function maps(layout) {
    const en2fa = LAYOUTS[layout] || STANDARD;
    const fa2en = {};
    for (const [k, v] of Object.entries(en2fa)) if (!(v in fa2en) || k === k.toLowerCase()) fa2en[v] = k;
    Object.assign(fa2en, { 'ي': 'd', 'ك': ';', 'ى': 'd' });
    for (let i = 0; i < 10; i++) { fa2en[FA_DIGITS[i]] = String(i); fa2en[AR_DIGITS[i]] = String(i); }
    return { en2fa, fa2en };
  }

  // Which script dominates? 'fa' | 'en' | null
  function dominantScript(text) {
    let fa = 0, en = 0;
    for (const ch of text) { if (AR_LETTER.test(ch)) fa++; else if (LATIN_LETTER.test(ch)) en++; }
    if (!fa && !en) return null;
    return fa >= en ? 'fa' : 'en';
  }

  // Convert text typed in the wrong layout. direction: 'toFa' | 'toEn' | 'auto'
  function convertLayout(text, direction = 'auto', layout = 'standard') {
    if (!text) return { text, direction: null };
    const { en2fa, fa2en } = maps(layout);
    if (direction === 'auto') direction = dominantScript(text) === 'fa' ? 'toEn' : 'toFa';
    let out = '';
    if (direction === 'toFa') {
      for (const ch of text) {
        if (ch in en2fa) out += en2fa[ch];
        else if (/[A-Z]/.test(ch) && ch.toLowerCase() in en2fa) out += en2fa[ch.toLowerCase()]; // Caps Lock
        else out += ch;
      }
    } else {
      for (const ch of text) out += ch in fa2en ? fa2en[ch] : ch === '\u200C' ? ' ' : ch;
    }
    return { text: out, direction };
  }

  // Characters that belong to a "typed in one layout" run.
  const EN_KEYS = new Set(Object.keys(STANDARD).concat(Object.keys(LEGACY)));
  function charClass(ch) {
    if (AR_LETTER.test(ch) || ch === '\u200C') return 'fa';
    if (LATIN_LETTER.test(ch) || (EN_KEYS.has(ch) && !'.?/\\'.includes(ch))) return 'en';
    if (ch === '\n' || ch === '\r') return 'break';
    return 'neutral'; // spaces, digits, . / ? etc.
  }
  // Find the run right before the caret that was typed in one layout, e.g. "سلام lkdhl o,fd|" -> "lkdhl o,fd"
  function findRunBefore(text, caret) {
    let i = caret, script = null;
    while (i > 0) {
      const c = charClass(text[i - 1]);
      if (c === 'break') break;
      if (c !== 'neutral') { if (!script) script = c; else if (c !== script) break; }
      i--;
    }
    let start = i;
    while (start < caret && charClass(text[start]) === 'neutral') start++;
    return script ? { start, end: caret, script } : null;
  }

  // ---------- Persian proofreading (conservative, Virastar-style) ----------
  const L = '\u0600-\u06FF\u200C';             // Persian/Arabic block + ZWNJ
  const W = '[\u0621-\u064A\u0660-\u0669\u066E-\u06D3\u06F0-\u06F9\u06A9\u06AF\u06CC\u067E\u0686\u0698]';
  function fixPersian(text, opts = {}) {
    if (!text || !AR_LETTER.test(text)) return text;
    let t = text;
    t = t.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');                  // Arabic Yeh/Kaf -> Persian
    t = t.replace(/\u0640+/g, '');                                     // kashida
    t = t.replace(/[٠-٩]/g, d => FA_DIGITS[AR_DIGITS.indexOf(d)]);     // Arabic-Indic -> Persian digits
    t = t.replace(/\u200C{2,}/g, '\u200C').replace(/ ?\u200C ?/g, '\u200C'); // stray ZWNJ + spaces
    t = t.replace(/[ \t]{2,}/g, ' ');                                   // double spaces
    // English punctuation next to Persian -> Persian punctuation
    t = t.replace(new RegExp(`(${W}) *,(?!\\d)`, 'g'), '$1،');
    t = t.replace(new RegExp(`(${W}) *;`, 'g'), '$1؛');
    t = t.replace(new RegExp(`(${W}) *\\?`, 'g'), '$1؟');
    // no space before, one space after punctuation
    t = t.replace(/ +([،؛؟!.:)\]»])/g, '$1');
    t = t.replace(new RegExp(`([،؛؟!])(?=${W})`, 'g'), '$1 ');
    t = t.replace(/([(\[«]) +/g, '$1');
    t = t.replace(/\.{3,}/g, '…');
    // "..." -> «...» when the quoted part is Persian
    t = t.replace(/"([^"\n]*?)"/g, (m, inner) => AR_LETTER.test(inner) && !LATIN_LETTER.test(inner) ? `«${inner}»` : m);
    // ZWNJ: می/نمی prefix and common suffixes
    t = t.replace(new RegExp(`(^|[^${L}])(ن?می) (?=${W}{2,})`, 'g'), '$1$2\u200C');
    t = t.replace(new RegExp(`(${W}{2,}) (ها|های|هایی|هایم|هایت|هایش|هایمان|هایتان|هایشان|تر|ترین|تری)(?=$|[^${L}])`, 'g'), '$1\u200C$2');
    if (opts.digits === 'fa') t = toPersianDigits(t);
    return t;
  }
  function toPersianDigits(t) { return t.replace(/[0-9]/g, d => FA_DIGITS[+d]).replace(/[٠-٩]/g, d => FA_DIGITS[AR_DIGITS.indexOf(d)]); }
  function toEnglishDigits(t) { return t.replace(/[۰-۹]/g, d => FA_DIGITS.indexOf(d)).replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d)); }

  function stats(t) {
    const words = (t.match(/[^\s\u200C]+(?:\u200C[^\s\u200C]+)*/g) || []).length;
    return { chars: [...t].length, words };
  }

  return { convertLayout, findRunBefore, dominantScript, fixPersian, toPersianDigits, toEnglishDigits, stats, LAYOUTS };
})();
globalThis.PFText = PFText;
