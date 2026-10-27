// Popup: Overview tab (toggle keywords, see what was blocked on this tab)
// and Config tab (add/remove keywords and sites). Settings live in chrome.storage.sync:
//   {
//     enabled: boolean,
//     keywords: [{ text: string, active: boolean }],
//     siteMode: 'except' | 'only',  // filter everywhere but `sites`, or only on `sites`
//     sites: string[],              // hostnames; each also covers its subdomains
//   }

const $ = (id) => document.getElementById(id);

let settings = { enabled: true, keywords: [], siteMode: 'except', sites: [] };
// Stats from the content script of the active tab, or null when it can't run there.
let pageStats = null;
// Hostname of the active tab, or null for chrome:// and other non-web pages.
let currentHost = null;

// ---------- Storage ----------

async function load() {
  const {
    enabled = true,
    keywords = [],
    siteMode = 'except',
    sites = [],
  } = await chrome.storage.sync.get(['enabled', 'keywords', 'siteMode', 'sites']);
  settings = { enabled, keywords, siteMode, sites };
}

function save(patch) {
  settings = { ...settings, ...patch };
  render();
  return chrome.storage.sync.set(patch);
}

const sameKeyword = (a, b) =>
  a.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() ===
  b.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// ---------- Sites ----------

// Accepts "https://www.g1.globo.com/politica" and returns "g1.globo.com".
function normalizeSite(raw) {
  const text = raw.trim().toLowerCase();
  if (!text) return '';
  try {
    const host = new URL(text.includes('://') ? text : `http://${text}`).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Same rule as content.js: "globo.com" also covers "g1.globo.com".
const hostMatches = (host, site) => host === site || host.endsWith(`.${site}`);

const isListed = (host) => settings.sites.some((site) => hostMatches(host, site));

function isSiteAllowed(host) {
  return settings.siteMode === 'only' ? isListed(host) : !isListed(host);
}

// ---------- Page stats ----------

async function refreshStats() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    currentHost = url && /^https?:$/.test(url.protocol) ? normalizeSite(url.hostname) : null;
    pageStats = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: 'nf:getStats' }) : null;
  } catch {
    // chrome:// pages, the Web Store, or a tab opened before the extension was installed.
    pageStats = null;
  }
  render();
}

// ---------- Rendering ----------

function render() {
  $('enabled').checked = settings.enabled;
  $('enabled-label').textContent = settings.enabled ? 'Ligado' : 'Desligado';
  renderOverview();
  renderConfig();
  renderSites();
}

// True when the filter should be running on the active tab right now.
const filteringHere = () => settings.enabled && (!currentHost || isSiteAllowed(currentHost));

function renderSummary() {
  const el = $('summary');
  el.className = 'summary';
  if (!settings.enabled) {
    el.classList.add('off');
    el.innerHTML = '<strong>—</strong><span>Filtro desligado</span>';
  } else if (!filteringHere()) {
    el.classList.add('off');
    el.innerHTML = '<strong>—</strong><span>Filtro desligado neste site</span>';
  } else if (!pageStats) {
    el.classList.add('na');
    el.innerHTML = '<strong>—</strong><span>Recarregue a página para filtrar aqui</span>';
  } else {
    const n = pageStats.total;
    el.innerHTML = `<strong>${n}</strong><span>${n === 1 ? 'bloco bloqueado' : 'blocos bloqueados'} nesta página</span>`;
  }
}

// The "this site" line under the summary, with a one-click add/remove.
function renderSiteLine() {
  $('site-line').hidden = !currentHost;
  if (!currentHost) return;
  const listed = isListed(currentHost);
  $('site-host').textContent = currentHost;
  if (settings.siteMode === 'only') {
    $('site-toggle').textContent = listed ? 'Parar de filtrar aqui' : 'Filtrar neste site';
  } else {
    $('site-toggle').textContent = listed ? 'Voltar a filtrar aqui' : 'Não filtrar neste site';
  }
}

function renderOverview() {
  renderSummary();
  renderSiteLine();
  const { keywords } = settings;
  const list = $('overview-list');
  list.replaceChildren();

  $('overview-empty').hidden = keywords.length > 0;
  $('overview-head').hidden = keywords.length === 0;
  const active = keywords.filter((k) => k.active).length;
  $('active-count').textContent = `${active} de ${keywords.length} ativas`;

  keywords.forEach((kw, i) => {
    const li = document.createElement('li');
    li.classList.toggle('inactive', !kw.active);

    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = kw.active;
    box.addEventListener('change', () => toggleKeyword(i, box.checked));

    const text = document.createElement('span');
    text.className = 'kw-text';
    text.textContent = kw.text;
    text.title = kw.text;

    const counting = Boolean(pageStats) && filteringHere() && kw.active;
    const count = pageStats?.byKeyword?.[kw.text] ?? 0;
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.classList.toggle('hit', counting && count > 0);
    pill.textContent = counting ? count : '–';
    pill.title = 'Blocos bloqueados nesta página';

    label.append(box, text, pill);
    li.append(label);
    list.append(li);
  });
}

