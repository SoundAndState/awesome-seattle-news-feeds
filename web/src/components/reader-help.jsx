import {messages} from '../localization.mjs';
import {Message} from './message.jsx';
import {useRef} from 'react';
import {download} from '../ui-effects.mjs';

export function FeedListHelp({site}) {
  if (!site.opmlUrl) return <div className="feed-list-content"><h2 id="feed-list-title" tabIndex="-1">{messages.feedList.title}</h2><p>{messages.feedList.unavailable}</p></div>;
  return <><div className="feed-list-content">
<h2 id="feed-list-title" tabIndex="-1">{messages.feedList.heading}</h2>
<p>{messages.feedList.introduction}</p>
<h3>{messages.feedList.guidesHeading}</h3><p className="hint">{messages.feedList.guidesHint}</p>
<ul className="import-guides">
<li><a href="https://docs.feedly.com/article/51-how-to-import-opml-into-feedly" target="_blank" rel="noopener noreferrer">{messages.feedList.feedly}</a></li>
<li><a href="https://www.inoreader.com/help/basic/feeds-sources/can-i-import-feeds-from-another-rss-reader" target="_blank" rel="noopener noreferrer">{messages.feedList.inoreader}</a></li>
<li><a href="https://feedbin.com/help/how-to-subscribe/#opml-import" target="_blank" rel="noopener noreferrer">{messages.feedList.feedbin}</a></li>
<li><a href="https://docs.readwise.io/reader/docs/faqs/feed" target="_blank" rel="noopener noreferrer">{messages.feedList.readwise}</a></li>
<li><a href="https://netnewswire.com/help/mac/6.1/en/import-opml.html" target="_blank" rel="noopener noreferrer">{messages.feedList.netNewsWireMac}</a></li>
<li><a href="https://netnewswire.com/help/ios/6.0/en/import-opml.html" target="_blank" rel="noopener noreferrer">{messages.feedList.netNewsWireMobile}</a></li>
</ul>
<p className="hint"><Message message={messages.feedList.otherReader} values={{filename: <strong>feeds.opml</strong>}}/></p>
</div><div className="feed-list-actions"><a className="primary-button" href={site.opmlUrl} download="feeds.opml">{messages.feedList.download}{' '}<svg className="resource-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v10m-4-4 4 4 4-4M3 14h10"/></svg></a></div></>;
}

export function AboutHelp({site, state}) {
  const fileRef = useRef(null);
  return <><div className="about-content">
<h2 id="about-title" tabIndex="-1">{site.name}</h2>
{site.about.purpose && <><h3>{messages.help.purposeHeading}</h3><p>{site.about.purpose}</p></>}
<h3>{messages.help.privacyHeading}</h3><ul>
<li>{messages.help.cookies}</li>
<li>{messages.help.browserLibrary}</li>
<li>{messages.help.clearingStorage}</li>
<li>{site.about.hosting || messages.help.hosting}</li>
<li>{site.proxy ? messages.help.serviceRequests : messages.help.directRequests}</li>
<li>{messages.help.requestPrivacy}</li>
<li>{site.capabilities.archive ? messages.help.externalArchiveLinks : messages.help.externalPublisherLinks}</li>
</ul>
<details><summary>{messages.help.connectionsHeading}</summary>
{site.about.serviceDetails && <p>{site.about.serviceDetails}</p>}
<p>{site.about.delivery || (site.proxy ? messages.help.serviceDelivery : messages.help.directDelivery)}</p>
<p>{messages.help.cors}</p>
<p><Message message={messages.help.addressPrivacy} values={{hash: <code>#</code>}}/></p>
<p>{messages.help.sanitization}</p>
<p>{messages.help.publisherLinks}</p>
{site.capabilities.archive && <p><Message message={messages.help.archive} values={{prefix: <code>utm_</code>}}/></p>}
</details>
<details><summary>{messages.help.refreshHeading}</summary>
<p>{messages.help.refreshPolicy}</p>
<p>{messages.help.timeouts}</p>
<p>{messages.help.newItems}</p>
<p>{messages.help.progress}</p>
<p>{messages.help.retention}</p>
{site.proxy && site.about.cache && <p>{site.about.cache}</p>}
{site.proxy && site.about.snapshots && <p>{site.about.snapshots}</p>}
<p>{messages.help.offline}</p>
<p>{messages.help.scrollRead}</p>
<p>{messages.help.unreadRetention}</p>
</details>
<h3>{messages.help.appearanceHeading}</h3><p>{messages.help.appearance}</p>
<p>{messages.help.swipePreview}</p>
{site.capabilities.backups && <><h3>{messages.help.backupHeading}</h3><p>{messages.help.backups}</p><div className="backup-actions"><button id="export-state" className="secondary-button" onClick={async () => download(await state.exportBackup())}>{messages.backup.export}</button><button id="import-state" className="secondary-button" onClick={() => fileRef.current.click()}>{messages.backup.restore}</button><input ref={fileRef} onChange={async event => {const input = event.currentTarget; if (input.files[0]) await state.importBackup(input.files[0]); input.value = '';}} id="backup-file" type="file" accept="application/json,.json" hidden/></div><p id="backup-status" role="status">{state.backupStatus}</p></>}<p><a href="./third-party-notices.txt">{messages.help.credits}</a></p>
</div></>;
}
