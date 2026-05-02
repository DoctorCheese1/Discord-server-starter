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

async function requestWithFallback(url, headers) {
  try {
    const { default: cloudscraper } = await import('cloudscraper');
    const response = await cloudscraper.get({
      url,
      headers,
      resolveWithFullResponse: true,
      simple: false,
      followAllRedirects: false
    });

    return {
      status: response.statusCode || response.status || 0,
      location: response.headers?.location || '',
      body: typeof response.body === 'string' ? response.body : '',
      engine: 'cloudscraper'
    };
  } catch {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers
    });

    const body = await response.text();
    return {
      status: response.status,
      location: response.headers.get('location') || '',
      body,
      engine: 'fetch'
    };
  }
}

function extractDownloadUrlsFromResourcePage(resourceId, html) {
  const text = String(html || '');
  const patterns = [
    new RegExp(`/resources/(?:[^/]+\.)?${resourceId}/download\?version=[^"'\s<]+`, 'ig'),
    new RegExp(`/resources/(?:[^/]+\.)?${resourceId}/download[^"'\s<]*`, 'ig'),
    /href=["']([^"']*download[^"']*)["']/ig
  ];

  const urls = [];
  for (const pattern of patterns) {
    if (pattern.source.startsWith('href=')) {
      for (const m of text.matchAll(pattern)) {
        const href = m[1];
        if (!href || !href.includes('/download')) continue;
        urls.push(href);
      }
      continue;
    }

    for (const m of text.matchAll(pattern)) {
      urls.push(m[0]);
    }
  }

  const normalized = urls
    .map((u) => u.replace(/&amp;/g, '&'))
    .map((u) => (u.startsWith('http') ? u : `https://www.spigotmc.org${u}`));

  // Add non-versioned fallback endpoints in case HTML contains no explicit links.
  normalized.push(`https://www.spigotmc.org/resources/${resourceId}/download`);
  normalized.push(`https://www.spigotmc.org/resources/${resourceId}/download?version=latest`);
  normalized.push(`https://www.spigotmc.org/resources/${resourceId}/download?version=0`);

  return [...new Set(normalized)];
}

function extractXfToken(html) {
  const text = String(html || '');
  const m = text.match(/name=["']_xfToken["']\s+value=["']([^"']+)["']/i);
  return m?.[1] || '';
}

function withXfToken(url, xfToken) {
  if (!xfToken) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_xfToken=${encodeURIComponent(xfToken)}`;
}

function inferAuthState(body = '') {
  const text = String(body || '');
  if (!text) return 'unknown';
  if (/Log Out|data-logout-url|account\/logout/i.test(text)) return 'logged_in';
  if (/Log in|Register|Forgot your password\?/i.test(text)) return 'logged_out';
  if (/cf-browser-verification|Attention Required|Cloudflare/i.test(text)) return 'cloudflare_challenge';
  return 'unknown';
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

  const downloadUrl = `https://www.spigotmc.org/resources/${resourceId}/download`; 
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: `https://www.spigotmc.org/resources/${resourceId}/`,
    Origin: 'https://www.spigotmc.org',
    Cookie: cookieHeader
  };

  const preflight = await requestWithFallback('https://www.spigotmc.org/account/', headers);
  const preflightAuth = inferAuthState(preflight.body);
  const resourcePage = await requestWithFallback(`https://www.spigotmc.org/resources/${resourceId}/`, headers);
  const xfToken = extractXfToken(resourcePage.body);

  const response = await requestWithFallback(withXfToken(downloadUrl, xfToken), headers);
  const { status, location, engine } = response;
  console.log(`ℹ️ Request engine: ${engine}`);
  console.log(`ℹ️ Account check: ${preflight.status} (${preflightAuth})`);

  if (status === 403) {
    const extractedDownloadUrls = extractDownloadUrlsFromResourcePage(resourceId, resourcePage.body);

    for (const [index, extractedDownloadUrl] of extractedDownloadUrls.entries()) {
      const retry = await requestWithFallback(withXfToken(extractedDownloadUrl, xfToken), headers);
      if (retry.status >= 300 && retry.status < 400 && retry.location) {
        console.log('✅ Cookie test looks valid: page-derived download link worked.');
        console.log(`Attempt: ${index + 1}/${extractedDownloadUrls.length}`);
        console.log(`Status: ${retry.status}`);
        console.log(`Location: ${retry.location}`);
        return;
      }
    }

    fail('❌ Cookie test failed: 403 Forbidden (session/cookies not accepted).', 2);
    if (preflightAuth === 'logged_out') console.error('Hint: cookies are not logged in anymore (session expired).');
    if (preflightAuth === 'cloudflare_challenge') console.error('Hint: Cloudflare challenge detected; clearances may be bound to browser context.');
    if (preflightAuth === 'logged_in') console.error(`Hint: account is logged in, but direct download is denied and ${extractedDownloadUrls.length} page-derived links also failed.`);
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
