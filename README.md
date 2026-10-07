# PersianFix

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://github.com/rezaking1380/PersianFix/actions/workflows/test.yml/badge.svg)](https://github.com/rezaking1380/PersianFix/actions)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave-orange.svg)](manifest.json)

A Manifest V3 browser extension that improves Persian/Arabic typography on web pages without modifying the actual page content.

## Features

- **Automatic Detection**: Detects Persian/Arabic text using Unicode-based heuristics
- **Safe Font Replacement**: Applies Vazirmatn only where appropriate; skips known Persian-capable fonts
- **Custom Font Support**: Upload your own font (TTF, OTF, WOFF, WOFF2)
- **Digit Rendering**: Optional OpenType ss01 feature for Persian digits (glyph-only, text unchanged)
- **Mixed Content**: Correctly handles Persian + English with proper bidi semantics
- **RTL/LTR Smart**: Uses browser Unicode Bidi Algorithm; never forces global RTL
- **SPA Compatible**: Works with React, Vue, Svelte, Next.js, and other frameworks
- **Dynamic Content**: Handles infinite scroll, modals, text updates, etc. via MutationObserver
- **Live Settings**: Toggles, digit mode and custom font apply instantly, no page reload needed
- **Shadow DOM Support**: Processes open Shadow DOM; gracefully handles closed roots
- **Icon Protection**: Preserves Font Awesome, Material Icons, and other icon fonts
- **Code Protection**: Never modifies `<pre>`, `<code>`, `<kbd>`, monospace, or password fields
- **Per-Site Control**: Master toggle + per-domain enable/disable + exclusion list
- **Lightweight**: No runtime dependencies, no build step, minimal size

## Installation

### 1. Fonts

Vazirmatn v33.003 (Regular / Medium / Bold, WOFF2) is already bundled in `fonts/`.
To update, replace them from https://github.com/rastikerdar/vazirmatn/releases keeping the same file names.

### 2. Load Extension

1. Open: `chrome://extensions` (Chrome), `edge://extensions` (Edge), `brave://extensions` (Brave)
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `PersianFix` folder
5. Extension appears in toolbar

## Architecture

```
PersianFix/
├── manifest.json              # MV3 configuration
├── background.js              # Minimal service worker
├── content.js                 # DOM processor (injected at document_start, scans after DOMContentLoaded)
├── content.css                # @font-face + [data-pf-*] rules
├── lib/detect.js              # Shared utilities
├── popup.html/js/css          # Settings UI
├── fonts/                     # Vazirmatn WOFF2 (bundled)
└── README.md
```

### Key Design

- **Per-Frame Independence**: Each frame runs its own content script
- **CSS-Based Styling**: Uses `[data-pf-*]` attributes; no global font overrides
- **Efficient Traversal**: TreeWalker with early rejection filters
- **Debounced Mutations**: Coalesced processing with bounded batches
- **WeakSet Caching**: Prevents re-evaluation; allows garbage collection
- **Fail-Closed**: If uncertain, does nothing

## Permissions

- `storage`: Stores settings and custom fonts
- Host permissions `http://*/*`, `https://*/*`: run on web pages and read the active tab's host in the popup

## Storage

**chrome.storage.sync** (102 KB total, 8 KB per item):
- `masterEnabled`: Boolean
- `digitMode`: 'auto' | 'persian'
- `exclusionList`: Array of domains
- `siteOverrides`: Object { domain: enabled }
- `useCustomFont`: Boolean

Priority: master switch > per-site override > exclusion list > enabled.

**chrome.storage.local** (10 MB):
- `userFont`: Base64 custom font (max 4 MB)

## Persian/Arabic Detection

Uses Unicode ranges for Persian/Arabic scripts:
- `\u0600-\u06FF` (Arabic)
- `\u0750-\u077F` (Arabic Supplement)
- `\uFB50-\uFDFF` (Arabic Presentation Forms A)
- `\uFE70-\uFEFF` (Arabic Presentation Forms B)

