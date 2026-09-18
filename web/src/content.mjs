import DOMPurify from 'dompurify';
import {safeUrl} from './links.mjs';

export function cleanText(value) {
  const spaced = String(value || '').replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, ' ');
  const clean = DOMPurify.sanitize(spaced, {ALLOWED_TAGS: [], ALLOWED_ATTR: [], RETURN_DOM_FRAGMENT: true});
  return clean.textContent.replace(/\s+/g, ' ').trim();
}

export function articleContent(html, base) {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'a', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'hr', 'pre', 'code', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title'],
  });
  for (const link of fragment.querySelectorAll('a')) {
    const href = safeUrl(link.getAttribute('href'), base);
    if (href) {link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';}
    else link.removeAttribute('href');
  }
  return fragment;
}
