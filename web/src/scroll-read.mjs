export function scrollReader(container, onRead) {
  let enabled = false, lastY = window.scrollY, positions = new Map(), frame;
  function snapshot() {
    return new Map([...container.querySelectorAll('.story')].map(card => {
      const {top, bottom} = card.getBoundingClientRect();
      return [card.dataset.article, {card, top, bottom}];
    }));
  }
  function sync() {lastY = window.scrollY; positions = enabled ? snapshot() : new Map();}
  function check() {
    frame = null;
    const current = snapshot(), delta = window.scrollY - lastY;
    const ids = [];
    if (delta > 0 && !document.hidden && !document.querySelector('dialog[open]')) {
      for (const [id, now] of current) {
        const before = positions.get(id);
        // Only mark cards that were visible and crossed the top through scrolling, not a layout change.
        if (before && before.top < innerHeight && before.bottom > 0 && now.bottom <= 0 && Math.abs(before.bottom - delta - now.bottom) < 2 && !now.card.classList.contains('is-read')) ids.push(id);
      }
    }
    positions = current; lastY = window.scrollY;
    if (ids.length) onRead(ids);
  }
  window.addEventListener('scroll', () => {if (enabled && !frame) frame = requestAnimationFrame(check);}, {passive: true});
  window.addEventListener('resize', sync);
  document.addEventListener('visibilitychange', sync);
  return {sync, setEnabled(value) {enabled = value; sync();}};
}
