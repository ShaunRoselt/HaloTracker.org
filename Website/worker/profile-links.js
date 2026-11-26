import { readPublicHistory } from './profile-history.js';

function ageInYears(birthDate, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate ?? '')) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(+date) || date.toISOString().slice(0, 10) !== birthDate || birthDate > today) return null;
  return Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))
    - Number(today.slice(5) < birthDate.slice(5));
}

export async function readProfileLinks(request, db) {
  if (request.method !== 'GET') return Response.json({}, { status: 405 });
  const params = new URL(request.url).searchParams;
  const platform = params.get('platform');
  const id = params.get('id') ?? '';
  if (!['steam', 'xbox'].includes(platform) || !/^\d{1,20}$/.test(id)) {
    return Response.json({}, { status: 400 });
  }
  try {
    const select = db.prepare(`
      SELECT service, url FROM player_profile_links
      WHERE platform = ? AND account_id = ?
      ORDER BY service
    `).bind(platform, id);
    const factsQuery = db.prepare(`
      SELECT country_code AS countryCode, job_title AS jobTitle, birth_date AS birthDate
      FROM player_profile_facts WHERE platform = ? AND account_id = ?
    `).bind(platform, id);
    const [{ results }, facts, publicHistory] = await Promise.all([
      select.all(), factsQuery.first(), readPublicHistory(db, platform, id),
    ]);
    const details = facts || publicHistory ? {
      countryCode: facts?.countryCode ?? null,
      jobTitle: facts?.jobTitle ?? null,
      age: ageInYears(facts?.birthDate),
      publicHistory,
    } : null;
    return Response.json({ links: results, details }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Profile links lookup failed', error.message);
    return Response.json({}, { status: 503 });
  }
}
