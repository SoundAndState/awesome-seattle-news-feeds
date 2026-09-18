import {feedDates} from '../dates.mjs';
import {feedMode} from '../source-model.mjs';
import {ITEM_LIMITS, validItemId} from '../item-model.mjs';
import {escapeHtml, textHtml, postHeadline} from './text.mjs';

function object(value) {return value && typeof value === 'object' && !Array.isArray(value);}

function jsonObject(text) {
  let data;
  try {data = JSON.parse(text);} catch {throw new Error('The source did not return valid JSON.');}
  if (!object(data)) throw new Error('The JSON source must be an object.');
  return data;
}

function entry(item, source, now) {
  if (!object(item) || !validItemId(item.id)) throw new Error('Each JSON item needs a stable text ID.');
  for (const key of ['url', 'title', 'content_html', 'content_text', 'summary', 'date_published', 'date_modified']) {
    if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(`A JSON item's ${key} must be text.`);
  }
  if (typeof item.content_html !== 'string' && typeof item.content_text !== 'string') throw new Error('Each JSON item needs content_html or content_text.');
  if (!Array.isArray(item.authors) || item.authors.some(author => !object(author) || (author.name !== undefined && typeof author.name !== 'string'))) throw new Error('JSON item authors must be objects with optional text names.');
  const title = item.title?.trim() ? escapeHtml(item.title) : feedMode(source) === 'posts' ? escapeHtml(postHeadline(item.content_text || '')) : 'Untitled story';
  return {
    url: item.url, guid: item.id, title,
    html: item.content_html || (item.content_text ? textHtml(item.content_text) : '') || item.summary || '',
    author: [...new Set(item.authors.map(author => author.name || '').filter(Boolean))].join(', '),
    identityDate: item.date_published || item.date_modified,
    ...feedDates({date_published: item.date_published, date_modified: item.date_modified}, now),
  };
}

export function readJsonFeed(text, source, now) {
  const data = jsonObject(text);
  if (!['https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1'].includes(data.version) || !Array.isArray(data.items) || typeof data.title !== 'string') throw new Error('The source must use JSON Feed version 1 or 1.1.');
  return data.items.slice(0, ITEM_LIMITS.perFeed).map(item => {
    if (!object(item)) throw new Error('The JSON source contains an invalid item.');
    return entry({...item, authors: item.authors ?? (item.author ? [item.author] : data.authors ?? (data.author ? [data.author] : []))}, source, now);
  });
}

export function readPostsJson(text, source, now) {
  const data = jsonObject(text);
  if (data.version !== 1 || !Array.isArray(data.posts)) throw new Error('The posts source requires version 1 and a posts list.');
  return data.posts.slice(0, ITEM_LIMITS.perFeed).map(post => {
    if (!object(post)) throw new Error('The posts source contains an invalid post.');
    if (post.author !== undefined && typeof post.author !== 'string') throw new Error('A post author must be text.');
    return entry({id: post.id, url: post.url, title: post.title, content_text: post.text, content_html: post.html, date_published: post.published, date_modified: post.updated, authors: post.author ? [{name: post.author}] : []}, source, now);
  });
}