### Pipeline

1. DOM candidate is inspected
2. Text eligibility checked
3. Unicode Persian detection
4. Exclusion checks (code, icons, etc.)
5. Computed style checks (existing Persian font?)
6. Site/user configuration checked
7. Apply `[data-pf-rtl]` marker for CSS styling

## Directionality

- **No global RTL forcing** on document
- **No bidi control characters** inserted
- **Browser UBA** for mixed RTL/LTR content
- **dir="auto"** applied cautiously to mixed containers

## Digit Rendering

**Vazirmatn v33.003+** supports `ss01` OpenType feature for Persian digit glyphs.

When "Persian Digits" mode is enabled:
```css
font-feature-settings: 'ss01' 1 !important;
```

**Text is never mutated**: Character `'1'` (U+0031) remains `'1'`; only glyph rendering changes.

## Custom Font

1. Popup > Custom Font > select TTF/OTF/WOFF/WOFF2 file (max 4 MB)
2. File validated and stored in chrome.storage.local
3. Loaded via the `FontFace` API (family `PFUserFont`), so page CSP cannot block it
4. Persists after browser reload
5. Falls back to Vazirmatn on load failure

## iframe & Shadow DOM

**Same-Origin iframes**: Each gets independent content script instance.

**Cross-Origin iframes**: Not accessible; no same-origin policy violations attempted.

**Open Shadow DOM**: Fully supported; adopted stylesheets applied.

**Closed Shadow DOM**: Not accessible; no hacks or monkey-patching.

## Performance

- Incremental TreeWalker resumed across idle slices (8 ms budget)
- MutationObserver (childList + characterData) feeding a shared queue, nothing dropped
- WeakSet element caching
- requestIdleCallback yielding
- Early rejection filters
- Deferred font loading

## Testing Checklist

1. **English-only site**: No changes visible
2. **Persian-only page**: Text styled with Vazirmatn
3. **Mixed Persian/English**: Correct bidi, both scripts rendered well
4. **Known Persian font**: Not unnecessarily replaced
5. **Font Awesome**: Icons intact
6. **Material Icons**: Icons intact
7. **Code blocks**: Monospace preserved
8. **Contenteditable**: No disruption
9. **React/Vue SPA**: Navigation smooth, no full-page rescans
10. **Infinite scroll**: New content styled, old not repeated
11. **Dynamic modal**: Content in modal processed when opened
12. **Same-origin iframe**: Content processed independently
13. **Cross-origin iframe**: No errors
14. **Open Shadow DOM**: Content processed
15. **Closed Shadow DOM**: No crash
16. **Custom font**: Loads, persists after reload
17. **Digit modes**: Glyph-only change, text unchanged
18. **Disabled site**: Styling removed instantly (and re-applied when enabled again)

## Troubleshooting

- **Extension not loading**: Check `chrome://extensions` for errors
- **Persian not styled**: Check toggles (master, site, exclusion list)
- **Layout broken**: Not caused by extension; disable to confirm
- **Custom font fails**: Check file size (<4MB), format, storage quota
- **Slow performance**: Large pages (100k+ nodes) normal; check debug stats

## Limitations

- Closed Shadow DOM not accessible
- Cross-origin iframes not accessible
- Chrome internal pages blocked by browser
- Text transformation is glyph-only (no character mutation)
- Custom fonts are device-specific (local storage)
- Icon font detection is heuristic-based (fail-closed)

## Browser Compatibility

| Browser | Version | Support |
|---------|---------|---------|
| Chrome  | 99+     | Full    |
| Edge    | 99+     | Full    |
| Brave   | 1.0+    | Full    |

## Author

Developed by **Reza ngr** ([GitHub](https://github.com/rezaking1380)).

## License

Extension provided as-is. Vazirmatn licensed under SIL Open Font License (OFL).
See: https://github.com/rastikerdar/vazirmatn/blob/main/OFL.txt
