# Ask my blog

**Live demo:** https://tusharkanjariya.github.io/browser-ai-demo/

Search my Medium posts by meaning, in your own words, and land on the exact section that answers you. The AI model ([all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via [Transformers.js](https://huggingface.co/docs/transformers.js)) runs in your browser tab. No backend, no API key, no vector database.

## How it works

1. **Build time (my machine):** every post from my Medium export is split into sections of up to ~120 words, and each section becomes a 384-number embedding. They ship as `vectors.bin` (int8, ~1.4 MB).
2. **In the browser:** the reader's question is embedded with the same model and scored against every section. Each post's best section wins. That's the whole "vector database": an array and a loop.
3. **New posts:** a GitHub Action reads my Medium RSS feed every 6 hours and indexes anything new.

## Files

| File | What it does |
|---|---|
| `index.html`, `app.js` | The page |
| `search.js` | Ranking logic, shared by the page and the accuracy test |
| `sw.js` | Offline support after the first visit |
| `posts.json` | Post list: title, subtitle, links, date, cover, key terms |
| `chunks.json` | One row per section: post id, paragraph anchor, heading, short snippet |
| `vectors.bin` | Section embeddings |
| `scripts/build-index.mjs` | Builds the three data files from `posts/` (the Medium export) |
| `scripts/sync-rss.mjs` | Merges new posts from RSS into `posts.json` |
| `scripts/eval.mjs` | Accuracy test: 38 real questions with known right answers |

## The full articles are not published

`posts/` (the Medium export) is git-ignored. The public files contain embeddings, headings, ~150-character snippets and key terms, not the article text, because many posts are member-only.

## Commands

```
npm install          # once
npm run build        # rebuild the index from posts/ (~3.5 min for 250 posts)
npm run eval         # accuracy check (currently 35/38 first, 37/38 top 3)
npm run sync         # pull new posts from RSS
npm test             # RSS parser tests
python -m http.server 8765   # then open http://localhost:8765
```

## Updating

- **New post:** nothing to do. The Action picks it up from RSS and indexes its title and subtitle.
- **Full-text indexing for new posts:** download a fresh Medium export now and then (Settings → Download your information), replace `posts/`, run `npm run build`, commit the three data files.
- **Edited a post:** same as above.

## Deploy on GitHub Pages

1. Push this folder to a repo.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Settings → Actions → General → Workflow permissions → Read and write (so the sync job can commit).
