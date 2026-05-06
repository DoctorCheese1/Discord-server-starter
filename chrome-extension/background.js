const SNAPSHOT_KEY = "cookieSnapshot";
const ENTITY_KEY = "cookieEntities";
const AUTO_REFRESH_MINUTES = 30;
const TARGET_COOKIE_DOMAINS = ["spigot.org", ".spigot.org", "spigotmc.org", ".spigotmc.org"];

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function toEntityPayload(cookies) {
  const map = {};

  for (const cookie of cookies) {
    const key = cookie.name.toLowerCase();
    map[key] = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expirationDate ?? null,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      hidden: true,
    };
  }

  return map;
}

async function getSpigotCookies() {
  const all = [];
  for (const domain of TARGET_COOKIE_DOMAINS) {
    const cookies = await chrome.cookies.getAll({ domain });
    all.push(...cookies);
  }

  const deduped = new Map();
  for (const c of all) {
    deduped.set(`${c.domain}|${c.path}|${c.name}`, c);
  }

  return [...deduped.values()];
}

async function snapshotSpigotCookies(sourceUrl, reason = "auto") {
  const cookies = await getSpigotCookies();
  const capturedAt = new Date().toISOString();
  const entities = toEntityPayload(cookies);

  const snapshot = {
    sourceHost: getHostFromUrl(sourceUrl || ""),
    sourceUrl: sourceUrl || null,
    target: "spigot-only",
    reason,
    capturedAt,
    count: cookies.length,
    cookies,
  };

  await chrome.storage.local.set({
    [SNAPSHOT_KEY]: snapshot,
    [ENTITY_KEY]: {
      sourceHost: snapshot.sourceHost,
      sourceUrl: snapshot.sourceUrl,
      target: snapshot.target,
      reason,
      capturedAt,
      entities,
    },
  });

  return snapshot;
}

async function captureFromActiveTab(reason = "auto") {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return snapshotSpigotCookies(tab?.url ?? null, reason);
}

chrome.tabs.onActivated.addListener(async () => {
  await captureFromActiveTab("tab_activated");
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  await snapshotSpigotCookies(tab?.url ?? null, "tab_updated");
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "cookie-refresh") return;
  await captureFromActiveTab("alarm_30m");
});

function ensureAlarm() {
  chrome.alarms.create("cookie-refresh", { periodInMinutes: AUTO_REFRESH_MINUTES });
}

chrome.runtime.onStartup.addListener(async () => {
  ensureAlarm();
  await captureFromActiveTab("startup");
});

chrome.runtime.onInstalled.addListener(async () => {
  ensureAlarm();
  await captureFromActiveTab("installed");
});


async function autofillEditorInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, reason: "No active tab." };

  const store = await chrome.storage.local.get(ENTITY_KEY);
  const entities = store[ENTITY_KEY]?.entities || {};

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (cookieEntities) => {
      const normalize = (v) => (v || "").toString().trim().toLowerCase();
      const byName = cookieEntities || {};
      let filled = 0;

      const elements = Array.from(
        document.querySelectorAll("input[type='text'], input:not([type]), textarea, [contenteditable='true']"),
      );

      for (const el of elements) {
        const candidates = [
          el.name,
          el.id,
          el.getAttribute("data-cookie"),
          el.getAttribute("placeholder"),
          el.getAttribute("aria-label"),
        ]
          .map(normalize)
          .filter(Boolean);

        let matched = null;
        for (const candidate of candidates) {
          if (byName[candidate]) {
            matched = byName[candidate];
            break;
          }
        }

        if (!matched) continue;
        const value = matched.value || "";

        if (el.isContentEditable) {
          el.textContent = value;
        } else {
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        filled += 1;
      }

      return { filled };
    },
    args: [entities],
  });

  return { ok: true, filled: result?.[0]?.result?.filled || 0 };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "refresh-cookies") {
    (async () => {
      const snapshot = await captureFromActiveTab("manual_popup_refresh");
      sendResponse({ ok: !!snapshot });
    })();
    return true;
  }

  if (message?.type === "autofill-editor") {
    (async () => {
      const result = await autofillEditorInActiveTab();
      sendResponse(result);
    })();
    return true;
  }

  if (message?.type === "set-cookie-hidden") {
    (async () => {
      const store = await chrome.storage.local.get(ENTITY_KEY);
      const payload = store[ENTITY_KEY];
      if (!payload?.entities?.[message.cookieKey]) {
        sendResponse({ ok: false });
        return;
      }

      payload.entities[message.cookieKey].hidden = !!message.hidden;
      await chrome.storage.local.set({ [ENTITY_KEY]: payload });
      sendResponse({ ok: true });
    })();
    return true;
  }
});
