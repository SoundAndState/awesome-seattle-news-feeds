"""Live feed health audit; separate from deterministic pull-request validation."""
import argparse
import concurrent.futures
import datetime as dt
import email.utils
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
UTC = dt.timezone.utc
MAX_BYTES = 5_000_000
AGENT = 'Mozilla/5.0 (compatible; SeattleFeedDirectory/1.0; +https://github.com/sayhiben/awesome-seattle-news-feeds)'


def local(tag):
    return tag.rsplit('}', 1)[-1]


def parse_date(value):
    if not value:
        return None
    try:
        result = email.utils.parsedate_to_datetime(value)
    except (ValueError, TypeError):
        try:
            result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    return result.replace(tzinfo=UTC) if result.tzinfo is None else result.astimezone(UTC)


def article_url(value):
    url = urllib.parse.urlsplit(value.strip())
    query = [(k, v) for k, v in urllib.parse.parse_qsl(url.query) if not k.lower().startswith('utm_')]
    return urllib.parse.urlunsplit(('https', url.netloc.lower().removeprefix('www.'), url.path.rstrip('/'), urllib.parse.urlencode(query), ''))


def inspect_xml(data, now, max_age_days):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('DTD/entity declarations are not supported')
    root = ET.fromstring(data)
    kind = local(root.tag)
    if kind == 'rss':
        channel = root.find('channel')
        if channel is None or channel.find('title') is None or not channel.findtext('link'):
            raise ValueError('RSS is missing channel/title/link elements')
        items = channel.findall('item')
    elif kind == 'feed' and root.tag == '{http://www.w3.org/2005/Atom}feed':
        if not root.findtext('{http://www.w3.org/2005/Atom}title'):
            raise ValueError('Atom is missing feed/title')
        items = root.findall('{http://www.w3.org/2005/Atom}entry')
    elif kind == 'RDF':
        items = [child for child in root if local(child.tag) == 'item']
    else:
        raise ValueError('Response is not an RSS or Atom feed')
    if not items:
        raise ValueError('Feed contains no entries')
    dates, links = [], []
    for item in items:
        if not any(local(child.tag) in ('title', 'description', 'summary', 'content') and child.text for child in item):
            raise ValueError('Entry has no title or content')
        for child in item:
            if local(child.tag) in ('pubDate', 'published', 'updated', 'date'):
                date = parse_date(child.text)
                if date:
                    dates.append(date)
            if local(child.tag) == 'link' and child.get('rel', 'alternate') == 'alternate':
                value = child.text or child.get('href', '')
                if value.startswith(('http://', 'https://')):
                    links.append(article_url(value))
    result = {'format': 'Atom' if kind == 'feed' else 'RSS', 'items': len(items), 'articleUrls': sorted(set(links))}
    if kind == 'rss' and not channel.findtext('title'):
        result['warnings'] = ['Publisher channel title is empty; the OPML supplies a subscription name']
    if not dates:
        result['error'] = 'No parseable entry dates; freshness needs manual review'
    else:
        latest = max(dates)
        result['latestEntry'] = latest.isoformat()
        age = (now - latest).days
        if age > max_age_days:
            result['error'] = f'Latest entry is {age} days old (limit {max_age_days})'
        elif latest > now + dt.timedelta(days=2):
            result['error'] = 'Latest entry date is unexpectedly in the future'
    return result


def check(feed, max_age_days):
    result = {'id': feed['id'], 'url': feed['feed']}
    for attempt in range(2):
        try:
            request = urllib.request.Request(feed['feed'], headers={'User-Agent': AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9'})
            with urllib.request.urlopen(request, timeout=20) as response:
                result.update(httpStatus=response.status, finalUrl=response.url,
                              contentType=response.headers.get('Content-Type', ''))
                data = response.read(MAX_BYTES + 1)
            result['responseBytes'] = len(data)
            if result['httpStatus'] != 200:
                raise ValueError(f"HTTP {result['httpStatus']} returned instead of a feed response; access needs review from this network")
            if not data.strip():
                raise ValueError('Publisher returned an empty HTTP 200 response')
            if len(data) > MAX_BYTES:
                raise ValueError('Response exceeds 5 MB')
            result.update(inspect_xml(data, dt.datetime.now(UTC), max_age_days))
            if result['format'] != feed['format']:
                result['error'] = f"Format changed: expected {feed['format']}, received {result['format']}"
            break
        except Exception as error:
            if attempt == 0:
                time.sleep(1)
            else:
                result['error'] = str(error)
    result['status'] = 'failed' if 'error' in result else 'ok'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', help='Check one feed ID')
    parser.add_argument('--output', default='reports/feed-health.json')
    parser.add_argument('--max-age-days', type=int, default=365)
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'data' / 'feeds.json').read_text(encoding='utf-8'))
    feeds = [feed for feed in catalog['feeds'] if not args.only or feed['id'] == args.only]
    if not feeds:
        parser.error('No matching feeds')
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda feed: check(feed, args.max_age_days), feeds))
    duplicates = []
    for i, left in enumerate(results):
        for right in results[i + 1:]:
            a, b = set(left.get('articleUrls', [])), set(right.get('articleUrls', []))
            same_target = left.get('finalUrl') and left.get('finalUrl') == right.get('finalUrl')
            if same_target or (len(a) >= 5 and a == b):
                duplicates.append([left['id'], right['id']])
    report = {'checkedAt': dt.datetime.now(UTC).isoformat(), 'results': results, 'possibleDuplicates': duplicates}
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    for result in results:
        print(f"{result['status'].upper()}: {result['id']} {result.get('error', '')}")
    for pair in duplicates:
        print('REVIEW DUPLICATE: ' + ', '.join(pair))
    failures = sum(result['status'] == 'failed' for result in results)
    summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary_path:
        lines = ['# Live feed health', '', f'{len(results)} feeds checked; {failures} failures; {len(duplicates)} possible duplicate pairs.', '',
                 'These are network checks, separate from README and OPML validation. A runner-specific response does not prove a feed is unavailable to readers. Download the feed-health artifact for details.', '']
        for result in results:
            if result['status'] == 'failed':
                detail = result['error'].replace('<', '&lt;').replace('>', '&gt;').replace('\n', ' ')
                lines.append(f"- **{result['id']}**: {detail}")
        for pair in duplicates:
            lines.append('- Possible duplicate subscriptions: ' + ', '.join(pair))
        Path(summary_path).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{len(results)} checked; {failures} failures; {len(duplicates)} possible duplicate pairs. Report: {output}')
    raise SystemExit(1 if failures or duplicates else 0)


if __name__ == '__main__':
    main()
