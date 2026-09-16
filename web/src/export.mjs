import {dateIso} from './dates.mjs';

export function articlesCsv(rows) {
  const cell = value => {
    let text = String(value ?? '');
    // Feed text is untrusted; prevent spreadsheet applications interpreting it as a formula.
    if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const values = [['Title', 'Source', 'Published', 'URL', 'Content', 'Read', 'Updated'], ...rows.map(row => [row.title, row.source, dateIso(row.published, row.publishedDateOnly), row.url, row.content, row.read ? 'Yes' : 'No', dateIso(row.updated, row.updatedDateOnly)])];
  return '\uFEFF' + values.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
