const STORAGE_KEY = "cookieSnapshots";

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function requestRefresh(tab) {
  if (!tab?.url) return;
  const domain = getDomainFromUrl(tab.url);
  if (!domain) return;

  const cookies = await chrome.cookies.getAll({ domain });
  const snapshot = {
    domain,
    url: tab.url,
    capturedAt: new Date().toISOString(),
    count: cookies.length,
    cookies,
  };

  const existing = await chrome.storage.local.get(STORAGE_KEY);
  const map = existing[STORAGE_KEY] || {};
  map[domain] = snapshot;
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

async function render() {
  const tab = await getCurrentTab();
  const domain = getDomainFromUrl(tab?.url || "");
  const meta = document.getElementById("meta");
  const output = document.getElementById("output");

  if (!domain) {
    meta.textContent = "Open a regular website tab (http/https).";
    output.textContent = "No domain detected for this tab.";
    return;
  }

  const store = await chrome.storage.local.get(STORAGE_KEY);
  const snapshot = store[STORAGE_KEY]?.[domain];

  if (!snapshot) {
    meta.textContent = `No snapshot yet for ${domain}.`;
    output.textContent = "Click Refresh current tab.";
    return;
  }

  meta.textContent = `${snapshot.domain} • ${snapshot.count} cookies • captured ${snapshot.capturedAt}`;
  output.textContent = JSON.stringify(snapshot, null, 2);
}

document.getElementById("refresh").addEventListener("click", async () => {
  const tab = await getCurrentTab();
  await requestRefresh(tab);
  await render();
});

document.getElementById("copy").addEventListener("click", async () => {
  const text = document.getElementById("output").textContent;
  await navigator.clipboard.writeText(text);
});

render();
