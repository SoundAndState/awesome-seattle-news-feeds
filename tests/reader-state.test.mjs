import test from 'node:test';
import assert from 'node:assert/strict';
import {feedMode, itemMode, normalizeRoute, matchesItem} from '../web/src/reader-state.mjs';
import {makeCatalog} from './fixtures/catalog.mjs';
import {postId} from './fixtures/feeds.mjs';

const catalog=makeCatalog();
const feeds=new Map(catalog.feeds.map(feed=>[feed.id,feed]));
const categories=new Map(catalog.categories.map(category=>[category.id,category]));
const article={id:'https://publisher.example/article',feedIds:['local-news']};
const post={id:postId('123'),feedIds:['bluesky-reporter']};
const route=value=>normalizeRoute(value,feeds,categories);

test('unread is the default and exclusions preserve explicit source browsing and Saved',()=>{
  assert.equal(route({}).view,'unread');
  const excluded=new Set(article.feedIds);
  assert.equal(matchesItem(article,route({}),feeds,excluded),false);
  assert.equal(matchesItem(article,route({source:article.feedIds[0]}),feeds,excluded),true);
  assert.equal(matchesItem(article,route({view:'saved'}),feeds,excluded),true);
  assert.equal(matchesItem({...article,feedIds:[...article.feedIds,'transit-news']},route({}),feeds,excluded),true);
});

test('legacy routes infer modes and explicit modes reject incompatible filters',()=>{
  assert.equal(route({category:'bluesky'}).mode,'posts');
  assert.equal(route({source:'bluesky-reporter'}).mode,'posts');
  assert.equal(route({}).mode,'articles');
  const explicit=route({mode:'posts',source:'local-news',category:'regional'});
  assert.equal(explicit.source,'');assert.equal(explicit.category,'');
  assert.equal(feedMode(feeds.get('local-news')),'articles');
});
test('shared Saved ignores inherited feed filters and applies only its type filter',()=>{
  const all=route({view:'saved',mode:'posts',source:'local-news',category:'regional'});
  assert.equal(all.source,'');assert.equal(all.category,'');
  assert.equal(matchesItem(article,all,feeds),true);assert.equal(matchesItem(post,all,feeds),true);
  assert.equal(matchesItem(article,{...all,savedKind:'posts'},feeds),false);
  assert.equal(matchesItem(post,{...all,savedKind:'articles'},feeds),false);
});
test('removed accounts and legacy saved items retain their content type',()=>{
  assert.equal(itemMode(post,new Map()),'posts');
  assert.equal(itemMode({...post,id:'old-post-id'},new Map()),'posts');
  assert.equal(itemMode(article,new Map()),'articles');
  assert.equal(matchesItem(post,route({mode:'articles'}),feeds),false);
  assert.equal(matchesItem(article,route({mode:'posts'}),feeds),false);
});
