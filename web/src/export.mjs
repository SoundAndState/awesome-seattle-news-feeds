import {messages} from './localization.mjs';
import {dateIso} from './dates.mjs';

export function articlesCsv(rows) {
  const cell = value => {
    let text = String(value ?? '');
    // Feed text is untrusted; prevent spreadsheet applications interpreting it as a formula.
    if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const values = [[messages.exports.title, messages.exports.source, messages.common.published, messages.common.url, messages.exports.content, messages.common.read, messages.common.updated], ...rows.map(row => [row.title, row.source, dateIso(row.published, row.publishedDateOnly), row.url, row.content, row.read ? messages.exports.yes : messages.exports.no, dateIso(row.updated, row.updatedDateOnly)])];
  return '\uFEFF' + values.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
