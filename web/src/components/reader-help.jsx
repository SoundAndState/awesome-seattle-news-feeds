import {useRef} from 'react';
import {download} from '../ui-effects.mjs';

export function FeedListHelp({site}) {
  if (!site.opmlUrl) return <div className="feed-list-content"><h2 id="feed-list-title" tabIndex="-1">Feed list</h2><p>This collection does not provide a feed list download.</p></div>;
  return <><div className="feed-list-content">
<h2 id="feed-list-title" tabIndex="-1">Use these feeds in another reader</h2>
<p>Download the complete feed list, then import it into your RSS reader to follow these sources. The file uses OPML, a format for sharing lists of feeds.</p>
<h3>Follow your reader’s import guide</h3><p className="hint">These links open the reader’s own instructions in a new tab.</p>
<ul className="import-guides">
<li><a href="https://docs.feedly.com/article/51-how-to-import-opml-into-feedly" target="_blank" rel="noopener noreferrer">Feedly</a></li>
<li><a href="https://www.inoreader.com/help/basic/feeds-sources/can-i-import-feeds-from-another-rss-reader" target="_blank" rel="noopener noreferrer">Inoreader</a></li>
<li><a href="https://feedbin.com/help/how-to-subscribe/#opml-import" target="_blank" rel="noopener noreferrer">Feedbin</a></li>
<li><a href="https://docs.readwise.io/reader/docs/faqs/feed" target="_blank" rel="noopener noreferrer">Readwise Reader</a></li>
<li><a href="https://netnewswire.com/help/mac/6.1/en/import-opml.html" target="_blank" rel="noopener noreferrer">NetNewsWire (Mac)</a></li>
<li><a href="https://netnewswire.com/help/ios/6.0/en/import-opml.html" target="_blank" rel="noopener noreferrer">NetNewsWire (iPhone &amp; iPad)</a></li>
</ul>
<p className="hint">Use another reader? Look for “Import OPML” in its help and choose the downloaded <strong>feeds.opml</strong> file.</p>
</div><div className="feed-list-actions"><a className="primary-button" href={site.opmlUrl} download="feeds.opml">Download feed list (.opml) <svg className="resource-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v10m-4-4 4 4 4-4M3 14h10"/></svg></a></div></>;
}

