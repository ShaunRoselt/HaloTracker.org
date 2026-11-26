import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const endpoint = 'https://halotracker.org/api/admin/profile-research';
const [command, option] = process.argv.slice(2);

function researchToken() {
  if (process.env.HALOTRACKER_PROFILE_RESEARCH_TOKEN) return process.env.HALOTRACKER_PROFILE_RESEARCH_TOKEN;
  try {
    return execFileSync('secret-tool', ['lookup', 'service', 'halotracker.org', 'purpose', 'profile-research'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
    }).trim();
  } catch {
    throw new Error('The HaloTracker profile research credential is unavailable on this host.');
  }
}

async function requestResearch(token, { cursor, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const url = new URL(endpoint);
  if (option === '--include-recent') url.searchParams.set('includeRecent', '1');
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('The profile research API returned HTTP ' + response.status + '.');
  return response.json();
}

try {
  if (!['list', 'apply', 'history'].includes(command)) {
    throw new Error('Use "list", "apply" with one completed profile on stdin, or "history" with an array of dated evidence on stdin.');
  }
  const token = researchToken();
  if (!token) throw new Error('The HaloTracker profile research credential is empty.');
  if (command === 'apply') {
    const body = JSON.stringify(JSON.parse(readFileSync(0, 'utf8')));
    console.log(JSON.stringify(await requestResearch(token, { body })));
  } else if (command === 'history') {
    const rows = JSON.parse(readFileSync(0, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('Pass a JSON array of history records.');
    let changed = 0;
    for (let offset = 0; offset < rows.length; offset += 40) {
      const body = JSON.stringify(rows.slice(offset, offset + 40));
      const result = await requestResearch(token, { body, method: 'PUT' });
      changed += result.changed;
      console.error('History records processed: ' + Math.min(offset + 40, rows.length) + '/' + rows.length);
    }
    console.log(JSON.stringify({ processed: rows.length, changed }));
  } else {
    const profiles = [];
    let cursor = null;
    do {
      const page = await requestResearch(token, { cursor });
      profiles.push(...page.profiles);
      cursor = page.nextCursor;
    } while (cursor);
    console.log(JSON.stringify({ profiles }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
