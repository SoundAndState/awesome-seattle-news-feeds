import {PUBLISHED, UPDATED} from './feeds.mjs';

export function jsonFeed(items = [{}]) {
  return JSON.stringify({version: 'https://jsonfeed.org/version/1.1', title: 'Fixture JSON News', items: items.map((item, index) => ({
    id: `item-${index}`, url: `https://publisher.example/story-${index}`, title: 'Local JSON story',
    content_text: 'A neighborhood update.', date_published: PUBLISHED, date_modified: UPDATED,
    ...item,
  }))});
}

export function postsJson(posts = [{}]) {
  return JSON.stringify({version: 1, posts: posts.map((post, index) => ({
    id: `post-${index}`, url: `https://publisher.example/post-${index}`, text: 'A neighborhood post.',
    published: PUBLISHED, updated: UPDATED, author: 'Local Reporter', ...post,
  }))});
}
