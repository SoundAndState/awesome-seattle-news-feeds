import './style.css';
import './loading.css';
import {verifyOpml, inBatches, nextRefresh, safeUrl, archiveUrl} from './feeds.mjs';
import {cleanText, articleContent} from './content.mjs';
import {openLibrary, save, removeArticles} from './storage.mjs';
import {loadFeed} from './network.mjs';
import {articlesCsv} from './export.mjs';
import {scrollReader} from './scroll-read.mjs';
import {readerNavigation} from './navigation.mjs';
import {feedMode, itemMode, normalizeRoute, matchesItem} from './reader-state.mjs';
import {dateLabel, dateIso, validTimestamp} from './dates.mjs';

const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, className, action) => {const node = el('button', className, label); node.addEventListener('click', action); return node;};
const external = (label, url, className = '') => {
  const node = el('a', className, label.replace(/↗(?!\uFE0E)/g, '↗\uFE0E'));
  node.href = safeUrl(url) || '#'; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
};

const articles = new Map(), states = new Map(), health = new Map(), pending = new Map();
const readingStarted = new Set(), expandedPosts = new Set();
const scrolling = scrollReader($('#stories'), markScrolledArticles);
let catalog, feedMap, categoryMap, navigation, shownArticle, renderedSelection, renderTimer, session, retryAgain, loadingRun;
let mode = 'articles', view = 'all', category = '', source = '', query = '', savedKind = 'all', unavailableOnly = false, limit = 60;
let preferredView = 'unread', excluded = new Set();
let undoRead = [], dialogReturn, initial = true, catalogFallback = false;
const shortNames = {regional:'Seattle & regional', neighborhoods:'Seattle neighborhoods', eastside:'Eastside', 'north-sound':'North Sound', 'south-sound':'South Sound', statewide:'Washington state', transport:'Transit & urbanism', culture:'Food, culture & history', commentary:'Commentary & advocacy', official:'Government & services', community:'Community organizations', satire:'Satire'};
const route = () => ({mode, view, category, source, savedKind, query});
const navigate = (changes, options) => navigation?.go(changes, options);
function notice(message) {$('#notice').textContent = message; $('#notice').hidden = !message;}
function announce(message) {$('#announcement').textContent = message;}
async function toggleExcluded(id) {
  if (excluded.has(id)) excluded.delete(id); else excluded.add(id);
  await save('settings', [{id:'excludedSources',value:[...excluded]}]);
  render();
  announce(excluded.has(id) ? 'The reader excluded this source from your feeds. Saved items remain available.' : 'The reader included this source in your feeds.');
}
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const choice = $('#theme').value;
  const dark = choice === 'dark' || (choice === 'auto' && systemTheme.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = dark ? '#111110' : '#f9f9f8';
}
systemTheme.addEventListener('change', applyTheme);
$('#theme').addEventListener('change', async () => {
  const theme = $('#theme').value;
  applyTheme(); await save('settings', [{id:'theme',value:theme}]);
  announce(theme === 'auto' ? 'The reader now follows your device’s theme.' : `The reader now uses the ${theme === 'dark' ? 'Dark' : 'Light'} theme.`);
});
applyTheme();
function closeMenu() {
  const focused = $('#resource-menu').contains(document.activeElement);
  $('#reader-header').classList.remove('menu-open');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
  $('#menu-toggle').setAttribute('aria-label', 'Open menu');
  if (focused && matchMedia('(max-width: 760px)').matches) $('#menu-toggle').focus({preventScroll:true});
}
$('#menu-toggle').addEventListener('click', () => {
  const open = $('#reader-header').classList.toggle('menu-open');
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
  $('#menu-toggle').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});
document.addEventListener('click', event => {if (!event.target.closest('.masthead')) closeMenu();});
document.addEventListener('focusin', event => {if (!event.target.closest('.masthead')) closeMenu();});
document.addEventListener('keydown', event => {if (event.key === 'Escape') closeMenu();});
// Focus rings remain available to keyboard users, including on iOS.
document.addEventListener('pointerdown', () => document.documentElement.classList.add('pointer-navigation'), true);
document.addEventListener('keydown', () => document.documentElement.classList.remove('pointer-navigation'), true);
window.addEventListener('scroll', () => {
  $('#reader-header').classList.toggle('compact', scrollY > 100);
  $('#back-to-top').hidden = scrollY < 500;
}, {passive:true});
$('#back-to-top').addEventListener('click', () => {
  window.scrollTo({top:0,behavior:'instant'});
  $('.wordmark').focus({preventScroll:true});
  scrolling.sync();
});
function selectedFeeds(all = false) {return catalog.feeds.filter(feed => feedMode(feed) === mode && (all || ((!category || feed.category === category) && (!source || feed.id === source))));}
function matching(item) {return matchesItem(item, route(), feedMap, excluded);}
function filteredArticles() {
  return [...articles.values()].filter(item => matching(item) && (view !== 'unread' || !states.get(item.id)?.read) && (view !== 'saved' || states.get(item.id)?.saved) && (!query || `${item.title} ${item.author || ''} ${item.excerpt} ${sourceName(item)}`.toLocaleLowerCase().includes(query)))
    .sort((a,b) => (b.published || b.updated || 0) - (a.published || a.updated || 0) || b.firstSeen - a.firstSeen || a.id.localeCompare(b.id));
}
function sourceName(article) {return feedMap.get(article.feedIds[0])?.name || article.sourceName || 'Previously saved source';}
function sourceLink(article) {
  const feed = feedMap.get(article.feedIds[0]);
  return feed ? button(sourceName(article), 'publisher', () => navigate({mode:feedMode(feed),view:'sources',source:feed.id,category:'',query:'',unavailableOnly:false})) : el('span', 'publisher', sourceName(article));
}
function bookmarkIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('bookmark-icon');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M6 3h12v18l-6-4-6 4z'); svg.append(path); return svg;
}
function saveButton(article, className = 'save-button') {
  const node = button('', className, async () => {
    await setState(article.id, {saved: !states.get(article.id)?.saved});
    update(); announce(states.get(article.id)?.saved ? 'The reader saved this item.' : 'The reader removed this item from Saved.');
  });
  function update() {
    const saved = Boolean(states.get(article.id)?.saved);
    node.replaceChildren(bookmarkIcon(), el('span', '', saved ? 'Saved' : 'Save'));
    node.classList.toggle('is-saved', saved); node.setAttribute('aria-pressed', String(saved));
    node.setAttribute('aria-label', `${saved ? 'Saved' : 'Save'} ${article.title || 'Untitled article'}${saved ? '; remove from Saved' : ''}`);
  }
  node.dataset.save = article.id; update(); return node;
}
function updateReadButton(node, article) {
  const read = Boolean(states.get(article.id)?.read);
  node.querySelector('span').textContent = read ? 'Mark Unread' : 'Mark Read';
  node.classList.toggle('is-read', read); node.setAttribute('aria-pressed', String(read));
  node.setAttribute('aria-label', `${read ? 'Mark Unread' : 'Mark Read'}: ${article.title}`);
}
function readButton(article) {
  const node = button('', 'read-button', async () => {await setState(article.id, {read: !states.get(article.id)?.read}); announce(states.get(article.id)?.read ? 'The reader marked this item as read.' : 'The reader marked this item as unread.');});
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.classList.add('read-icon');
  const path = document.createElementNS(icon.namespaceURI, 'path'); path.setAttribute('d', 'm5 12 4 4L19 6'); icon.append(path);
  node.append(icon, el('span')); node.dataset.read = article.id; updateReadButton(node, article); return node;
}
function articleLinks(article, className = 'publisher-link') {
  if (!article.url) return [];
  const social = itemMode(article, feedMap) === 'posts';
  const publisher = external(`${social ? 'View on Bluesky' : 'Read at publisher'} ↗\uFE0E`, article.url, className);
  const archive = external('Find archived page ↗\uFE0E', archiveUrl(article.url), `${className} archive-link`);
  for (const link of [publisher, archive]) link.addEventListener('click', () => setState(article.id, {read: true}));
  return [publisher, archive];
}

