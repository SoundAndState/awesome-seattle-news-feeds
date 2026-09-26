import {messages, formatMessage} from '../localization.mjs';
import {useLayoutEffect, useRef, useState} from 'react';
import {cleanText} from '../content.mjs';
import {itemMode, feedMode} from '../reader-state.mjs';
import {focusControl} from '../ui-effects.mjs';
import {dismissPreviewWithSwipe} from '../preview-swipe.mjs';
import {ExternalLink, ItemMetadata, ItemLinks, SaveButton, SafeContent, categoryName} from './items.jsx';
import {FeedListHelp, AboutHelp} from './reader-help.jsx';

export function Dialog({id, titleId, open, close, returnTo, initialFocus, children, className = '', swipeClose = false}) {
  const ref = useRef(null), returnRef = useRef(returnTo);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) {
      returnRef.current = id === 'filter-dialog' && document.activeElement?.id === 'menu-filter-button' ? {element: '#menu-filter-button'} : returnTo;
      dialog.showModal();
      dialog.querySelector(initialFocus || '.close-button')?.focus({preventScroll: true});
    } else if (!open && dialog.open) {
      dialog.close();
      focusControl(returnRef.current);
    }
  }, [open, returnTo, initialFocus]);
  useLayoutEffect(() => () => {if (ref.current?.open) ref.current.close();}, []);
  useLayoutEffect(() => {
    if (open && swipeClose) return dismissPreviewWithSwipe(ref.current, close);
  }, [open, swipeClose, close]);
  return <dialog id={id} ref={ref} className={className} aria-labelledby={titleId} onCancel={event => {event.preventDefault(); close();}} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const r = event.currentTarget.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
  }}>{children}</dialog>;
}

function CloseButton({label, close}) {
  return <button className="close-button" aria-label={label} onClick={close}>×</button>;
}

