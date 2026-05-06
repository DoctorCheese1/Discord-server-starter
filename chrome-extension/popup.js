const SNAPSHOT_KEY = "cookieSnapshot";
const ENTITY_KEY = "cookieEntities";

async function requestRefresh() {
  const response = await chrome.runtime.sendMessage({ type: "refresh-cookies" });
  return !!response?.ok;
}

function cookieRow(cookieKey, record) {
  const row = document.createElement("div");
  row.className = "cookie-row";

  const name = document.createElement("div");
  name.className = "cookie-name";
  name.textContent = `${record.name}:`;

  const input = document.createElement("input");
  input.type = record.hidden ? "password" : "text";
  input.value = record.value || "";
  input.readOnly = true;

  const toggleWrap = document.createElement("label");
  toggleWrap.className = "small";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = !record.hidden;
  toggle.addEventListener("change", async () => {
    const hidden = !toggle.checked;
    input.type = hidden ? "password" : "text";
    await chrome.runtime.sendMessage({
      type: "set-cookie-hidden",
      cookieKey,
      hidden,
    });
  });

  toggleWrap.append(toggle, document.createTextNode(` hidden/non-hidden (${record.domain})`));
  row.append(name, input, toggleWrap);
  return row;
}

async function render(message = "") {
  const meta = document.getElementById("meta");
  const list = document.getElementById("cookieList");
  list.innerHTML = "";

  const store = await chrome.storage.local.get([SNAPSHOT_KEY, ENTITY_KEY]);
  const snapshot = store[SNAPSHOT_KEY];
  const payload = store[ENTITY_KEY];

  if (!snapshot || !payload?.entities) {
    meta.textContent = message || "No cookie snapshot yet.";
    return;
  }

  meta.textContent = `${snapshot.hostname} • ${snapshot.count} cookies • captured ${snapshot.capturedAt}`;

  const entries = Object.entries(payload.entities);
  if (entries.length === 0) {
    list.textContent = "No cookies captured for this page.";
    return;
  }

  entries.sort(([a], [b]) => a.localeCompare(b));
  for (const [cookieKey, record] of entries) {
    list.appendChild(cookieRow(cookieKey, record));
  }
}

document.getElementById("refresh").addEventListener("click", async () => {
  const ok = await requestRefresh();
  document.getElementById("status").textContent = ok ? " Refreshed" : " Refresh failed";
  await render(ok ? "" : "Refresh failed.");
});

document.getElementById("copy").addEventListener("click", async () => {
  const store = await chrome.storage.local.get([SNAPSHOT_KEY, ENTITY_KEY]);
  await navigator.clipboard.writeText(JSON.stringify(store, null, 2));
});

(async () => {
  await requestRefresh();
  await render();
})();
