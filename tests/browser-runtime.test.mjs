import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserRuntime} from '../web/src/browser-runtime.mjs';

test('browser subscriptions remove their own events and timers without affecting another reader', () => {
  const timers = new Set(), window = Object.assign(new EventTarget(), {
    setInterval(callback, ms) {assert.equal(ms, 60000); timers.add(callback); return callback;},
    clearInterval(callback) {timers.delete(callback);},
  });
  const document = Object.assign(new EventTarget(), {hidden: false}), navigator = {onLine: true};
  const runtime = createBrowserRuntime({window, document, navigator});
  const counts = [0, 0];
  const callbacks = index => Object.fromEntries(['online', 'offline', 'visibility', 'tick'].map(name => [name, () => counts[index]++]));
  const stopFirst = runtime.subscribe(callbacks(0)), stopSecond = runtime.subscribe(callbacks(1));
  window.dispatchEvent(new Event('offline'));
  document.dispatchEvent(new Event('visibilitychange'));
  for (const tick of timers) tick();
  assert.deepEqual(counts, [3, 3]);
  stopFirst(); stopFirst();
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  for (const tick of timers) tick();
  assert.deepEqual(counts, [3, 6]);
  assert.equal(timers.size, 1);
  document.hidden = true; navigator.onLine = false;
  assert.equal(runtime.isVisible(), false);
  assert.equal(runtime.isOnline(), false);
  stopSecond();
  assert.equal(timers.size, 0);
});

test('refresh locks forward the collection key and cancellation signal, with a no-lock fallback', async () => {
  const controller = new AbortController();
  const runtime = createBrowserRuntime({navigator: {locks: {request(name, options, work) {
    assert.equal(name, 'fixture-refresh'); assert.equal(options.signal, controller.signal); return work();
  }}}});
  assert.equal(await runtime.withLock('fixture-refresh', controller.signal, async () => 42), 42);
  const fallback = createBrowserRuntime({navigator: {}});
  assert.equal(await fallback.withLock('fixture-refresh', controller.signal, async () => 7), 7);
  controller.abort();
  for (const service of [runtime, fallback]) assert.throws(() => service.withLock('fixture-refresh', controller.signal, () => assert.fail('Canceled work ran')), {name: 'AbortError'});
});
