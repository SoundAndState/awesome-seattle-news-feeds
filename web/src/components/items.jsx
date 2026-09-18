import {memo, useLayoutEffect, useRef} from 'react';
import {safeUrl, archiveUrl} from '../links.mjs';
import {cleanText, articleContent} from '../content.mjs';
import {dateLabel, dateIso, validTimestamp} from '../dates.mjs';
import {feedMode, itemMode} from '../reader-state.mjs';
import {sourceName} from '../reader-store.mjs';

export function ExternalLink({href, children, ...props}) {
  const url = safeUrl(href);
  return url ? <a {...props} href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <span className={props.className}>{children}</span>;
}

export function Icon({name}) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${name}-icon`}><path d={name === 'bookmark' ? 'M6 3h12v18l-6-4-6 4z' : 'm5 12 4 4L19 6'}/></svg>;
}

export function SaveButton({item, saved, actions}) {
  return <button className={`save-button${saved ? ' is-saved' : ''}`} data-save={item.id} aria-pressed={Boolean(saved)} aria-label={`${saved ? 'Saved' : 'Save'} ${item.title || 'Untitled article'}${saved ? '; remove from Saved' : ''}`} onClick={() => actions.toggleSaved(item.id)}><Icon name="bookmark"/><span>{saved ? 'Saved' : 'Save'}</span></button>;
}

function ItemDates({item}) {
  const fields = ['published', 'updated'].filter(field => validTimestamp(item[field]));
  return <span className="story-dates">{fields.length ? fields.map(field => {
    const label = dateLabel(item[field], true, item[`${field}DateOnly`]);
    return <span className={`story-${field}`} key={field}>{field === 'published' ? 'Published' : 'Updated'} <time dateTime={dateIso(item[field], item[`${field}DateOnly`])} title={label}>{label}</time></span>;
  }) : 'No date in feed'}</span>;
}

export function categoryName(id, state) {
  return state.categoryMap.get(id)?.shortTitle || state.categoryMap.get(id)?.title || id;
}

export function ItemMetadata({item, state, className, preview = false}) {
  const feed = state.feedMap.get(item.feedIds[0]), read = state.states.get(item.id)?.read;
  const category = item.feedIds.map(id => state.feedMap.get(id)?.category).find(Boolean);
  const classification = state.categoryMap.get(category)?.label || {satire: 'Satire', commentary: 'Commentary & advocacy', official: 'Official information'}[category];
  return <div className={`${className} article-metadata`}>
    <div className="article-attribution">
      {feed ? <button className="publisher" onClick={() => state.navigate({mode: feedMode(feed), view: 'sources', source: feed.id, category: '', query: '', unavailableOnly: false})}>{sourceName(item, state)}</button> : <span className="publisher">{sourceName(item, state)}</span>}
      {classification && <span className={`category-tag category-${category}`}>{classification}</span>}
      {item.author && <span className="author">By {cleanText(item.author)}</span>}
      {preview && <span className="article-read-status">{read ? 'Read' : 'Unread'}</span>}
    </div>
    <div className="date-line"><span className={`read-dot${read ? '' : ' unread-dot'}`} aria-label={read ? 'Read' : 'Unread'}>{read ? 'Read' : 'Unread'}</span><ItemDates item={item}/></div>
  </div>;
}

export function ItemLinks({item, state, site}) {
  if (!safeUrl(item.url)) return null;
  const feed = state.feedMap.get(item.feedIds[0]);
  const label = itemMode(item, state.feedMap) === 'posts' ? (feed?.platform === 'bluesky' || feed?.category === 'bluesky' || item.id.startsWith('at://') ? 'View on Bluesky' : 'View original post') : 'Read at publisher';
  const markRead = () => state.setItemState(item.id, {read: true});
  return <><ExternalLink className="publisher-link" href={item.url} onClick={markRead}>{label} ↗︎</ExternalLink>{site.capabilities.archive && <ExternalLink className="publisher-link archive-link" href={archiveUrl(item.url)} onClick={markRead}>Find archived page ↗︎</ExternalLink>}</>;
}

export const StoryCard = memo(function StoryCard({item, state, site}) {
  const saved = state.states.get(item.id)?.saved, read = state.states.get(item.id)?.read;
  const social = itemMode(item, state.feedMap) === 'posts';
  const rawText = social ? cleanText(item.html) : '';
  const text = rawText.replace(/\[contains quote post or other embedded content\]/gi, '').trim();
  const expanded = state.expandedPosts.has(item.id);
  const postProps = {className: `post-text${!expanded && text.length > 320 ? ' collapsed' : ''}`, 'data-story': item.id};
  return <article className={`story ${social ? 'post' : 'article-card'}${read ? ' is-read' : ''}`} data-article={item.id} aria-label={social ? `Post by ${sourceName(item, state)}` : undefined}>
    <div className="story-copy">
      {!social && <h2><button className="story-title" data-story={item.id} aria-label={`Preview article: ${item.title || 'Untitled article'}`} aria-haspopup="dialog" aria-controls="article-dialog" onClick={() => state.navigate({article: item.id, limit: state.route.limit}, {keepScroll: true})}><span className="headline-text">{item.title || 'Untitled article'}</span></button></h2>}
      <ItemMetadata item={item} state={state} className="story-meta"/>
      {social ? <>
        {safeUrl(item.url) ? <ExternalLink {...postProps} href={item.url} onClick={() => state.setItemState(item.id, {read: true})}>{text || item.title}</ExternalLink> : <p {...postProps}>{text || item.title}</p>}
        {text.length > 320 && <button className="text-button post-expand" data-expand={item.id} aria-expanded={expanded} onClick={() => state.toggleExpanded(item.id)}>{expanded ? 'Show less' : 'Show more'}</button>}
        {/\[contains quote post or other embedded content\]/i.test(rawText) && <p className="embed-note">Open the original post to see quoted posts and other embedded content.</p>}
      </> : item.excerpt && <p className="excerpt">{item.excerpt}</p>}
      <div className="article-footer"><div className="story-foot"><ItemLinks item={item} state={state} site={site}/></div><div className="story-actions">
        <SaveButton item={item} saved={saved} actions={state}/>
        <button className={`read-button${read ? ' is-read' : ''}`} data-read={item.id} aria-pressed={Boolean(read)} aria-label={`${read ? 'Mark Unread' : 'Mark Read'}: ${item.title}`} onClick={() => state.toggleRead(item.id)}><Icon name="read"/><span>{read ? 'Mark Unread' : 'Mark Read'}</span></button>
      </div></div>
    </div>
  </article>;
}, (previous, next) => {
  // Feed progress changes the store but not existing cards. Compare every
  // presentation dependency, including the page limit captured by Preview.
  const id = next.item.id, before = previous.state, after = next.state;
  return previous.item === next.item && previous.site === next.site
    && before.feedMap === after.feedMap && before.categoryMap === after.categoryMap
    && before.states.get(id)?.saved === after.states.get(id)?.saved
    && before.states.get(id)?.read === after.states.get(id)?.read
    && before.expandedPosts.has(id) === after.expandedPosts.has(id)
    && before.route.limit === after.route.limit;
});

function friendlyError(error) {
  if (/403|denied/i.test(error)) return 'A server refused the feed request. Try opening the publisher’s website.';
  if (/challenge|browser check/i.test(error)) return 'The publisher asks for a browser check that the reader cannot complete. Open the publisher’s website to continue.';
  if (/timed out|too long|did not receive the feed in time/i.test(error)) return 'The reader did not receive the feed in time. Choose Retry to try again.';
  if (/Invalid feed|No stories|could not read the feed/i.test(error)) return 'The reader could not read this feed. You can still try opening the publisher’s website.';
  return 'The reader could not load this feed. Choose Retry to try again, or open the publisher’s website.';
}

export function SourceCard({feed, state}) {
  const status = state.health.get(feed.id), excluded = state.excluded.has(feed.id);
  if (!state.feedMap.has(feed.id)) return <article className="source-card"><h2>{feed.name}</h2><p>{feed.description}</p><button className="secondary-button" onClick={() => state.toggleExcluded(feed.id)}>Include source</button></article>;
  const cached = status?.lastSuccess && (status.error || status.transport === 'snapshot');
  return <article className="source-card">
    <div className="source-top"><span className="category-tag">{categoryName(feed.category, state)}</span><span className={`source-status${status?.error ? ' error' : ''}`}>{cached ? 'Using an earlier copy' : status?.error ? 'Unavailable' : status?.lastSuccess ? 'Available' : 'Waiting to check'}</span></div>
    <h2><ExternalLink href={feed.website}>{feed.name}</ExternalLink></h2><p>{feed.description}</p>
    {status?.error && <p className="source-detail">{friendlyError(status.error)}</p>}
    <p className="source-detail">{status?.lastSuccess ? `The reader last loaded ${status.items} items on ${dateLabel(status.lastSuccess, true)}.${status.transport === 'direct' ? ' Your browser connected directly to the publisher.' : ''}` : status?.error ? 'The reader has no earlier copy of this feed. Choose Visit website to read at the publisher.' : 'The reader has not loaded this feed yet. Choose Retry to load it now.'}</p>
    {status?.transport === 'snapshot' && <p className="source-detail">The reader is using a backup that a scheduled task collected on {dateLabel(status.fetchedAt || status.lastSuccess, true)}.</p>}
    {status?.error && <details><summary>Technical details</summary><p className="source-detail">{status.error}</p></details>}
    <div className="source-links"><button className="text-button" onClick={() => state.navigate({mode: feedMode(feed), view: 'all', source: feed.id, category: '', query: '', unavailableOnly: false})}>View items →</button><ExternalLink href={feed.website}>Visit website ↗︎</ExternalLink><ExternalLink href={feed.feed}>Open feed ↗︎</ExternalLink>
      {state.route.view !== 'excluded' && (status?.error || !status?.lastSuccess) && <button className="text-button" disabled={Boolean(state.session)} onClick={() => state.refresh({only: feed.id, retryFailed: true})}>Retry</button>}
      <button className="secondary-button" data-exclude={feed.id} aria-pressed={excluded} onClick={() => state.toggleExcluded(feed.id)}>{excluded ? 'Include source' : 'Exclude source'}</button>
    </div>
    {excluded && <p className="source-detail">Excluded from your feeds. Your saved items are still available, and you can still open this source directly.</p>}
  </article>;
}

// The only imperative content boundary: DOMPurify returns a safe fragment. React
// owns the container; publisher markup never becomes component props or events.
export function SafeContent({item, website}) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const fragment = articleContent(item.html, item.url || website);
    if (!fragment.textContent.trim()) {
      const paragraph = document.createElement('p');
      paragraph.textContent = 'The publisher includes only a headline in this feed. Visit the publisher to read the story.';
      fragment.append(paragraph);
    }
    ref.current.replaceChildren(fragment);
  }, [item.html, item.url, website]);
  return <div ref={ref} className="article-content"/>;
}
