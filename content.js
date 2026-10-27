// News Filter content script.
// Finds text that matches an active keyword, works out which news block
// (card, list item, article...) it belongs to, and covers that block with a
// white "FILTER BLOCKED" placeholder. The block keeps its size, so the site's
// layout does not move.

(() => {
  if (window.__newsFilterLoaded) return;
  window.__newsFilterLoaded = true;

  const BLOCKED_CLASS = 'nf-blocked';
  const OVERLAY_CLASS = 'nf-overlay';

  // Text inside these is never matched.
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT',
    'OPTION', 'CODE', 'PRE', 'IFRAME', 'HEAD', 'TITLE', 'SVG',
  ]);
  // These are never treated as a news block, however small the page is.
  const NEVER_BLOCK = new Set(['HTML', 'BODY', 'MAIN']);
  // Tags that count as list items even without a class name.
  const ITEM_TAGS = new Set(['LI', 'ARTICLE', 'DIV', 'SECTION', 'A']);

  // Limits for how big a block may get before we stop climbing the DOM.
  const MAX_TEXT = 1500;
  const MAX_HEADINGS = 2;
  const MAX_LINKS = 4;
  const MAX_VIEWPORT_AREA = 0.7;
  const MIN_ITEM_HEIGHT = 28;
  const MIN_ITEM_WIDTH = 80;
  // When no card/list item is found, only grow up to something this small
  // (one headline, one or two links), so loose text never takes a sidebar with it.
  const FALLBACK_MAX_HEADINGS = 1;
  const FALLBACK_MAX_LINKS = 2;

  const state = {
    // True only when the filter is switched on AND this site passes the site list.
    enabled: false,
    siteAllowed: true,
    regex: null,
    // Index of each capture group in the regex -> keyword text as typed.
    groupKeywords: [],
  };
  // Blocked element -> keyword that caused it.
  const blocked = new Map();

  // ---------- Matching ----------

  function normalize(text) {
    return text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function escapeRegExp(s) {
    return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  // "elei*" matches eleição, eleições, eleitoral...
  function keywordPattern(text) {
    return normalize(text.trim())
      .split('*')
      .map(escapeRegExp)
      .join('[\\p{L}\\p{N}]*');
  }

  function buildRegex(keywords) {
    const active = keywords.filter((k) => k.active && k.text.trim());
    state.groupKeywords = active.map((k) => k.text);
    if (!active.length) return null;
    const groups = active.map((k) => `(${keywordPattern(k.text)})`).join('|');
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${groups})(?![\\p{L}\\p{N}])`, 'u');
  }

  function matchKeyword(text) {
    const m = state.regex.exec(normalize(text));
    if (!m) return null;
    const i = m.slice(1).findIndex((g) => g !== undefined);
    return state.groupKeywords[i];
  }

  // ---------- Site list ----------

  // A site entry covers its subdomains: "globo.com" matches "g1.globo.com".
  function hostMatches(host, site) {
    return host === site || host.endsWith(`.${site}`);
  }

  // siteMode "except": filter everywhere but the listed sites.
  // siteMode "only": filter on the listed sites only.
  function isSiteAllowed(siteMode, sites) {
    const host = location.hostname.toLowerCase().replace(/^www\./, '');
    const listed = sites.some((site) => hostMatches(host, site));
    return siteMode === 'only' ? listed : !listed;
  }

  // ---------- Finding the block around a match ----------

  function isCompact(el, maxHeadings = MAX_HEADINGS, maxLinks = MAX_LINKS) {
    if (NEVER_BLOCK.has(el.tagName)) return false;
    if ((el.textContent || '').length > MAX_TEXT) return false;
    const rect = el.getBoundingClientRect();
    if (rect.height > window.innerHeight * 1.2) return false;
    if (rect.width * rect.height > window.innerWidth * window.innerHeight * MAX_VIEWPORT_AREA) {
      return false;
    }
    if (el.querySelectorAll('h1,h2,h3,h4,h5,h6').length > maxHeadings) return false;
    const links = new Set();
    for (const a of el.querySelectorAll('a[href]')) {
      links.add(a.href.split('#')[0]);
      if (links.size > maxLinks) return false;
    }
    return true;
  }

  // True when el is one entry of a repeated list: it has a sibling with the
  // same tag and the same first class name, and it looks like real content.
  function isRepeatedItem(el) {
    const parent = el.parentElement;
    if (!parent) return false;
    const cls = el.classList[0] || '';
    if (!cls && !ITEM_TAGS.has(el.tagName)) return false;
    const hasTwin = [...parent.children].some(
      (sib) => sib !== el && sib.tagName === el.tagName && (sib.classList[0] || '') === cls,
    );
    if (!hasTwin) return false;
    const rect = el.getBoundingClientRect();
    if (rect.height < MIN_ITEM_HEIGHT || rect.width < MIN_ITEM_WIDTH) return false;
    return Boolean(el.querySelector('a,img,picture,h1,h2,h3,h4,h5,h6') || el.closest('a'));
  }

  // Climbs from the matched text towards the page root and returns the first
  // article or repeated list item. Without one, falls back to the largest
  // ancestor that still looks like a single headline.
  function findBlock(start) {
    let fallback = NEVER_BLOCK.has(start.tagName) ? null : start;
    for (let el = start; el && !NEVER_BLOCK.has(el.tagName); el = el.parentElement) {
      if (!isCompact(el)) break;
      if (el.matches('article, [role="article"]') || isRepeatedItem(el)) return el;
      if (isCompact(el, FALLBACK_MAX_HEADINGS, FALLBACK_MAX_LINKS)) fallback = el;
    }
    return fallback;
  }

  // ---------- Blocking ----------

  function injectStyles() {
    if (document.getElementById('nf-styles')) return;
    const style = document.createElement('style');
    style.id = 'nf-styles';
    style.textContent = `
      .${BLOCKED_CLASS} > :not(.${OVERLAY_CLASS}) { visibility: hidden !important; }
      .${OVERLAY_CLASS} {
        position: absolute !important;
        inset: 0 !important;
        z-index: 1 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 4px !important;
        margin: 0 !important;
        padding: 4px !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        background: #fff !important;
        border: 1px dashed #f0b3b5 !important;
        color: #d4141c !important;
        font: 700 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif !important;
        letter-spacing: 0.08em !important;
        text-transform: uppercase !important;
        text-align: center !important;
        cursor: default !important;
        pointer-events: auto !important;
        opacity: 1 !important;
        transform: none !important;
      }
      .${OVERLAY_CLASS} .nf-kw {
        color: #9a9a9a !important;
        font-weight: 500 !important;
        font-size: 11px !important;
        letter-spacing: 0 !important;
        text-transform: none !important;
      }
      .${OVERLAY_CLASS}.nf-small {
        font-size: 10px !important;
        gap: 0 !important;
        padding: 0 4px !important;
        white-space: nowrap !important;
      }
      .${OVERLAY_CLASS}.nf-small .nf-kw { display: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function makeOverlay(el, keyword) {
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute('aria-label', 'Conteúdo bloqueado pelo News Filter');
    if (el.getBoundingClientRect().height < 56) overlay.classList.add('nf-small');

    const title = document.createElement('span');
    title.textContent = 'FILTER BLOCKED';
    const kw = document.createElement('span');
    kw.className = 'nf-kw';
    kw.textContent = `“${keyword}”`;
    overlay.append(title, kw);

    for (const type of ['click', 'auxclick', 'mousedown']) {
      overlay.addEventListener(type, swallow, true);
    }
    return overlay;
  }

  // Safe to call again on an element that is already blocked: it only
  // restores what the site may have removed (our class or our overlay).
  function applyBlock(el, keyword) {
    for (const inner of el.querySelectorAll(`.${BLOCKED_CLASS}`)) removeBlock(inner);
    if (!el.classList.contains(BLOCKED_CLASS)) el.classList.add(BLOCKED_CLASS);
    if (!('nfPos' in el.dataset) && getComputedStyle(el).position === 'static') {
      el.dataset.nfPos = el.style.position;
      el.style.setProperty('position', 'relative');
    }
    if (!el.querySelector(`:scope > .${OVERLAY_CLASS}`)) el.appendChild(makeOverlay(el, keyword));
    blocked.set(el, keyword);
  }

  function removeBlock(el) {
    el.classList.remove(BLOCKED_CLASS);
    el.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove();
    if ('nfPos' in el.dataset) {
      el.style.position = el.dataset.nfPos;
      delete el.dataset.nfPos;
    }
    blocked.delete(el);
  }

  function removeAll() {
    for (const el of [...blocked.keys()]) removeBlock(el);
  }

  // ---------- Scanning ----------

  function collectMatches(root) {
    const matches = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (SKIP_TAGS.has(node.tagName.toUpperCase()) || node.isContentEditable) {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.classList.contains(BLOCKED_CLASS) || node.classList.contains(OVERLAY_CLASS)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        return node.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const keyword = matchKeyword(node.data);
      if (keyword) matches.push({ el: node.parentElement, keyword });
    }
    return matches;
  }

  function scan(root) {
    if (!state.enabled || !state.regex || !root?.isConnected) return;
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.closest(`.${BLOCKED_CLASS}`)) return;
    // The walker never asks acceptNode about its root, so check it here.
    if (SKIP_TAGS.has(root.tagName.toUpperCase()) || root.isContentEditable) return;
    for (const { el, keyword } of collectMatches(root)) {
      if (!el.isConnected || el.closest(`.${BLOCKED_CLASS}`)) continue;
      const block = findBlock(el);
      if (block) applyBlock(block, keyword);
    }
  }

  // Puts back class/overlay on blocks the site re-rendered, and forgets
  // blocks the site removed from the page.
  function repair() {
    for (const [el, keyword] of [...blocked]) {
      if (!el.isConnected) blocked.delete(el);
      else applyBlock(el, keyword);
    }
  }

  function stats() {
    const byKeyword = {};
    for (const el of blocked.keys()) {
      if (!el.isConnected) continue;
      const kw = blocked.get(el);
      byKeyword[kw] = (byKeyword[kw] || 0) + 1;
    }
    const total = Object.values(byKeyword).reduce((a, b) => a + b, 0);
    return { enabled: state.enabled, siteAllowed: state.siteAllowed, total, byKeyword };
  }

  function report() {
    if (!chrome.runtime?.id) return shutdown();
    chrome.runtime.sendMessage({ type: 'nf:count', total: stats().total }).catch(() => {});
  }

  // ---------- Watching the page ----------

  const pendingRoots = new Set();
  let flushTimer = null;

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 300);
  }

  function flush() {
    flushTimer = null;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    observer.disconnect();
    repair();
    for (const root of roots) scan(root);
    observe();
    report();
  }

  const observer = new MutationObserver((mutations) => {
    if (!state.enabled || !state.regex) return;
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (blocked.has(m.target) && !m.target.classList.contains(BLOCKED_CLASS)) {
          pendingRoots.add(m.target);
        }
      } else if (m.type === 'characterData') {
        if (m.target.parentElement) pendingRoots.add(m.target.parentElement);
      } else {
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (!n.classList.contains(OVERLAY_CLASS)) pendingRoots.add(n);
          } else if (n.nodeType === Node.TEXT_NODE && n.parentElement) {
            pendingRoots.add(n.parentElement);
          }
        }
        for (const n of m.removedNodes) {
          if (n.classList?.contains(OVERLAY_CLASS) && blocked.has(m.target)) {
            pendingRoots.add(m.target);
          }
        }
      }
    }
    if (pendingRoots.size) scheduleFlush();
  });

  function observe() {
    if (!state.enabled || !state.regex || !document.body) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  // ---------- Settings ----------

  async function loadSettings() {
    if (!chrome.runtime?.id) return shutdown();
    const {
      enabled = true,
      keywords = [],
      siteMode = 'except',
      sites = [],
    } = await chrome.storage.sync.get(['enabled', 'keywords', 'siteMode', 'sites']);
    observer.disconnect();
    removeAll();
    state.siteAllowed = isSiteAllowed(siteMode, sites);
    state.enabled = enabled && state.siteAllowed;
    state.regex = buildRegex(keywords);
    if (state.enabled && state.regex) {
      injectStyles();
      scan(document.body);
      observe();
    }
    report();
  }

  function shutdown() {
    observer.disconnect();
    clearTimeout(flushTimer);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.enabled || changes.keywords || changes.siteMode || changes.sites) loadSettings();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'nf:getStats') sendResponse(stats());
  });

  loadSettings();
})();
