// Startup + context menu
const DEFAULTS = { masterEnabled: true, digitMode: 'auto', styleInputs: true, editorEnabled: true, kbLayout: 'standard', exclusionList: [], siteOverrides: {}, siteFonts: {}, useCustomFont: false, fontScale: 100, lineHeight: 0 };

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(null);
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULTS)) if (current[k] === undefined) missing[k] = v;
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
  if ('customFontFamily' in current) await chrome.storage.sync.remove(['customFontFamily']);
  try { chrome.contextMenus.removeAll(); } catch {}
  createMenus();
});

function createMenus() {
  const cmds = [{ id: 'pf-convert', title: chrome.i18n.getMessage('cxConvert') || 'Convert layout', parentId: 'pf' },
                { id: 'pf-fix', title: chrome.i18n.getMessage('cxFix') || 'Persian fix', parentId: 'pf' },
                { id: 'pf-editor', title: chrome.i18n.getMessage('cxEditor') || 'Full editor', parentId: 'pf' }];
  try { chrome.contextMenus.create({ id: 'pf', title: 'PersianFix', contexts: ['editable'] }); }
  catch {}
  for (const c of cmds) try { chrome.contextMenus.create(c, () => chrome.runtime.lastError); } catch {}
}

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'pf-convert') chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'pf-cmd', cmd: 'convert', targeted: true }).catch(() => {});
  });
  if (info.menuItemId === 'pf-fix') chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'pf-cmd', cmd: 'fix', targeted: true }).catch(() => {});
  });
  if (info.menuItemId === 'pf-editor') chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'pf-cmd', cmd: 'editor', targeted: true }).catch(() => {});
  });
});

chrome.commands.onCommand.addListener(cmd => {
  const map = { 'convert-field': 'convert', 'fix-field': 'fix', 'open-editor': 'editor' };
  if (map[cmd]) chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'pf-cmd', cmd: map[cmd], targeted: true }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'pf-state' && sender.tab && Number.isInteger(sender.tab.id)) {
    setTabIcon(sender.tab.id, !!msg.active);
    try {
      chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.active ? '✓' : '' }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: msg.active ? '#10b981' : '#6b7280' }).catch(() => {});
    } catch {}
  }
});

// --- Toolbar icon state (active = full color, inactive = gray) ---

const ICON_ACTIVE = { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png' };
const ICON_INACTIVE = { 16: 'icons/icon-gray16.png', 32: 'icons/icon-gray32.png', 48: 'icons/icon-gray48.png' };

function setTabIcon(tabId, active) {
  try { chrome.action.setIcon({ tabId, path: active ? ICON_ACTIVE : ICON_INACTIVE }).catch(() => {}); } catch {}
}

// Reset to gray while a tab navigates; the content script reports the real
// state shortly after commit (top frame only — content.js guards with isTop).
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    setTabIcon(tabId, false);
    try { chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}); } catch {}
  }
});
