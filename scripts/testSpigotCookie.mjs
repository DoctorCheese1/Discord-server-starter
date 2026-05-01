#!/usr/bin/env node

const [, , resourceArg = '', xfUser = '', xfSession = '', xfTfaTrust = ''] = process.argv;

if (!resourceArg || !xfUser || !xfSession) {
  console.error('Usage: node scripts/testSpigotCookie.mjs <resourceIdOrUrl> <xf_user> <xf_session> [xf_tfa_trust]');
  process.exit(1);
}

function parseSpigotResourceId(input) {
  const raw = String(input || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/spigotmc\.org\/resources\/[^./]+\.([0-9]+)\//i)
    || raw.match(/spigotmc\.org\/resources\/([0-9]+)/i)
    || raw.match(/spiget\.org\/resources\/([0-9]+)/i);
  return match?.[1] || '';
}

const resourceId = parseSpigotResourceId(resourceArg);
if (!resourceId) {
  console.error('Could not parse Spigot resource ID from input:', resourceArg);
  process.exit(1);
}

const cookieParts = [`xf_user=${xfUser}`, `xf_session=${xfSession}`];
if (xfTfaTrust) cookieParts.push(`xf_tfa_trust=${xfTfaTrust}`);

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
  console.error('❌ Cookie test failed: 403 Forbidden (session not accepted).');
  process.exit(2);
}

if (response.status >= 300 && response.status < 400 && location) {
  console.log('✅ Cookie test looks valid: received redirect to download target.');
  console.log(`Status: ${response.status}`);
  console.log(`Location: ${location}`);
  process.exit(0);
}

if (response.ok) {
  console.log('✅ Cookie test succeeded: direct downloadable response returned.');
  console.log(`Status: ${response.status}`);
  process.exit(0);
}

console.error(`⚠️ Unexpected response: HTTP ${response.status}`);
if (location) console.error(`Location: ${location}`);
process.exit(3);
