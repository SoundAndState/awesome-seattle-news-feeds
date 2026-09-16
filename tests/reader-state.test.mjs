import test from 'node:test';
import assert from 'node:assert/strict';
import {feedMode, itemMode, normalizeRoute, matchesItem} from '../web/src/reader-state.mjs';

const feeds=new Map([['paper',{category:'regional'}],['bluesky-reporter',{category:'bluesky'}]]);
const categories=new Map([['regional',{}],['bluesky',{}]]);
const article={id:'https://example.com/article',feedIds:['paper']};
const post={id:'at://did:plc:reporter/app.bsky.feed.post/123',feedIds:['bluesky-reporter']};
const route=value=>normalizeRoute(value,feeds,categories);

test('legacy routes infer modes and explicit modes reject incompatible filters',()=>{
  assert.equal(route({category:'bluesky'}).mode,'posts');
  assert.equal(route({source:'bluesky-reporter'}).mode,'posts');
  assert.equal(route({}).mode,'articles');
  const explicit=route({mode:'posts',source:'paper',category:'regional'});
  assert.equal(explicit.source,'');assert.equal(explicit.category,'');
  assert.equal(feedMode(feeds.get('paper')),'articles');
});
test('shared Saved ignores inherited feed filters and applies only its type filter',()=>{
  const all=route({view:'saved',mode:'posts',source:'paper',category:'regional'});
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
