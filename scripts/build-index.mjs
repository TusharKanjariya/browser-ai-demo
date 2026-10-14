// Builds the search index from the Medium export in posts/ (local only, never committed).
// Output (public): posts.json, chunks.json, vectors.bin. Full article text is NOT published:
// only embeddings, headings, short snippets and key terms.
//
// Posts without an export file (e.g. new ones from RSS, or every post when this runs in CI)
// keep their previous chunks, or get a title + subtitle chunk if they're brand new.
// Run: npm run build
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pipeline } from '@huggingface/transformers';
import { MODEL, DIM, terms } from '../search.js';

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const MAX_WORDS = 120; // MiniLM was trained on short passages; longer text gets diluted or truncated
const SNIPPET_CHARS = 150;
const BOILERPLATE = /read free|non-members|thanks? (you )?for reading|follow me|clap|buy me a coffee|subscribe|connect with me|linkedin|newsletter/i;

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const words = (s) => s.split(' ').length;
const snippet = (s) => (s.length <= SNIPPET_CHARS ? s : s.slice(0, s.lastIndexOf(' ', SNIPPET_CHARS)) + '…');

export function parseExport(html) {
  const url = html.match(/href="([^"]+)" class="p-canonical"/)?.[1] ?? '';
  const id = url.split('-').pop();
  const sections = [];
  let cur = { anchor: '', heading: '', paras: [] };
  sections.push(cur);
  for (const [, tag, anchor, cls, inner] of html.matchAll(/<(h3|h4|p|li|blockquote)\b[^>]*?\bid="([^"]+)"[^>]*?class="graf ([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (/graf--(title|subtitle)\b/.test(cls)) continue;
    const t = text(inner);
    if (!t) continue;
    if (tag === 'h3' || tag === 'h4') sections.push((cur = { anchor, heading: t, paras: [] }));
    else if (!(BOILERPLATE.test(t) && words(t) < 40)) cur.paras.push({ anchor, text: t });
  }
  return {
    id,
    title: text(html.match(/<h1 class="p-name">([\s\S]*?)<\/h1>/)?.[1] ?? ''),
    subtitle: text(html.match(/<section data-field="subtitle"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? ''),
    url,
    freeUrl: html.match(new RegExp(`href="(https://medium\\.com/[^"]*${id}\\?sk=[^"]+)"`))?.[1] ?? '',
    date: html.match(/datetime="(\d{4}-\d{2}-\d{2})/)?.[1] ?? '',
    image: html.match(/<img[^>]+src="(https:\/\/cdn-images-1\.medium\.com\/[^"]+)"/)?.[1]?.replace(/\/max\/\d+\//, '/max/400/') ?? '',
    sections: sections.filter((s) => s.paras.length),
  };
}

// One chunk per ~MAX_WORDS of a section. Each chunk is embedded with the post title and section
// heading in front, so a paragraph that only says "it" still knows what "it" is.
export function chunk(post) {
  const out = [];
  for (const s of post.sections) {
    let group = [];
    let first = true;
    const flush = () => {
      if (!group.length) return;
      const body = group.map((p) => p.text).join(' ');
      // First chunk of a headed section links to the heading; later ones to their own first paragraph.
      const anchor = first && s.heading ? s.anchor : group[0].anchor;
      out.push({ anchor, heading: s.heading, snippet: snippet(body), embed: `${post.title}. ${s.heading ? s.heading + '. ' : ''}${body}` });
      group = [];
      first = false;
    };
    for (const p of s.paras) {
      if (group.length && words(group.map((g) => g.text).join(' ') + ' ' + p.text) > MAX_WORDS) flush();
      group.push(p);
    }
    flush();
  }
  return out;
}

const summary = (p) => ({ anchor: '', heading: '', snippet: p.subtitle, embed: `${p.title}. ${p.subtitle}. ${(p.tags ?? []).join(', ').replaceAll('-', ' ')}` });

// Top distinctive words per post (TF-IDF over the full text). Public, but it's a word list, not the article.
function keywords(bodies) {
  const df = new Map();
  const tfs = bodies.map((b) => {
    const tf = new Map();
    for (const w of terms(b)) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
    return tf;
  });
  return tfs.map((tf) => [...tf]
    .filter(([w, n]) => n >= 2 && !/^\d+$/.test(w))
    .map(([w, n]) => [w, n * Math.log(bodies.length / df.get(w))])
    .sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w]) => w));
}

