(async () => {
  const $ = id => document.getElementById(id);
  const masterToggle = $('masterToggle');
  const siteToggle = $('siteToggle');
  const currentDomainEl = $('currentDomain');
  const statusBanner = $('statusBanner');
  const statusText = $('statusText');
  const digitModeRadios = document.querySelectorAll('input[name="digitMode"]');
  const fontFileInput = $('fontFile');
  const pickFontBtn = $('pickFontBtn');
  const resetFontBtn = $('resetFontBtn');
  const fontStatus = $('fontStatus');
  const fontMsg = $('fontMsg');
  const themeToggle = $('themeToggle');

  const MAX_FONT_BYTES = 4 * 1024 * 1024;
  const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
  let settings = { ...PFDetect.SETTINGS_SCHEMA };
  let currentHost = '';
  let pageSupported = false;

  // ---------- theme ----------
  function setTheme(t) { document.body.classList.remove('dark', 'light'); document.body.classList.add(t); }
  setTheme(localStorage.getItem('pf-theme') === 'light' ? 'light' : 'dark');
  themeToggle.addEventListener('click', () => {
    const t = document.body.classList.contains('light') ? 'dark' : 'light';
    setTheme(t);
    localStorage.setItem('pf-theme', t);
  });

  // ---------- helpers ----------
  function showFontMsg(text, kind) { fontMsg.textContent = text || ''; fontMsg.className = 'card-msg' + (kind ? ' ' + kind : ''); }
  function setFontBadge(custom) {
    fontStatus.textContent = custom ? 'فونت کاربر (فعال)' : 'وزیرمتن (پیش‌فرض)';
    fontStatus.style.color = custom ? 'var(--accent)' : '';
  }
  // Check magic bytes: wOFF, wOF2, OTTO, 0x00010000 (TrueType), 'true'
  function looksLikeFont(buf) {
    const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (b.length < 4) return false;
    const tag = String.fromCharCode(...b);
    return ['wOFF', 'wOF2', 'OTTO', 'true', 'ttcf'].includes(tag) || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0);
  }
  function readAsDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  }

  // ---------- init ----------
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      pageSupported = (url.protocol === 'http:' || url.protocol === 'https:') &&
        !/^(chrome\.google\.com|chromewebstore\.google\.com|microsoftedge\.microsoft\.com)$/.test(url.hostname);
      currentHost = pageSupported ? url.hostname : '';
      currentDomainEl.textContent = pageSupported ? currentHost : 'صفحه داخلی مرورگر';
    } else {
      currentDomainEl.textContent = 'صفحه داخلی مرورگر';
    }
  } catch { currentDomainEl.textContent = '—'; }

  settings = { ...settings, ...(await chrome.storage.sync.get(PFDetect.SETTINGS_SCHEMA)) };
  const { userFont } = await chrome.storage.local.get('userFont');
  setFontBadge(!!(userFont && settings.useCustomFont));

  function updateUI() {
    masterToggle.checked = settings.masterEnabled !== false;
    // Site toggle shows the per-site state, independent of master (before it always looked "off" when master was off).
    siteToggle.checked = pageSupported ? PFDetect.isSiteAllowed(currentHost, settings) : false;
    siteToggle.disabled = !masterToggle.checked || !pageSupported;
    const radio = document.querySelector(`input[name="digitMode"][value="${settings.digitMode === 'persian' ? 'persian' : 'auto'}"]`);
    if (radio) radio.checked = true;
    updateStatusBanner();
  }
  function updateStatusBanner() {
    if (!masterToggle.checked) {
      statusBanner.className = 'status-banner disabled';
      statusText.textContent = 'افزونه به صورت سراسری غیرفعال است';
    } else if (!pageSupported) {
      statusBanner.className = 'status-banner neutral';
      statusText.textContent = 'این صفحه توسط مرورگر پشتیبانی نمی‌شود';
    } else if (siteToggle.checked) {
      statusBanner.className = 'status-banner active';
      statusText.textContent = 'فونت فارسی روی این سایت فعال است';
    } else {
      statusBanner.className = 'status-banner disabled';
      statusText.textContent = 'غیرفعال روی این سایت';
    }
  }

  // ---------- listeners ----------
  masterToggle.addEventListener('change', async () => {
    settings.masterEnabled = masterToggle.checked;
    await chrome.storage.sync.set({ masterEnabled: settings.masterEnabled });
    updateUI();
  });

  siteToggle.addEventListener('change', async () => {
    if (!currentHost) return;
    const host = PFDetect.normalizeDomain(currentHost);
    const overrides = { ...(settings.siteOverrides || {}) };
    for (const k of Object.keys(overrides)) if (PFDetect.normalizeDomain(k) === host) delete overrides[k];
    // Only store an override when it differs from what the rules already say (keeps sync storage small: 8 KB per item)
    const allowedWithout = PFDetect.isSiteAllowed(host, { ...settings, siteOverrides: overrides });
    if (allowedWithout !== siteToggle.checked) overrides[host] = siteToggle.checked;
    settings.siteOverrides = overrides;
    try { await chrome.storage.sync.set({ siteOverrides: overrides }); }
    catch (e) { siteToggle.checked = !siteToggle.checked; alert('ذخیره تنظیمات ناموفق بود: ' + e.message); }
    updateStatusBanner();
  });

  digitModeRadios.forEach(radio => radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    settings.digitMode = radio.value;
    await chrome.storage.sync.set({ digitMode: settings.digitMode });
  }));

  pickFontBtn.addEventListener('click', () => fontFileInput.click());

  fontFileInput.addEventListener('change', async () => {
    const file = fontFileInput.files[0];
    fontFileInput.value = ''; // allow re-selecting the same file
    if (!file) return;
    showFontMsg('');
    if (!FONT_EXT.test(file.name)) return showFontMsg('فرمت فایل باید TTF، OTF، WOFF یا WOFF2 باشد.', 'error');
    if (file.size > MAX_FONT_BYTES) return showFontMsg('حجم فونت نباید بیشتر از ۴ مگابایت باشد.', 'error');
    pickFontBtn.setAttribute('aria-busy', 'true');
    try {
      const buf = await file.arrayBuffer();
      if (!looksLikeFont(buf)) throw new Error('فایل انتخاب‌شده فونت معتبر نیست.');
      try { await new FontFace('pf-validate', buf).load(); }      // real validation (README promised it, code never did it)
      catch { throw new Error('مرورگر نتوانست این فونت را بخواند.'); }
      const dataUrl = await readAsDataURL(file);
      await chrome.storage.local.set({ userFont: dataUrl });
      settings.useCustomFont = true;
      await chrome.storage.sync.set({ useCustomFont: true });
      setFontBadge(true);
      showFontMsg('فونت «' + file.name + '» ذخیره و فعال شد.', 'ok');
    } catch (err) {
      showFontMsg(err.message && /[\u0600-\u06FF]/.test(err.message) ? err.message : 'خطا در ذخیره فونت: ' + err.message, 'error');
    } finally {
      pickFontBtn.removeAttribute('aria-busy');
    }
  });

  resetFontBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('userFont');
    settings.useCustomFont = false;
    await chrome.storage.sync.set({ useCustomFont: false });
    setFontBadge(false);
    showFontMsg('به وزیرمتن برگشت.', 'ok');
  });

  updateUI();
})();
