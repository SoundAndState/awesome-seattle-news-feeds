import './style.css';
import {verifyOpml, inBatches, nextRefresh, safeUrl, selectedSources, archiveUrl} from './feeds.mjs';
import {cleanText, articleContent} from './content.mjs';
import {openLibrary, save, removeArticles} from './storage.mjs';
import {loadFeed} from './network.mjs';
import {articlesCsv} from './export.mjs';
import {scrollReader} from './scroll-read.mjs';
import {readerNavigation} from './navigation.mjs';

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
const articles = new Map();
const states = new Map();
const health = new Map();
const scrolling = scrollReader($('#stories'), markScrolledArticles);
let catalog, feedMap, categoryMap, renderedSelection;
let view = 'all', category = '', source = '', query = '', unavailableOnly = false, limit = 60, refreshing = false, refreshAgain = false, done = 0, total = 0, renderTimer;
let navigation, shownArticle;
function navigate(changes, options) {navigation?.go(changes, options);}
const shortNames = {'regional': 'Seattle & regional', 'neighborhoods': 'Seattle neighborhoods', 'eastside': 'Eastside', 'north-sound': 'North Sound', 'south-sound': 'South Sound', 'statewide': 'Washington state', 'transport': 'Transit & urbanism', 'culture': 'Food, culture & history', 'commentary': 'Commentary & advocacy', 'official': 'Government & services', 'community': 'Community organizations', 'satire': 'Satire', 'bluesky': 'Bluesky'};

function notice(message) {$('#notice').textContent = message; $('#notice').hidden = !message;}
function sourceName(article) {return feedMap.get(article.feedIds[0])?.name || article.sourceName || 'Previously saved source';}
function sourceLink(article) {
  const feed = feedMap.get(article.feedIds[0]);
  return feed ? external(sourceName(article), feed.website, 'publisher') : el('span', 'publisher', sourceName(article));
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
    update();
  });
  function update() {
    const saved = Boolean(states.get(article.id)?.saved);
    node.replaceChildren(bookmarkIcon(), el('span', '', saved ? 'Saved' : 'Save'));
    node.classList.toggle('is-saved', saved); node.setAttribute('aria-pressed', String(saved));
    node.setAttribute('aria-label', `${saved ? 'Unsave' : 'Save'} ${article.title}`);
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
  const node = button('', 'read-button', () => setState(article.id, {read: !states.get(article.id)?.read}));
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.classList.add('read-icon');
  const path = document.createElementNS(icon.namespaceURI, 'path'); path.setAttribute('d', 'm5 12 4 4L19 6'); icon.append(path);
  node.append(icon, el('span')); node.dataset.read = article.id; updateReadButton(node, article); return node;
}
function articleLinks(article, className = 'publisher-link') {
  if (!article.url) return [];
  const social = feedMap.get(article.feedIds[0])?.category === 'bluesky';
  const publisher = external(`${social ? 'View on Bluesky' : 'Read at publisher'} ↗\uFE0E`, article.url, className);
  const archive = external('Read archived page ↗\uFE0E', archiveUrl(article.url), `${className} archive-link`);
  for (const link of [publisher, archive]) link.addEventListener('click', () => setState(article.id, {read: true}));
  return [publisher, archive];
}
function dateLabel(timestamp, full = false) {
  if (!timestamp) return 'Date not provided';
  return new Intl.DateTimeFormat('en-US', full ? {dateStyle: 'long', timeStyle: 'short'} : {month: 'short', day: 'numeric', ...(new Date(timestamp).getFullYear() !== new Date().getFullYear() ? {year: 'numeric'} : {})}).format(timestamp);
}
function selectedFeeds(includeSocial = false) {return selectedSources(catalog.feeds, {category, source, includeSocial});}
function matching(article, includeSocial = view === 'saved') {
  return (!category || article.feedIds.some(id => feedMap.get(id)?.category === category)) && (!source || article.feedIds.includes(source)) && (includeSocial || category || source || article.feedIds.some(id => feedMap.get(id)?.category !== 'bluesky'));
}
function filteredArticles() {
  return [...articles.values()].filter(article => matching(article) && (view !== 'unread' || !states.get(article.id)?.read) && (view !== 'saved' || states.get(article.id)?.saved) && (!query || `${article.title} ${article.excerpt} ${article.feedIds.map(id => feedMap.get(id)?.name || '').join(' ')} ${article.sourceName || ''}`.toLocaleLowerCase().includes(query)))
    .sort((a, b) => b.published - a.published || b.firstSeen - a.firstSeen || a.id.localeCompare(b.id));
}

