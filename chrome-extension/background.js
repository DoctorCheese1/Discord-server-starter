const STORAGE_KEY = "cookieSnapshots";
const ENTITY_STORAGE_KEY = "spigotCookieEntities";
const TARGET_DOMAIN = "spigot.org";
const AUTO_REFRESH_MINUTES = 30;

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

function toEntityPayload(cookies) {
  const xf = [];
  const cf = [];

  for (const cookie of cookies) {
    const record = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expirationDate ?? null,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
    };

    if (/^xf_/i.test(cookie.name) || /^xf/i.test(cookie.name)) xf.push(record);
    if (/^(cf_|__cf)/i.test(cookie.name) || /^cf/i.test(cookie.name)) cf.push(record);
  }

  return { xf, cf };
}

async function snapshotSpigotCookies(url, reason = "auto") {
  const hostname = getDomainFromUrl(url);
  if (!hostname || !isSpigotDomain(hostname)) return null;

  const cookies = await chrome.cookies.getAll({ domain: TARGET_DOMAIN });
  const entities = toEntityPayload(cookies);
  const capturedAt = new Date().toISOString();

  const snapshot = {
    domain: TARGET_DOMAIN,
    sourceHost: hostname,
    url,
    capturedAt,
    reason,
    count: cookies.length,
    cookies,
  };

  await chrome.storage.local.set({
    [STORAGE_KEY]: snapshot,
    [ENTITY_STORAGE_KEY]: {
      domain: TARGET_DOMAIN,
      sourceHost: hostname,
      url,
      capturedAt,
      reason,
      xf: entities.xf,
      cf: entities.cf,
      xfCount: entities.xf.length,
      cfCount: entities.cf.length,
    },
  });

  return snapshot;
}

async function processActiveTab(tabId, reason = "auto") {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url || !/^https?:/i.test(tab.url)) return null;
  return snapshotSpigotCookies(tab.url, reason);
}

async function captureFromActiveTab(reason = "auto") {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return processActiveTab(tab.id, reason);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await processActiveTab(tabId, "tab_activated");
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab?.active) return;
  if (!tab.url || !/^https?:/i.test(tab.url)) return;

  await snapshotSpigotCookies(tab.url, "tab_updated");
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "spigot-cookie-refresh") return;
  await captureFromActiveTab("alarm_30m");
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create("spigot-cookie-refresh", {
    periodInMinutes: AUTO_REFRESH_MINUTES,
  });
  await captureFromActiveTab("startup");
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create("spigot-cookie-refresh", {
    periodInMinutes: AUTO_REFRESH_MINUTES,
  });
  await captureFromActiveTab("installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "refresh-spigot-cookies") return;

  (async () => {
    const snapshot = await captureFromActiveTab("manual_popup_refresh");
    sendResponse({ ok: !!snapshot });
  })();

  return true;
});
