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

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function requestRefresh(tab) {
  if (!tab?.url) return { ok: false, reason: "No active tab URL." };
  const hostname = getDomainFromUrl(tab.url);
  if (!hostname || !isSpigotDomain(hostname)) {
    return { ok: false, reason: "Open a spigot.org tab first." };
  }

  const cookies = await chrome.cookies.getAll({ domain: TARGET_DOMAIN });
  const snapshot = {
    domain: TARGET_DOMAIN,
    sourceHost: hostname,
    url: tab.url,
    capturedAt: new Date().toISOString(),
    count: cookies.length,
    cookies,
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
  return { ok: true };
}

async function render(message = "") {
  const tab = await getCurrentTab();
  const hostname = getDomainFromUrl(tab?.url || "");
  const meta = document.getElementById("meta");
  const output = document.getElementById("output");

  if (!hostname || !isSpigotDomain(hostname)) {
    meta.textContent = "Open a spigot.org page (https://spigot.org or subdomains).";
    output.textContent = message || "No spigot.org tab detected.";
    return;
  }

  const store = await chrome.storage.local.get(STORAGE_KEY);
  const snapshot = store[STORAGE_KEY];

  if (!snapshot) {
    meta.textContent = "No spigot cookie snapshot yet.";
    output.textContent = "Click Refresh current tab.";
    return;
  }

  meta.textContent = `${snapshot.domain} • ${snapshot.count} cookies • captured ${snapshot.capturedAt}`;
  output.textContent = JSON.stringify(snapshot, null, 2);
}

document.getElementById("refresh").addEventListener("click", async () => {
  const tab = await getCurrentTab();
  const result = await requestRefresh(tab);
  await render(result.ok ? "" : result.reason);
});

document.getElementById("copy").addEventListener("click", async () => {
  const text = document.getElementById("output").textContent;
  await navigator.clipboard.writeText(text);
});

render();
