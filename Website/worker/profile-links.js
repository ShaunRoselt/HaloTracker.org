import auditedProfiles from './public-profile-audit.js';

// Shaun’s website and cross-linked Stack Exchange profiles identify these public links.
const publishedLinks = new Map([
  ['steam:76561198215789693', [
    ['email', 'mailto:Me@ShaunRoselt.com'],
    ['stackoverflow', 'https://stackoverflow.com/users/shaunroselt'],
    ['arqade', 'https://gaming.stackexchange.com/users/shaunroselt'],
    ['website', 'https://www.shaunroselt.com/'],
    ['github', 'https://github.com/ShaunRoselt'],
    ['linkedin', 'https://www.linkedin.com/in/shaunroselt/'],
    ['youtube', 'https://www.youtube.com/ShaunRoselt'],
    ['instagram', 'https://www.instagram.com/shaun.roselt/'],
    ['facebook', 'https://www.facebook.com/shaunroselt0'],
    ['x', 'https://x.com/ShaunRoselt'],
  ]],
]);

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
    let [{ results }, facts] = await Promise.all([select.all(), factsQuery.first()]);
    const key = `${platform}:${id}`;
    const audited = auditedProfiles[key];
    const savedServices = new Set(results.map(({ service }) => service));
    const verifiedLinks = new Map([...(audited?.links ?? []), ...(publishedLinks.get(key) ?? [])]);
    const missing = [...verifiedLinks]
      .filter(([service]) => !savedServices.has(service));
    if (missing.length) {
      const insert = db.prepare(`
        INSERT INTO player_profile_links (platform, account_id, service, url)
        VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING
      `);
      await db.batch(missing.map(([service, url]) => insert.bind(platform, id, service, url)));
      ({ results } = await select.all());
    }
    if (!facts && (audited?.countryCode || audited?.jobTitle || audited?.birthDate)) {
      await db.prepare(`
        INSERT INTO player_profile_facts (platform, account_id, country_code, job_title, birth_date)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
      `).bind(platform, id, audited.countryCode ?? null, audited.jobTitle ?? null, audited.birthDate ?? null).run();
      facts = await factsQuery.first();
    }
    const details = facts ? {
      countryCode: facts.countryCode,
      jobTitle: facts.jobTitle,
      age: ageInYears(facts.birthDate),
    } : null;
    return Response.json({ links: results, details }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Profile links lookup failed', error.message);
    return Response.json({}, { status: 503 });
  }
}
