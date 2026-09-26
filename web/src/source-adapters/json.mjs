import {messages, formatMessage} from '../localization.mjs';
import {feedDates} from '../dates.mjs';
import {feedMode} from '../source-model.mjs';
import {ITEM_LIMITS, validItemId} from '../item-model.mjs';
import {escapeHtml, textHtml, postHeadline} from './text.mjs';

function object(value) {return value && typeof value === 'object' && !Array.isArray(value);}

function jsonObject(text) {
  let data;
  try {data = JSON.parse(text);} catch {throw new Error(messages.feeds.invalidJson);}
  if (!object(data)) throw new Error(messages.feeds.invalidObject);
  return data;
}

function entry(item, source, now) {
  if (!object(item) || !validItemId(item.id)) throw new Error(messages.feeds.invalidId);
  for (const key of ['url', 'title', 'content_html', 'content_text', 'summary', 'date_published', 'date_modified']) {
    if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(formatMessage(messages.feeds.invalidText, {key: key}));
  }
  if (typeof item.content_html !== 'string' && typeof item.content_text !== 'string') throw new Error(messages.feeds.missingContent);
  if (!Array.isArray(item.authors) || item.authors.some(author => !object(author) || (author.name !== undefined && typeof author.name !== 'string'))) throw new Error(messages.feeds.invalidAuthors);
  const title = item.title?.trim() ? escapeHtml(item.title) : feedMode(source) === 'posts' ? escapeHtml(postHeadline(item.content_text || '')) : escapeHtml(messages.common.untitledStory);
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
  if (!['https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1'].includes(data.version) || !Array.isArray(data.items) || typeof data.title !== 'string') throw new Error(messages.feeds.invalidVersion);
  return data.items.slice(0, ITEM_LIMITS.perFeed).map(item => {
    if (!object(item)) throw new Error(messages.feeds.invalidItem);
    return entry({...item, authors: item.authors ?? (item.author ? [item.author] : data.authors ?? (data.author ? [data.author] : []))}, source, now);
  });
}

export function readPostsJson(text, source, now) {
  const data = jsonObject(text);
  if (data.version !== 1 || !Array.isArray(data.posts)) throw new Error(messages.feeds.invalidPostsVersion);
  return data.posts.slice(0, ITEM_LIMITS.perFeed).map(post => {
    if (!object(post)) throw new Error(messages.feeds.invalidPost);
    if (post.author !== undefined && typeof post.author !== 'string') throw new Error(messages.feeds.invalidPostAuthor);
    return entry({id: post.id, url: post.url, title: post.title, content_text: post.text, content_html: post.html, date_published: post.published, date_modified: post.updated, authors: post.author ? [{name: post.author}] : []}, source, now);
  });
}