function updateNavigation() {
  for (const node of document.querySelectorAll('[data-view]')) {
    const active = node.dataset.view === view;
    node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active));
  }
  for (const node of document.querySelectorAll('[data-category]')) {
    const active = node.dataset.category === category;
    node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active));
  }
  const filtered = [...articles.values()].filter(article => matching(article, false));
  $('#all-count').textContent = filtered.length;
  $('#unread-count').textContent = filtered.filter(article => !states.get(article.id)?.read).length;
  $('#saved-count').textContent = [...articles.values()].filter(article => matching(article, true) && states.get(article.id)?.saved).length;
  $('#clear-section').hidden = !category && !source;
  $('#source-filter').value = source;
  $('#mark-read').hidden = view === 'sources' || view === 'saved';
  $('#show-all-sources').hidden = view !== 'sources' || !unavailableOnly;
  $('#scroll-read').closest('label').hidden = view === 'sources';
  $('#export-saved').disabled = ![...articles.keys()].some(id => states.get(id)?.saved);
}

function renderProgress() {
  const failures = selectedFeeds(true).filter(feed => health.get(feed.id)?.error).length;
  const node = $('#feed-progress');
  node.replaceChildren();
  if (refreshing) node.append(el('span', 'refresh-status', `Checking feeds · ${done} of ${total}`));
  else node.append(el('span', '', 'Healthy feeds are checked at most every 15 minutes. Refresh retries unavailable feeds.'));
  if (failures) node.append(button(`${failures} feed${failures === 1 ? '' : 's'} unavailable · View sources`, 'text-button status-link', () => navigate({view: 'sources', unavailableOnly: true, query: ''})));
}

function storyCard(article, index) {
  const state = states.get(article.id) || {};
  const card = el('article', `story ${state.read ? 'is-read' : ''}`);
  card.dataset.article = article.id;
  const number = el('span', 'story-number', String(index + 1).padStart(2, '0'));
  number.setAttribute('aria-hidden', 'true');
  const body = el('div', 'story-copy');
  const metadata = el('div', 'story-meta');
  metadata.append(sourceLink(article), el('span', 'meta-dot', '·'));
  const time = el('time', '', dateLabel(article.published));
  if (article.published) time.dateTime = new Date(article.published).toISOString();
  metadata.append(time);
  if (!state.read) metadata.append(el('span', 'unread-dot', 'Unread'));
  const title = el('h2');
  const open = button(article.title || 'Untitled story', 'story-title', () => navigate({article: article.id, limit}, {keepScroll: true}));
  open.dataset.story = article.id; title.append(open);
  const categoryId = feedMap.get(article.feedIds[0])?.category;
  const footer = el('div', 'story-foot');
  footer.append(el('span', `category-tag category-${categoryId}`, shortNames[categoryId] || 'From your library'));
  footer.append(...articleLinks(article));
  body.append(title, metadata);
  if (article.excerpt || categoryId !== 'bluesky') body.append(el('p', 'excerpt', article.excerpt || 'Open the story for the publisher’s feed preview.'));
  body.append(footer);
  const actions = el('div', 'story-actions');
  actions.append(saveButton(article), readButton(article)); body.append(actions); card.append(number, body); return card;
}

