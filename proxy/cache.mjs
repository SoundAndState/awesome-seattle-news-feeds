export const CACHE_SECONDS = 900;

export function cacheSeconds(headers, now = Date.now()) {
  const policy = headers.get('cache-control') || '';
  if (/\b(private|no-store|no-cache)\b/i.test(policy) || headers.has('set-cookie') || headers.get('vary')?.includes('*')) return 0;
  const directive = name => {
    const values = [...policy.matchAll(new RegExp(`(?:^|,)\\s*${name}\\s*=\\s*([^,]+)`, 'gi'))];
    if (!values.length) return undefined;
    const value = values[0][1].trim().replace(/^"|"$/g, '');
    return values.length === 1 && /^\d+$/.test(value) ? Number(value) : 0;
  };
  // RFC 9111: s-maxage overrides max-age, which overrides Expires.
  const date = Date.parse(headers.get('date'));
  const expires = Date.parse(headers.get('expires'));
  const lifetime = directive('s-maxage') ?? directive('max-age') ?? (Number.isFinite(expires) ? (expires - (Number.isFinite(date) ? date : now)) / 1000 : CACHE_SECONDS);
  const age = Math.max(Number(headers.get('age') || 0), Number.isFinite(date) ? (now - date) / 1000 : 0, 0);
  return Number.isFinite(age) ? Math.max(0, Math.floor(Math.min(CACHE_SECONDS, lifetime - age))) : 0;
}

export function cachePolicy(headers, now = Date.now()) {
  const seconds = cacheSeconds(headers, now);
  return seconds ? `public, max-age=${seconds}` : 'no-store';
}