function timeNode(timestamp, onlyDate = false) {
  const node = el('time', '', dateLabel(timestamp, true, onlyDate));
  if (validTimestamp(timestamp)) {node.dateTime = dateIso(timestamp, onlyDate); node.title = node.textContent;}
  return node;
}
function itemDates(item) {
  const node = el('span', 'story-dates');
  for (const [field, label] of [['published', 'Published'], ['updated', 'Updated']]) {
    if (!validTimestamp(item[field])) continue;
    const line = el('span', `story-${field}`); line.append(`${label} `, timeNode(item[field], item[`${field}DateOnly`])); node.append(line);
  }
  if (!node.childElementCount) node.textContent = 'No date in feed';
  return node;
}
function articleMetadata(item, className, showReadStatus = false) {
  const metadata = el('div', `${className} article-metadata`), attribution = el('div', 'article-attribution');
  attribution.append(sourceLink(item));
  const categoryId = item.feedIds.map(id => feedMap.get(id)?.category).find(Boolean);
  const classification = {satire:'Satire', commentary:'Commentary & advocacy', official:'Official information'}[categoryId];
  if (classification) attribution.append(el('span', `category-tag category-${categoryId}`, classification));
  if (item.author) attribution.append(el('span', 'author', `By ${cleanText(item.author)}`));
  if (showReadStatus) attribution.append(el('span', 'article-read-status', states.get(item.id)?.read ? 'Read' : 'Unread'));
  const dates = el('div', 'date-line');
  const dot = el('span', `read-dot ${states.get(item.id)?.read ? '' : 'unread-dot'}`, states.get(item.id)?.read ? 'Read' : 'Unread');
  dot.setAttribute('aria-label', dot.textContent);
  dates.append(dot, itemDates(item));
  metadata.append(attribution, dates);
  return metadata;
}
function updateNavigation() {
  for (const node of document.querySelectorAll('[data-mode]')) node.setAttribute('aria-pressed', String(['all','unread'].includes(view) && node.dataset.mode === mode));
  for (const node of document.querySelectorAll('[data-view]')) node.setAttribute('aria-pressed', String(node.dataset.view === view));
  for (const node of document.querySelectorAll('[data-kind]')) node.setAttribute('aria-pressed', String(node.dataset.kind === savedKind));
  const current = [...articles.values()].filter(item => itemMode(item, feedMap) === mode);
  $('#all-count').textContent = current.length;
  $('#unread-count').textContent = current.filter(item => !states.get(item.id)?.read).length;
  const savedCount = [...articles.keys()].filter(id => states.get(id)?.saved).length;
  $('#saved-count').textContent = savedCount;
  $('#export-saved').disabled = !savedCount;
  $('#export-saved').setAttribute('aria-label', 'Export all saved items as CSV');
  $('#export-saved').hidden = view !== 'saved';
  $('#excluded-count').textContent = excluded.size;
  $('#publications-button').textContent = mode === 'posts' ? 'Accounts' : 'Publications';
  $('#library-views').hidden = false; $('#saved-kinds').hidden = view !== 'saved';
  $('#library-views').setAttribute('aria-label', mode === 'posts' ? 'Post view' : 'Article view');
  $('#filter-button').hidden = ['saved','excluded'].includes(view); $('#refresh').hidden = ['saved','excluded'].includes(view);
  $('#reading-options').hidden = ['sources','saved','excluded'].includes(view);
  $('#show-all-sources').hidden = view !== 'sources' || !unavailableOnly;
  const searchLabel = view === 'excluded' ? 'Search excluded sources' : view === 'saved' ? 'Search saved items' : view === 'sources' ? `Search ${mode === 'posts' ? 'accounts' : 'publications'}` : `Search ${mode}`;
  $('#search-label').textContent = searchLabel; $('#search').placeholder = `${searchLabel}…`;
  $('#clear-search').hidden = !$('#search').value;
  $('#search-help').textContent = view === 'excluded' ? 'Search the sources you have excluded.' : view === 'sources' ? `Search the ${mode === 'posts' ? 'accounts' : 'publications'} in this list.` : 'Search the items this reader has loaded in your current view.';
  $('#stories').setAttribute('aria-label', view === 'saved' ? 'Saved items' : ['sources','excluded'].includes(view) ? 'Sources' : mode === 'posts' ? 'Posts' : 'Articles');
  const chips = $('#filter-chips'); chips.replaceChildren();
  if (category) chips.append(button(`${shortNames[category]} ×`, 'filter-chip', () => navigate({category:''})));
  if (source) chips.append(button(`${feedMap.get(source)?.name} ×`, 'filter-chip', () => navigate({source:''})));
  if (query) chips.append(button(`Search: ${navigation.current.query} ×`, 'filter-chip', () => navigate({query:''})));
  if (category || source || query) chips.append(button('Clear all', 'text-button', () => navigate({category:'',source:'',query:''})));
  chips.hidden = !chips.childElementCount;
}
function renderLoading() {
  const run = loadingRun, panel = $('#feed-loading'), bar = $('#loading-bar');
  const visible = Boolean(run && run.mode === mode && view !== 'saved');
  const active = visible && !run.finished && !run.controller.signal.aborted;
  const starting = active && panel.hidden;
  panel.hidden = !visible;
  $('#stories').setAttribute('aria-busy', String(active));
  if (active) $('#stories').setAttribute('aria-describedby', 'loading-guidance');
  else $('#stories').removeAttribute('aria-describedby');
  if (!visible) return;
  panel.dataset.state = active ? 'loading' : 'finished';
  $('#loading-label').textContent = view === 'sources' ? 'Sources' : mode === 'posts' ? 'Posts' : 'Articles';
  $('#loading-guidance').textContent = view === 'sources' ? 'Checking availability.' : 'Wait to start reading.';
  $('#loading-result').textContent = run.completed ? view === 'sources' ? 'Sources checked.' : 'Ready to read.' : 'Check paused.';
  $('#loading-guidance').setAttribute('aria-hidden', String(!active));
  $('#loading-result').setAttribute('aria-hidden', String(active));
  $('#loading-count-value').textContent = `${String(run.done).padStart(String(run.total).length, '\u2007')} / ${run.total}`;
  $('#dismiss-loading').disabled = active;
  $('.loading-mark').textContent = run.completed ? '✓' : 'Ⅱ';
  bar.max = run.total; bar.value = run.done;
  bar.setAttribute('aria-label', active ? view === 'sources' ? 'Checking sources' : `Loading ${mode}` : run.completed ? 'Feed check complete' : 'Feed check paused');
  bar.setAttribute('aria-valuetext', `${run.done} of ${run.total} feeds checked`);
  bar.setAttribute('aria-describedby', active ? 'loading-guidance' : 'loading-result');
  if (starting) announce(`${bar.getAttribute('aria-label')}. ${$('#loading-guidance').textContent}`);
}
function renderProgress() {
  if (!catalog) return;
  const active = session && session.mode === mode && !session.controller.signal.aborted && view !== 'saved';
  renderLoading();
  const node = $('#feed-progress'); node.replaceChildren();
  if (view === 'saved') {node.append(el('span', '', 'Your saved articles and posts')); return;}
  const feeds = selectedFeeds(true), failures = feeds.filter(feed => health.get(feed.id)?.error);
  const attempts = feeds.map(feed => health.get(feed.id)?.lastAttempt || health.get(feed.id)?.lastSuccess || 0).filter(Boolean);
  if (!active) {
    const checked = el('span', '', attempts.length ? `The reader last checked feeds ${dateLabel(Math.max(...attempts), true)}` : 'The reader has not checked feeds yet.');
    checked.hidden = !$('#feed-loading').hidden;
    if (attempts.length) checked.title = `The reader last checked feeds ${dateLabel(Math.max(...attempts), true)}`;
    node.append(checked);
  }
  if (failures.length) node.append(button(`${failures.length} unavailable`, 'text-button status-link', () => navigate({view:'sources',unavailableOnly:true,source:'',category:'',query:''})));
  $('#refresh').disabled = Boolean(active); $('#refresh').textContent = active ? '↻ Checking' : '↻ Refresh';
}
function renderPending() {
  const count = view === 'saved' || view === 'sources' ? 0 : [...pending.values()].filter(matching).length;
  $('#new-items').hidden = !count; $('#new-items').textContent = `Show ${count} new ${mode}`;
}