function sourceCard(feed) {
  const status = health.get(feed.id);
  const card = el('article', 'source-card');
  const top = el('div', 'source-top');
  top.append(el('span', 'category-tag', shortNames[feed.category]), el('span', `source-status ${status?.error ? 'error' : ''}`, status?.error ? 'Unavailable' : status?.lastSuccess ? 'Connected' : 'Not checked yet'));
  const title = el('h2'); title.append(external(feed.name, feed.website));
  card.append(top, title, el('p', '', feed.description));
  const detail = status?.error ? `${status.error} ${status.lastSuccess ? `Last loaded ${dateLabel(status.lastSuccess, true)}.` : 'Visit the publisher while its feed is unavailable.'}` : status?.lastSuccess ? `Last loaded ${dateLabel(status.lastSuccess, true)} · ${status.items} stories in feed${status.transport === 'direct' ? ' · Direct from publisher' : ''}` : 'Refresh to check this feed.';
  card.append(el('p', 'source-detail', detail));
  if (!status?.error && status?.transport === 'snapshot') card.append(el('p', 'source-detail', `Cached fallback collected ${dateLabel(status.fetchedAt || status.lastSuccess, true)}. Live publisher requests from Cloudflare failed. Updates are scheduled every 15 minutes; cached copies expire within 6 hours.`));
  const links = el('div', 'source-links');
  links.append(button('View stories →', 'text-button', () => {navigate({source: feed.id, category: '', view: 'all', unavailableOnly: false, query: ''}); refreshFeeds();}), external('Website ↗', feed.website), external('RSS ↗', feed.feed));
  card.append(links); return card;
}

function render() {
  if (!catalog) return;
  clearTimeout(renderTimer); renderTimer = null;
  const selection = JSON.stringify([view, category, source, query, unavailableOnly]);
  const anchor = selection === renderedSelection && window.scrollY > 0 ? [...$('#stories').querySelectorAll('.story')].map(card => ({id: card.dataset.article, top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom})).find(card => card.bottom > 0 && card.top < innerHeight && (view !== 'unread' || !states.get(card.id)?.read)) : null;
  const focus = document.activeElement;
  const focusKey = focus?.dataset.save || focus?.dataset.story || focus?.dataset.read;
  const focusKind = focus?.dataset.save ? 'save' : focus?.dataset.read ? 'read' : 'story';
  const categoryInfo = categoryMap.get(category);
  const feedInfo = feedMap.get(source);
  const titles = {all: 'Latest stories', unread: 'Unread stories', saved: 'Saved stories', sources: unavailableOnly ? 'Unavailable feeds' : 'All sources'};
  $('#heading').textContent = view === 'sources' && unavailableOnly ? titles.sources : feedInfo?.name || categoryInfo?.title || titles[view];
  $('#page-heading').classList.toggle('sr-only', view === 'all' && !category && !source);
  $('#description').textContent = feedInfo?.description || categoryInfo?.description || '';
  $('#description').hidden = !$('#description').textContent || (view === 'sources' && unavailableOnly);
  updateNavigation(); renderProgress();
  const container = $('#stories'); container.className = view === 'sources' ? 'source-grid' : '';
  container.replaceChildren();
  if (view === 'sources') {
    const sources = selectedFeeds(true).filter(feed => (!unavailableOnly || health.get(feed.id)?.error) && (!query || `${feed.name} ${feed.description}`.toLocaleLowerCase().includes(query))).sort((a, b) => a.name.localeCompare(b.name));
    $('#result-label').textContent = `${sources.length} ${unavailableOnly ? 'unavailable ' : ''}feed${sources.length === 1 ? '' : 's'}`;
    container.append(...sources.map(sourceCard));
    if (!sources.length) showEmpty('No sources match.', 'Try another search or clear the section filter.');
    $('#load-more').hidden = true;
  } else {
    const list = filteredArticles();
    const social = category === 'bluesky' || feedInfo?.category === 'bluesky';
    $('#result-label').textContent = `${list.length.toLocaleString()} ${view === 'saved' ? 'saved ' : ''}${social ? `post${list.length === 1 ? '' : 's'}` : `stor${list.length === 1 ? 'y' : 'ies'}`} · Newest first`;
    container.append(...list.slice(0, limit).map(storyCard));
    if (!list.length) {
      const title = refreshing ? 'Loading feeds…' : view === 'saved' ? 'No saved stories.' : view === 'unread' ? 'No unread stories.' : 'No stories to show.';
      const description = refreshing ? 'Stories appear as feeds arrive.' : view === 'saved' ? 'Use Save beside a story to add it here.' : query ? 'Try another search or clear your filters.' : 'Try Refresh or check the source directory for feed errors.';
      showEmpty(title, description);
    }
    $('#load-more').hidden = list.length <= limit;
    $('#mark-read').disabled = !list.some(article => !states.get(article.id)?.read);
  }
  if (focusKey) [...container.querySelectorAll(`[data-${focusKind}]`)].find(node => node.dataset[focusKind] === focusKey)?.focus({preventScroll: true});
  if (anchor) {
    const card = [...container.querySelectorAll('.story')].find(card => card.dataset.article === anchor.id);
    if (card) window.scrollBy(0, card.getBoundingClientRect().top - anchor.top);
  }
  renderedSelection = selection;
  scrolling.sync();
  syncDialogs();
}

