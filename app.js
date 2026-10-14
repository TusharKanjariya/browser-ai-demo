import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
import { MODEL, prepare, rank, keywordRank, similarPosts, terms } from './search.js';

// From scripts/eval.mjs runs: correct answers score 0.54-0.92, off-topic questions top out around 0.41.
const STRONG = 0.6;
const RELATED = 0.45;
const CHIPS = [
  'my API works in Postman but not in the browser',
  '100vh is broken on my phone',
  'do I need a vector database for RAG',
  'is my AI app safe from prompt attacks',
  'keep my node server running after closing the terminal',
  'can you make money writing on Medium',
];

const $ = (id) => document.getElementById(id);
const input = $('q');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ms = (t) => `${Math.round(t).toLocaleString()} ms`;
const setStat = (id, text) => { $(id).textContent = text; };

let index = null;
let embed = null;
let mode = 'ai';
let similarTo = null; // a post, when showing "More like this"

// ---------- render ----------

function card(r, kind) {
  const p = r.post;
  const base = p.freeUrl || p.url; // friend link when there is one, so non-members can read it too
  const [, anchor, heading, snippet] = r.chunk ?? [];
  const badge = kind === 'ai'
    ? `<span class="badge${r.sem < STRONG ? ' weak' : ''}">${r.sem >= STRONG ? 'Strong match' : 'Related'} · ${r.sem.toFixed(2)}</span> · `
    : kind === 'keyword' ? `<span class="badge">${r.hits} word${r.hits > 1 ? 's' : ''} matched</span> · ` : '';
  const section = anchor && snippet
    ? `<div class="section"><span class="sec-h">${esc(heading || 'Intro')}</span> ${esc(snippet)}
       <a href="${esc(base)}#${esc(anchor)}" target="_blank" rel="noopener">Jump to this part →</a></div>`
    : '';
  return `<li class="card">
    ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}
    <div class="body">
      <h3><a href="${esc(base)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <p>${esc(p.subtitle)}</p>
      ${section}
      <div class="meta">${badge}${esc(p.date)}${p.freeUrl ? ' · Free to read' : ''}
        · <button type="button" class="more" data-id="${esc(p.id)}">More like this</button></div>
    </div></li>`;
}

function list(results, kind, q) {
  if (kind === 'ai') {
    const good = results.filter((r) => r.sem >= RELATED);
    if (good.length) return `<ol>${good.map((r) => card(r, kind)).join('')}</ol>`;
    return `<div class="empty">I haven't written about "${esc(q)}" yet. The closest thing I have:</div><ol>${card(results[0], kind)}</ol>`;
  }
  return results.length
    ? `<ol>${results.map((r) => card(r, kind)).join('')}</ol>`
    : `<div class="empty">No post uses those exact words.${embed ? ' AI search matches by meaning, try that.' : ''}</div>`;
}

const latest = () => `<h2>Latest posts</h2><ol>${index.posts.slice(0, 5).map((post) => card({ post }, 'none')).join('')}</ol>`;

// ---------- search ----------

