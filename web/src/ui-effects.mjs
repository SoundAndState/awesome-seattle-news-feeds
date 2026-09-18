export function download({content, type, filename}) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function focusControl(target) {
  if (!target) return;
  let element;
  if (target.element) element = document.querySelector(target.element);
  else {
    const controls = [...document.querySelectorAll(`#stories [data-${target.kind}]`)];
    element = controls.find(node => node.dataset[target.kind] === target.id);
    if (!element) {
      const rows = document.querySelector('#stories')?.children || [];
      element = rows[Math.max(0, Math.min(target.index, rows.length - 1))]?.querySelector('[data-story], [data-save]');
    }
  }
  if (element?.closest('#resource-menu') && matchMedia('(max-width: 760px)').matches) element = document.querySelector('#menu-toggle');
  if (element?.id === 'filter-button' && !element.getClientRects().length) element = document.querySelector('#menu-toggle');
  (element || document.querySelector('#stories .empty-state h2') || document.querySelector('#heading'))?.focus({preventScroll: true});
}

export function focusedItem() {
  const element = document.activeElement;
  const kind = ['save', 'read', 'story', 'expand', 'exclude'].find(key => element?.dataset[key]);
  if (!kind || element.closest('dialog')) return null;
  return {kind, id: element.dataset[kind], index: [...document.querySelector('#stories').children].indexOf(element.closest('.story'))};
}

// Native dialog handles keyboard containment. Prevent iOS single-finger panning
// from escaping a scrollable dialog when its content reaches either edge.
export function containDialogTouch() {
  let previous;
  const start = event => {previous = event.touches.length === 1 ? {x: event.touches[0].clientX, y: event.touches[0].clientY} : null;};
  const move = event => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog || !previous || event.touches.length !== 1) return;
    const touch = event.touches[0], dx = previous.x - touch.clientX, dy = previous.y - touch.clientY;
    previous = {x: touch.clientX, y: touch.clientY};
    for (let node = event.target; node instanceof Element && node !== dialog && dialog.contains(node); node = node.parentElement) {
      const style = getComputedStyle(node);
      if ((/auto|scroll/.test(style.overflowY) && ((dy < 0 && node.scrollTop > 0) || (dy > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1))) ||
        (/auto|scroll/.test(style.overflowX) && ((dx < 0 && node.scrollLeft > 0) || (dx > 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1)))) return;
    }
    if (event.cancelable) event.preventDefault();
  };
  document.addEventListener('touchstart', start, {passive: true});
  document.addEventListener('touchmove', move, {passive: false});
  return () => {document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move);};
}