function showEmpty(title, description) {
  const empty = el('div', 'empty-state'); empty.append(el('span', 'empty-symbol', '≈'), el('h2', '', title), el('p', '', description));
  $('#stories').append(empty);
}

function scheduleRender() {if (!renderTimer) renderTimer = setTimeout(() => {renderTimer = null; render();}, 350);}
async function setState(id, changes) {
  const state = {...states.get(id), id, ...changes}; states.set(id, state); await save('state', [state]); render();
}
async function markScrolledArticles(ids) {
  const updates = ids.map(id => ({...states.get(id), id, read: true}));
  for (const state of updates) states.set(state.id, state);
  // Keep passed cards in place, including in Unread, so automatic marking never moves the page.
  for (const card of $('#stories').querySelectorAll('.story')) {
    if (!ids.includes(card.dataset.article)) continue;
    card.classList.add('is-read');
    updateReadButton(card.querySelector('[data-read]'), articles.get(card.dataset.article));
  }
  updateNavigation();
  await save('state', updates);
}

function syncDialogs() {
  const route = navigation?.current;
  if (!route) return;
  if (!route.about && $('#about-dialog').open) $('#about-dialog').close();
  if (!route.article && $('#article-dialog').open) {$('#article-dialog').close(); shownArticle = null;}
  if (route.about && !$('#about-dialog').open) $('#about-dialog').showModal();
  if (route.article && (shownArticle !== route.article || (!$('#article-dialog').open))) {
    const article = articles.get(route.article);
    if (article) {shownArticle = article.id; openArticle(article);}
    else {
      $('#article-body').replaceChildren(el('h2', 'article-title', 'Story not in this browser’s library'), el('p', '', 'It may appear after feeds finish loading. Close this preview to browse available stories.'));
      $('#article-body h2').id = 'article-title';
      if (!$('#article-dialog').open) $('#article-dialog').showModal();
    }
  }
}

function openArticle(article) {
  setState(article.id, {read: true});
  const body = $('#article-body'); body.replaceChildren();
  const metadata = el('p', 'article-meta');
  const time = el('time', '', dateLabel(article.published, true));
  if (article.published) time.dateTime = new Date(article.published).toISOString();
  metadata.append(sourceLink(article), ' · ', time);
  const title = el('h2', 'article-title', article.title); title.id = 'article-title';
  const actions = el('div', 'article-links');
  actions.append(...articleLinks(article), saveButton(article));
  const content = el('div', 'article-content'); content.append(articleContent(article.html, article.url || feedMap.get(article.feedIds[0])?.website));
  if (!content.textContent.trim()) content.append(el('p', '', 'This feed includes a headline only. Visit the publisher to read the story.'));
  body.append(title, metadata, actions, content, el('p', 'feed-note', 'Feed content may be an excerpt. Open the original article for the full version and updates.'));
  $('#article-dialog').showModal(); $('#article-dialog').scrollTop = 0;
}

