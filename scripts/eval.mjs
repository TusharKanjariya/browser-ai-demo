// Accuracy check: realistic reader questions → the post(s) that should answer them.
// Uses the same ranking code as the browser. Run: npm run eval
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pipeline } from '@huggingface/transformers';
import { MODEL, prepare, rank } from '../search.js';

const CASES = [
  ['my API works in Postman but fails in the browser', ['54f88aa30bee', '293c8ea0eb2f']],
  ['do I need a vector database for RAG', ['13c331d541c0']],
  ['100vh is broken on my phone', ['a4e65cb2797f']],
  ['run linux tools on windows without a virtual machine', ['ab43440769f4']],
  ['an npm package got hacked', ['f120fc681d72']],
  ['is my AI app safe from prompt attacks', ['56703206a517', '52c758294bba']],
  ['preload made my site slower', ['1b946624fdce']],
  ['keep my node server running after I close the terminal', ['bca08da5210b']],
  ['run AI models on a laptop without a GPU', ['2c35145ba5d1']],
  ['my search box sends a request on every keystroke', ['e794e7e2aeff']],
  ['what is a closure in javascript', ['622032dd67eb']],
  ['my try catch did not catch the async error', ['09e06081b118']],
  ['make my website readable for ChatGPT', ['c5cdfe374633']],
  ['JSON.stringify removes undefined', ['585067b14dc9']],
  ['how much money can you make writing on medium', ['15eca3959913']],
  ['how can freelancers charge more', ['b61c521aef02']],
  ['stop bots without a captcha', ['45e53e508dc1']],
  ['my AI agent forgets everything between sessions', ['64079b444884', '0ecc4ef5df1a']],
  ['why is my AI using so many tokens', ['a2463745fa18']],
  ['how does google maps predict traffic', ['4f1afbffc783']],
  ['send email from node', ['b813734e9a3e']],
  ['share files between two computers without uploading to the cloud', ['ace74f836410']],
  ['position a tooltip next to a button with css only', ['9176006e3059']],
  ['custom fonts make my page flash', ['6f3486a8c763']],
  ['does every project need react', ['dcb04e98e0a9']],
  ['difference between authentication and authorization', ['c09ace851e8b', 'dcd0e9ad6583']],
  ['ignore a file in git only on my machine', ['ed08be450233']],
  ['use different claude accounts for work and personal projects', ['4ca5eb50455d']],
  ['I cannot focus because of my phone', ['d8305b86908a']],
  ['my site scores well on lighthouse but users hate it', ['e166ffbf8724', 'bb22293532fd']],
  // Short name queries, where embeddings are usually weakest
  ['pm2', ['bca08da5210b']], ['ccavenue', ['8f9de6637ced']], ['htmx', ['544a2dd46d8a']], ['webmcp', ['a0176a78f428']],
  ['notebooklm', ['067caa74c9ad']], ['ollama', ['72a232da1b85']], ['currying', ['77cc046ef729']], ['react2shell', ['d7d07c72b919']],
];

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const index = prepare({
  posts: JSON.parse(await readFile(at('posts.json'), 'utf8')),
  chunks: JSON.parse(await readFile(at('chunks.json'), 'utf8')),
  vectors: new Int8Array((await readFile(at('vectors.bin'))).buffer.slice(0)),
});
const embed = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });

let top1 = 0, top3 = 0;
for (const [q, want] of CASES) {
  const [qv] = (await embed(q, { pooling: 'mean', normalize: true })).tolist();
  const results = rank(index, qv, { limit: 10 });
  const pos = results.findIndex((r) => want.includes(r.post.id)) + 1;
  if (pos === 1) top1++;
  if (pos && pos <= 3) top3++;
  const mark = pos === 1 ? 'OK ' : pos && pos <= 3 ? 'top3' : 'MISS';
  console.log(`${mark} #${pos || '-'}  ${q}\n       → ${results[0].post.title} (${results[0].sem.toFixed(2)}) § ${results[0].chunk[2] || 'intro'}`);
}
console.log(`\nTop-1: ${top1}/${CASES.length}   Top-3: ${top3}/${CASES.length}`);
