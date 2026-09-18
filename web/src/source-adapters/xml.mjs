import {parseFeed} from 'feedsmith';
import {feedDates} from '../dates.mjs';
import {feedMode} from '../source-model.mjs';
import {ITEM_LIMITS} from '../item-model.mjs';
import {escapeHtml, textHtml, postHeadline} from './text.mjs';

export function readXml(text, source, now) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Feed contains unsupported XML declarations.');
  const {feed, format} = parseFeed(text);
  const entries = format === 'atom' ? feed.entries : feed.items;
  if (!entries?.length) throw new Error('The feed contains no articles or posts.');
  return entries.slice(0, ITEM_LIMITS.perFeed).map(item => {
    const url = format === 'atom' ? item.links?.find(link => !link.rel || link.rel === 'alternate')?.href : item.url || item.link || (item.guid?.isPermaLink !== false ? item.guid?.value : '');
    const kind = feedMode(source);
    // The legacy Bluesky XML descriptions contain literal post text.
    const social = kind === 'posts' && source.category === 'bluesky';
    const postText = social && typeof item.description === 'string' ? item.description : item.content_text || '';
    const title = social ? escapeHtml(postHeadline(postText)) : typeof item.title === 'string' && item.title.trim() ? item.title : kind === 'posts' ? escapeHtml(postHeadline(postText)) : 'Untitled story';
    const html = social ? textHtml(postText) : item.content?.encoded || (typeof item.content === 'string' ? item.content : '') || item.content_html || (item.content_text ? textHtml(item.content_text) : '') || item.description || item.summary || '';
    const guid = item.guid?.value || item.id;
    const people = item.dc?.creators || item.dcterms?.creators || item.authors || item.atom?.authors || (format === 'atom' ? item.source?.authors || feed.authors : []) || [];
    return {
      url, title, html: String(html), guid,
      identityDate: item.pubDate || item.published || item.dc?.date || item.updated,
      nativeId: social && /^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\//.test(guid) ? guid : '',
      author: [...new Set(people.map(person => typeof person === 'string' ? person : person.name || '').filter(Boolean))].join(', '),
      ...feedDates(item, now),
    };
  });
}
