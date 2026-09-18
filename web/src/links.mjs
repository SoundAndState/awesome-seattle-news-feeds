export function safeUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {return '';}
}

export function archiveUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return '';
  const article = new URL(safe);
  for (const key of [...article.searchParams.keys()]) if (/^utm_/i.test(key)) article.searchParams.delete(key);
  article.hash = '';
  return `https://ghostarchive.org/search?go=Go&term=${encodeURIComponent(article.href)}`;
}
