import './style.css';
import {normalizeFeed, verifyOpml, inBatches, nextRefresh, safeUrl, selectedSources} from './feeds.mjs';
import {cleanText, articleContent} from './content.mjs';
import {openLibrary, save, removeArticles} from './storage.mjs';

const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, className, action) => {const node = el('button', className, label); node.addEventListener('click', action); return node;};
const external = (label, url, className = '') => {
  const node = el('a', className, label);
  node.href = safeUrl(url) || '#'; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
};
const articles = new Map();
const states = new Map();
const health = new Map();
let catalog, feedMap, categoryMap;
let view = 'all', category = '', source = '', query = '', limit = 60, refreshing = false, refreshAgain = false, done = 0, total = 0, renderTimer;
const shortNames = {'regional': 'Seattle & regional', 'neighborhoods': 'Seattle neighborhoods', 'eastside': 'Eastside', 'north-sound': 'North Sound', 'south-sound': 'South Sound', 'statewide': 'Washington state', 'transport': 'Transit & urbanism', 'culture': 'Food, culture & history', 'commentary': 'Commentary & advocacy', 'official': 'Government & services', 'community': 'Community organizations', 'satire': 'Satire', 'bluesky': 'Bluesky'};

function notice(message) {$('#notice').textContent = message; $('#notice').hidden = !message;}
function sourceName(article) {return feedMap.get(article.feedIds[0])?.name || article.sourceName || 'Previously saved source';}
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
}

function renderProgress() {
  const failures = selectedFeeds().filter(feed => health.get(feed.id)?.error).length;
  const node = $('#feed-progress');
  node.replaceChildren();
  if (refreshing) node.append(el('span', 'refresh-status', `Checking feeds · ${done} of ${total}`));
  else node.append(el('span', '', 'Updates are checked at most every 15 minutes per feed.'));
  if (failures) node.append(button(`${failures} feed${failures === 1 ? '' : 's'} unavailable · View sources`, 'text-button status-link', () => {view = 'sources'; render();}));
}

function storyCard(article, index) {
  const state = states.get(article.id) || {};
  const card = el('article', `story ${state.read ? 'is-read' : ''}`);
  const number = el('span', 'story-number', String(index + 1).padStart(2, '0'));
  number.setAttribute('aria-hidden', 'true');
  const body = el('div', 'story-copy');
  const metadata = el('div', 'story-meta');
  metadata.append(el('span', 'publisher', sourceName(article)), el('span', 'meta-dot', '·'));
  const time = el('time', '', dateLabel(article.published));
  if (article.published) time.dateTime = new Date(article.published).toISOString();
  metadata.append(time);
  if (!state.read) metadata.append(el('span', 'unread-dot', 'Unread'));
  const title = el('h2');
  const open = button(article.title || 'Untitled story', 'story-title', () => openArticle(article));
  open.dataset.story = article.id; title.append(open);
  const categoryId = feedMap.get(article.feedIds[0])?.category;
  const footer = el('div', 'story-foot');
  footer.append(el('span', `category-tag category-${categoryId}`, shortNames[categoryId] || 'From your library'));
  if (article.url) {
    const publisher = external(categoryId === 'bluesky' ? 'View on Bluesky ↗' : 'Read at publisher ↗', article.url, 'publisher-link');
    publisher.addEventListener('click', () => setState(article.id, {read: true}));
    footer.append(publisher);
  }
  body.append(metadata, title);
  if (article.excerpt || categoryId !== 'bluesky') body.append(el('p', 'excerpt', article.excerpt || 'Open the story for the publisher’s feed preview.'));
  body.append(footer);
  const actions = el('div', 'story-actions');
  const saved = button(state.saved ? '◆' : '◇', `save-button ${state.saved ? 'is-saved' : ''}`, async () => {await setState(article.id, {saved: !states.get(article.id)?.saved});});
  saved.setAttribute('aria-label', `${state.saved ? 'Unsave' : 'Save'} ${article.title}`); saved.setAttribute('aria-pressed', String(Boolean(state.saved))); saved.title = state.saved ? 'Remove saved story' : 'Save story'; saved.dataset.save = article.id;
  const read = button(state.read ? 'Read' : 'Mark read', 'read-button', () => setState(article.id, {read: !states.get(article.id)?.read}));
  read.setAttribute('aria-label', `${state.read ? 'Mark unread' : 'Mark read'}: ${article.title}`);
  actions.append(saved, read); card.append(number, body, actions); return card;
}

