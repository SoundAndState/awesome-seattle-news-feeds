const compactDate = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', year:'numeric'});
const dateOnly = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
const fullDate = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});

export function validTimestamp(value) {
  return Number.isFinite(value) && value > 0 && value <= 8640000000000000;
}

function firstDate(values, now) {
  for (const raw of values.flat()) {
    if (typeof raw !== 'string' && !(raw instanceof Date)) continue;
    const timestamp = Date.parse(raw);
    if (validTimestamp(timestamp) && timestamp <= now + 86400000) {
      return {timestamp, dateOnly: typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())};
    }
  }
  return {timestamp:0, dateOnly:false};
}

export function feedDates(item, now) {
  const published = firstDate([item.pubDate, item.published, item.date_published, item.atom?.published, item.dcterms?.issued, item.prism?.publicationDate, item.dc?.dates, item.dc?.date, item.dcterms?.dates], now);
  const updated = firstDate([item.updated, item.date_modified, item.atom?.updated, item.dcterms?.modified], now);
  return {published:published.timestamp, publishedDateOnly:published.dateOnly, updated:updated.timestamp, updatedDateOnly:updated.dateOnly};
}

export function dateLabel(timestamp, full = false, onlyDate = false) {
  if (!validTimestamp(timestamp)) return 'No date in feed';
  return (onlyDate ? dateOnly : full ? fullDate : compactDate).format(timestamp);
}

export function dateIso(timestamp, onlyDate = false) {
  if (!validTimestamp(timestamp)) return '';
  const iso = new Date(timestamp).toISOString();
  return onlyDate ? iso.slice(0, 10) : iso;
}
