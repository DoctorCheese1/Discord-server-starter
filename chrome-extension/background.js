const STORAGE_KEY = "cookieSnapshots";
const TARGET_DOMAIN = "spigot.org";

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isSpigotDomain(hostname) {
  return hostname === TARGET_DOMAIN || hostname.endsWith(`.${TARGET_DOMAIN}`);
}

async function snapshotSpigotCookies(url) {
  const hostname = getDomainFromUrl(url);
  if (!hostname || !isSpigotDomain(hostname)) return;

  const cookies = await chrome.cookies.getAll({ domain: TARGET_DOMAIN });
  const snapshot = {
    domain: TARGET_DOMAIN,
    sourceHost: hostname,
    url,
    capturedAt: new Date().toISOString(),
    count: cookies.length,
    cookies,
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
}

async function processActiveTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url || !/^https?:/i.test(tab.url)) return;
  await snapshotSpigotCookies(tab.url);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await processActiveTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab?.active) return;
  if (!tab.url || !/^https?:/i.test(tab.url)) return;

  await snapshotSpigotCookies(tab.url);
});

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id !== undefined) {
    await processActiveTab(tabs[0].id);
  }
});
