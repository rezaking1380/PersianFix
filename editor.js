// Floating text tools for inputs / textareas / contenteditable editors.
// - ⇄  fix text typed in the wrong keyboard layout (fa <-> en), selection or last run before the caret
// - ✓  Persian proofreading (ی/ک, half-spaces, punctuation, spacing)
// - ZWNJ insert, direction toggle, and a full editor dialog
(() => {
  if (window.__pfEditor) return;
  window.__pfEditor = true;
  const D = PFDetect, T = PFText;
  const typo = () => window.__pfTypo;
  const t = (k, ...subs) => { try { return chrome.i18n.getMessage(k, subs) || k; } catch { return k; } };
  const uiDir = (() => { try { return chrome.i18n.getMessage('@@bidi_dir') || 'rtl'; } catch { return 'rtl'; } })();

  function settings() { return (typo() && typo().settings) || D.SETTINGS_SCHEMA; }
  function host() { return (typo() && typo().host) || location.hostname; }
  function enabled() { const s = settings(); return s.editorEnabled !== false && D.isSiteEnabled(host(), s); }

  // ---------- helpers for fields ----------
  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  function fieldFrom(el) { const r = D.editableRootOf(el); return r && !r.closest('[data-pf-ignore]') ? r : null; }
  const isPlain = el => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  function supportsSelection(el) { try { return el.selectionStart !== null && el.selectionStart !== undefined; } catch { return false; } }
  function getSel(el) {
    const root = el.getRootNode();
    return (root.getSelection && root.getSelection()) || window.getSelection();
  }

  // Replace [start,end) of a plain field, keeping the browser undo stack when possible.
  function replacePlain(el, start, end, text) {
    el.focus();
    const sel = supportsSelection(el);
    if (sel) el.setSelectionRange(start, end); else el.select();
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch {}
    if (!ok || (sel && el.value.slice(start, start + text.length) !== text)) {
      const v = el.value, nv = sel ? v.slice(0, start) + text + v.slice(end) : text;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, nv); // React-friendly
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
      if (sel) el.setSelectionRange(start + text.length, start + text.length);
    }
  }
  function replaceRange(range, text) {
    const sel = getSel(range.startContainer.parentElement || document.body);
    sel.removeAllRanges(); sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch {}
    if (!ok) {
      range.deleteContents();
      const n = document.createTextNode(text);
      range.insertNode(n);
      range.setStartAfter(n); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
      n.parentElement && n.parentElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }
  function textNodesIn(root) {
    const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) out.push(n);
    return out;
  }

  // Apply fn to selection, or (whole) field when nothing is selected
  function transformField(el, fn) {
    if (isPlain(el)) {
      const v = el.value;
      let s = 0, e = v.length;
      if (supportsSelection(el) && el.selectionStart !== el.selectionEnd) { s = el.selectionStart; e = el.selectionEnd; }
      const out = fn(v.slice(s, e));
      if (out !== v.slice(s, e)) replacePlain(el, s, e, out);
      return out !== v.slice(s, e);
    }
    const sel = getSel(el);
    if (sel.rangeCount && !sel.isCollapsed && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const r = sel.getRangeAt(0), src = r.toString(), out = fn(src);
      if (out !== src) replaceRange(r, out);
      return out !== src;
    }
    // whole editor: node by node so formatting survives
    let changed = false;
    for (const n of textNodesIn(el)) {
      const out = fn(n.data);
      if (out !== n.data) { const r = document.createRange(); r.selectNodeContents(n); replaceRange(r, out); changed = true; }
    }
    return changed;
  }

  // ⇄ layout conversion
  function convertField(el) {
    const layout = settings().kbLayout;
    if (isPlain(el)) {
      const v = el.value;
      let s, e;
      if (!supportsSelection(el)) { s = 0; e = v.length; }
      else if (el.selectionStart !== el.selectionEnd) { s = el.selectionStart; e = el.selectionEnd; }
      else { const run = T.findRunBefore(v, el.selectionEnd); if (run) { s = run.start; e = run.end; } else { s = 0; e = v.length; } }
      if (s === e) return null;
      const r = T.convertLayout(v.slice(s, e), 'auto', layout);
      replacePlain(el, s, e, r.text);
      if (supportsSelection(el)) el.setSelectionRange(s + r.text.length, s + r.text.length);
      return r.direction;
    }
    const sel = getSel(el);
    if (!sel.rangeCount) return null;
    let range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return null;
    if (range.collapsed) {
      const node = sel.focusNode;
      if (!node || node.nodeType !== 3) return null;
      const run = T.findRunBefore(node.data, sel.focusOffset);
      if (!run) return null;
      range = document.createRange(); range.setStart(node, run.start); range.setEnd(node, run.end);
    }
    const r = T.convertLayout(range.toString(), 'auto', layout);
    replaceRange(range, r.text);
    return r.direction;
  }
  const fixField = el => transformField(el, s => T.fixPersian(s));
  function insertZwnj(el) {
    if (isPlain(el)) { if (supportsSelection(el)) replacePlain(el, el.selectionStart, el.selectionEnd, '\u200C'); return; }
    const sel = getSel(el); if (sel.rangeCount) replaceRange(sel.getRangeAt(0), '\u200C');
  }
  function toggleDir(el) {
    const cur = el.getAttribute('dir') || getComputedStyle(el).direction;
    el.setAttribute('dir', cur === 'rtl' ? 'ltr' : 'rtl');
    return el.getAttribute('dir');
  }

  // ---------- UI (closed shadow root so pages can't restyle it) ----------
  let hostEl, shadow, bar, toast, toastTimer, field = null;
  const dismissed = new WeakSet();
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'PF Vazirmatn', Vazirmatn, Tahoma, system-ui, sans-serif; }
    .bar { position: fixed; display: none; gap: 2px; padding: 3px; border-radius: 9px; background: #1e293b; color: #e2e8f0;
           box-shadow: 0 4px 14px rgba(0,0,0,.25); opacity: .55; transition: opacity .15s; z-index: 2147483647; direction: ${uiDir}; }
    .bar.show { display: flex; } .bar:hover, .bar:focus-within { opacity: 1; }
    .bar button { all: unset; cursor: pointer; min-width: 26px; height: 24px; padding: 0 6px; border-radius: 6px;
                  display: inline-flex; align-items: center; justify-content: center; color: inherit; line-height: 1; transition: background .15s, color .15s; }
    .bar button svg { pointer-events: none; display: block; }
    .bar button:hover { background: #334155; color: #fff; } .bar .x { color: #94a3b8; min-width: 20px; }
    .bar .x:hover { color: #f87171; }
    .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #f8fafc; padding: 8px 14px;
             border-radius: 10px; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.3); display: none; z-index: 2147483647; direction: ${uiDir}; max-width: 90vw; }
    .toast.show { display: block; }
    .ov { position: fixed; inset: 0; background: rgba(15,23,42,.5); display: flex; align-items: center; justify-content: center; z-index: 2147483647; }
    .dlg { width: min(760px, 94vw); max-height: 92vh; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px;
           background: #fff; color: #0f172a; box-shadow: 0 20px 60px rgba(0,0,0,.35); direction: ${uiDir}; }
    .hd { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 14px; }
    .tools { display: flex; flex-wrap: wrap; gap: 6px; }
    .tools button, .ft button, .hd button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 8px; font-size: 12.5px; background: #f1f5f9; color: #0f172a; }
    .tools button:hover, .ft button:hover { background: #e2e8f0; }
    textarea { width: 100%; min-height: 45vh; resize: vertical; padding: 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 15px; line-height: 1.9; outline: none; color: inherit; background: #fff; }
    textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
    .ft { display: flex; align-items: center; gap: 8px; } .ft .sp { flex: 1; font-size: 12px; color: #64748b; }
    .ft .primary { background: #4f46e5; color: #fff; } .ft .primary:hover { background: #4338ca; }
    .note { font-size: 11.5px; color: #b45309; }
    @media (prefers-color-scheme: dark) {
      .dlg { background: #1e293b; color: #f1f5f9; } textarea { background: #0f172a; border-color: #334155; }
      .tools button, .ft button, .hd button { background: #334155; color: #f1f5f9; } .tools button:hover, .ft button:hover { background: #475569; }
      .ft .sp { color: #94a3b8; } .note { color: #fbbf24; }
    }`;

  function ensureUI() {
    if (hostEl && hostEl.isConnected) return;
    hostEl = document.createElement('pf-ui');
    hostEl.setAttribute('data-pf-ignore', '');
    hostEl.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;display:block!important;';
    shadow = hostEl.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>${CSS}</style>
      <div class="bar" part="bar">
        <button data-a="convert" title="${t('tbConvert')}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg></button>
        <button data-a="fix" title="${t('tbFix')}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
        <button data-a="zwnj" title="${t('tbZwnj')}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h5"/><path d="M15 12h5"/><line x1="12" y1="5" x2="12" y2="19"/></svg></button>
        <button data-a="dir" title="${t('tbDir')}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="5" y2="18"/><polyline points="7 10 3 12 7 14"/></svg></button>
        <button data-a="editor" title="${t('tbEditor')}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
        <button data-a="close" class="x" title="${t('tbClose')}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div><div class="toast"></div>`;
    bar = shadow.querySelector('.bar');
    toast = shadow.querySelector('.toast');
    bar.addEventListener('mousedown', e => e.preventDefault()); // keep focus (and selection) in the field
    bar.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !field) return;
      run(b.dataset.a, field);
    });
    (document.body || document.documentElement).appendChild(hostEl);
    if (typo()) typo().ensureFonts();
  }
  function showToast(msg) {
    ensureUI();
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function run(action, el) {
    if (!el) return;
    try {
      switch (action) {
        case 'convert': {
          const d = convertField(el);
          showToast(d === 'toFa' ? t('toastToFa') : d === 'toEn' ? t('toastToEn') : t('toastNothing'));
          break;
        }
        case 'fix': showToast(fixField(el) ? t('toastFixed') : t('toastNoFix')); break;
        case 'zwnj': insertZwnj(el); break;
        case 'dir': toggleDir(el); place(); break;
        case 'editor': openEditor(el); break;
        case 'close': dismissed.add(el); hideBar(); break;
      }
    } catch (e) { console.warn('[PersianFix]', e); }
  }

  // ---------- toolbar placement ----------
  let rafPending = false;
  function place() {
    if (!field || !bar || !bar.classList.contains('show')) return;
    const r = field.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) { bar.style.visibility = 'hidden'; return; }
    bar.style.visibility = '';
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const rtl = getComputedStyle(field).direction === 'rtl';
    let left = rtl ? r.left : r.right - bw;
    left = Math.max(4, Math.min(left, innerWidth - bw - 4));
    let top = r.top - bh - 4;
    if (top < 4) top = r.bottom + 4;
    top = Math.max(4, Math.min(top, innerHeight - bh - 4));
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  }
  function schedulePlace() { if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; place(); }); } }
  function showBar(el) {
    if (!enabled() || dismissed.has(el)) return;
    field = el; ensureUI();
    bar.classList.add('show'); place();
  }
  function hideBar() { if (bar) bar.classList.remove('show'); }

  document.addEventListener('focusin', e => {
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    if (target === hostEl) return;
    const el = fieldFrom(target);
    if (el) showBar(el); else { field = null; hideBar(); }
  }, true);
  document.addEventListener('focusout', e => {
    setTimeout(() => {
      const a = deepActive();
      if (a === hostEl || modalOpen) return;
      const el = fieldFrom(a);
      if (!el) { hideBar(); if (!modalOpen) field = null; }
    }, 0);
  }, true);
  addEventListener('scroll', schedulePlace, { capture: true, passive: true });
  addEventListener('resize', schedulePlace, { passive: true });
  document.addEventListener('input', e => { if (field) schedulePlace(); }, true);

  // ---------- full editor dialog ----------
  let modalOpen = false;
  function openEditor(el) {
    ensureUI();
    if (modalOpen) return;
    // remember what we're editing so "apply" writes back to the same place
    let target;
    if (isPlain(el)) {
      const v = el.value, sel = supportsSelection(el) && el.selectionStart !== el.selectionEnd;
      target = { s: sel ? el.selectionStart : 0, e: sel ? el.selectionEnd : v.length };
      target.text = v.slice(target.s, target.e);
    } else {
      const s = getSel(el), r = s.rangeCount && !s.isCollapsed && el.contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0).cloneRange() : null;
      target = { range: r, text: r ? r.toString() : el.innerText.replace(/\n$/, ''), whole: !r };
    }
    modalOpen = true; hideBar();
    const ov = document.createElement('div');
    ov.className = 'ov';
    ov.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">
        <div class="hd"><span>${t('edTitle')}</span><button data-a="cancel" title="Esc">✕</button></div>
        <div class="tools">
          <button data-a="convert">⇄ ${t('edConvert')}</button>
          <button data-a="fix">✓ ${t('edFix')}</button>
          <button data-a="fa">۱۲۳ ${t('edFaDigits')}</button>
          <button data-a="en">123 ${t('edEnDigits')}</button>
          <button data-a="zwnj">${t('edZwnj')}</button>
          <button data-a="dir">⇆ ${t('edDir')}</button>
        </div>
        <textarea dir="auto" spellcheck="true"></textarea>
        ${!isPlain(el) && target.whole ? `<div class="note">${t('edRichNote')}</div>` : ''}
        <div class="ft"><span class="sp"></span>
          <button data-a="copy">${t('edCopy')}</button>
          <button data-a="cancel">${t('edCancel')}</button>
          <button data-a="apply" class="primary" title="Ctrl+Enter">${t('edApply')}</button>
        </div></div>`;
    shadow.appendChild(ov);
    const ta = ov.querySelector('textarea'), info = ov.querySelector('.sp');
    ta.value = target.text;
    const updateInfo = () => { const st = T.stats(ta.value); info.textContent = t('edStats', String(st.words), String(st.chars)); };
    updateInfo();
    ta.addEventListener('input', updateInfo);
    setTimeout(() => ta.focus(), 0);

    const taReplace = fn => { // selection in textarea, otherwise all
      const s = ta.selectionStart, e = ta.selectionEnd, has = s !== e;
      const a = has ? s : 0, b = has ? e : ta.value.length, out = fn(ta.value.slice(a, b));
      ta.focus(); ta.setSelectionRange(a, b);
      if (!document.execCommand('insertText', false, out)) ta.setRangeText(out, a, b, 'end');
      updateInfo();
    };
    const close = () => { ov.remove(); modalOpen = false; el.focus(); showBar(el); };
    const apply = () => {
      const out = ta.value;
      ov.remove(); modalOpen = false;
      if (isPlain(el)) {
        // value may have changed meanwhile: clamp
        const v = el.value, s = Math.min(target.s, v.length), e = Math.min(target.e, v.length);
        replacePlain(el, s, e, out);
      } else {
        el.focus();
        let r = target.range;
        if (!r || !el.contains(r.commonAncestorContainer)) { r = document.createRange(); r.selectNodeContents(el); }
        replaceRange(r, out);
      }
      showBar(el);
    };
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    ov.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const layout = settings().kbLayout;
      switch (b.dataset.a) {
        case 'convert': taReplace(s => T.convertLayout(s, 'auto', layout).text); break;
        case 'fix': taReplace(s => T.fixPersian(s)); break;
        case 'fa': taReplace(T.toPersianDigits); break;
        case 'en': taReplace(T.toEnglishDigits); break;
        case 'zwnj': ta.focus(); if (!document.execCommand('insertText', false, '\u200C')) ta.setRangeText('\u200C', ta.selectionStart, ta.selectionEnd, 'end'); break;
        case 'dir': ta.dir = (ta.dir === 'rtl' || (ta.dir === 'auto' && getComputedStyle(ta).direction === 'rtl')) ? 'ltr' : 'rtl'; break;
        case 'copy': navigator.clipboard.writeText(ta.value).then(() => showToast(t('toastCopied')), () => {}); break;
        case 'cancel': close(); break;
        case 'apply': apply(); break;
      }
    });
    ov.addEventListener('keydown', e => {
      e.stopPropagation(); // don't let page shortcuts fire while typing in the dialog
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); }
    }, true);
  }

  // ---------- keyboard shortcuts & context menu (sent by background) ----------
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || msg.type !== 'pf-cmd') return;
    if (!msg.targeted && !document.hasFocus()) return;   // broadcast: only the focused frame acts
    const s = settings();
    if (s.masterEnabled === false) return;
    const el = fieldFrom(deepActive());
    if (!el) { if (!msg.targeted) return; showToast(t('toastNoField')); return; }
    run(msg.cmd, el);
  });

  if (typo()) typo().onSettings(() => { if (!enabled()) hideBar(); });
})();