function storyCard(item) {
  const state = states.get(item.id) || {}, social = itemMode(item, feedMap) === 'posts';
  const card = el('article', `story ${social ? 'post' : 'article-card'} ${state.read ? 'is-read' : ''}`); card.dataset.article = item.id;
  if(social)card.setAttribute('aria-label', `Post by ${sourceName(item)}`);
  const body = el('div', 'story-copy'), metadata = articleMetadata(item, 'story-meta');
  if (social) {
    body.append(metadata);
    const text = cleanText(item.html).replace(/\[contains quote post or other embedded content\]/gi,'').trim();
    const url = safeUrl(item.url);
    const post = url ? external(text || item.title, url, 'post-text') : el('p','post-text', text || item.title);
    if (url) {
      post.dataset.story = item.id;
      post.addEventListener('click', () => setState(item.id, {read:true}));
    }
    const expanded = expandedPosts.has(item.id); post.classList.toggle('collapsed', !expanded && text.length > 320); body.append(post);
    if (text.length > 320) {
      const expand = button(expanded ? 'Show less' : 'Show more', 'text-button post-expand', () => {
        if (expandedPosts.has(item.id)) expandedPosts.delete(item.id); else expandedPosts.add(item.id);
        render();
      });
      expand.dataset.expand = item.id; expand.setAttribute('aria-expanded', String(expanded)); body.append(expand);
    }
    if (/\[contains quote post or other embedded content\]/i.test(cleanText(item.html))) body.append(el('p','embed-note','Open this post on Bluesky to see quoted posts and other embedded content.'));
  } else {
    const headline = item.title || 'Untitled article';
    const title = el('h2'), open = button('', 'story-title', () => navigate({article:item.id,limit},{keepScroll:true}));
    open.append(el('span', 'headline-text', headline));
    open.setAttribute('aria-label', `Preview article: ${headline}`);
    open.setAttribute('aria-haspopup', 'dialog'); open.setAttribute('aria-controls', 'article-dialog');
    open.dataset.story = item.id; title.append(open); body.append(title,metadata);
    if (item.excerpt) body.append(el('p','excerpt',item.excerpt));
  }
  const footer = el('div','story-foot'); footer.append(...articleLinks(item));
  const actions = el('div','story-actions'); actions.append(saveButton(item),readButton(item));
  const utility = el('div', 'article-footer'); utility.append(footer,actions); body.append(utility);
  card.append(body); return card;
}
function friendlyError(error) {
  if (/403|denied/i.test(error)) return 'A server refused the feed request. Try opening the publisher’s website.';
  if (/challenge|browser check/i.test(error)) return 'The publisher asks for a browser check that the reader cannot complete. Open the publisher’s website to continue.';
  if (/timed out|too long|did not receive the feed in time/i.test(error)) return 'The reader did not receive the feed in time. Choose Retry to try again.';
  if (/Invalid feed|No stories|could not read the feed/i.test(error)) return 'The reader could not read this feed. You can still try opening the publisher’s website.';
  return 'The reader could not load this feed. Choose Retry to try again, or open the publisher’s website.';
}
function sourceCard(feed) {
  const status = health.get(feed.id), cached = status?.lastSuccess && (status.error || status.transport === 'snapshot');
  const card = el('article','source-card'), top = el('div','source-top');
  top.append(el('span','category-tag', feedMode(feed) === 'posts' ? 'Bluesky' : shortNames[feed.category]),el('span',`source-status ${status?.error ? 'error' : ''}`,cached ? 'Using an earlier copy' : status?.error ? 'Unavailable' : status?.lastSuccess ? 'Available' : 'Waiting to check'));
  const title = el('h2'); title.append(external(feed.name,feed.website)); card.append(top,title,el('p','',feed.description));
  if (status?.error) card.append(el('p','source-detail',friendlyError(status.error)));
  if (status?.lastSuccess) card.append(el('p','source-detail',`The reader last loaded ${status.items} items on ${dateLabel(status.lastSuccess,true)}.${status.transport === 'direct' ? ' Your browser connected directly to the publisher.' : ''}`));
  else card.append(el('p','source-detail',status?.error ? 'The reader has no earlier copy of this feed. Choose Visit website to read at the publisher.' : 'The reader has not loaded this feed yet. Choose Retry to load it now.'));
  if (status?.transport === 'snapshot') card.append(el('p','source-detail',`The reader is using a backup that a scheduled task collected on ${dateLabel(status.fetchedAt || status.lastSuccess,true)}. The task runs every 15 minutes, though GitHub may delay it. Cloudflare stops using each copy within 6 hours, or sooner if the publisher requires it.`));
  if (status?.error) {const details = el('details'); details.append(el('summary','','Technical details'),el('p','source-detail',status.error)); card.append(details);}
  const links = el('div','source-links');
  links.append(button('View items →','text-button',() => navigate({mode:feedMode(feed),view:'all',source:feed.id,category:'',query:'',unavailableOnly:false})),external('Visit website ↗',feed.website),external('Open feed ↗',feed.feed));
  if (view !== 'excluded' && (status?.error || !status?.lastSuccess)) {const retry=button('Retry','text-button',()=>refreshFeeds({only:feed.id,retryFailed:true})); retry.disabled=Boolean(session); links.append(retry);}
  const exclude = button(excluded.has(feed.id) ? 'Include source' : 'Exclude source', 'secondary-button', () => toggleExcluded(feed.id));
  exclude.dataset.exclude = feed.id; exclude.setAttribute('aria-pressed', String(excluded.has(feed.id)));
  links.append(exclude);
  if (excluded.has(feed.id)) card.append(el('p', 'source-detail', 'Excluded from your feeds. Your saved items are still available.'));
  card.append(links); return card;
}
function captureFocus() {
  const node = document.activeElement, keys = ['save','read','story','expand','exclude'];
  const kind = keys.find(key => node?.dataset[key]);
  if (!kind || node.closest('dialog')) return null;
  const index = [...$('#stories').children].indexOf(node.closest('.story'));
  return {kind,id:node.dataset[kind],index};
}
function focusItem(target) {
  if (!target) return;
  if (target.element) {
    const element = $(target.element);
    if (element?.closest('#resource-menu') && matchMedia('(max-width: 760px)').matches) {
      closeMenu();
      $('#menu-toggle').focus({preventScroll:true});
      return;
    }
    element?.focus({preventScroll:true}); return;
  }
  const controls = [...$('#stories').querySelectorAll(`[data-${target.kind}]`)];
  const exact = controls.find(node => node.dataset[target.kind] === target.id);
  const fallback = $('#stories').children[Math.max(0,Math.min(target.index,$('#stories').children.length-1))]?.querySelector('[data-story], [data-save]');
  (exact || fallback || $('#stories .empty-state h2') || $('#heading')).focus({preventScroll:true});
}
function render() {
  if (!catalog) return;
  clearTimeout(renderTimer); renderTimer = null;
  const selection = JSON.stringify([mode,view,category,source,query,savedKind,unavailableOnly]);
  const anchor = selection === renderedSelection && scrollY > 0 ? [...$('#stories').querySelectorAll('.story')].map(card=>({id:card.dataset.article,top:card.getBoundingClientRect().top,bottom:card.getBoundingClientRect().bottom})).find(card=>card.bottom > 60 && card.top < innerHeight && (view !== 'unread' || !states.get(card.id)?.read)) : null;
  const focus = captureFocus();
  const heading = view === 'excluded' ? 'Excluded sources' : view === 'saved' ? 'Saved items' : view === 'sources' ? unavailableOnly ? 'Unavailable sources' : mode === 'posts' ? 'Accounts' : 'Publications' : `${view === 'unread' ? 'Unread' : 'Latest'} ${mode}`;
  $('#heading').textContent = heading; document.title = `${heading} — Sound & State`;
  $('#page-heading').classList.toggle('sr-only',!['saved','sources','excluded'].includes(view));
  $('#description').hidden = true; updateNavigation(); renderProgress(); renderPending();
  const container = $('#stories'); container.className = ['sources','excluded'].includes(view) ? 'source-grid' : ''; container.replaceChildren();
  if (view === 'sources' || view === 'excluded') {
    const available = view === 'excluded' ? [...excluded].map(id => feedMap.get(id) || {id,name:id,description:'This source is no longer in the catalog.'}) : selectedFeeds();
    const sources = available.filter(feed=>(!unavailableOnly || health.get(feed.id)?.error) && (!query || `${feed.name} ${feed.description}`.toLocaleLowerCase().includes(query))).sort((a,b)=>a.name.localeCompare(b.name));
    $('#result-label').textContent = `${sources.length} ${unavailableOnly ? 'unavailable ' : ''}sources`;
    container.append(...sources.map(feed => {
      if (feedMap.has(feed.id)) return sourceCard(feed);
      const card = el('article', 'source-card');
      card.append(el('h2', '', feed.name), el('p', '', feed.description), button('Include source', 'secondary-button', () => toggleExcluded(feed.id)));
      return card;
    }));
    if (!sources.length) showEmpty(view === 'excluded' && !query ? 'No excluded sources.' : 'No sources match.', view === 'excluded' ? 'Select a publisher’s name in the feed to exclude a source, or clear your search.' : 'Clear your filters to see more sources.');
    $('#load-more').hidden = true;
  } else {
    const list = filteredArticles();
    $('#result-label').textContent = `${list.length.toLocaleString()} ${view === 'saved' ? 'saved items' : mode} · Newest first`;
    container.append(...list.slice(0,limit).map(storyCard));
    if (!list.length) {
      const anySaved = [...states.values()].some(state=>state.saved && articles.has(state.id));
      const active = session && session.mode === mode && view !== 'saved';
      const filtered = query || category || source || (view === 'saved' && savedKind !== 'all');
      const title = view === 'saved' ? anySaved ? 'No saved items match.' : 'You have not saved any items yet.' : active ? `Loading ${mode}…` : filtered ? 'No items match.' : view === 'unread' ? 'You’re caught up.' : 'The reader has not loaded any items yet.';
      const description = view === 'saved' && !anySaved ? 'Save an article or post to find it here.' : filtered ? 'Clear your filters or try another search. The reader searches only the items it has loaded in this view.' : active ? 'The reader adds items as each feed finishes loading.' : 'Choose Refresh to check for new items, or open Filters and browse sources to see which feeds could not load.';
      showEmpty(title,description);
    }
    $('#load-more').hidden = list.length <= limit;
    const unread = list.filter(item=>!states.get(item.id)?.read).length;
    $('#mark-read').textContent = `Mark ${unread.toLocaleString()} matching ${mode} read`; $('#mark-read').disabled = !unread;
  }
  if (focus) focusItem(focus);
  if (anchor) {const card = [...container.children].find(card=>card.dataset.article===anchor.id); if (card) window.scrollBy(0,card.getBoundingClientRect().top-anchor.top);}
  renderedSelection = selection; scrolling.sync(); syncDialogs();
}
function showEmpty(title,description) {const empty=el('div','empty-state'); const heading=el('h2','',title); heading.tabIndex=-1; empty.append(heading,el('p','',description)); $('#stories').append(empty);}
function scheduleRender() {if (!renderTimer) renderTimer=setTimeout(render,350);}
async function setState(id,changes) {const state={...states.get(id),id,...changes}; states.set(id,state); await save('state',[state]); render();}
async function markScrolledArticles(ids) {
  const updates=ids.map(id=>({...states.get(id),id,read:true}));
  for (const state of updates) states.set(state.id,state);
  for (const card of $('#stories').querySelectorAll('.story')) if(ids.includes(card.dataset.article)) {
    card.classList.add('is-read');
    const dot = card.querySelector('.read-dot');
    if (dot) {dot.classList.remove('unread-dot'); dot.textContent = 'Read'; dot.setAttribute('aria-label', 'Read');}
    updateReadButton(card.querySelector('[data-read]'), articles.get(card.dataset.article));
  }
  updateNavigation(); await save('state',updates);
}
function renderFilterSources() {
  const search=$('#source-search').value.trim().toLocaleLowerCase();
  const feeds=selectedFeeds(true).filter(feed=>feed.name.toLocaleLowerCase().includes(search)).sort((a,b)=>a.name.localeCompare(b.name));
  $('#source-choices').replaceChildren(...feeds.map(feed=>{
    const node=button(feed.name,'source-choice',()=>navigate({source:feed.id,category:'',view:view==='sources'?'all':view,unavailableOnly:false},{replace:true}));
    node.dataset.source=feed.id; node.setAttribute('aria-pressed',String(source===feed.id)); return node;
  }));
  $('#source-choice-status').textContent=feeds.length ? `${feeds.length} ${mode==='posts'?'accounts':'publications'}` : 'No sources match this search.';
}
function renderFilters() {
  $('#filter-title').textContent=`Filter ${mode}`;
  $('#section-filter').hidden=mode==='posts';
  $('#categories').replaceChildren(...catalog.categories.filter(section=>section.id!=='bluesky').map(section=>{
    const node=button('', '',()=>navigate({category:category===section.id?'':section.id,source:'',view:view==='sources'?'all':view,unavailableOnly:false},{replace:true}));
    node.dataset.category=section.id; node.setAttribute('aria-pressed',String(category===section.id)); node.append(el('span','',shortNames[section.id]||section.title),el('span','count',catalog.feeds.filter(feed=>feed.category===section.id).length)); return node;
  }));
  $('#browse-sources').replaceChildren(document.createTextNode(`Browse ${mode==='posts'?'accounts':'publications'} `),el('span','count',selectedFeeds(true).length));
  $('#source-picker-title').textContent=mode==='posts'?'Accounts':'Publications';
  const label=mode==='posts'?'Find an account':'Find a publication';
  $('#source-search-label').textContent=label; $('#source-search').placeholder=`${label}…`; $('#source-search').value=''; renderFilterSources();
}
function openFeedList() {
  dialogReturn={element:'#feed-list-button'};
  $('#feed-list-dialog').showModal();$('#feed-list-title').focus();
}
function closeDialog(dialog) {
  if(navigation)navigation.close();
  else {dialog.close();focusItem(dialogReturn);dialogReturn=null;}
}
function syncDialogs() {
  const current=navigation?.current; if(!current)return;
  const item=articles.get(current.article);
  if(item && itemMode(item,feedMap)==='posts') {
    navigate({article:'',mode:'posts',view:current.view==='saved'?'saved':'all',savedKind:current.view==='saved'?'posts':current.savedKind,limit},{replace:true,keepScroll:true});
    return;
  }
  for(const [id,open] of [['article-dialog',Boolean(current.article)],['about-dialog',current.about],['feed-list-dialog',current.feedList],['filter-dialog',current.filters]]) {
    const dialog=$(`#${id}`);
    if(!open && dialog.open){dialog.close(); if(id==='article-dialog')shownArticle=null; focusItem(dialogReturn); dialogReturn=null;}
  }
  if(current.about && !$('#about-dialog').open){dialogReturn={element:'#about-button'};$('#about-dialog').showModal();$('#about-title').focus();}
  if(current.feedList && !$('#feed-list-dialog').open)openFeedList();
  if(current.filters && !$('#filter-dialog').open){dialogReturn={element:$('#filter-button').getClientRects().length?'#filter-button':'#menu-filter-button'};renderFilters();$('#filter-dialog').showModal();}
  if(current.article && (shownArticle!==current.article || !$('#article-dialog').open)) {
    if(!$('#article-dialog').open) dialogReturn={kind:'story',id:current.article,index:[...$('#stories').children].findIndex(card=>card.dataset.article===current.article)};
    if(item){shownArticle=item.id;openArticle(item);} else {
      $('#article-save').replaceChildren(); $('#article-save').hidden=true;
      const heading=el('h2','article-title','The reader cannot find this item in your library'); heading.id='article-title'; heading.tabIndex=-1;
      $('#article-body').replaceChildren(heading,el('p','','It may appear after feeds finish loading. Close this preview to browse available items.'));
      if(!$('#article-dialog').open){$('#article-dialog').showModal();heading.focus();}
    }
  }
}
function openArticle(item) {
  setState(item.id,{read:true});
  const body=$('#article-body'); body.replaceChildren();
  const previewSave=$('#article-save'); previewSave.replaceChildren(saveButton(item)); previewSave.hidden=false;
  const title=el('h2','article-title',item.title||'Untitled article'); title.id='article-title'; title.tabIndex=-1;
  if(safeUrl(item.url))title.replaceChildren(external(item.title||'Untitled article',item.url));
  const metadata=articleMetadata(item,'article-meta',true);
  const actions=el('div','article-links'); actions.append(...articleLinks(item));
  const content=el('div','article-content'); content.append(articleContent(item.html,item.url||feedMap.get(item.feedIds[0])?.website));
  if(!content.textContent.trim())content.append(el('p','','The publisher includes only a headline in this feed. Visit the publisher to read the story.'));
  body.append(title,metadata,actions,content);
  const footer=el('footer','article-preview-footer'), links=el('div','article-links');
  links.append(...articleLinks(item));
  if(cleanText(content.innerHTML).length >= 220)footer.append(links);
  footer.append(el('p','feed-note','The publisher may include only part of the article in its feed. Choose Read at publisher for the full article and any updates.'));
  body.append(footer);
  $('#article-dialog').showModal();body.scrollTop=0;title.focus({preventScroll:true});
}

