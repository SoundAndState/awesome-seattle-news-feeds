import english from './locales/en.json' with {type: 'json'};

// English is the only shipped language. Keep copy in the catalog, not here.
export const messages = english;
const numbers = new Intl.NumberFormat(english.locale);
const plurals = new Intl.PluralRules(english.locale);

// Parts may be plain values or React elements supplied by the caller. Catalog
// text is never HTML and replacement values are never parsed a second time.
export function messageParts(template, values = {}) {
  if (typeof template !== 'string') throw new TypeError('Expected a message string.');
  return template.split(/(\{[a-zA-Z][a-zA-Z0-9_]*\})/g).map(part => {
    if (!/^\{[a-zA-Z][a-zA-Z0-9_]*\}$/.test(part)) return part;
    const key = part.slice(1, -1);
    if (!Object.hasOwn(values, key)) throw new Error(`Missing message value: ${key}`);
    return values[key];
  });
}

export function formatMessage(template, values) {
  return messageParts(template, values).join('');
}

export function countMessage(variants, count, values = {}) {
  return formatMessage(variants[plurals.select(count)] ?? variants.other, {...values, count: numbers.format(count)});
}
