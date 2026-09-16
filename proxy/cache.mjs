export const CACHE_SECONDS = 900;

export function cacheSeconds(headers, now = Date.now(), cap = CACHE_SECONDS) {
  const policy = headers.get('cache-control') || '';
  if (/\b(private|no-store|no-cache)\b/i.test(policy) || headers.get('vary')?.includes('*')) return 0;
  // Public responses may set an incidental cookie. No cookies are sent upstream or
  // returned to readers; require explicit shared caching permission before storing these.
  if (headers.has('set-cookie') && !/(?:^|,)\s*(?:public\s*(?:,|$)|s-maxage\s*=)/i.test(policy)) return 0;
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
  return Number.isFinite(age) ? Math.max(0, Math.floor(Math.min(cap, lifetime - age))) : 0;
}

export function cachePolicy(headers, now = Date.now()) {
  const seconds = cacheSeconds(headers, now);
  return seconds ? `public, max-age=${seconds}` : 'no-store';
}
