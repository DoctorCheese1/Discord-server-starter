#!/usr/bin/env node

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TEST_VERSION = '633090';

const [, , resourceArg = '', cookieOrXfUser = '', xfSession = '', xfTfaTrust = '', extraCookieHeader = '', userAgentArg = ''] = process.argv;

function fail(message, code = 1) {
  console.error(message);
  process.exitCode = code;
}

const safeDecode = (value) => {
  try { return decodeURIComponent(String(value || '').trim()); } catch { return String(value || '').trim(); }
};

function parseResourceId(input) {
  const raw = String(input || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/spigotmc\.org\/resources\/[^./]+\.([0-9]+)\//i)
    || raw.match(/spigotmc\.org\/resources\/([0-9]+)/i)
    || raw.match(/spiget\.org\/resources\/([0-9]+)/i);
  return match?.[1] || '';
}

function parseCookieParts(header) {
  return String(header || '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return null;
      return [part.slice(0, idx).trim(), safeDecode(part.slice(idx + 1))];
    })
    .filter(Boolean);
}

function buildCookieHeader() {
  if (cookieOrXfUser.includes('=') && cookieOrXfUser.includes(';')) {
    const full = parseCookieParts(cookieOrXfUser);
    const extra = parseCookieParts(extraCookieHeader);
    return [...full, ...extra].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  if (!cookieOrXfUser || !xfSession) return '';

  const parts = [
    ['xf_user', safeDecode(cookieOrXfUser)],
    ['xf_session', safeDecode(xfSession)]
  ];
  const decodedTfa = safeDecode(xfTfaTrust);
  if (decodedTfa) parts.push(['xf_tfa_trust', decodedTfa]);
  parts.push(...parseCookieParts(extraCookieHeader));
  return parts.map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(url, headers) {
  try {
    const { default: cloudscraper } = await import('cloudscraper');
    const r = await cloudscraper.get({ url, headers, resolveWithFullResponse: true, simple: false, followAllRedirects: false });
    return { status: r.statusCode || 0, location: r.headers?.location || '', body: String(r.body || ''), engine: 'cloudscraper' };
  } catch {
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'manual', headers });
      return { status: r.status, location: r.headers.get('location') || '', body: await r.text(), engine: 'fetch' };
    } catch (e) {
      return { status: 0, location: '', body: String(e?.message || e || ''), engine: 'fetch-error' };
    }
  }
}

function inferAuthState(body = '') {
  if (/Log Out|data-logout-url|account\/logout/i.test(body)) return 'logged_in';
  if (/Log in|Register|Forgot your password\?/i.test(body)) return 'logged_out';
  if (/cf-browser-verification|Attention Required|Cloudflare/i.test(body)) return 'cloudflare_challenge';
  return 'unknown';
}

function inferResourceState(body = '') {
  if (/You do not have permission|must purchase|buy this resource/i.test(body)) return 'no_access';
  if (/resource is no longer available|removed from listing|deleted/i.test(body)) return 'unavailable';
  if (/download\?version|downloadButton|fa-download/i.test(body)) return 'download_visible';
  return 'unknown';
}

function extractXfToken(body = '') {
  return body.match(/name=["']_xfToken["']\s+value=["']([^"']+)["']/i)?.[1] || '';
}


function extractLatestVersionId(resourceId, body = '') {
  const text = String(body || '');
  const m = text.match(new RegExp(`/resources/(?:[^/]+\.)?${resourceId}/download\?version=(\d+)`, 'i'));
  return m?.[1] || '';
}

function buildCandidateUrls(resourceId, html, latestVersionId = '') {
  const out = new Set([
    `https://www.spigotmc.org/resources/${resourceId}/download?version=${TEST_VERSION}`,
    `https://www.spigotmc.org/resources/${resourceId}/download`,
    `https://api.spiget.org/v2/resources/${resourceId}/download`
  ]);
  if (latestVersionId) out.add(`https://www.spigotmc.org/resources/${resourceId}/download?version=${latestVersionId}`);
  const patterns = [
    new RegExp(`/resources/(?:[^/]+\\.)?${resourceId}/download[^"'\\s<]*`, 'ig'),
    /href=["']([^"']*download[^"']*)["']/ig
  ];
  for (const p of patterns) {
    for (const m of html.matchAll(p)) {
      const raw = (m[1] || m[0] || '').replace(/&amp;/g, '&');
      try { out.add(new URL(raw, 'https://www.spigotmc.org/').toString()); } catch {}
    }
  }
  return [...out];
}


async function fetchLatestSpigetPath(resourceId) {
  const apiUrl = `https://api.spiget.org/v2/resources/${resourceId}`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) return '';
    const data = await response.json();
    const rawPath = String(data?.file?.url || '').trim();
    if (!rawPath) return '';
    return rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  } catch {
    return '';
  }
}

function addToken(url, token) {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}_xfToken=${encodeURIComponent(token)}`;
}




function extractCookieValue(cookieHeader, key) {
  const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${safeKey}=([^;]+)`, 'i'));
  return match?.[1] || '';
}

