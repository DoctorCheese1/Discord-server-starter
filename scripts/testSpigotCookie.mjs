#!/usr/bin/env node

const [, , resourceArg = '', cookieOrXfUser = '', xfSession = '', xfTfaTrust = '', extraCookieHeader = ''] = process.argv;

function fail(message, code = 1) {
  console.error(message);
  process.exitCode = code;
}

function decodeCookieValue(value) {
  const raw = String(value || '').trim();
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseSpigotResourceId(input) {
  const raw = String(input || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/spigotmc\.org\/resources\/[^./]+\.([0-9]+)\//i)
    || raw.match(/spigotmc\.org\/resources\/([0-9]+)/i)
    || raw.match(/spiget\.org\/resources\/([0-9]+)/i);
  return match?.[1] || '';
}

function normalizeCookieParts(input) {
  const raw = String(input || '').trim();
  if (!raw) return [];
  return raw.split(';').map((part) => part.trim()).filter(Boolean).filter((part) => part.includes('='));
}

function parseCookieHeader(header) {
  return normalizeCookieParts(header)
    .map((part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return null;
      const key = part.slice(0, idx).trim();
      const value = decodeCookieValue(part.slice(idx + 1));
      if (!key) return null;
      return [key, value];
    })
    .filter(Boolean);
}

function formatCookieHeader(cookieEntries) {
  return cookieEntries.map(([key, value]) => `${key}=${value}`).join('; ');
}

function buildCookieHeader() {
  if (cookieOrXfUser.includes('=') && cookieOrXfUser.includes(';')) {
    const full = parseCookieHeader(cookieOrXfUser);
    const extra = parseCookieHeader(extraCookieHeader);
    return formatCookieHeader([...full, ...extra]);
  }

  if (!cookieOrXfUser || !xfSession) return '';
  const decodedXfUser = decodeCookieValue(cookieOrXfUser);
  const decodedXfSession = decodeCookieValue(xfSession);
  const decodedXfTfaTrust = decodeCookieValue(xfTfaTrust);
  const extraCookieParts = parseCookieHeader(extraCookieHeader);

  const cookieParts = [
    ['xf_user', decodedXfUser],
    ['xf_session', decodedXfSession]
  ];
  if (decodedXfTfaTrust) cookieParts.push(['xf_tfa_trust', decodedXfTfaTrust]);
  cookieParts.push(...extraCookieParts);
  return formatCookieHeader(cookieParts);
}

async function requestWithCloudscraper(url, headers) {
  const { default: cloudscraper } = await import('cloudscraper');
  return cloudscraper.get({
    url,
    headers,
    resolveWithFullResponse: true,
    simple: false,
    followAllRedirects: false
  });
}

async function main() {
  if (!resourceArg || !cookieOrXfUser) {
    fail('Usage: node scripts/testSpigotCookie.mjs <resourceIdOrUrl> <full_cookie_header|xf_user> [xf_session] [xf_tfa_trust] [extra_cookie_header]');
    return;
  }

  const resourceId = parseSpigotResourceId(resourceArg);
  if (!resourceId) {
    fail(`Could not parse Spigot resource ID from input: ${resourceArg}`);
    return;
  }

  const cookieHeader = buildCookieHeader();
  if (!cookieHeader) {
    fail('Missing cookie info. Provide a full cookie header string, or xf_user + xf_session.', 1);
    return;
  }

  const downloadUrl = `https://www.spigotmc.org/resources/${resourceId}/download?version=latest`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: `https://www.spigotmc.org/resources/${resourceId}/`,
    Origin: 'https://www.spigotmc.org',
    Cookie: cookieHeader
  };

  let response;
  try {
    response = await requestWithCloudscraper(downloadUrl, headers);
  } catch (error) {
    fail(`❌ Cloudscraper request failed: ${error.message}`, 4);
    console.error('Tip: install dependency with: npm i cloudscraper');
    return;
  }

  const location = response.headers?.location || '';
  const status = response.statusCode || response.status || 0;

  if (status === 403) {
    fail('❌ Cookie test failed: 403 Forbidden (session/cookies not accepted).', 2);
    return;
  }

  if (status >= 300 && status < 400 && location) {
    console.log('✅ Cookie test looks valid: received redirect to download target.');
    console.log(`Status: ${status}`);
    console.log(`Location: ${location}`);
    return;
  }

  if (status >= 200 && status < 300) {
    console.log('✅ Cookie test succeeded: direct downloadable response returned.');
    console.log(`Status: ${status}`);
    return;
  }

  fail(`⚠️ Unexpected response: HTTP ${status}`, 3);
  if (location) console.error(`Location: ${location}`);
}

await main();
