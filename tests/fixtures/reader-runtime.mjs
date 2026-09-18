import {NOW} from './feeds.mjs';

// Drive time and browser events without replacing process-wide globals or
// starting real timers. Each test reader gets an independent environment.
export function makeReaderRuntime({now = Date.parse(NOW), online = true, visible = true, locks} = {}) {
  const listeners = new Set();
  const emit = name => {for (const listener of listeners) listener[name]();};
  return {
    now: () => now,
    isOnline: () => online,
    isVisible: () => visible,
    withLock(name, signal, work) {
      signal.throwIfAborted();
      return locks ? locks.request(name, {signal}, work) : work();
    },
    subscribe(callbacks) {listeners.add(callbacks); return () => listeners.delete(callbacks);},
    setOnline(value) {online = value; emit(value ? 'online' : 'offline');},
    setVisible(value) {visible = value; emit('visibility');},
    advance(ms) {now += ms; emit('tick');},
    subscriptions: () => listeners.size,
  };
}
