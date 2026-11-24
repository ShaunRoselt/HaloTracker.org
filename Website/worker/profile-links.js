// Shaun's website links back to this Steam account and publishes these profiles.
const publishedLinks = new Map([
  ['steam:76561198215789693', [
    ['website', 'https://www.shaunroselt.com/'],
    ['github', 'https://github.com/ShaunRoselt'],
    ['linkedin', 'https://www.linkedin.com/in/shaunroselt/'],
    ['youtube', 'https://www.youtube.com/ShaunRoselt'],
    ['instagram', 'https://www.instagram.com/shaun.roselt/'],
    ['facebook', 'https://www.facebook.com/shaunroselt0'],
    ['x', 'https://x.com/ShaunRoselt'],
  ]],
]);

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
    let { results } = await select.all();
    const seed = publishedLinks.get(`${platform}:${id}`);
    if (!results.length && seed) {
      const insert = db.prepare(`
        INSERT INTO player_profile_links (platform, account_id, service, url)
        VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING
      `);
      await db.batch(seed.map(([service, url]) => insert.bind(platform, id, service, url)));
      ({ results } = await select.all());
    }
    return Response.json({ links: results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Profile links lookup failed', error.message);
    return Response.json({}, { status: 503 });
  }
}
