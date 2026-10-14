// Pulls the Medium RSS feed and merges new/updated posts into posts.json.
// The feed only has the latest 10 posts, so older ones stay as they are.
// Run: node scripts/sync-rss.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FEED = 'https://medium.com/feed/@TusharKanjariya';
const FILE = fileURLToPath(new URL('../posts.json', import.meta.url));

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const field = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '')
  .replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();

export function parseFeed(xml) {
  return xml.split('<item>').slice(1).map((item) => {
    const desc = field(item, 'description');
    return {
      id: field(item, 'guid').split('/').pop(),
      title: decode(field(item, 'title')),
      subtitle: decode(desc.match(/medium-feed-snippet">([\s\S]*?)<\/p>/)?.[1] ?? ''),
      url: field(item, 'link').split('?')[0],
      date: new Date(field(item, 'pubDate')).toISOString().slice(0, 10),
      tags: [...item.matchAll(/<category><!\[CDATA\[(.*?)\]\]><\/category>/g)].map((m) => m[1]),
      image: desc.match(/<img src="([^"]+)"/)?.[1]?.replace(/\/max\/\d+\//, '/max/400/') ?? '',
    };
  });
}

export function merge(existing, incoming) {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const p of incoming) byId.set(p.id, { ...byId.get(p.id), ...p });
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = await fetch(FEED, { headers: { 'user-agent': 'Mozilla/5.0 (blog-search sync)' } });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const incoming = parseFeed(await res.text());
  if (!incoming.length) throw new Error('RSS returned no items, refusing to touch posts.json');
  const existing = JSON.parse(await readFile(FILE, 'utf8').catch(() => '[]'));
  const posts = merge(existing, incoming);
  await writeFile(FILE, JSON.stringify(posts, null, 1) + '\n');
  console.log(`posts.json: ${existing.length} -> ${posts.length} posts`);
}
