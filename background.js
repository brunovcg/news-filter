// Shows how many blocks were hidden on each tab as a badge on the toolbar icon.

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(['enabled', 'keywords', 'siteMode', 'sites']);
  const defaults = {};
  if (current.enabled === undefined) defaults.enabled = true;
  if (!Array.isArray(current.keywords)) defaults.keywords = [];
  if (current.siteMode === undefined) defaults.siteMode = 'except';
  if (!Array.isArray(current.sites)) defaults.sites = [];
  if (Object.keys(defaults).length) await chrome.storage.sync.set(defaults);
});

chrome.action.setBadgeBackgroundColor({ color: '#d4141c' });

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'nf:count' || !sender.tab) return;
  chrome.action.setBadgeText({
    tabId: sender.tab.id,
    text: msg.total > 0 ? String(msg.total) : '',
  });
});
