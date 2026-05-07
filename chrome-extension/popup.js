const SNAPSHOT_KEY = "cookieSnapshot";
const ENTITY_KEY = "cookieEntities";
const VAULT_KEY = "secureEntitiesVault";
const REPORT_KEY = "lastAutofillReport";
let unlockedEntities = null;

function toAutofillPayload(entities) {
  const wanted = ["xf_user", "xf_session", "xf_tfa_trust", "cf_clearance"];
  const out = {};
  for (const key of wanted) {
    if (entities?.[key]?.value) out[key] = entities[key].value;
  }
  return out;
}

async function encryptPayload(passphrase, payloadObj) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(passphrase));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(JSON.stringify(payloadObj));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
}

async function decryptPayload(passphrase, vault) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(passphrase));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(vault.iv) }, key, new Uint8Array(vault.data));
  return JSON.parse(dec.decode(decrypted));
}

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

  meta.textContent = `${snapshot.sourceHost || snapshot.sourceUrl || "unknown host"} • ${snapshot.count} cookies • captured ${snapshot.capturedAt}`;

  const wanted = new Set(["xf_user", "xf_session", "xf_tfa_trust", "cf_clearance"]);
  const entries = Object.entries(payload.entities).filter(([key]) => wanted.has(String(key).toLowerCase()));
  if (entries.length === 0) {
    list.textContent = "No xf_user / xf_session / xf_tfa_trust / cf_clearance cookies captured.";
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
  const result = unlockedEntities
    ? await chrome.runtime.sendMessage({ type: "autofill-editor-with-payload", entities: unlockedEntities })
    : await chrome.runtime.sendMessage({ type: "autofill-editor" });
  await chrome.storage.local.set({ [REPORT_KEY]: { at: new Date().toISOString(), result } });
  document.getElementById("status").textContent = result?.ok
    ? ` Autofilled ${result.filled} field(s)`
    : ` Autofill failed${result?.reason ? `: ${result.reason}` : ""}`;
  document.getElementById("autofillReport").textContent = `Last autofill: ${result?.ok ? `filled ${result.filled}` : `failed (${result?.reason || "unknown"})`} at ${new Date().toLocaleTimeString()}`;
});

document.getElementById("copy").addEventListener("click", async () => {
  const store = await chrome.storage.local.get([SNAPSHOT_KEY, ENTITY_KEY]);
  await navigator.clipboard.writeText(JSON.stringify(store, null, 2));
});

document.getElementById("copyPayload").addEventListener("click", async () => {
  const store = await chrome.storage.local.get([ENTITY_KEY]);
  const payload = toAutofillPayload(unlockedEntities || store[ENTITY_KEY]?.entities || {});
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  document.getElementById("status").textContent = " Payload copied";
});

document.getElementById("openAutofill").addEventListener("click", async () => {
  const store = await chrome.storage.local.get([ENTITY_KEY]);
  const editorUrl = document.getElementById("editorUrl").value.trim();
  if (!editorUrl) return (document.getElementById("status").textContent = " Missing editor URL");
  const entities = unlockedEntities || store[ENTITY_KEY]?.entities || {};
  const result = await chrome.runtime.sendMessage({ type: "open-editor-autofill", editorUrl, entities });
  document.getElementById("status").textContent = result?.ok ? ` Opened + autofilled ${result.filled}` : ` Open+autofill failed: ${result?.reason || "unknown"}`;
});

document.getElementById("lockVault").addEventListener("click", async () => {
  const passphrase = document.getElementById("vaultPassphrase").value;
  if (!passphrase) return (document.getElementById("status").textContent = " Enter passphrase first");
  const store = await chrome.storage.local.get([ENTITY_KEY]);
  const payload = toAutofillPayload(store[ENTITY_KEY]?.entities || {});
  const encrypted = await encryptPayload(passphrase, payload);
  await chrome.storage.local.set({ [VAULT_KEY]: encrypted });
  unlockedEntities = null;
  document.getElementById("status").textContent = " Vault locked";
});

document.getElementById("unlockVault").addEventListener("click", async () => {
  const passphrase = document.getElementById("vaultPassphrase").value;
  const store = await chrome.storage.local.get([VAULT_KEY]);
  if (!store[VAULT_KEY]) return (document.getElementById("status").textContent = " No vault found");
  try {
    unlockedEntities = await decryptPayload(passphrase, store[VAULT_KEY]);
    document.getElementById("status").textContent = " Vault unlocked";
  } catch {
    document.getElementById("status").textContent = " Wrong passphrase";
  }
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