export function AboutHelp({site, state}) {
  const fileRef = useRef(null);
  return <><div className="about-content">
<h2 id="about-title" tabIndex="-1">{site.name}</h2>
{site.about.purpose && <><h3>Why this reader exists</h3><p>{site.about.purpose}</p></>}
<h3>Privacy Statement</h3><ul>
<li>The reader does not set or read cookies, use analytics, or load fonts from other sites.</li>
<li>The reader keeps saved items, which items you have read, and preferences in this browser. It does not upload them or sync them between devices.</li>
<li>Clearing this site's browser data deletes your library and preferences. If browser storage is unavailable, you lose changes when you close or reload the page.</li>
<li>{site.about.hosting || 'The website host receives your IP address and page request when you open this reader.'}</li>
<li>{site.proxy ? 'The feed service receives your IP address and the feed you request. If it cannot deliver a feed, your browser may request it directly from the publisher. The publisher then receives your IP address and feed request.' : 'Your browser requests feeds directly from their publishers. Each publisher receives your IP address and feed request.'}</li>
<li>Feed requests send no cookies, login credentials, or address of the page you are viewing.</li>
<li>{site.capabilities.archive ? 'Publisher and archive links' : 'Publisher links'} open in a new tab. Those sites apply their own privacy policies and may use cookies.</li>
</ul>
<details><summary>How the reader connects and displays content</summary>
{site.about.serviceDetails && <p>{site.about.serviceDetails}</p>}
<p>{site.about.delivery || (site.proxy ? 'Your browser asks the feed service for each curated source. If that request fails, your browser tries to load the feed directly from its publisher.' : 'Your browser loads each curated feed directly from its publisher.')}</p>
<p>For that direct attempt to work, the publisher must allow other websites, including this reader, to read its feed in a browser. This permission is called cross-origin resource sharing (CORS). Without it, your browser blocks the reader from accessing the feed.</p>
<p>When this reader loads a feed, your browser does not save any cookies the publisher sends. The reader keeps track of which items you have read in this browser and never sends that information to a server. When you search or change views, the reader puts your selection after the <code>#</code> in the page address. Your browser does not send that part of the address to the site host.</p>
<p>The reader removes scripts, embedded pages, forms, and images from feed previews before showing them. Your browser also limits which scripts the reader can run and which sites it can contact.</p>
<p>When you follow a publisher link, your browser does not send the address of this reader to that site.</p>
{site.capabilities.archive && <p>Choose Find archived page to send the article address to Ghostarchive and look for a saved copy. Your browser does not send the address of this reader. The reader first removes tracking parameters whose names start with <code>utm_</code>. Ghostarchive may not have a copy.</p>}
</details>
<details><summary>How the reader refreshes and stores items</summary>
<p>While you view Articles or Posts, the reader checks the feeds that match your filters. It pauses those checks when you leave the tab and checks again when you return. After a feed loads successfully, the reader waits at least 15 minutes before checking it again. If a feed fails, the reader waits longer between attempts. Choose Refresh to retry failed feeds immediately.</p>
<p>When the reader finds new items while you are reading, it shows a button in the header. Choose that button to add the new items and return to the top of the list.</p>
<p>The reader checks your browser’s stored feeds before showing a progress bar. If feeds need checking, wait for “Ready to read” before you start reading. The bar counts completed checks, including feeds the reader could not load. It does not estimate how much time remains. The finished status stays in place until you choose Dismiss feed status or change views.</p>
<p>The reader keeps unsaved items for up to 30 days and up to 150 items per feed. It keeps saved items until you remove them or clear this site's browser data.</p>
{site.proxy && site.about.cache && <p>{site.about.cache}</p>}
{site.proxy && site.about.snapshots && <p>{site.about.snapshots}</p>}
<p>The reader keeps a copy of the feed list in your browser so you can still browse your library if it cannot download the latest list. You need an internet connection to load new content, and the reader may not reopen while you are offline.</p>
<p>The reader starts in Unread and marks articles as read when their titles pass behind the header. For posts, it waits until the post text passes behind the header. Turn off Mark items read as I scroll past them in Reading options if you prefer to mark them yourself. The reader remembers your choice and whether you last selected Latest or Unread.</p>
<p>Items stay in the Unread list after you open them or mark them as read. Choose Unread again, Refresh, or Show new articles or posts to rebuild the list. Changing views, filters, or search also rebuilds it.</p>
</details>
<h3>Choose what you see</h3><p>Choose Auto, Light, or Dark in the Theme menu. Auto follows your device’s appearance. Select a publisher’s name to see its details and exclude that source from your feeds. Open Excluded sources in the menu to include it again. Saved items remain available, and you can still browse an excluded source directly.</p>
{site.capabilities.backups && <><h3>Back up your library</h3><p>Choose Export reading backup to download a JSON file with your saved articles and posts and a record of which items you have read. Choose Restore backup to add items from a backup and combine its read and saved marks with your current library. Restore backup accepts backups from this collection. You can also choose Export saved items as CSV on the Saved page to download all your saved items for a spreadsheet.</p><div className="backup-actions"><button id="export-state" className="secondary-button" onClick={async () => download(await state.exportBackup())}>Export reading backup</button><button id="import-state" className="secondary-button" onClick={() => fileRef.current.click()}>Restore backup</button><input ref={fileRef} onChange={async event => {const input = event.currentTarget; if (input.files[0]) await state.importBackup(input.files[0]); input.value = '';}} id="backup-file" type="file" accept="application/json,.json" hidden/></div><p id="backup-status" role="status">{state.backupStatus}</p></>}<p><a href="./third-party-notices.txt">Software credits</a></p>
</div></>;
}