function sourceCard(feed) {
  const status = health.get(feed.id);
  const card = el('article', 'source-card');
  const top = el('div', 'source-top');
  top.append(el('span', 'category-tag', shortNames[feed.category]), el('span', `source-status ${status?.error ? 'error' : ''}`, status?.error ? 'Unavailable' : status?.lastSuccess ? 'Connected' : 'Not checked yet'));
  const title = el('h2'); title.append(external(feed.name, feed.website));
  card.append(top, title, el('p', '', feed.description));
  const detail = status?.error ? `${status.error} ${status.lastSuccess ? `Last loaded ${dateLabel(status.lastSuccess, true)}.` : 'Visit the publisher while its feed is unavailable.'}` : status?.lastSuccess ? `Last loaded ${dateLabel(status.lastSuccess, true)} · ${status.items} stories in feed` : 'Refresh to check this feed.';
  card.append(el('p', 'source-detail', detail));
  const links = el('div', 'source-links');
  links.append(button('View stories →', 'text-button', () => {source = feed.id; category = ''; view = 'all'; query = ''; $('#search').value = ''; limit = 60; render(); refreshFeeds();}), external('Website ↗', feed.website), external('RSS ↗', feed.feed));
  card.append(links); return card;
}

function render() {
  if (!catalog) return;
  const focus = document.activeElement;
  const focusKey = focus?.dataset.save || focus?.dataset.story;
  const focusKind = focus?.dataset.save ? 'save' : 'story';
  const categoryInfo = categoryMap.get(category);
  const feedInfo = feedMap.get(source);
  const titles = {all: 'Around the Sound.', unread: 'A fresh perspective.', saved: 'Worth coming back to.', sources: 'The local voices.'};
  $('#heading').textContent = feedInfo?.name || categoryInfo?.title || titles[view];
  $('#heading-kicker').textContent = {all: 'THE LOCAL PICTURE', unread: 'YOUR UNREAD STORIES', saved: 'YOUR SAVED STORIES', sources: 'MEET THE COLLECTION'}[view];
  $('#description').textContent = feedInfo?.description || categoryInfo?.description || {all: 'The latest from your corner of the Northwest.', unread: 'Stories you haven’t opened yet, newest first.', saved: 'Your reading list, kept right here in this browser.', sources: 'Independent reporting, neighborhood notes, and perspectives from across Washington.'}[view];
  updateNavigation(); renderProgress();
  const container = $('#stories'); container.className = view === 'sources' ? 'source-grid' : '';
  container.replaceChildren();
  if (view === 'sources') {
    const sources = selectedFeeds(true).filter(feed => !query || `${feed.name} ${feed.description}`.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
    $('#result-label').textContent = `${sources.length} curated feed${sources.length === 1 ? '' : 's'}`;
    container.append(...sources.map(sourceCard));
    if (!sources.length) showEmpty('No sources match.', 'Try another search or clear the section filter.');
    $('#load-more').hidden = true;
  } else {
    const list = filteredArticles();
    const social = category === 'bluesky' || feedInfo?.category === 'bluesky';
    $('#result-label').textContent = `${list.length.toLocaleString()} ${view === 'saved' ? 'saved ' : ''}${social ? `post${list.length === 1 ? '' : 's'}` : `stor${list.length === 1 ? 'y' : 'ies'}`} · Newest first`;
    container.append(...list.slice(0, limit).map(storyCard));
    if (!list.length) {
      const title = refreshing ? 'Gathering the local picture…' : view === 'saved' ? 'Keep a story for later.' : view === 'unread' && articles.size ? 'You’re caught up.' : 'A little quiet here.';
      const description = refreshing ? 'Stories appear as each publisher’s feed arrives.' : view === 'saved' ? 'Choose the diamond beside any story to save it here.' : query ? 'Try another search or clear your filters.' : 'Try Refresh or browse the source directory. Some publishers may be temporarily unavailable.';
      showEmpty(title, description);
    }
    $('#load-more').hidden = list.length <= limit;
    $('#mark-read').disabled = !list.some(article => !states.get(article.id)?.read);
  }
  if (focusKey) [...container.querySelectorAll(`[data-${focusKind}]`)].find(node => node.dataset[focusKind] === focusKey)?.focus({preventScroll: true});
}

function showEmpty(title, description) {
  const empty = el('div', 'empty-state'); empty.append(el('span', 'empty-symbol', '≈'), el('h2', '', title), el('p', '', description));
  $('#stories').append(empty);
}

function scheduleRender() {if (!renderTimer) renderTimer = setTimeout(() => {renderTimer = null; render();}, 350);}
async function setState(id, changes) {
  const state = {...states.get(id), id, ...changes}; states.set(id, state); await save('state', [state]); render();
}

function openArticle(article) {
  setState(article.id, {read: true});
  const body = $('#article-body'); body.replaceChildren();
  const metadata = el('p', 'article-meta', `${sourceName(article)} · ${dateLabel(article.published, true)}`);
  const title = el('h2', 'article-title', article.title); title.id = 'article-title';
  const actions = el('div', 'article-links');
  if (article.url) actions.append(external(feedMap.get(article.feedIds[0])?.category === 'bluesky' ? 'View on Bluesky ↗' : 'Read at publisher ↗', article.url, 'primary-button'));
  const saved = button(states.get(article.id)?.saved ? 'Saved ◆' : 'Save story ◇', 'secondary-button', async () => {await setState(article.id, {saved: !states.get(article.id)?.saved}); saved.textContent = states.get(article.id)?.saved ? 'Saved ◆' : 'Save story ◇';});
  actions.append(saved);
  const content = el('div', 'article-content'); content.append(articleContent(article.html, article.url || feedMap.get(article.feedIds[0])?.website));
  if (!content.textContent.trim()) content.append(el('p', '', 'This feed includes a headline only. Visit the publisher to read the story.'));
  body.append(metadata, title, actions, content, el('p', 'feed-note', 'This is the content supplied in the publisher’s feed. Visit the original story for updates, images, and the full article.'));
  $('#article-dialog').showModal(); $('#article-dialog').scrollTop = 0;
}

async function fetchFeed(feed) {
  const previous = health.get(feed.id) || {id: feed.id};
  try {
    const response = await fetch(`${__PROXY_URL__}/feed/${feed.id}`, {signal: AbortSignal.timeout(22000), credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) {
      const info = await response.json().catch(() => ({}));
      throw new Error(info.error || `Feed relay returned HTTP ${response.status}.`);
    }
    const fresh = normalizeFeed(await response.text(), feed);
    const merged = fresh.map(item => {
      const existing = articles.get(item.id);
      const title = cleanText(item.title);
      const text = cleanText(item.html);
      const excerpt = feed.category === 'bluesky' && text.startsWith(title) ? text.slice(title.length).trim() : text;
      const article = {...item, firstSeen: existing?.firstSeen || item.firstSeen, feedIds: [...new Set([...(existing?.feedIds || []), feed.id])], sourceName: existing?.sourceName || feed.name, title, excerpt: excerpt.slice(0, 260)};
      articles.set(article.id, article); return article;
    });
    await save('articles', merged);
    const current = {id: feed.id, lastSuccess: Date.now(), nextCheck: nextRefresh(), failures: 0, items: fresh.length};
    health.set(feed.id, current); await save('feeds', [current]);
  } catch (error) {
    const failures = (previous.failures || 0) + 1;
    const message = error.name === 'TimeoutError' ? 'The feed took too long to respond.' : error instanceof TypeError ? 'The feed relay could not be reached.' : error.message;
    const current = {...previous, id: feed.id, failures, nextCheck: nextRefresh(failures), error: message.slice(0, 200)};
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

async function refreshFeeds() {
  if (!catalog) return;
  if (refreshing) {refreshAgain = true; return;}
  if (!navigator.onLine) {notice('You’re offline. Previously loaded stories are still available.'); return;}
  const queue = selectedFeeds().filter(feed => !health.get(feed.id)?.nextCheck || health.get(feed.id).nextCheck <= Date.now());
  if (!queue.length) {$('#feed-progress').replaceChildren(el('span', '', 'Feeds were checked recently. Refresh is available after their 15-minute freshness window; unavailable feeds wait longer.')); return;}
  refreshing = true; done = 0; total = queue.length;
  $('#refresh').disabled = true; $('#refresh').textContent = '↻ Refreshing'; render();
  // Multiple tabs share a lock and re-read timestamps to avoid duplicate full refreshes.
  const run = async () => {
    const library = await openLibrary(notice);
    for (const item of library.articles) if (!articles.has(item.id)) articles.set(item.id, item);
    for (const item of library.state) if (!states.has(item.id)) states.set(item.id, item);
    for (const item of library.feeds) if ((item.nextCheck || 0) > (health.get(item.id)?.nextCheck || 0)) health.set(item.id, item);
    await inBatches(queue, async feed => {if ((health.get(feed.id)?.nextCheck || 0) <= Date.now()) await fetchFeed(feed); else done++;});
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
  $('#feed-count').textContent = catalog.feeds.length; $('#sources-count').textContent = catalog.feeds.length;
  for (const section of catalog.categories) {
    const node = button('', '', () => {category = category === section.id ? '' : section.id; source = ''; limit = 60; render(); if (category === 'bluesky' && view !== 'sources') refreshFeeds();});
    node.dataset.category = section.id;
    node.append(el('span', '', shortNames[section.id] || section.title), el('span', 'count', catalog.feeds.filter(feed => feed.category === section.id).length));
    $('#categories').append(node);
  }
  for (const feed of [...catalog.feeds].sort((a, b) => a.name.localeCompare(b.name))) {const option = el('option', '', feed.name); option.value = feed.id; $('#source-filter').append(option);}
  for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', () => {view = node.dataset.view; limit = 60; render(); if (view !== 'sources' && view !== 'saved' && (category === 'bluesky' || feedMap.get(source)?.category === 'bluesky')) refreshFeeds();});
  $('#clear-section').addEventListener('click', () => {category = ''; source = ''; limit = 60; render();});
  $('#source-filter').addEventListener('change', event => {source = event.target.value; category = ''; limit = 60; render(); if (feedMap.get(source)?.category === 'bluesky' && view !== 'sources') refreshFeeds();});
  $('#search').addEventListener('input', event => {query = event.target.value.toLocaleLowerCase().trim(); limit = 60; render();});
  $('#refresh').addEventListener('click', refreshFeeds);
  $('#load-more').addEventListener('click', () => {limit += 60; render();});
  $('#mark-read').addEventListener('click', async () => {
    const updates = filteredArticles().map(article => ({...states.get(article.id), id: article.id, read: true}));
    for (const state of updates) states.set(state.id, state);
    await save('state', updates); render();
  });
}

$('#edition-date').textContent = new Intl.DateTimeFormat('en-US', {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'}).format(new Date());
$('#refresh').setAttribute('aria-label', 'Refresh');
$('#about-button').addEventListener('click', () => $('#about-dialog').showModal());
for (const node of document.querySelectorAll('[data-close]')) node.addEventListener('click', () => document.getElementById(node.dataset.close).close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {if (event.target === dialog) {const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();}});
$('#mobile-filter').addEventListener('click', () => {const open = $('#mobile-filter').getAttribute('aria-expanded') !== 'true'; $('#mobile-filter').setAttribute('aria-expanded', String(open)); $('.sidebar').classList.toggle('expanded', open);});
window.addEventListener('offline', () => notice('You’re offline. Previously loaded stories are still available.'));
window.addEventListener('online', () => {notice('Connection restored. Choose Refresh to check for new stories.');});

$('#export-state').addEventListener('click', () => {
  const backup = {format: 'sound-and-state', version: 1, exportedAt: new Date().toISOString(), state: [...states.values()], savedArticles: [...articles.values()].filter(article => states.get(article.id)?.saved)};
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], {type: 'application/json'}));
  const link = el('a'); link.href = url; link.download = `sound-and-state-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    setupNavigation(); await prune(); render(); await refreshFeeds();
  } catch (error) {notice(error.message); $('#result-label').textContent = 'Collection unavailable'; showEmpty('The collection is taking a moment.', 'Try reloading, or use “Get the feeds” to read the collection in another reader.');}
}
start();
