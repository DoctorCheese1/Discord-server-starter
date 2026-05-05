const STORAGE_KEY = "cookieSnapshots";
const ENTITY_STORAGE_KEY = "spigotCookieEntities";
const TARGET_DOMAINS = ["spigot.org", "spigotmc.org", "spoigot.org"];

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isSpigotDomain(hostname) {
  return TARGET_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function requestRefresh() {
  const response = await chrome.runtime.sendMessage({ type: "refresh-spigot-cookies" });
  return !!response?.ok;
}

function renderSnapshot(metaEl, outputEl, snapshot, entities) {
  metaEl.textContent = `${snapshot.domain} • ${snapshot.count} cookies • xf:${entities?.xfCount ?? 0} • cf:${entities?.cfCount ?? 0} • captured ${snapshot.capturedAt}`;
  outputEl.textContent = JSON.stringify(
    {
      snapshot,
      entities,
    },
    null,
    2,
  );
}

async function render(message = "") {
  const tab = await getCurrentTab();
  const hostname = getDomainFromUrl(tab?.url || "");
  const meta = document.getElementById("meta");
  const output = document.getElementById("output");

  if (!hostname || !isSpigotDomain(hostname)) {
    meta.textContent = "Open a supported tab (spigot.org, spigotmc.org, or spoigot.org).";
    output.textContent = message || "No supported Spigot tab detected.";
    return;
  }

  const store = await chrome.storage.local.get([STORAGE_KEY, ENTITY_STORAGE_KEY]);
  const snapshot = store[STORAGE_KEY];
  const entities = store[ENTITY_STORAGE_KEY];

  if (!snapshot) {
    meta.textContent = "No spigot cookie snapshot yet.";
    output.textContent = "Click Manual refresh.";
    return;
  }

  renderSnapshot(meta, output, snapshot, entities);
}

document.getElementById("refresh").addEventListener("click", async () => {
  const refreshed = await requestRefresh();
  await render(refreshed ? "" : "Refresh failed. Ensure a supported Spigot tab is active.");
});

document.getElementById("copy").addEventListener("click", async () => {
  const text = document.getElementById("output").textContent;
  await navigator.clipboard.writeText(text);
});

(async () => {
  await requestRefresh();
  await render();
})();
