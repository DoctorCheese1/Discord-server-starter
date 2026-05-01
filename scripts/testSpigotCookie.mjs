#!/usr/bin/env node

const [, , resourceArg = '', xfUser = '', xfSession = '', xfTfaTrust = ''] = process.argv;

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

async function main() {
  if (!resourceArg || !xfUser || !xfSession) {
    fail('Usage: node scripts/testSpigotCookie.mjs <resourceIdOrUrl> <xf_user> <xf_session> [xf_tfa_trust]');
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

  const cookieParts = [`xf_user=${decodedXfUser}`, `xf_session=${decodedXfSession}`];
  if (decodedXfTfaTrust) cookieParts.push(`xf_tfa_trust=${decodedXfTfaTrust}`);

  const downloadUrl = `https://www.spigotmc.org/resources/${resourceId}/download?version=latest`;

  const response = await fetch(downloadUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ServerControlBot/2.0; +https://spigotmc.org)',
      Accept: '*/*',
      Referer: 'https://www.spigotmc.org/',
      Origin: 'https://www.spigotmc.org',
      Cookie: cookieParts.join('; ')
    }
  });

  const location = response.headers.get('location') || '';
  if (response.status === 403) {
    fail('❌ Cookie test failed: 403 Forbidden (session not accepted).', 2);
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
