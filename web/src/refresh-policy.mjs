export const REFRESH_MS = 15 * 60 * 1000;

export function nextRefresh(failures = 0, now = Date.now()) {
  return now + Math.min(6 * 60 * 60 * 1000, REFRESH_MS * 2 ** Math.min(failures, 6));
}

export async function inBatches(items, work, concurrency = 4) {
  let index = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (index < items.length) {const item = items[index++]; await work(item);}
  }));
}