async function fetchFeed(feed,run) {
  const previous=health.get(feed.id)||{id:feed.id};
  try {
    const {items:fresh,transport,fetchedAt,stale}=await loadFeed(feed,__PROXY_URL__,{signal:run.controller.signal});
    if(run.controller.signal.aborted)return;
    const merged=fresh.map(item=>{
      const existing=articles.get(item.id)||pending.get(item.id), title=cleanText(item.title), text=cleanText(item.html);
      const article={...item,firstSeen:existing?.firstSeen||item.firstSeen,feedIds:[...new Set([...(existing?.feedIds||[]),feed.id])],sourceName:existing?.sourceName||feed.name,title,excerpt:text.slice(0,260)};
      if(!articles.has(item.id) && item.id!==navigation.current.article && (run.buffer || readingStarted.has(run.mode)))pending.set(item.id,article); else articles.set(item.id,article);
      return article;
    });
    await save('articles',merged);
    const current={id:feed.id,lastAttempt:Date.now(),lastSuccess:Date.now(),nextCheck:nextRefresh(),failures:0,items:fresh.length,transport,fetchedAt,stale};health.set(feed.id,current);await save('feeds',[current]);
  } catch(error) {
    if(run.controller.signal.aborted)return;
    const failures=(previous.failures||0)+1;
    const current={...previous,id:feed.id,lastAttempt:Date.now(),failures,nextCheck:nextRefresh(failures),error:error.message.slice(0,420)};health.set(feed.id,current);await save('feeds',[current]);
  } finally {if(!run.controller.signal.aborted)run.done++;scheduleRender();}
}
async function prune() {
  if(catalogFallback)return;
  const kept=new Map(), remove=[], cutoff=Date.now()-30*86400000;
  for(const item of [...articles.values(),...pending.values()].sort((a,b)=>b.firstSeen-a.firstSeen)) {
    if(states.get(item.id)?.saved)continue;
    const ids=item.feedIds.filter(id=>feedMap.has(id));
    if(item.firstSeen<cutoff || !ids.length || ids.every(id=>(kept.get(id)||0)>=150))remove.push(item.id); else for(const id of ids)kept.set(id,(kept.get(id)||0)+1);
  }
  for(const id of remove){articles.delete(id);pending.delete(id);}await removeArticles(remove);
}
async function refreshFeeds({retryFailed=false,only=''}={}) {
  if(!catalog || ['saved','excluded'].includes(view) || document.hidden)return;
  if(session){retryAgain={retryFailed,only};return;}
  if(!navigator.onLine){notice('You’re offline. You can still read any items this reader already has in your library. Reconnect to load new items.');return;}
  const due=feed=>(retryFailed && health.get(feed.id)?.error)||!health.get(feed.id)?.nextCheck||health.get(feed.id).nextCheck<=Date.now();
  const queue=selectedFeeds().filter(feed=>(!excluded.has(feed.id)||source===feed.id||only===feed.id||view==='sources')&&(!only||feed.id===only)&&due(feed));
  if(!queue.length){renderProgress();return;}
  const run={mode,controller:new AbortController(),done:0,total:queue.length,buffer:[...articles.values()].some(item=>itemMode(item,feedMap)===mode)};
  session=run;render();
  const work=async()=>{
    const library=await openLibrary(notice);
    for(const item of library.state)states.set(item.id,item);
    for(const item of library.articles)if(!articles.has(item.id)&&!pending.has(item.id)){if(run.buffer)pending.set(item.id,item);else articles.set(item.id,item);}
    for(const item of library.feeds)if((item.nextCheck||0)>(health.get(item.id)?.nextCheck||0))health.set(item.id,item);
    if(run.controller.signal.aborted)return;
    // Another tab may have refreshed these feeds while this tab waited for the lock.
    const remaining=queue.filter(due);
    if(!remaining.length)return;
    run.total=remaining.length;loadingRun=run;render();
    await inBatches(remaining,async feed=>{if(run.controller.signal.aborted)return;await fetchFeed(feed,run);});
  };
  try {if(navigator.locks)await navigator.locks.request('sound-and-state-refresh',{signal:run.controller.signal},work);else await work();await prune();}
  catch(error){if(!run.controller.signal.aborted)notice('The reader could not finish checking for new items. You can still read your library. Choose Refresh to try again.');}
  finally {run.finished=true;run.completed=!run.controller.signal.aborted&&run.done===run.total;session=null;render();if(!run.controller.signal.aborted && run.mode===mode && view!=='saved')announce(`${run.completed?'Feed check complete. ':''}${$('#result-label').textContent}`);if(retryAgain){const next=retryAgain;retryAgain=null;refreshFeeds(next);}}
}
function rememberReading() {if(view!=='saved'&&view!=='sources')readingStarted.add(mode);}
function setupNavigation() {
  for(const node of document.querySelectorAll('[data-mode]'))node.addEventListener('click',()=>navigation.switchMode(node.dataset.mode));
  for(const node of document.querySelectorAll('[data-view]'))node.addEventListener('click',()=>navigate(node.dataset.view==='saved'?{view:'saved',savedKind:'all',source:'',category:'',query:'',unavailableOnly:false}:{view:node.dataset.view,unavailableOnly:false}));
  for(const node of document.querySelectorAll('[data-kind]'))node.addEventListener('click',()=>navigate({savedKind:node.dataset.kind}));
  $('#filter-button').addEventListener('click',()=>navigate({filters:true,limit},{keepScroll:true}));
  $('#menu-filter-button').addEventListener('click',()=>navigate({view:['all','unread'].includes(view)?view:preferredView,filters:true,limit},{keepScroll:true}));
  $('#browse-sources').addEventListener('click',()=>navigate({view:'sources',source:'',category:'',query:'',unavailableOnly:false},{replace:true}));
  $('#source-search').addEventListener('input',renderFilterSources);
  $('#show-all-sources').addEventListener('click',()=>navigate({unavailableOnly:false,category:'',source:'',query:''}));
  $('#clear-search').addEventListener('click',()=>{navigate({query:''});$('#search').focus();announce('Search cleared.');});
  $('#publications-button').addEventListener('click',()=>navigate({view:'sources',source:'',category:'',query:'',unavailableOnly:false}));
  $('#excluded-button').addEventListener('click',()=>navigate({view:'excluded',source:'',category:'',query:'',unavailableOnly:false}));
  $('#search').addEventListener('input',event=>{navigate({query:event.target.value},{search:true});announce($('#result-label').textContent);});
  $('#search').addEventListener('blur',()=>navigation.endSearch());
  $('#refresh').addEventListener('click',()=>refreshFeeds({retryFailed:true}));
  $('#dismiss-loading').addEventListener('click',()=>{loadingRun=null;renderProgress();$('#refresh').focus({preventScroll:true});});
  $('#load-more').addEventListener('click',()=>navigate({limit:limit+60},{replace:true,keepScroll:true}));
  $('#scroll-read').addEventListener('change',async event=>{
    const enabled = event.target.checked;
    scrolling.setEnabled(enabled);await save('settings',[{id:'markReadOnScroll',enabled}]);
    announce(enabled ? 'The reader will mark items read as you scroll past them.' : 'The reader will wait for you to mark items read.');
  });
  $('#mark-read').addEventListener('click',async()=>{
    undoRead=filteredArticles().filter(item=>!states.get(item.id)?.read).map(item=>({id:item.id,read:Boolean(states.get(item.id)?.read)}));
    const updates=undoRead.map(item=>({...states.get(item.id),id:item.id,read:true}));for(const state of updates)states.set(state.id,state);
    await save('state',updates);$('#reading-options').open=false;$('#undo-message').textContent=`The reader marked ${updates.length} ${mode} as read. `;$('#undo-bar').hidden=false;render();$('#undo-read').focus({preventScroll:true});
  });
  $('#undo-read').addEventListener('click',async()=>{const updates=undoRead.map(item=>({...states.get(item.id),...item}));for(const state of updates)states.set(state.id,state);await save('state',updates);undoRead=[];$('#undo-bar').hidden=true;render();$('#heading').focus({preventScroll:true});announce('The reader restored each item’s previous read or unread mark.');});
  $('#new-items').addEventListener('click',()=>{for(const [id,item] of pending)if(itemMode(item,feedMap)===mode){articles.set(id,item);pending.delete(id);}render();window.scrollTo({top:0,behavior:'instant'});scrolling.sync();$('#heading').focus({preventScroll:true});announce('The reader added new items to the list.');});
  $('#stories').addEventListener('pointerdown',rememberReading);$('#stories').addEventListener('keydown',rememberReading);
  window.addEventListener('scroll',()=>{if(scrollY>200&&!document.querySelector('dialog[open]'))rememberReading();},{passive:true});
}
$('#about-button').addEventListener('click',()=>navigate({about:true,limit},{keepScroll:true}));
$('#feed-list-button').addEventListener('click',()=>{
  if(navigation)navigate({feedList:true,limit},{keepScroll:true});else openFeedList();
});
for(const node of document.querySelectorAll('[data-close]'))node.addEventListener('click',()=>closeDialog($(`#${node.dataset.close}`)));
for(const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog(dialog);});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog(dialog);}});
}
$('.wordmark').addEventListener('click',event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate({mode:'articles',view:preferredView,source:'',category:'',query:'',unavailableOnly:false});});
$('.skip-link').addEventListener('click',event=>{event.preventDefault();$('#main').focus();});
window.addEventListener('offline',()=>{session?.controller.abort();notice('You’re offline. You can still read any items this reader already has in your library. Reconnect to load new items.');});
window.addEventListener('online',()=>{notice('You’re back online. The reader can check for new items again.');refreshFeeds();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)session?.controller.abort();else refreshFeeds();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('#reading-options').open=false;});
document.addEventListener('click',event=>{if(!$('#reading-options').contains(event.target))$('#reading-options').open=false;});

function downloadFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = el('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#export-saved').addEventListener('click', () => {
  const rows = [...articles.values()].filter(article => states.get(article.id)?.saved).sort((a, b) => (b.published || b.updated || 0) - (a.published || a.updated || 0) || a.id.localeCompare(b.id)).map(article => ({
    title: article.title, source: sourceName(article), published: article.published, publishedDateOnly: article.publishedDateOnly, updated: article.updated, updatedDateOnly: article.updatedDateOnly, url: article.url, content: cleanText(article.html), read: states.get(article.id)?.read,
  }));
  downloadFile(articlesCsv(rows), 'text/csv;charset=utf-8', `sound-and-state-saved-${new Date().toISOString().slice(0, 10)}.csv`);
});
$('#export-state').addEventListener('click', () => {
  const backup = {format: 'sound-and-state', version: 1, exportedAt: new Date().toISOString(), state: [...states.values()], savedArticles: [...articles.values()].filter(article => states.get(article.id)?.saved)};
  downloadFile(JSON.stringify(backup), 'application/json', `sound-and-state-${new Date().toISOString().slice(0, 10)}.json`);
  $('#backup-status').textContent = 'Check your browser’s downloads for a backup of your saved items and which items you have read.';
});
$('#import-state').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw new Error('The reader cannot restore a backup larger than 20 MB. Choose a smaller backup.');
    let data;
    try {data = JSON.parse(await file.text());}
    catch {throw new Error('The reader cannot read this file as a JSON backup. Choose a file from Export reading backup.');}
    if (!data || data.format !== 'sound-and-state' || data.version !== 1 || !Array.isArray(data.state) || !Array.isArray(data.savedArticles) || data.state.length > 100000 || data.savedArticles.length > 5000) throw new Error('The reader cannot restore this file. Choose a JSON backup from Export reading backup.');
    const newStates = data.state.map(item => {
      if (!item || typeof item.id !== 'string' || item.id.length > 4096 || (item.read !== undefined && typeof item.read !== 'boolean') || (item.saved !== undefined && typeof item.saved !== 'boolean')) throw new Error('The reader cannot read which items this backup marks as read or saved. Choose another backup.');
      return {id: item.id, read: Boolean(item.read || states.get(item.id)?.read), saved: Boolean(item.saved || states.get(item.id)?.saved)};
    });
    const savedIds = new Set(newStates.filter(state => state.saved).map(state => state.id));
    const newArticles = data.savedArticles.map(item => {
      if (!item || !savedIds.has(item.id) || !Array.isArray(item.feedIds) || item.feedIds.length > 1000 || item.feedIds.some(id => typeof id !== 'string' || id.length > 120) || typeof item.title !== 'string' || typeof item.html !== 'string' || item.html.length > 100000 || typeof item.sourceName !== 'string' || !Number.isFinite(item.published) || !Number.isFinite(item.firstSeen)) throw new Error('The reader cannot read a saved item in this backup. Choose another backup.');
      if (item.updated !== undefined && item.updated !== 0 && !validTimestamp(item.updated)) throw new Error('The reader cannot read an item’s update date in this backup. Choose another backup.');
      return {id: item.id, url: safeUrl(item.url), title: cleanText(item.title).slice(0, 2000), html: item.html, excerpt: cleanText(item.html).slice(0, 260), sourceName: cleanText(item.sourceName).slice(0, 200), author: typeof item.author === 'string' ? cleanText(item.author).slice(0, 500) : '', feedIds: item.feedIds, published: item.published, publishedDateOnly: item.publishedDateOnly === true, updated: item.updated || 0, updatedDateOnly: item.updatedDateOnly === true, firstSeen: item.firstSeen};
    });
    for (const item of newStates) states.set(item.id, item);
    for (const item of newArticles) if (!articles.has(item.id)) articles.set(item.id, item);
    await save('state', newStates); await save('articles', newArticles); render();
    $('#backup-status').textContent = `The reader combined ${newArticles.length} saved items and the backup’s read marks with your library.`;
  } catch (error) {$('#backup-status').textContent = error.message;}
  finally {event.target.value = '';}
});


