export const escapeHtml = text => text.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
export const textHtml = text => `<p>${escapeHtml(text).replace(/\r?\n/g, '<br>')}</p>`;

export function postHeadline(text) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const preview = [...normalized].slice(0, 160).join('');
  return (preview.length < normalized.length ? preview.replace(/\s+\S*$/, '') : preview) || 'Untitled post';
}
