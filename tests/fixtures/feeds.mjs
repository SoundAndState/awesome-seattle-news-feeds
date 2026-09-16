import {readFileSync} from 'node:fs';

export const NOW = '2026-09-16T12:00:00Z';
export const PUBLISHED = 'Tue, 15 Sep 2026 10:00:00 GMT';
export const UPDATED = '2026-09-15T12:45:00Z';
export const rss = readFileSync(new URL('./rss.xml', import.meta.url), 'utf8').trim();
export const atom = readFileSync(new URL('./atom.xml', import.meta.url), 'utf8').trim();
const escape = value => String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[character]));
const tag = (name, value) => value === null ? '' : `<${name}>${escape(value)}</${name}>`;
const cdata = value => `<![CDATA[${String(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

// Keep unusual raw date/namespace fragments visible in parser tests via extraXml.
export function rssItem({title = 'Local story', url = 'https://publisher.example/story', html = null, text = null, id = null, published = PUBLISHED, updated = null, extraXml = ''} = {}) {
  return `<item>${tag('title', title)}${tag('link', url)}${id === null ? '' : `<guid isPermaLink="false">${escape(id)}</guid>`}${tag('pubDate', published)}${tag('atom:updated', updated)}${html === null ? '' : `<content:encoded>${cdata(html)}</content:encoded>`}${text === null ? '' : `<description>${cdata(text)}</description>`}${extraXml}</item>`;
}

export function rssFeed(items = [{}], {channelXml = ''} = {}) {
  return rss.replace(/<item>[\s\S]*<\/item>/, () => items.map(rssItem).join('')).replace('</channel>', () => `${channelXml}</channel>`);
}

export function atomFeed(entries = [{}]) {
  const items = entries.map(({id = 'story', title = 'Local story', url = 'https://publisher.example/story', published = null, updated = null, html = '<p>Local reporting.</p>', extraXml = ''}) => {
    const link = url === null ? '' : `<link href="${escape(url)}"/>`;
    const content = html === null ? '' : `<content type="html">${escape(html)}</content>`;
    return `<entry>${tag('id', id)}${tag('title', title)}${link}${tag('published', published)}${tag('updated', updated)}${content}${extraXml}</entry>`;
  });
  return atom.replace(/<entry>[\s\S]*<\/entry>/, () => items.join(''));
}

export const postUrl = id => `https://bsky.app/profile/reporter.example/post/${id}`;
export const postId = id => `at://did:plc:fixture/app.bsky.feed.post/${id}`;
export function postItem(id, overrides = {}) {
  return {title: null, id: postId(id), url: postUrl(id), text: `A new trail connects two neighborhoods.\nParks & trails <3 — ${id}`, ...overrides};
}
export function articleItem(id, overrides = {}) {
  return {
    title: `Seattle parks get a new trail — ${id}`,
    url: `https://publisher.example/${id}?utm_source=rss&edition=local&UTM_medium=feed#section`,
    updated: UPDATED, html: '<p>A new trail connects two neighborhoods.</p>',
    ...overrides,
  };
}
export const unsafeHtml = '<p>A new trail connects two neighborhoods.</p><script>window.compromised=true</script><img src="https://tracker.example/pixel" onerror="window.compromised=true"><a href="javascript:alert(1)">Unsafe link</a><a href="/more">More reporting</a>';
export const defaultFeed = id => rssFeed([id.startsWith('bluesky-') ? postItem(id) : articleItem(id)]);
