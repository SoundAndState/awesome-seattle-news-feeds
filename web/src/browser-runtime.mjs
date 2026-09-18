// The store uses this small environment boundary instead of browser globals.
// Subscriptions belong to one start/destroy cycle and return their own cleanup.
export function createBrowserRuntime({window = globalThis.window, document = globalThis.document, navigator = globalThis.navigator} = {}) {
  return {
    now: () => Date.now(),
    isVisible: () => !document.hidden,
    isOnline: () => navigator.onLine,
    withLock(name, signal, work) {
      signal.throwIfAborted();
      return navigator.locks ? navigator.locks.request(name, {signal}, work) : work();
    },
    subscribe({offline, online, visibility, tick}) {
      window.addEventListener('offline', offline);
      window.addEventListener('online', online);
      document.addEventListener('visibilitychange', visibility);
      const interval = window.setInterval(tick, 60000);
      return () => {
        window.clearInterval(interval);
        window.removeEventListener('offline', offline);
        window.removeEventListener('online', online);
        document.removeEventListener('visibilitychange', visibility);
      };
    },
  };
}