function renderConfig() {
  const { keywords } = settings;
  const list = $('config-list');
  list.replaceChildren();
  $('config-count').textContent =
    keywords.length === 1 ? '1 palavra-chave' : `${keywords.length} palavras-chave`;
  $('clear-all').hidden = keywords.length === 0;

  keywords.forEach((kw, i) => {
    const li = document.createElement('li');
    li.classList.toggle('inactive', !kw.active);

    const text = document.createElement('span');
    text.className = 'kw-text';
    text.textContent = kw.text;
    text.title = kw.text;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = `Remover “${kw.text}”`;
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => removeKeyword(i));

    li.append(text, remove);
    list.append(li);
  });
}

function renderSites() {
  const { siteMode, sites } = settings;
  for (const radio of document.querySelectorAll('input[name="site-mode"]')) {
    radio.checked = radio.value === siteMode;
  }

  const hint = $('site-hint');
  hint.classList.toggle('warn', siteMode === 'only' && sites.length === 0);
  if (siteMode === 'only') {
    hint.textContent = sites.length
      ? 'O filtro roda só nestes sites. Subdomínios entram junto.'
      : 'Lista vazia: o filtro não roda em nenhum site até você adicionar um.';
  } else {
    hint.textContent = 'O filtro roda em todos os sites, menos nestes. Subdomínios entram junto.';
  }

  const addCurrent = $('add-current');
  addCurrent.hidden = !currentHost || isListed(currentHost);
  if (currentHost) addCurrent.textContent = `+ Adicionar ${currentHost}`;

  const list = $('site-list');
  list.replaceChildren();
  sites.forEach((site, i) => {
    const li = document.createElement('li');

    const text = document.createElement('span');
    text.className = 'kw-text';
    text.textContent = site;
    text.title = site;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = `Remover ${site}`;
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => removeSite(i));

    li.append(text, remove);
    list.append(li);
  });
}

// ---------- Actions ----------

function toggleKeyword(index, active) {
  const keywords = settings.keywords.map((k, i) => (i === index ? { ...k, active } : k));
  save({ keywords }).then(refreshSoon);
}

function setAll(active) {
  save({ keywords: settings.keywords.map((k) => ({ ...k, active })) }).then(refreshSoon);
}

function addKeywords(raw) {
  const keywords = [...settings.keywords];
  for (const part of raw.split(',')) {
    const text = part.trim().replace(/\s+/g, ' ');
    if (text && !keywords.some((k) => sameKeyword(k.text, text))) {
      keywords.push({ text, active: true });
    }
  }
  if (keywords.length !== settings.keywords.length) save({ keywords }).then(refreshSoon);
}

function removeKeyword(index) {
  save({ keywords: settings.keywords.filter((_, i) => i !== index) }).then(refreshSoon);
}

function addSites(raw) {
  const sites = [...settings.sites];
  for (const part of raw.split(/[\s,]+/)) {
    const site = normalizeSite(part);
    if (site && !sites.includes(site)) sites.push(site);
  }
  if (sites.length !== settings.sites.length) save({ sites }).then(refreshSoon);
}

function removeSite(index) {
  save({ sites: settings.sites.filter((_, i) => i !== index) }).then(refreshSoon);
}

// Adds the active tab's site to the list, or removes every entry that covers it.
function toggleCurrentSite() {
  if (!currentHost) return;
  if (isListed(currentHost)) {
    save({ sites: settings.sites.filter((site) => !hostMatches(currentHost, site)) }).then(refreshSoon);
  } else {
    addSites(currentHost);
  }
}

// The content script rescans after a settings change; give it a moment.
function refreshSoon() {
  setTimeout(refreshStats, 350);
}

// ---------- Tabs ----------

function showTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  $('panel-overview').hidden = name !== 'overview';
  $('panel-config').hidden = name !== 'config';
  try {
    localStorage.setItem('nf:tab', name);
  } catch {}
  if (name === 'config') $('keyword-input').focus();
}

function initialTab() {
  try {
    const saved = localStorage.getItem('nf:tab');
    if (saved) return saved;
  } catch {}
  return settings.keywords.length ? 'overview' : 'config';
}

// ---------- Wiring ----------

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
});

$('enabled').addEventListener('change', (e) => {
  save({ enabled: e.target.checked }).then(refreshSoon);
});

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  addKeywords($('keyword-input').value);
  $('keyword-input').value = '';
  $('keyword-input').focus();
});

$('site-form').addEventListener('submit', (e) => {
  e.preventDefault();
  addSites($('site-input').value);
  $('site-input').value = '';
  $('site-input').focus();
});

for (const radio of document.querySelectorAll('input[name="site-mode"]')) {
  radio.addEventListener('change', () => save({ siteMode: radio.value }).then(refreshSoon));
}

$('add-current').addEventListener('click', toggleCurrentSite);
$('site-toggle').addEventListener('click', toggleCurrentSite);
$('check-all').addEventListener('click', () => setAll(true));
$('check-none').addEventListener('click', () => setAll(false));
$('go-config').addEventListener('click', () => showTab('config'));

$('clear-all').addEventListener('click', () => {
  if (confirm('Apagar todas as palavras-chave?')) save({ keywords: [] }).then(refreshSoon);
});

(async () => {
  await load();
  render();
  showTab(initialTab());
  refreshStats();
})();
