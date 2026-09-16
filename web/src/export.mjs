export function articlesCsv(rows) {
  const cell = value => {
    let text = String(value ?? '');
    // Feed text is untrusted; prevent spreadsheet applications interpreting it as a formula.
    if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const values = [['Title', 'Source', 'Published', 'URL', 'Content', 'Read'], ...rows.map(row => [row.title, row.source, row.published ? new Date(row.published).toISOString() : '', row.url, row.content, row.read ? 'Yes' : 'No'])];
  return '\uFEFF' + values.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