async function loadOldIndex() {
  if (!existsSync(at('chunks.json')) || !existsSync(at('vectors.bin'))) return new Map();
  const chunks = JSON.parse(await readFile(at('chunks.json'), 'utf8'));
  const vectors = new Int8Array((await readFile(at('vectors.bin'))).buffer.slice(0));
  const byPost = new Map();
  chunks.forEach((c, i) => {
    if (!byPost.has(c[0])) byPost.set(c[0], []);
    byPost.get(c[0]).push({ row: c, vec: vectors.subarray(i * DIM, (i + 1) * DIM) });
  });
  return byPost;
}

async function main() {
  const meta = JSON.parse(await readFile(at('posts.json'), 'utf8').catch(() => '[]'));
  const files = existsSync(at('posts')) ? (await readdir(at('posts'))).filter((f) => f.endsWith('.html') && !f.startsWith('draft_')) : [];
  const exported = await Promise.all(files.map(async (f) => parseExport(await readFile(at(`posts/${f}`), 'utf8'))));

  // Merge export over RSS metadata; RSS keeps tags (the export has none).
  const byId = new Map(meta.map((p) => [p.id, p]));
  for (const e of exported) {
    const { sections, ...fields } = e;
    const prev = byId.get(e.id);
    // RSS knows the live URL when a post sits in a publication; the export only has the profile URL.
    byId.set(e.id, { ...prev, ...fields, url: prev?.url || fields.url, image: prev?.image || fields.image });
  }
  const posts = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));

  const fresh = new Map(exported.map((e) => [e.id, e]));
  const kw = keywords(exported.map((e) => e.sections.flatMap((s) => [s.heading, ...s.paras.map((p) => p.text)]).join(' ')));
  exported.forEach((e, i) => { byId.get(e.id).keywords = kw[i]; });

  const old = await loadOldIndex();
  const rows = [];
  const vecs = [];
  const toEmbed = [];
  for (const p of posts) {
    const e = fresh.get(p.id);
    if (!e && old.has(p.id)) {
      for (const { row, vec } of old.get(p.id)) { rows.push(row); vecs.push(vec); }
      continue;
    }
    for (const c of [summary(p), ...(e ? chunk({ ...e, title: p.title }) : [])]) {
      rows.push([p.id, c.anchor, c.heading, c.snippet]);
      vecs.push(null);
      toEmbed.push([vecs.length - 1, c.embed]);
    }
  }

  console.log(`${posts.length} posts (${exported.length} from export), ${rows.length} chunks, embedding ${toEmbed.length}...`);
  const embed = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  const t = performance.now();
  for (let i = 0; i < toEmbed.length; i += 32) {
    const batch = toEmbed.slice(i, i + 32);
    const out = (await embed(batch.map(([, s]) => s), { pooling: 'mean', normalize: true })).tolist();
    batch.forEach(([slot], j) => { vecs[slot] = Int8Array.from(out[j], (v) => Math.round(v * 127)); });
    process.stdout.write(`\r  ${Math.min(i + 32, toEmbed.length)}/${toEmbed.length}`);
  }
  console.log(`\n  done in ${Math.round((performance.now() - t) / 1000)}s`);

  const flat = new Int8Array(vecs.length * DIM);
  vecs.forEach((v, i) => flat.set(v, i * DIM));
  await writeFile(at('posts.json'), JSON.stringify(posts, null, 1) + '\n');
  await writeFile(at('chunks.json'), JSON.stringify(rows));
  await writeFile(at('vectors.bin'), flat);
  console.log(`wrote posts.json, chunks.json (${rows.length}), vectors.bin (${Math.round(flat.length / 1024)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
