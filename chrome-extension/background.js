const SNAPSHOT_KEY = "cookieSnapshot";
const ENTITY_KEY = "cookieEntities";
const AUTO_REFRESH_MINUTES = 30;

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

async function snapshotCookiesForUrl(url, reason = "auto") {
  const hostname = getHostFromUrl(url);
  if (!hostname) return null;

  const cookies = await chrome.cookies.getAll({ url });
  const capturedAt = new Date().toISOString();
  const entities = toEntityPayload(cookies);

  const snapshot = {
    hostname,
    url,
    reason,
    capturedAt,
    count: cookies.length,
    cookies,
  };

  await chrome.storage.local.set({
    [SNAPSHOT_KEY]: snapshot,
    [ENTITY_KEY]: {
      hostname,
      url,
      reason,
      capturedAt,
      entities,
    },
  });

  return snapshot;
}

async function captureFromActiveTab(reason = "auto") {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) return null;
  return snapshotCookiesForUrl(tab.url, reason);
}

chrome.tabs.onActivated.addListener(async () => {
  await captureFromActiveTab("tab_activated");
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab?.active || !tab.url || !/^https?:/i.test(tab.url)) return;
  await snapshotCookiesForUrl(tab.url, "tab_updated");
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "refresh-cookies") {
    (async () => {
      const snapshot = await captureFromActiveTab("manual_popup_refresh");
      sendResponse({ ok: !!snapshot });
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
