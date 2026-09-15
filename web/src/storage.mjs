import Dexie from 'dexie';

const db = new Dexie('sound-and-state');
db.version(1).stores({articles: '&id, published, firstSeen, *feedIds', state: '&id', feeds: '&id'});
let persistent = true;
const memory = {articles: new Map(), state: new Map(), feeds: new Map()};
let warning = () => {};

async function operation(store, method, args) {
  if (persistent) {
    try {return await db[store][method](...args);}
    catch {persistent = false; warning('Browser storage is unavailable or full. This session still works, but new reading changes may not be saved. Export a backup before closing.');}
  }
  const map = memory[store];
  if (method === 'toArray') return [...map.values()];
  if (method === 'put') return map.set(args[0].id, args[0]);
  if (method === 'bulkPut') for (const item of args[0]) map.set(item.id, item);
  if (method === 'bulkDelete') for (const id of args[0]) map.delete(id);
}

export async function openLibrary(onWarning) {
  warning = onWarning;
  const result = {};
  for (const store of Object.keys(memory)) {
    result[store] = await operation(store, 'toArray', []);
    for (const item of result[store]) memory[store].set(item.id, item);
  }
  return result;
}

export async function save(store, items) {
  for (const item of items) memory[store].set(item.id, item);
  await operation(store, 'bulkPut', [items]);
}

export async function removeArticles(ids) {
  for (const id of ids) memory.articles.delete(id);
  await operation('articles', 'bulkDelete', [ids]);
}