function inferCfClearanceAge(cookieHeader) {
  const cf = extractCookieValue(cookieHeader, 'cf_clearance');
  if (!cf) return 'missing';
  const m = cf.match(/-(\d{10})-/);
  if (!m) return 'unknown';
  const issued = Number(m[1]) * 1000;
  const ageMinutes = Math.floor((Date.now() - issued) / 60000);
  if (Number.isNaN(ageMinutes)) return 'unknown';
  return `${ageMinutes}m old`;
}

function hasCloudflareCookie(cookieHeader) {
  return /(?:^|;\s*)cf_clearance=/i.test(String(cookieHeader || ''));
}

function buildCurlPreview(url, userAgent, cookieHeader) {
  const safeUrl = String(url || '').replace(/"/g, '\"');
  const safeUa = String(userAgent || '').replace(/"/g, '\"');
  const safeCookie = String(cookieHeader || '').replace(/"/g, '\"');
  return `curl -i "${safeUrl}" -H "User-Agent: ${safeUa}" -H "Cookie: ${safeCookie}"`;
}

async function main() {
  if (!resourceArg || !cookieOrXfUser) return fail('Usage: node scripts/testSpigotCookie.mjs <resourceIdOrUrl> <full_cookie_header|xf_user> [xf_session] [xf_tfa_trust] [extra_cookie_header] [user_agent]');

  const resourceId = parseResourceId(resourceArg);
  if (!resourceId) return fail(`Could not parse Spigot resource ID from input: ${resourceArg}`);

  const cookieHeader = buildCookieHeader();
  if (!cookieHeader) return fail('Missing cookie info. Provide full cookie header, or xf_user + xf_session.');

  const userAgent = userAgentArg || DEFAULT_UA;
  const headers = {
    'User-Agent': userAgent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: `https://www.spigotmc.org/resources/${resourceId}/`,
    Origin: 'https://www.spigotmc.org',
    Cookie: cookieHeader
  };

  const account = await request('https://www.spigotmc.org/account/', headers);
  const resource = await request(`https://www.spigotmc.org/resources/${resourceId}/`, headers);
  const versionsPage = await request(`https://www.spigotmc.org/resources/${resourceId}/updates`, headers);
  const latestVersionId = extractLatestVersionId(resourceId, `${versionsPage.body}
${resource.body}`);
  const latestSpigetPath = await fetchLatestSpigetPath(resourceId);
  const authState = inferAuthState(account.body);
  const resourceState = inferResourceState(resource.body);
  const token = extractXfToken(resource.body);

  console.log(`ℹ️ Request engine: ${resource.engine}`);
  console.log(`ℹ️ Account check: ${account.status} (${authState})`);
  console.log(`ℹ️ Resource access hint: ${resourceState}`);
  console.log(`ℹ️ User-Agent: ${userAgent}`);
  console.log(`ℹ️ Has cf_clearance: ${hasCloudflareCookie(cookieHeader)}`);
  console.log(`ℹ️ cf_clearance age: ${inferCfClearanceAge(cookieHeader)}`);
  console.log(`ℹ️ Latest version id: ${latestVersionId || 'not found'}`);
  console.log(`ℹ️ Spiget path: ${latestSpigetPath || 'not found'}`);

  const baseCandidates = buildCandidateUrls(resourceId, resource.body, latestVersionId);
  if (latestSpigetPath) baseCandidates.unshift(`https://www.spigotmc.org${latestSpigetPath}`);
  const candidates = [...new Set(baseCandidates)].map((u) => addToken(u, token));
  if (candidates.length) console.log(`ℹ️ Manual test command: ${buildCurlPreview(candidates[0], userAgent, cookieHeader)}`);
  for (const [i, url] of candidates.entries()) {
    const r = await request(url, headers);
    if (r.status >= 300 && r.status < 400 && r.location) {
      console.log('✅ Cookie test looks valid: received redirect to download target.');
      console.log(`Attempt: ${i + 1}/${candidates.length}`);
      console.log(`Status: ${r.status}`);
      console.log(`Location: ${r.location}`);
      return;
    }
    if (r.status >= 200 && r.status < 300) {
      console.log('✅ Cookie test succeeded: direct downloadable response returned.');
      console.log(`Attempt: ${i + 1}/${candidates.length}`);
      console.log(`Status: ${r.status}`);
      return;
    }
  }

  fail('❌ Cookie test failed: no candidate download URL succeeded.', 2);
  if (authState === 'logged_out') console.error('Hint: cookies are not logged in anymore (session expired).');
  if (authState === 'cloudflare_challenge') {
    console.error('Hint: Cloudflare challenge detected; clearance may be browser-bound.');
    console.error('Hint: rerun with your exact browser User-Agent as arg 6 and fresh cf_clearance cookie.');
    if (!hasCloudflareCookie(cookieHeader)) console.error('Hint: your current cookie input does not include cf_clearance.');
    if (inferCfClearanceAge(cookieHeader).endsWith('old')) console.error('Hint: your cf_clearance may be stale; copy a fresh one from a live browser session.');
  }
  if (resourceState === 'no_access') console.error('Hint: account may not own/have access to this resource.');
  if (resourceState === 'unavailable') console.error('Hint: resource appears unavailable/removed on Spigot.');
}

await main();
