export function scrollReader(container, onRead) {
  const headerHeight = () => document.querySelector('#reader-header')?.getBoundingClientRect().height || 0;
  let enabled = false, lastY = window.scrollY, lastHeaderHeight = headerHeight(), positions = new Map(), frame;
  function snapshot() {
    return new Map([...container.querySelectorAll('.story')].map(card => {
      const {top, bottom} = (card.querySelector('h2, .post-text') || card).getBoundingClientRect();
      return [card.dataset.article, {card, top, bottom}];
    }));
  }
  function sync() {lastY = window.scrollY; lastHeaderHeight = headerHeight(); positions = enabled ? snapshot() : new Map();}
  function check() {
    frame = null;
    const current = snapshot(), delta = window.scrollY - lastY;
    const height = headerHeight(), headerDelta = height - lastHeaderHeight;
    const ids = [];
    if (delta > 0 && !document.hidden && !document.querySelector('dialog[open]')) {
      for (const [id, now] of current) {
        const before = positions.get(id);
        // A title (or post text) must cross the visible reading edge through
        // scrolling. Header resizing and unrelated layout changes do not count.
        if (before && before.top < innerHeight && before.bottom > lastHeaderHeight && now.bottom <= height && Math.abs(before.bottom - delta + headerDelta - now.bottom) < 2 && !now.card.classList.contains('is-read')) ids.push(id);
      }
    }
    positions = current; lastY = window.scrollY; lastHeaderHeight = height;
    if (ids.length) onRead(ids);
  }
  const onScroll = () => {if (enabled && !frame) frame = requestAnimationFrame(check);};
  window.addEventListener('scroll', onScroll, {passive: true});
  window.addEventListener('resize', sync);
  document.addEventListener('visibilitychange', sync);
  return {sync, setEnabled(value) {enabled = value; sync();}, destroy() {
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', sync);
    document.removeEventListener('visibilitychange', sync);
  }};
}
