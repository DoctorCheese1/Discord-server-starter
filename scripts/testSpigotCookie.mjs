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
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.includes('='));
}

function buildCookieHeader() {
  // Mode A: full cookie header passed as arg2 (recommended)
  if (cookieOrXfUser.includes('=') && cookieOrXfUser.includes(';')) {
    const full = normalizeCookieParts(cookieOrXfUser);
    const extra = normalizeCookieParts(extraCookieHeader);
    return [...full, ...extra].join('; ');
  }

  // Mode B: legacy positional args xf_user xf_session [xf_tfa_trust] [extra_cookie_header]
  if (!cookieOrXfUser || !xfSession) return '';
  const decodedXfUser = decodeCookieValue(cookieOrXfUser);
  const decodedXfSession = decodeCookieValue(xfSession);
  const decodedXfTfaTrust = decodeCookieValue(xfTfaTrust);
  const extraCookieParts = normalizeCookieParts(extraCookieHeader);

  const cookieParts = [`xf_user=${decodedXfUser}`, `xf_session=${decodedXfSession}`];
  if (decodedXfTfaTrust) cookieParts.push(`xf_tfa_trust=${decodedXfTfaTrust}`);
  cookieParts.push(...extraCookieParts);
  return cookieParts.join('; ');
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
    console.error('Tip: use full browser Cookie header as arg2 to include all required cookies.');
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