let runId = 0;
async function search() {
  if (!index) return;
  const q = input.value.trim();
  const url = new URL(location.href);
  q ? url.searchParams.set('q', q) : url.searchParams.delete('q');
  history.replaceState(null, '', url);

  const out = $('results');
  out.className = `cols${mode === 'compare' && q && !similarTo ? ' compare' : ''}`;

  if (similarTo) {
    const results = similarPosts(index, similarTo);
    out.innerHTML = `<h2>More like "${esc(similarTo.title)}" <button type="button" class="link" id="back">clear</button></h2><ol>${results.map((r) => card(r, 'none')).join('')}</ol>`;
    return;
  }
  if (!q) { out.innerHTML = latest(); return; }

  const id = ++runId;
  const useAi = embed && mode !== 'keyword';
  let ai = null;
  if (useAi) {
    const netBefore = performance.getEntriesByType('resource').length;
    const t0 = performance.now();
    const [qv] = (await embed(q, { pooling: 'mean', normalize: true })).tolist();
    ai = rank(index, qv);
    if (id !== runId) return; // a newer search started while this one was embedding
    setStat('s-query', `${ms(performance.now() - t0)} for "${q}"`);
    setStat('s-net', String(performance.getEntriesByType('resource').length - netBefore));
  }
  const kw = keywordRank(index, terms(q));
  if (mode === 'compare' && ai) {
    out.innerHTML = `<section><h2>AI search (meaning)</h2>${list(ai, 'ai', q)}</section><section><h2>Keyword search (exact words)</h2>${list(kw, 'keyword', q)}</section>`;
  } else if (ai) {
    out.innerHTML = list(ai, 'ai', q);
  } else {
    out.innerHTML = (embed ? '' : '<div class="empty">The AI model is still loading, so these are plain keyword matches for now.</div>') + list(kw, 'keyword', q);
  }
}

// ---------- wiring ----------

const run = () => { similarTo = null; search(); };
let timer;
input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
});

$('chips').innerHTML = CHIPS.map((c) => `<button type="button">${esc(c)}</button>`).join('');
$('chips').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  input.value = e.target.textContent;
  run();
});

document.querySelector('.modes').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  mode = btn.dataset.mode;
  document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  run();
});

$('results').addEventListener('click', (e) => {
  if (e.target.id === 'back') return run();
  const id = e.target.closest('.more')?.dataset.id;
  if (!id) return;
  similarTo = index.posts.find((p) => p.id === id);
  search();
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- boot ----------

async function loadIndex() {
  const t = performance.now();
  const [posts, chunks, buf] = await Promise.all([
    fetch('posts.json').then((r) => r.json()),
    fetch('chunks.json').then((r) => r.json()),
    fetch('vectors.bin').then((r) => r.arrayBuffer()),
  ]);
  index = prepare({ posts, chunks, vectors: new Int8Array(buf) });
  setStat('s-posts', `${posts.length} posts split into ${chunks.length.toLocaleString()} sections`);
  setStat('s-index', `${ms(performance.now() - t)} to download (${(buf.byteLength / 1e6).toFixed(1)} MB of vectors, built ahead of time)`);
}

async function loadModel() {
  const files = {};
  const bar = $('progress');
  bar.hidden = false;
  const t = performance.now();
  embed = await pipeline('feature-extraction', MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (e) => {
      if (e.status !== 'progress' || !e.total) return;
      files[e.file] = [e.loaded, e.total];
      const [done, total] = Object.values(files).reduce(([a, b], [l, tt]) => [a + l, b + tt], [0, 0]);
      bar.value = done / total;
      setStat('status', `Downloading the AI model (only once): ${(done / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`);
    },
  });
  bar.hidden = true;
  setStat('s-load', ms(performance.now() - t));
}

async function boot() {
  input.value = new URLSearchParams(location.search).get('q') ?? '';
  try {
    await loadIndex();
  } catch (err) {
    console.error(err);
    setStat('status', 'Could not load the post index. Please refresh.');
    return;
  }
  search(); // keyword results right away; AI takes over once the model is ready

  const gpu = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  setStat('s-device', `WebAssembly on your CPU${gpu ? ' (WebGPU is available, but this model is small enough not to need it)' : ''}`);

  try {
    await loadModel();
  } catch (err) {
    console.error(err);
    setStat('status', 'The AI model failed to load. Keyword search still works.');
    return;
  }
  document.querySelectorAll('.modes button').forEach((b) => { b.disabled = false; });
  setStat('status', `Ready. ${index.posts.length} posts, searched on your device.`);
  search();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    setStat('s-offline', 'Yes, after the first load. Try it with Wi-Fi off.');
  }).catch(() => setStat('s-offline', 'Not in this browser'));
}

boot();
