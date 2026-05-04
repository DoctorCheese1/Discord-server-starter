const STORAGE_KEY = "cookieSnapshots";

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function snapshotCookiesForUrl(url) {
  const domain = getDomainFromUrl(url);
  if (!domain) return;

  const cookies = await chrome.cookies.getAll({ domain });
  const snapshot = {
    domain,
    url,
    capturedAt: new Date().toISOString(),
    count: cookies.length,
    cookies,
  };

  const existing = await chrome.storage.local.get(STORAGE_KEY);
  const map = existing[STORAGE_KEY] || {};
  map[domain] = snapshot;

  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

async function processActiveTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url || !/^https?:/i.test(tab.url)) return;
  await snapshotCookiesForUrl(tab.url);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await processActiveTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab?.active) return;
  if (!tab.url || !/^https?:/i.test(tab.url)) return;

  await snapshotCookiesForUrl(tab.url);
});

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id !== undefined) {
    await processActiveTab(tabs[0].id);
  }
});
