import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, merge } from './sync-rss.mjs';

const xml = `<rss><channel><item>
  <title><![CDATA[Prompt Injection Is SQL Injection Again.]]></title>
  <description><![CDATA[<p class="medium-feed-image"><a href="x"><img src="https://cdn-images-1.medium.com/max/1672/1*abc.png" width="1672"></a></p><p class="medium-feed-snippet">SQL injection got fixed. Why hasn&#x2019;t prompt injection?</p>]]></description>
  <link>https://medium.com/@TusharKanjariya/prompt-injection-56703206a517?source=rss-4a24e4e7e0fa------2</link>
  <guid isPermaLink="false">https://medium.com/p/56703206a517</guid>
  <category><![CDATA[llm]]></category><category><![CDATA[cybersecurity]]></category>
  <pubDate>Mon, 12 Oct 2026 17:04:49 GMT</pubDate>
</item></channel></rss>`;

test('parses a Medium RSS item', () => {
  assert.deepEqual(parseFeed(xml), [{
    id: '56703206a517',
    title: 'Prompt Injection Is SQL Injection Again.',
    subtitle: 'SQL injection got fixed. Why hasn’t prompt injection?',
    url: 'https://medium.com/@TusharKanjariya/prompt-injection-56703206a517',
    date: '2026-10-12',
    tags: ['llm', 'cybersecurity'],
    image: 'https://cdn-images-1.medium.com/max/400/1*abc.png',
  }]);
});

test('merge keeps old posts, updates existing, sorts newest first', () => {
  const old = [{ id: 'a', title: 'Old', date: '2025-01-01', tags: ['x'] }, { id: 'b', title: 'B v1', date: '2026-01-01' }];
  const out = merge(old, [{ id: 'b', title: 'B v2', date: '2026-01-01' }, { id: 'c', title: 'New', date: '2026-10-01' }]);
  assert.deepEqual(out.map((p) => [p.id, p.title]), [['c', 'New'], ['b', 'B v2'], ['a', 'Old']]);
});
