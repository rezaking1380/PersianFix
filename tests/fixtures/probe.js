// Injected into the fixture page by the loop driver.
// Reports what PersianFix actually marked, so we can assert on real behaviour.
window.__pfProbe = function () {
  const ids = ['probe-h1', 'probe-control', 'probe-mono', 'probe-ce-host', 'probe-ce-nested',
    'probe-ce-p', 'probe-wrapper', 'probe-deep', 'probe-deep-p'];
  const out = { rafCount: window.__rafCount, marked: {}, computedFont: {}, contentEditableIDL: {} };
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    out.marked[id] = el.hasAttribute('data-pf-rtl');
    out.computedFont[id] = getComputedStyle(el).fontFamily;
    out.contentEditableIDL[id] = el.contentEditable;
  }
  out.markedCount = document.querySelectorAll('[data-pf-rtl]').length;
  out.totalElements = document.querySelectorAll('*').length;
  out.hasHead = !!document.head;
  return out;
};