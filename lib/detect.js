// Shared helpers (content scripts, popup, options, background). Safe to load more than once.
var PFDetect = globalThis.PFDetect || (() => {
  const RTL_REGEX = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  const PERSIAN_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const KNOWN_PERSIAN_FONTS = [
    'vazir', 'vazirmatn', 'shabnam', 'sahel', 'samim', 'tanha', 'parastoo', 'gandom', 'nahid', 'mikhak',
    'iransans', 'iranyekan', 'iraniansans', 'yekan', 'yekanbakh', 'estedad', 'peyda', 'morabba', 'kalameh',
    'anjoman', 'dana', 'lalezar', 'bnazanin', 'btitr', 'bmitra', 'blotus', 'byekan', 'bkoodak', 'broya',
    'xbroya', 'xbniloofar', 'xbzar', 'nazanin', 'notonaskharabic', 'notosansarabic', 'notokufiarabic',
    'notonastaliqurdu', 'markazitext', 'amiri', 'harmattan', 'scheherazade', 'ibmplexsansarabic'
  ];
  const ICON_FONT_PATTERNS = [/font[\s-]?awesome/i, /material[\s-]?icons?/i, /material[\s-]?symbols?/i, /bootstrap[\s-]?icons?/i, /glyphicons?/i, /flaticon/i, /icomoon/i, /^fa[\s-]?(solid|regular|light|thin|brands|duotone)/i, /icon[\s-]?font/i, /^(remix|ion|feather|tabler|line)[\s-]?icons?/i, /dashicons/i, /codicon/i, /^icons?$/i];
  const MONO_PATTERNS = [/\bmono(space)?\b/i, /courier/i, /consolas/i, /menlo/i, /monaco/i, /lucida[\s-]?console/i, /source[\s-]?code/i, /fira[\s-]?code/i, /jetbrains/i, /cascadia/i, /sfmono/i, /mono$/i];
  const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'MATH', 'PRE', 'CODE', 'KBD', 'SAMP', 'TT', 'VAR', 'IFRAME', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'HEAD', 'TITLE', 'META', 'LINK', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'IMG']);
  const EXCLUDED_ANCESTOR_SELECTOR = 'pre,code,kbd,samp,tt,var,svg,math,template,[data-mono],.mono,[data-pf-ignore]';
  const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel']);
  const OWN_FAMILIES = /^(PF Vazirmatn( Digits)?|PFUserFont)$/i;

  function hasRtl(t) { return typeof t === 'string' && RTL_REGEX.test(t); }
  function hasPersian(t) { return typeof t === 'string' && PERSIAN_REGEX.test(t); }
  function firstStrong(text) {
    if (!text) return null;
    const ltr = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
    for (const ch of text) { if (RTL_REGEX.test(ch)) return 'rtl'; if (ltr.test(ch)) return 'ltr'; }
    return null;
  }
  // Mostly-Persian text (used by "smart" digits so numbers inside English sentences stay Latin)
  function isPersianDominant(text) {
    let fa = 0, en = 0;
    for (const ch of text) { if (PERSIAN_REGEX.test(ch)) fa++; else if (/[A-Za-z]/.test(ch)) en++; }
    return fa > 0 && en <= fa * 0.25;
  }
  function isExcludedTag(e) { return !!e.tagName && EXCLUDED_TAGS.has(e.tagName.toUpperCase()); }
  function shouldExcludeElement(e) {
    if (!e || e.nodeType !== 1 || !e.tagName) return true;
    if (isExcludedTag(e)) return true;
    if (e.isContentEditable) return true;
    if (e.hasAttribute('data-mono') || e.hasAttribute('data-pf-ignore') || (e.classList && e.classList.contains('mono'))) return true;
    return false;
  }
  function isInExcludedContext(e) {
    if (shouldExcludeElement(e)) return true;
    try { return !!(e.closest && e.closest(EXCLUDED_ANCESTOR_SELECTOR)); } catch { return false; }
  }
  // Text fields the user types in (no password / number / hidden / etc.)
  function isTextField(e) {
    if (!e || e.nodeType !== 1) return false;
    if (e.tagName === 'TEXTAREA') return !e.readOnly && !e.disabled;
    if (e.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((e.getAttribute('type') || '').toLowerCase()) && !e.readOnly && !e.disabled;
    return false;
  }
  function isEditableRoot(e) {
    return !!(e && e.nodeType === 1 && e.isContentEditable && !(e.parentElement && e.parentElement.isContentEditable));
  }
  function editableRootOf(e) {
    if (!e || e.nodeType !== 1) return null;
    if (isTextField(e)) return e;
    if (!e.isContentEditable) return null;
    let r = e;
    while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement;
    return r;
  }
  function splitFamilies(f) { return (f || '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean); }
  function stripOwnFamilies(f) { return splitFamilies(f).filter(x => !OWN_FAMILIES.test(x)).map(x => /^[a-z-]+$/i.test(x) ? x : `"${x.replace(/"/g, '')}"`).join(', '); }
  const norm = s => s.toLowerCase().replace(/[\s_-]+/g, '');
  function isIconFamily(f) { return splitFamilies(f).some(fam => ICON_FONT_PATTERNS.some(p => p.test(fam))); }
  function isMonoFamily(f) { const first = splitFamilies(f)[0]; return !!first && (first.toLowerCase() === 'monospace' || MONO_PATTERNS.some(p => p.test(first))); }
  function hasKnownPersianFamily(f) {
    return splitFamilies(f).some(fam => { const n = norm(fam); return KNOWN_PERSIAN_FONTS.some(k => n === k || (k.length >= 5 && n.startsWith(k))); });
  }
  function normalizeDomain(d) { if (!d) return ''; let n = String(d).toLowerCase().trim().replace(/\.$/, ''); if (n.startsWith('www.')) n = n.slice(4); return n; }
  function hostMatches(d, p) {
    if (!d || !p) return false;
    const nd = normalizeDomain(d), np = normalizeDomain(p);
    if (np === nd) return true;
    if (np.startsWith('*.')) { const b = np.slice(2); return nd === b || nd.endsWith('.' + b); }
    return false;
  }
  function lookupHost(map, host) {
    if (!map || typeof map !== 'object') return undefined;
    const n = normalizeDomain(host);
    for (const [p, v] of Object.entries(map)) if (normalizeDomain(p) === n) return v;
    for (const [p, v] of Object.entries(map)) if (hostMatches(n, p)) return v;
    return undefined;
  }

  const SETTINGS_SCHEMA = {
    masterEnabled: true,
    digitMode: 'auto',          // 'auto' | 'smart' | 'persian'
    exclusionList: [],
    siteOverrides: {},          // { host: true|false }
    siteFonts: {},              // { host: 'vazirmatn'|'custom' }  (missing = follow global)
    useCustomFont: false,
    fontScale: 100,             // % (size-adjust, only Persian glyphs)
    lineHeight: 0,              // 0 = site default, otherwise unitless
    styleInputs: true,          // Persian font inside inputs / textareas / editors
    editorEnabled: true,        // floating toolbar on text fields
    kbLayout: 'standard'        // 'standard' (ISIRI 9147) | 'legacy'
  };
  function isSiteAllowed(d, s) {
    const o = lookupHost(s.siteOverrides, d);
    if (o !== undefined) return o === true;
    if (Array.isArray(s.exclusionList)) for (const p of s.exclusionList) if (hostMatches(d, p)) return false;
    return true;
  }
  function isSiteEnabled(d, s) { return s.masterEnabled !== false && isSiteAllowed(d, s); }
  function siteFontFor(d, s) { return lookupHost(s.siteFonts, d) || 'auto'; }
  // Sanitize imported / stored settings
  function sanitize(raw) {
    const s = { ...SETTINGS_SCHEMA };
    if (!raw || typeof raw !== 'object') return s;
    const bool = k => { if (typeof raw[k] === 'boolean') s[k] = raw[k]; };
    ['masterEnabled', 'useCustomFont', 'styleInputs', 'editorEnabled'].forEach(bool);
    if (['auto', 'smart', 'persian'].includes(raw.digitMode)) s.digitMode = raw.digitMode;
    if (['standard', 'legacy'].includes(raw.kbLayout)) s.kbLayout = raw.kbLayout;
    if (Number.isFinite(raw.fontScale)) s.fontScale = Math.min(150, Math.max(80, Math.round(raw.fontScale)));
    if (Number.isFinite(raw.lineHeight)) s.lineHeight = raw.lineHeight === 0 ? 0 : Math.min(3, Math.max(1, raw.lineHeight));
    const validHost = h => typeof h === 'string' && /^(\*\.)?[a-z0-9.-]+$/i.test(h.trim());
    if (Array.isArray(raw.exclusionList)) s.exclusionList = [...new Set(raw.exclusionList.filter(validHost).map(h => normalizeDomain(h)))];
    if (raw.siteOverrides && typeof raw.siteOverrides === 'object') for (const [h, v] of Object.entries(raw.siteOverrides)) if (validHost(h) && typeof v === 'boolean') s.siteOverrides[normalizeDomain(h)] = v;
    if (raw.siteFonts && typeof raw.siteFonts === 'object') for (const [h, v] of Object.entries(raw.siteFonts)) if (validHost(h) && ['vazirmatn', 'custom'].includes(v)) s.siteFonts[normalizeDomain(h)] = v;
    return s;
  }

  return { RTL_REGEX, PERSIAN_REGEX, SETTINGS_SCHEMA, hasRtl, hasPersian, firstStrong, isPersianDominant, isExcludedTag, shouldExcludeElement, isInExcludedContext, isTextField, isEditableRoot, editableRootOf, isIconFamily, isMonoFamily, hasKnownPersianFamily, stripOwnFamilies, normalizeDomain, hostMatches, lookupHost, isSiteAllowed, isSiteEnabled, siteFontFor, sanitize };
})();
globalThis.PFDetect = PFDetect;
