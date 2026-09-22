// Claim only a downward touch that starts outside controls and at the top of
// the article (or in its fixed toolbar). Other gestures keep native scrolling.
export function dismissPreviewWithSwipe(dialog, close) {
  const body = dialog.querySelector('#article-body');
  const mobile = matchMedia('(max-width: 760px), (pointer: coarse)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let gesture, timer, settling = false;
  const selectedText = () => document.getSelection()?.isCollapsed === false;
  function reset() {
    clearTimeout(timer);
    gesture = null; settling = false;
    delete dialog.dataset.swipe;
    dialog.style.removeProperty('--preview-swipe-y');
  }
  function settle(dismiss) {
    gesture = null; settling = true;
    if (reducedMotion.matches) {
      if (dismiss) close(); else reset();
      return;
    }
    dialog.dataset.swipe = 'settling';
    dialog.style.setProperty('--preview-swipe-y', dismiss ? `${innerHeight}px` : '0px');
    timer = setTimeout(() => {if (dismiss) close(); else reset();}, 180);
  }
  function start(event) {
    if (event.touches.length !== 1) {if (gesture) settle(false); return;}
    if (settling || !mobile.matches || !dialog.open || selectedText()) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('a,button,input,textarea,select,summary,[contenteditable]')) return;
    for (let node = target; node && node !== dialog; node = node.parentElement) if (node.scrollTop > 1) return;
    const touch = event.touches[0], rect = dialog.getBoundingClientRect();
    if (touch.clientX < rect.left || touch.clientX > rect.right || touch.clientY < rect.top || touch.clientY > rect.bottom) return;
    gesture = {id:touch.identifier, x:touch.clientX, y:touch.clientY, content:body.contains(target), distance:0, dragging:false};
  }
  function move(event) {
    if (!gesture) return;
    if (event.touches.length !== 1 || selectedText() || !event.cancelable) {settle(false); return;}
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id) {settle(false); return;}
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
    if (!gesture.dragging) {
      if (gesture.content && body.scrollTop > 1) {reset(); return;}
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (dy <= 0 || dy < Math.abs(dx) * 1.5) {reset(); return;}
      gesture.dragging = true;
    }
    event.preventDefault();
    gesture.distance = Math.max(0, dy);
    dialog.dataset.swipe = 'dragging';
    dialog.style.setProperty('--preview-swipe-y', `${gesture.distance}px`);
  }
  function end(event) {
    if (!gesture) return;
    if (!gesture.dragging) {reset(); return;}
    // Cancel the synthetic click so releasing over a link or the feed cannot
    // activate it after the preview closes.
    if (event.cancelable) event.preventDefault();
    settle(gesture.distance >= Math.min(100, dialog.clientHeight * .2));
  }
  const cancel = () => {if (gesture) settle(false);};
  dialog.addEventListener('touchstart', start, {passive:true});
  dialog.addEventListener('touchmove', move, {passive:false});
  dialog.addEventListener('touchend', end, {passive:false});
  dialog.addEventListener('touchcancel', cancel);
  window.addEventListener('resize', reset);
  return () => {
    reset();
    dialog.removeEventListener('touchstart', start);
    dialog.removeEventListener('touchmove', move);
    dialog.removeEventListener('touchend', end);
    dialog.removeEventListener('touchcancel', cancel);
    window.removeEventListener('resize', reset);
  };
}
