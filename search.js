// Ranking logic shared by the browser (app.js) and the accuracy check (scripts/eval.mjs),
// so the eval measures exactly what readers get.

export const MODEL = 'Xenova/all-MiniLM-L6-v2';
export const DIM = 384;

export const STOP = new Set(`a about above after again all also am an and any are as at be because been before being
below between both but by can could did do does doing don done down during each even every few for from get gets
got had has have having he her here hers him his how i if in into is it its itself just let like make makes many
me might more most much must my need new no nor not now of off on once one only or other our out over own really
same say says see she should so some still such than that the their them then there these they thing things this
those through to too under until up us use used uses using very want was way we well were what when where which
while who why will with without would yet you your yours actually always never every lot lots get got go going
know want make made take took think thought try tried work works`.split(/\s+/));

export const terms = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

// index = { posts, chunks: [postId, anchor, heading, snippet][], vectors: Int8Array (chunks × DIM, value × 127) }
export function prepare(index) {
  const byId = new Map(index.posts.map((p) => [p.id, p]));
  for (const p of index.posts) {
    p.terms = new Set(terms([p.title, p.subtitle, (p.tags ?? []).join(' ').replaceAll('-', ' '), (p.keywords ?? []).join(' ')].join(' ')));
  }
  index.chunkPost = index.chunks.map(([id]) => byId.get(id));
  return index;
}

// Score every section, keep each post's best one. A keyword boost was tested and dropped:
// section-level embeddings already rank names like "PM2" first, and the boost cost accuracy (scripts/eval.mjs).
export function rank(index, qv, { limit = 5 } = {}) {
  const { chunks, vectors, chunkPost } = index;
  const best = new Map();
  for (let c = 0; c < chunks.length; c++) {
    const post = chunkPost[c];
    let s = 0;
    for (let k = 0, off = c * DIM; k < DIM; k++) s += qv[k] * vectors[off + k];
    s /= 127;
    const cur = best.get(post);
    if (!cur || s > cur.sem) best.set(post, { post, chunk: chunks[c], sem: s });
  }
  return [...best.values()].sort((a, b) => b.sem - a.sem).slice(0, limit);
}

export function keywordRank(index, qTerms, { limit = 5 } = {}) {
  return index.posts
    .map((post) => ({ post, hits: qTerms.filter((t) => post.terms.has(t)).length }))
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
}

// "More like this": compare posts by the average of all their section vectors.
// Tested against summary-only vectors; the average picks clearly better neighbours.
export function similarPosts(index, post, limit = 4) {
  if (!index.centroids) {
    const pos = new Map(index.posts.map((p, i) => [p, i]));
    index.centroids = index.posts.map(() => new Float32Array(DIM));
    index.chunkPost.forEach((p, c) => {
      const v = index.centroids[pos.get(p)];
      for (let k = 0; k < DIM; k++) v[k] += index.vectors[c * DIM + k];
    });
    for (const v of index.centroids) { const len = Math.hypot(...v); for (let k = 0; k < DIM; k++) v[k] /= len; }
  }
  const me = index.centroids[index.posts.indexOf(post)];
  return index.posts
    .map((p, i) => ({ post: p, sem: p === post ? -1 : index.centroids[i].reduce((s, x, k) => s + x * me[k], 0) }))
    .sort((a, b) => b.sem - a.sem)
    .slice(0, limit);
}