async function start() {
  try {
    const libraryPromise=openLibrary(notice);
    const remotePromise=Promise.all([fetch(`${import.meta.env.BASE_URL}catalog.json`,{signal:AbortSignal.timeout(10000)}),fetch(`${import.meta.env.BASE_URL}feeds.opml`,{signal:AbortSignal.timeout(10000)})]).then(async([json,xml])=>{
      if(!json.ok||!xml.ok)throw new Error('The reader could not download the feed list. Check your connection and reload the page.');
      return verifyOpml(await xml.text(),await json.json());
    }).then(value=>({value}),error=>({error}));
    const library=await libraryPromise, cached=library.settings.find(item=>item.id==='catalog')?.value;
    if(cached)catalog=cached;
    else {
      const remote=await remotePromise;
      if(remote.error) {
        if(!library.articles.length)throw remote.error;
        catalog={feeds:[],categories:[]};catalogFallback=true;
        notice('The reader could not download the feed list. You can still browse the items it already has in your library. Check your connection and reload the page to try again.');
      } else {catalog=remote.value;await save('settings',[{id:'catalog',value:catalog}]);}
    }
    feedMap=new Map(catalog.feeds.map(feed=>[feed.id,feed]));categoryMap=new Map(catalog.categories.map(section=>[section.id,section]));
    for(const item of library.articles)articles.set(item.id,item);
    for(const item of library.state)states.set(item.id,item);
    for(const item of library.feeds)health.set(item.id,item);
    preferredView = library.settings.find(item=>item.id==='listView')?.value === 'all' ? 'all' : 'unread';
    excluded = new Set(library.settings.find(item=>item.id==='excludedSources')?.value || []);
    const theme = library.settings.find(item=>item.id==='theme')?.value;
    $('#theme').value = ['light','dark'].includes(theme) ? theme : 'auto'; applyTheme();
    $('#scroll-read').checked=library.settings.find(item=>item.id==='markReadOnScroll')?.enabled!==false;scrolling.setEnabled($('#scroll-read').checked);
    setupNavigation();await prune();
    navigation=readerNavigation({preferredView:()=>preferredView,normalize:next=>normalizeRoute(next,feedMap,categoryMap),apply:(next,y)=>{
      const changed=mode!==next.mode||view!==next.view||category!==next.category||source!==next.source;
      const needsRender=JSON.stringify([next.mode,next.view,next.category,next.source,next.query.toLocaleLowerCase().trim(),next.savedKind,next.unavailableOnly])!==renderedSelection || next.limit!==limit;
      if(changed){session?.controller.abort();loadingRun=null;$('#reading-options').open=false;}
      ({mode,view,category,source,savedKind,unavailableOnly,limit}=next);query=next.query.toLocaleLowerCase().trim();$('#search').value=next.query;
      if (['all','unread'].includes(view) && preferredView !== view) {preferredView=view; save('settings',[{id:'listView',value:view}]);}
      closeMenu();
      if(needsRender)render();else{updateNavigation();syncDialogs();}
      window.scrollTo({top:y,behavior:'instant'});scrolling.sync();
      if(changed && !next.article && !next.about && !next.feedList && !next.filters)announce($('#result-label').textContent);
      if(!initial && changed && !['saved','excluded'].includes(view))refreshFeeds();
    }});
    const feedListOpen=$('#feed-list-dialog').open;
    navigation.start();initial=false;
    if(feedListOpen)navigate({feedList:true,limit},{keepScroll:true});
    if(cached)remotePromise.then(async remote=>{
      if(remote.error){notice('The reader could not download the latest feed list, so it is using an earlier copy. You can still browse your library. Reload the page to try again.');return;}
      const changed=JSON.stringify(remote.value)!==JSON.stringify(catalog);
      await save('settings',[{id:'catalog',value:remote.value}]);
      if(changed)notice('The reader found a newer feed list. Reload the page when you’re ready to use it.');
    });
    refreshFeeds();
    setInterval(()=>{if(!document.hidden){renderProgress();refreshFeeds();}},60000);
  } catch(error) {renderLoading();notice(error.message);$('#result-label').textContent='The reader could not open your library.';showEmpty('The reader could not load the feed list.','Check your connection and reload the page, or choose Download feed list to use another reader.');}
}
start();