function FilterContent({state}) {
  const [search, setSearch] = useState('');
  const {mode, source, category, view} = state.route;
  const feeds = state.catalog?.feeds.filter(feed => feedMode(feed) === mode) || [];
  const shown = feeds.filter(feed => feed.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const select = changes => state.navigate({...changes, view: view === 'sources' ? 'all' : view, unavailableOnly: false}, {replace: true});
  const label = mode === 'posts' ? messages.filters.findAccount : messages.filters.findPublication;
  const categories = (state.catalog?.categories || []).filter(section => feeds.some(feed => feed.category === section.id));
  return <div className="filter-content">
    <button id="browse-sources" className="secondary-button" onClick={() => state.navigate({view: 'sources', source: '', category: '', query: '', unavailableOnly: false}, {replace: true})}>{formatMessage(messages.filters.browse, {kind: messages.kinds[mode === 'posts' ? 'accounts' : 'publications']})} <span id="sources-count" className="count">{feeds.length}</span></button>
    <section id="section-filter" hidden={mode === 'posts' && categories.length <= 1}><h3>{messages.common.sections}</h3><p className="hint">{messages.filters.sectionsHint}</p><nav id="categories" className="category-nav" aria-label={messages.common.sections}>{categories.map(section => <button key={section.id} data-category={section.id} aria-pressed={category === section.id} onClick={() => select({category: category === section.id ? '' : section.id, source: ''})}><span>{categoryName(section.id, state)}</span><span className="count">{feeds.filter(feed => feed.category === section.id).length}</span></button>)}</nav></section>
    <h3 id="source-picker-title">{mode === 'posts' ? messages.common.accounts : messages.common.publications}</h3><label className="search"><span className="sr-only" id="source-search-label">{label}</span><input id="source-search" type="search" placeholder={formatMessage(messages.search.placeholder, {label})} aria-labelledby="source-search-label" value={search} onChange={event => setSearch(event.target.value)}/></label>
    <div id="source-choices" className="source-choices">{shown.map(feed => <button key={feed.id} className="source-choice" data-source={feed.id} aria-pressed={source === feed.id} onClick={() => select({source: feed.id, category: ''})}>{feed.name}</button>)}</div><p id="source-choice-status" className="hint" role="status">{shown.length ? formatMessage(messages.filters.sourceCount, {count: shown.length, kind: messages.kinds[mode === 'posts' ? 'accounts' : 'publications']}) : messages.filters.noMatches}</p>
  </div>;
}

export function ReaderDialogs({state, site}) {
  const {route} = state;
  const item = state.articles.get(route.article);
  const social = item && itemMode(item, state.feedMap) === 'posts';
  const close = state.closeDialog;
  useLayoutEffect(() => {
    if (social) state.navigate({article: '', mode: 'posts', view: route.view === 'saved' ? 'saved' : 'all', savedKind: route.view === 'saved' ? 'posts' : route.savedKind, limit: route.limit}, {replace: true, keepScroll: true});
    else if (route.article && item && !state.states.get(item.id)?.read) state.setItemState(item.id, {read: true});
  }, [route.article, item?.id, social]);
  useLayoutEffect(() => {
    if (!route.article) return;
    const body = document.querySelector('#article-body');
    body.scrollTop = 0;
    document.querySelector('#article-title')?.focus({preventScroll: true});
  }, [route.article, item?.id]);
  return <>
    <Dialog id="filter-dialog" titleId="filter-title" open={route.filters} close={close} returnTo={{element: '#filter-button'}}>
      <div className="dialog-top"><h2 id="filter-title">{formatMessage(messages.filters.title, {kind: messages.kinds[route.mode]})}</h2><CloseButton label={messages.dialogs.closeFilters} close={close}/></div>
      {route.filters && <FilterContent state={state}/>}
    </Dialog>
    <Dialog id="article-dialog" titleId="article-title" open={Boolean(route.article) && !social} close={close} className="article-preview" initialFocus="#article-title" swipeClose returnTo={{kind: 'story', id: route.article, index: [...document.querySelectorAll('#stories .story')].findIndex(card => card.dataset.article === route.article)}}>
      <div className="dialog-top article-dialog-actions"><span className="preview-drag-handle" aria-hidden="true"/><span id="article-save" hidden={!item}>{item && <SaveButton item={item} saved={state.states.get(item.id)?.saved} actions={state}/>}</span><CloseButton label={messages.dialogs.closeStory} close={close}/></div>
      <div id="article-body">{item ? <>
        <h2 id="article-title" className="article-title" tabIndex={-1}><ExternalLink href={item.url}>{item.title || messages.common.untitledArticle}</ExternalLink></h2>
        <ItemMetadata item={item} state={state} className="article-meta" preview/>
        <div className="article-links"><ItemLinks item={item} state={state} site={site}/></div>
        <SafeContent item={item} website={state.feedMap.get(item.feedIds[0])?.website}/>
        <footer className="article-preview-footer">{cleanText(item.html).length >= 220 && <div className="article-links"><ItemLinks item={item} state={state} site={site}/></div>}<p className="feed-note">{messages.preview.partialFeed}</p></footer>
      </> : <><h2 id="article-title" className="article-title" tabIndex={-1}>{messages.preview.notFound}</h2><p>{messages.preview.notFoundHint}</p></>}</div>
    </Dialog>
    <Dialog id="feed-list-dialog" titleId="feed-list-title" open={route.feedList} close={close} initialFocus="#feed-list-title" returnTo={{element: '#feed-list-button'}}><div className="dialog-top"><span>{messages.common.downloadFeedList}</span><CloseButton label={messages.dialogs.closeFeedListGuide} close={close}/></div><FeedListHelp site={site}/></Dialog>
    <Dialog id="about-dialog" titleId="about-title" open={route.about} close={close} initialFocus="#about-title" returnTo={{element: '#about-button'}}><div className="dialog-top"><span>{messages.common.aboutThisReader}</span><CloseButton label={messages.dialogs.closeAbout} close={close}/></div><AboutHelp site={site} state={state}/></Dialog>
  </>;
}