async function fetchFeed(feed) {
  const previous = health.get(feed.id) || {id: feed.id};
  try {
    const {items: fresh, transport, fetchedAt, stale} = await loadFeed(feed, __PROXY_URL__);
    const merged = fresh.map(item => {
      const existing = articles.get(item.id);
      const title = cleanText(item.title);
      const text = cleanText(item.html);
      const excerpt = feed.category === 'bluesky' && text.startsWith(title) ? text.slice(title.length).trim() : text;
      const article = {...item, firstSeen: existing?.firstSeen || item.firstSeen, feedIds: [...new Set([...(existing?.feedIds || []), feed.id])], sourceName: existing?.sourceName || feed.name, title, excerpt: excerpt.slice(0, 260)};
      articles.set(article.id, article); return article;
    });
    await save('articles', merged);
    const current = {id: feed.id, lastSuccess: Date.now(), nextCheck: nextRefresh(), failures: 0, items: fresh.length, transport, fetchedAt, stale};
    health.set(feed.id, current); await save('feeds', [current]);
  } catch (error) {
    const failures = (previous.failures || 0) + 1;
    const current = {...previous, id: feed.id, failures, nextCheck: nextRefresh(failures), error: error.message.slice(0, 420)};
    health.set(feed.id, current); await save('feeds', [current]);
  } finally {done++; scheduleRender();}
}

async function prune() {
  const kept = new Map();
  const remove = [];
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const article of [...articles.values()].sort((a, b) => b.firstSeen - a.firstSeen)) {
    if (states.get(article.id)?.saved) continue;
    const activeIds = article.feedIds.filter(id => feedMap.has(id));
    if (article.firstSeen < cutoff || !activeIds.length || activeIds.every(id => (kept.get(id) || 0) >= 150)) remove.push(article.id);
    else for (const id of activeIds) kept.set(id, (kept.get(id) || 0) + 1);
  }
  for (const id of remove) articles.delete(id);
  await removeArticles(remove);
}

async function refreshFeeds(retryFailed = false) {
  if (!catalog) return;
  if (refreshing) {refreshAgain = true; return;}
  if (!navigator.onLine) {notice('You’re offline. Previously loaded stories are still available.'); return;}
  const due = feed => (retryFailed && health.get(feed.id)?.error) || !health.get(feed.id)?.nextCheck || health.get(feed.id).nextCheck <= Date.now();
  const queue = selectedFeeds().filter(due);
  if (!queue.length) {renderProgress(); return;}
  refreshing = true; done = 0; total = queue.length;
  $('#refresh').disabled = true; $('#refresh').textContent = '↻ Refreshing'; render();
  // Multiple tabs share a lock and re-read timestamps to avoid duplicate full refreshes.
  const run = async () => {
    const library = await openLibrary(notice);
    for (const item of library.articles) if (!articles.has(item.id)) articles.set(item.id, item);
    for (const item of library.state) if (!states.has(item.id)) states.set(item.id, item);
    for (const item of library.feeds) if ((item.nextCheck || 0) > (health.get(item.id)?.nextCheck || 0)) health.set(item.id, item);
    await inBatches(queue, async feed => {if (due(feed)) await fetchFeed(feed); else done++;});
  };
  try {
    if (navigator.locks) await navigator.locks.request('sound-and-state-refresh', run); else await run();
    await prune();
  } catch {notice('The refresh was interrupted. Your previously loaded stories are still here.');}
  finally {
    refreshing = false; $('#refresh').disabled = false; $('#refresh').textContent = '↻ Refresh'; render();
    if (refreshAgain) {refreshAgain = false; refreshFeeds();}
  }
}

