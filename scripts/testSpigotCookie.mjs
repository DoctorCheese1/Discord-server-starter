#!/usr/bin/env node

const [, , resourceArg = '', xfUser = '', xfSession = '', xfTfaTrust = '', extraCookieHeader = ''] = process.argv;

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

function normalizeExtraCookies(input) {
  const raw = String(input || '').trim();
  if (!raw) return [];
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.includes('='));
}

function buildCookieHeader(xfUserValue, xfSessionValue, xfTfaTrustValue, extraCookieParts) {
  const cookieParts = [`xf_user=${xfUserValue}`, `xf_session=${xfSessionValue}`];
  if (xfTfaTrustValue) cookieParts.push(`xf_tfa_trust=${xfTfaTrustValue}`);

  for (const part of extraCookieParts) {
    const key = part.split('=')[0]?.trim();
    if (!key) continue;
    if (key === 'xf_user' || key === 'xf_session' || key === 'xf_tfa_trust') continue;
    cookieParts.push(part);
  }

  return cookieParts.join('; ');
}

async function main() {
  if (!resourceArg || !xfUser || !xfSession) {
    fail('Usage: node scripts/testSpigotCookie.mjs <resourceIdOrUrl> <xf_user> <xf_session> [xf_tfa_trust] [extra_cookie_header]');
    return;
  }

  const resourceId = parseSpigotResourceId(resourceArg);
  if (!resourceId) {
    fail(`Could not parse Spigot resource ID from input: ${resourceArg}`);
    return;
  }

  const decodedXfUser = decodeCookieValue(xfUser);
  const decodedXfSession = decodeCookieValue(xfSession);
  const decodedXfTfaTrust = decodeCookieValue(xfTfaTrust);
  const extraCookieParts = normalizeExtraCookies(extraCookieHeader);
  const cookieHeader = buildCookieHeader(decodedXfUser, decodedXfSession, decodedXfTfaTrust, extraCookieParts);

  const downloadUrl = `https://www.spigotmc.org/resources/${resourceId}/download?version=latest`;

  const response = await fetch(downloadUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: `https://www.spigotmc.org/resources/${resourceId}/`,
      Origin: 'https://www.spigotmc.org',
      Cookie: cookieHeader
    }
  });

  const location = response.headers.get('location') || '';

  if (response.status === 403) {
    fail('❌ Cookie test failed: 403 Forbidden (session/cookies not accepted).', 2);
    console.error('Tip: pass extra browser cookies as the 5th arg, e.g. "cf_clearance=...; spigot_session=..."');
    if (location) console.error(`Location: ${location}`);
    return;
  }

  if (response.status >= 300 && response.status < 400 && location) {
    console.log('✅ Cookie test looks valid: received redirect to download target.');
    console.log(`Status: ${response.status}`);
    console.log(`Location: ${location}`);
    return;
  }

  if (response.ok) {
    console.log('✅ Cookie test succeeded: direct downloadable response returned.');
    console.log(`Status: ${response.status}`);
    return;
  }

  fail(`⚠️ Unexpected response: HTTP ${response.status}`, 3);
  if (location) console.error(`Location: ${location}`);
}

await main();
