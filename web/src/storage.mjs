import Dexie from 'dexie';

// Each reader owns its connection, fallback library, and warning recipient.
// Importing this module does not choose a brand or open a database.
export function createBrowserLibrary({storageNamespace, capabilities}, {createDatabase = name => new Dexie(name)} = {}) {
  const db = createDatabase(storageNamespace);
  db.version(1).stores({articles: '&id, published, firstSeen, *feedIds', state: '&id', feeds: '&id'});
  db.version(2).stores({settings: '&id'});
  let persistent = true, warning = () => {}, writes = Promise.resolve();
  const memory = {articles: new Map(), state: new Map(), feeds: new Map(), settings: new Map()};

  // Reads and writes share an order, so an older read cannot replace a newer
  // save in the fallback library if persistent storage fails later.
  function enqueue(work) {
    const result = writes.then(work);
    writes = result.catch(() => {});
    return result;
  }

  async function operation(store, method, args) {
    if (persistent) {
      try {return await db[store][method](...args);}
      catch {
        persistent = false;
        warning('The reader cannot save changes in this browser. You can keep reading, but you will lose new saves and read marks when you close or reload this page.' + (capabilities?.backups ? ' Open About this reader and choose Export reading backup before you leave.' : ''));
      }
    }
    const map = memory[store];
    if (method === 'toArray') return [...map.values()];
    if (method === 'bulkPut') for (const item of args[0]) map.set(item.id, item);
    if (method === 'bulkDelete') for (const id of args[0]) map.delete(id);
  }

  return {
    openLibrary(onWarning = () => {}) {
      warning = onWarning;
      return enqueue(async () => {
        const result = {};
        for (const store of Object.keys(memory)) {
          result[store] = await operation(store, 'toArray', []);
          // Replace the snapshot: another tab may have removed stored items.
          memory[store] = new Map(result[store].map(item => [item.id, item]));
        }
        return result;
      });
    },
    save(store, items) {
      return enqueue(async () => {
        for (const item of items) memory[store].set(item.id, item);
        await operation(store, 'bulkPut', [items]);
      });
    },
    removeArticles(ids) {
      return enqueue(async () => {
        for (const id of ids) memory.articles.delete(id);
        await operation('articles', 'bulkDelete', [ids]);
      });
    },
  };
}
