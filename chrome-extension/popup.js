const SNAPSHOT_KEY = "cookieSnapshot";
const ENTITY_KEY = "cookieEntities";
const REPORT_KEY = "lastAutofillReport";

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

  meta.textContent = `Captured ${snapshot.capturedAt}`;

  const wanted = new Set(["xf_user", "xf_session", "xf_tfa_trust"]);
  const entries = Object.entries(payload.entities).filter(([key]) => wanted.has(String(key).toLowerCase()));
  if (entries.length === 0) {
    list.textContent = "No xf_user / xf_session / xf_tfa_trust cookies captured.";
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

document.getElementById("autofill").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "autofill-editor" });
  await chrome.storage.local.set({ [REPORT_KEY]: { at: new Date().toISOString(), result } });
  document.getElementById("status").textContent = result?.ok
    ? ` Autofilled ${result.filled} cookie value(s)`
    : ` Autofill failed${result?.reason ? `: ${result.reason}` : ""}`;
  document.getElementById("autofillReport").textContent = `Last autofill: ${result?.ok ? `filled ${result.filled}` : `failed (${result?.reason || "unknown"})`} at ${new Date().toLocaleTimeString()}`;
});

document.getElementById("copy").addEventListener("click", async () => {
  const store = await chrome.storage.local.get([SNAPSHOT_KEY, ENTITY_KEY]);
  await navigator.clipboard.writeText(JSON.stringify(store, null, 2));
});

document.getElementById("copyPayload").addEventListener("click", async () => {
  const store = await chrome.storage.local.get([ENTITY_KEY]);
  const entities = store[ENTITY_KEY]?.entities || {};
  const wanted = ["xf_user", "xf_session", "xf_tfa_trust"];
  const payload = {};
  for (const key of wanted) {
    if (entities[key]?.value) payload[key] = entities[key].value;
  }
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  document.getElementById("status").textContent = " Payload copied";
});

(async () => {
  await requestRefresh();
  await render();
  const state = await chrome.storage.local.get([REPORT_KEY]);
  if (state[REPORT_KEY]) {
    const rr = state[REPORT_KEY];
    document.getElementById("autofillReport").textContent = `Last autofill: ${rr.result?.ok ? `filled ${rr.result.filled}` : `failed (${rr.result?.reason || "unknown"})`} at ${new Date(rr.at).toLocaleString()}`;
  }
})();