function setupNavigation() {
  $('#sources-count').textContent = catalog.feeds.length;
  for (const section of catalog.categories) {
    const node = button('', '', () => navigate({category: category === section.id ? '' : section.id, source: '', unavailableOnly: false, view: view === 'sources' ? 'all' : view}));
    node.dataset.category = section.id;
    node.append(el('span', '', shortNames[section.id] || section.title), el('span', 'count', catalog.feeds.filter(feed => feed.category === section.id).length));
    $('#categories').append(node);
  }
  for (const feed of [...catalog.feeds].sort((a, b) => a.name.localeCompare(b.name))) {const option = el('option', '', feed.name); option.value = feed.id; $('#source-filter').append(option);}
  for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', () => navigate({view: node.dataset.view, unavailableOnly: false}));
  $('#show-all-sources').addEventListener('click', () => navigate({unavailableOnly: false, category: '', source: '', query: ''}));
  $('#clear-section').addEventListener('click', () => navigate({category: '', source: ''}));
  $('#source-filter').addEventListener('change', event => navigate({source: event.target.value, category: '', unavailableOnly: false, view: view === 'sources' ? 'all' : view}));
  $('#search').addEventListener('input', event => navigate({query: event.target.value}, {search: true}));
  $('#search').addEventListener('blur', () => navigation.endSearch());
  $('#refresh').addEventListener('click', () => refreshFeeds(true));
  $('#load-more').addEventListener('click', () => navigate({limit: limit + 60}, {replace: true, keepScroll: true}));
  $('#scroll-read').addEventListener('change', async event => {
    scrolling.setEnabled(event.target.checked);
    await save('settings', [{id: 'markReadOnScroll', enabled: event.target.checked}]);
  });
  $('#mark-read').addEventListener('click', async () => {
    const updates = filteredArticles().map(article => ({...states.get(article.id), id: article.id, read: true}));
    for (const state of updates) states.set(state.id, state);
    await save('state', updates); render();
  });
}

$('#refresh').setAttribute('aria-label', 'Refresh');
$('#about-button').addEventListener('click', () => navigate({about: true, limit}, {keepScroll: true}));
for (const node of document.querySelectorAll('[data-close]')) node.addEventListener('click', () => navigation?.close());
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('cancel', event => {event.preventDefault(); navigation?.close();});
  dialog.addEventListener('click', event => {if (event.target === dialog) {const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) navigation?.close();}});
}
$('.wordmark').addEventListener('click', event => {
  if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate({view: 'all', category: '', source: '', query: '', unavailableOnly: false});
});
$('.skip-link').addEventListener('click', event => {event.preventDefault(); $('#main').focus();});
$('#mobile-filter').addEventListener('click', () => {const open = $('#mobile-filter').getAttribute('aria-expanded') !== 'true'; $('#mobile-filter').setAttribute('aria-expanded', String(open)); $('.sidebar').classList.toggle('expanded', open);});
window.addEventListener('offline', () => notice('You’re offline. Previously loaded stories are still available.'));
window.addEventListener('online', () => {notice('Connection restored. Choose Refresh to check for new stories.');});

function downloadFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = el('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#export-saved').addEventListener('click', () => {
  const rows = [...articles.values()].filter(article => states.get(article.id)?.saved).sort((a, b) => b.published - a.published || a.id.localeCompare(b.id)).map(article => ({
    title: article.title, source: sourceName(article), published: article.published, url: article.url, content: cleanText(article.html), read: states.get(article.id)?.read,
  }));
  downloadFile(articlesCsv(rows), 'text/csv;charset=utf-8', `sound-and-state-saved-${new Date().toISOString().slice(0, 10)}.csv`);
});
$('#export-state').addEventListener('click', () => {
  const backup = {format: 'sound-and-state', version: 1, exportedAt: new Date().toISOString(), state: [...states.values()], savedArticles: [...articles.values()].filter(article => states.get(article.id)?.saved)};
  downloadFile(JSON.stringify(backup), 'application/json', `sound-and-state-${new Date().toISOString().slice(0, 10)}.json`);
  $('#backup-status').textContent = 'Backup exported: read status and saved stories.';
});
$('#import-state').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw new Error('Backup is too large (20 MB maximum).');
    const data = JSON.parse(await file.text());
    if (data.format !== 'sound-and-state' || data.version !== 1 || !Array.isArray(data.state) || !Array.isArray(data.savedArticles) || data.state.length > 100000 || data.savedArticles.length > 5000) throw new Error('This is not a supported Sound & State backup.');
    const newStates = data.state.map(item => {
      if (typeof item.id !== 'string' || item.id.length > 4096 || (item.read !== undefined && typeof item.read !== 'boolean') || (item.saved !== undefined && typeof item.saved !== 'boolean')) throw new Error('Backup contains invalid reading state.');
      return {id: item.id, read: Boolean(item.read || states.get(item.id)?.read), saved: Boolean(item.saved || states.get(item.id)?.saved)};
    });
    const savedIds = new Set(newStates.filter(state => state.saved).map(state => state.id));
    const newArticles = data.savedArticles.map(item => {
      if (!savedIds.has(item.id) || !Array.isArray(item.feedIds) || item.feedIds.length > 1000 || item.feedIds.some(id => typeof id !== 'string' || id.length > 120) || typeof item.title !== 'string' || typeof item.html !== 'string' || item.html.length > 100000 || typeof item.sourceName !== 'string' || !Number.isFinite(item.published) || !Number.isFinite(item.firstSeen)) throw new Error('Backup contains an invalid saved story.');
      return {id: item.id, url: safeUrl(item.url), title: cleanText(item.title).slice(0, 2000), html: item.html, excerpt: cleanText(item.html).slice(0, 260), sourceName: cleanText(item.sourceName).slice(0, 200), feedIds: item.feedIds, published: item.published, firstSeen: item.firstSeen};
    });
    for (const item of newStates) states.set(item.id, item);
    for (const item of newArticles) if (!articles.has(item.id)) articles.set(item.id, item);
    await save('state', newStates); await save('articles', newArticles); render();
    $('#backup-status').textContent = `Restored ${newArticles.length} saved stories and merged reading state.`;
  } catch (error) {$('#backup-status').textContent = error.message;}
  finally {event.target.value = '';}
});

async function start() {
  try {
    const [catalogResponse, opmlResponse, library] = await Promise.all([fetch(`${import.meta.env.BASE_URL}catalog.json`), fetch(`${import.meta.env.BASE_URL}feeds.opml`), openLibrary(notice)]);
    if (!catalogResponse.ok || !opmlResponse.ok) throw new Error('The collection could not be loaded. Please reload this page.');
    catalog = verifyOpml(await opmlResponse.text(), await catalogResponse.json());
    feedMap = new Map(catalog.feeds.map(feed => [feed.id, feed])); categoryMap = new Map(catalog.categories.map(section => [section.id, section]));
    for (const item of library.articles) articles.set(item.id, item);
    for (const item of library.state) states.set(item.id, item);
    for (const item of library.feeds) health.set(item.id, item);
    $('#scroll-read').checked = library.settings.find(item => item.id === 'markReadOnScroll')?.enabled === true;
    scrolling.setEnabled($('#scroll-read').checked);
    setupNavigation(); await prune();
    navigation = readerNavigation({
      normalize: route => ({...route, view: ['all', 'unread', 'saved', 'sources'].includes(route.view) ? route.view : 'all', category: categoryMap.has(route.category) ? route.category : '', source: feedMap.has(route.source) ? route.source : '', query: String(route.query).slice(0, 500), limit: Math.max(60, Math.min(20000, Number(route.limit) || 60)), article: String(route.article).slice(0, 4096), about: Boolean(route.about) && !route.article, unavailableOnly: route.view === 'sources' && Boolean(route.unavailableOnly)}),
      apply: (route, y) => {
        ({view, category, source, unavailableOnly, limit} = route); query = route.query.toLocaleLowerCase().trim();
        $('#search').value = route.query;
        render(); window.scrollTo({top: y, behavior: 'instant'}); scrolling.sync();
        if (view !== 'sources' && view !== 'saved' && (category === 'bluesky' || feedMap.get(source)?.category === 'bluesky')) refreshFeeds();
      },
    });
    navigation.start(); await refreshFeeds();
  } catch (error) {notice(error.message); $('#result-label').textContent = 'Collection unavailable'; showEmpty('Unable to load the feed list.', 'Try reloading, or use “Download feed list” to open it in another reader.');}
}
start();
