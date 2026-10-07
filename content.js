// Typography engine. Marks Persian elements with data-pf-* attributes; all styling lives in one
// constructed stylesheet shared by the document and every open shadow root.
(() => {
  if (window.__pfTypo) return;
  const D = PFDetect;
  const TIME_BUDGET_MS = 8;
  const DEBUG = false;
  const log = (...a) => { if (DEBUG) console.debug('[PersianFix]', ...a); };

  // Persian/Arabic glyphs + ZWNJ/ZWJ/bidi marks + Arabic punctuation. Latin text keeps the site's own font.
  const AR_RANGE = 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F, U+00AB, U+00BB, U+2026';
  const DIGIT_RANGE = 'U+0030-0039, U+0025, U+066A-066C';
  const WEIGHTS = [['Regular', '100 449'], ['Medium', '450 599'], ['Bold', '600 900']];

  let settings = { ...D.SETTINGS_SCHEMA };
  let active = false;
  let processed = new WeakSet();
  const shadowRoots = new Set();
  const observers = new Map();
  const queue = [];
  let walker = null, scheduled = false, styledCount = 0;

  // In iframes use the top-level site, so per-site settings cover its frames too.
  function getHost() {
    try {
      const ao = location.ancestorOrigins;
      const origin = ao && ao.length ? ao[ao.length - 1] : self.origin;
      return new URL(origin).hostname || location.hostname || '';
    } catch { return location.hostname || ''; }
  }
  const currentHost = getHost();
  const isTop = window === window.top;

  // ---------- fonts (FontFace API: works under strict CSP, cross-browser, supports size-adjust) ----------
  const fontBuffers = {};           // name -> ArrayBuffer
  let faces = [];                   // FontFace objects we added
  let fontsWanted = false, fontsBuilt = false, userFontReady = false, userFontLoading = null;
  let buildingPromise = null, buildToken = 0;

  async function getBuffer(file) {
    if (!fontBuffers[file]) {
      fontBuffers[file] = fetch(chrome.runtime.getURL('fonts/' + file)).then(r => r.arrayBuffer());
      // Don't negative-cache: a transient fetch failure must not poison this
      // weight until the next full reload.
      fontBuffers[file].catch(() => { delete fontBuffers[file]; });
    }
    return fontBuffers[file];
  }
  function b64ToBuffer(dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(b64).buffer;
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function wantsCustom() {
    const sf = D.siteFontFor(currentHost, settings);
    return sf === 'custom' || (sf !== 'vazirmatn' && settings.useCustomFont);
  }
  async function loadUserFontBuffers() {
    const { userFont, userFontBold } = await chrome.storage.local.get(['userFont', 'userFontBold']);
    return { regular: userFont ? b64ToBuffer(userFont) : null, bold: userFontBold ? b64ToBuffer(userFontBold) : null };
  }
  // Single-flight: ensureFonts, storage handlers and editor.js can all call
  // buildFaces; overlapping runs used to leak duplicate FontFace objects.
  function buildFaces() {
    if (buildingPromise) return buildingPromise;
    const token = ++buildToken;
    buildingPromise = runBuildFaces(token).finally(() => { buildingPromise = null; });
    return buildingPromise;
  }

  async function runBuildFaces(token) {
    const stale = () => token !== buildToken;   // a newer build superseded us
    fontsWanted = true;
    const scale = (settings.fontScale || 100) + '%';
    const metrics = { ascentOverride: '95%', descentOverride: '45%', lineGapOverride: '0%', sizeAdjust: scale };
    const next = [];
    try {
      for (const [w, range] of WEIGHTS) {
        if (stale()) return;
        const buf = await getBuffer(`Vazirmatn-${w}.woff2`);
        if (stale()) return;
        next.push(new FontFace('PF Vazirmatn', buf, { weight: range, unicodeRange: AR_RANGE, display: 'swap', ...metrics }));
        next.push(new FontFace('PF Vazirmatn Digits', buf, { weight: range, unicodeRange: DIGIT_RANGE, display: 'swap', ...metrics }));
      }
      userFontReady = false;
      if (wantsCustom()) {
        const u = await loadUserFontBuffers();
        if (stale()) return;
        if (u.regular) next.push(new FontFace('PFUserFont', u.regular, { weight: u.bold ? '100 549' : '100 900', unicodeRange: AR_RANGE, display: 'swap', sizeAdjust: scale }));
        if (u.bold) next.push(new FontFace('PFUserFont', u.bold, { weight: '550 900', unicodeRange: AR_RANGE, display: 'swap', sizeAdjust: scale }));
      }
      const results = await Promise.allSettled(next.map(f => f.load()));
      if (stale()) return;   // never touch shared state if a newer build exists
      for (const f of faces) try { document.fonts.delete(f); } catch {}
      faces = next.filter((f, i) => results[i].status === 'fulfilled');
      for (const f of faces) document.fonts.add(f);
      userFontReady = faces.some(f => f.family === 'PFUserFont');
      if (wantsCustom() && !userFontReady) log('custom font failed, using Vazirmatn');
      fontsBuilt = true;
      updateSheet();
    } catch (e) { log('font load failed', e); }
  }
  function ensureFonts() { if (!fontsWanted) buildFaces(); }
  function dropFaces() { for (const f of faces) try { document.fonts.delete(f); } catch {} faces = []; fontsWanted = fontsBuilt = userFontReady = false; }

  // ---------- one shared stylesheet ----------
  const familyIds = new Map();      // original family stack -> id
  let sheet = null;
  function getSheet() {
    if (!sheet) { try { sheet = new CSSStyleSheet(); } catch { sheet = null; } }
    return sheet;
  }
  function adopt(root) {
    const sh = getSheet(); if (!sh) return;
    try { if (!root.adoptedStyleSheets.includes(sh)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sh]; } catch (e) { log(e); }
  }
  function unadopt(root) { try { root.adoptedStyleSheets = root.adoptedStyleSheets.filter(s => s !== sheet); } catch {} }
  function familyId(orig) {
    let id = familyIds.get(orig);
    if (id === undefined) { id = familyIds.size + 1; familyIds.set(orig, id); updateSheet(); }
    return id;
  }
  function updateSheet() {
    const sh = getSheet(); if (!sh) return;
    const main = userFontReady ? `'PFUserFont', 'PF Vazirmatn'` : `'PF Vazirmatn'`;
    const orig = 'var(--pf-orig, sans-serif)';
    const S = ':not(#pf-none)';
    let css = `
      [data-pf-rtl]${S} { font-family: ${main}, ${orig} !important; font-kerning: normal; }
      [data-pf-rtl][data-pf-digits]${S} { font-family: ${main}, 'PF Vazirmatn Digits', ${orig} !important; font-feature-settings: 'ss01' 1 !important; }
      [data-pf-rtl][data-pf-ls="fix"]${S} { letter-spacing: normal !important; }
      [data-pf-input]${S} { font-family: ${main}, ${orig} !important; }`;
    if (settings.lineHeight) css += `\n[data-pf-rtl]${S} { line-height: ${Number(settings.lineHeight)} !important; }`;
    for (const [fam, id] of familyIds) css += `\n[data-pf-f="${id}"] { --pf-orig: ${fam}; }`;
    try { sh.replaceSync(css); } catch (e) { log(e); }
  }

  // ---------- shadow DOM ----------
  function attachShadow(sr) {
    if (!sr || shadowRoots.has(sr)) return;
    shadowRoots.add(sr);
    adopt(sr);
    observe(sr);
    enqueue(sr, true);
  }
  function sweepShadowRoots() {
    if (!active) return;
    const roots = [document, ...shadowRoots];
    for (let i = 0; i < roots.length; i++) {
      try {
        for (const el of roots[i].querySelectorAll('*')) {
          const sr = el.shadowRoot;
          if (sr && sr.mode === 'open' && !shadowRoots.has(sr)) { attachShadow(sr); roots.push(sr); }
        }
      } catch {}
    }
  }

  // ---------- detection ----------
  function ownText(el) {
    let t = '';
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.data;
    return t;
  }
  function origFamily(cs) {
    const f = D.stripOwnFamilies(cs.fontFamily || '');
    return f && !/[;{}<>\\]/.test(f) ? f : 'sans-serif';
  }
  function styleText(el, text) {
    const cs = getComputedStyle(el);
    const ff = origFamily(cs);
    if (D.isIconFamily(ff) || D.isMonoFamily(ff)) return;
    if (!wantsCustom() && D.hasKnownPersianFamily(ff)) return;
    ensureFonts();
    el.setAttribute('data-pf-rtl', '');
    el.setAttribute('data-pf-f', familyId(ff));
    const dm = settings.digitMode;
    if (dm === 'persian' || (dm === 'smart' && D.isPersianDominant(text))) el.setAttribute('data-pf-digits', '');
    const ls = cs.letterSpacing;
    if (ls && ls !== 'normal' && parseFloat(ls) !== 0) el.setAttribute('data-pf-ls', 'fix');
    if (!el.hasAttribute('dir') && el !== document.body && el !== document.documentElement &&
        cs.direction !== 'rtl' && D.firstStrong(text) === 'rtl') {
      el.setAttribute('dir', 'auto');
      el.setAttribute('data-pf-dir', 'auto');
    }
    styledCount++;
  }
  // Inputs / textareas / contenteditable: Persian glyphs only (unicode-range), so English typing is untouched.
  function styleField(el) {
    if (!settings.styleInputs || el.hasAttribute('data-pf-input') || el.closest('[data-pf-ignore]')) return;
    const ff = origFamily(getComputedStyle(el));
    if (D.isIconFamily(ff) || D.isMonoFamily(ff)) return;          // code editors keep monospace
    if (!wantsCustom() && D.hasKnownPersianFamily(ff)) return;
    ensureFonts();
    el.setAttribute('data-pf-input', '');
    el.setAttribute('data-pf-f', familyId(ff));
  }
  function visit(el) {
    if (el.shadowRoot && el.shadowRoot.mode === 'open') attachShadow(el.shadowRoot);
    if (processed.has(el)) return;
    processed.add(el);
    try {
      const text = ownText(el);
      if (D.hasPersian(text)) styleText(el, text);
    } catch (e) { log(e); }
  }

  // ---------- incremental scheduler ----------
  const filter = {
    acceptNode(n) {
      if (D.isTextField(n) || D.isEditableRoot(n)) { try { styleField(n); } catch {} return NodeFilter.FILTER_REJECT; }
      return D.shouldExcludeElement(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  };
  function enqueue(node, deep) { if (node) { queue.push({ node, deep }); schedule(); } }
  function schedule() {
    if (scheduled || !active) return;
    scheduled = true;
    if ('requestIdleCallback' in window) requestIdleCallback(work, { timeout: 200 }); else setTimeout(work, 16);
  }
  function work() {
    scheduled = false;
    if (!active) return;
    const end = performance.now() + TIME_BUDGET_MS;
    while (performance.now() < end) {
      if (walker) { const n = walker.nextNode(); if (n) visit(n); else walker = null; continue; }
      const item = queue.shift();
      if (!item) break;
      const { node, deep } = item;
      if (!node.isConnected) continue;
      if (node.nodeType === 1) {
        if (D.isTextField(node) || D.isEditableRoot(node)) { if (!node.closest('[data-pf-ignore]')) styleField(node); continue; }
        if (D.isInExcludedContext(node)) continue;
        visit(node);
      }
      if (deep && (node.nodeType === 1 || node.nodeType === 11)) walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, filter);
    }
    if (walker || queue.length) schedule();
    else if (isTop) reportState();
  }

  // ---------- mutations ----------
  function onMutations(muts) {
    if (!active) return;
    for (const m of muts) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) enqueue(n, true);
          else if (n.nodeType === 3 && m.target.nodeType === 1) recheck(m.target);
        }
      } else if (m.type === 'characterData') {
        const p = m.target.parentElement;
        if (p) recheck(p);
      }
    }
  }
  function recheck(el) { if (!el.hasAttribute('data-pf-rtl')) { processed.delete(el); enqueue(el, false); } }
  function observe(root) {
    if (observers.has(root)) return;
    const mo = new MutationObserver(onMutations);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    observers.set(root, mo);
  }

  // ---------- lifecycle ----------
  function forEachMarked(fn) {
    for (const r of [document, ...shadowRoots]) { try { r.querySelectorAll('[data-pf-rtl],[data-pf-input]').forEach(fn); } catch {} }
  }
  function clearMarks() {
    forEachMarked(el => {
      ['data-pf-rtl', 'data-pf-digits', 'data-pf-ls', 'data-pf-input', 'data-pf-f'].forEach(a => el.removeAttribute(a));
      if (el.getAttribute('data-pf-dir') === 'auto') el.removeAttribute('dir');
      el.removeAttribute('data-pf-dir');
    });
    processed = new WeakSet();
    queue.length = 0; walker = null; styledCount = 0;
  }
  function activate() {
    if (active) return;
    active = true;
    updateSheet();
    adopt(document);
    observe(document.documentElement);
    enqueue(document.documentElement, true);
    const later = () => setTimeout(sweepShadowRoots, 1500);
    if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
    reportState();
  }
  function deactivate() {
    if (!active) return;
    active = false;
    for (const mo of observers.values()) mo.disconnect();
    observers.clear();
    clearMarks();
    unadopt(document);
    for (const sr of shadowRoots) unadopt(sr);
    shadowRoots.clear();
    dropFaces();
    reportState();
  }
  function fullRescan() {
    clearMarks();
    if (!active) return;
    for (const sr of shadowRoots) enqueue(sr, true);
    enqueue(document.documentElement, true);
  }
  function applyEnabledState() {
    const enabled = D.isSiteEnabled(currentHost, settings);
    if (enabled && !active) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyEnabledState, { once: true });
      else activate();
    } else if (!enabled && active) deactivate();
    else if (!enabled) reportState();
  }
  function reportState() {
    if (!isTop) return;
    try { chrome.runtime.sendMessage({ type: 'pf-state', active, count: styledCount }).catch?.(() => {}); } catch {}
  }

  function onStorageChanged(changes, area) {
    if (area === 'local') {
      if ((changes.userFont || changes.userFontBold) && active && fontsWanted) buildFaces();
      return;
    }
    if (area !== 'sync') return;
    const prevCustom = wantsCustom();
    for (const k in changes) settings[k] = changes[k].newValue === undefined ? D.SETTINGS_SCHEMA[k] : changes[k].newValue;
    applyEnabledState();
    if (!active) return;
    const customChanged = prevCustom !== wantsCustom();
    if (changes.fontScale || customChanged) { if (fontsWanted) buildFaces(); }
    if (changes.lineHeight) updateSheet();
    if (changes.digitMode || changes.styleInputs || customChanged) fullRescan(); // these affect which elements get marked
  }

  async function init() {
    try {
      settings = D.sanitize(await chrome.storage.sync.get(D.SETTINGS_SCHEMA));
      chrome.storage.onChanged.addListener(onStorageChanged);
      applyEnabledState();
    } catch (e) { console.warn('[PersianFix] init failed:', e); }
  }

  // Small API for editor.js (same isolated world)
  window.__pfTypo = {
    get settings() { return settings; },
    get host() { return currentHost; },
    get active() { return active; },
    ensureFonts,
    onSettings: fn => chrome.storage.onChanged.addListener((c, a) => { if (a === 'sync') fn(settings, c); })
  };
  // Bfcache restore: content script survives but nothing re-runs, so the
  // background service worker would keep a stale gray icon. Re-report.
  window.addEventListener('pageshow', e => { if (e.persisted) reportState(); });
  init();
})();
