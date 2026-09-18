import Dexie from 'dexie';
import {LIBRARY_TABLES, LIBRARY_VERSION, configureLibrarySchema} from './library-schema.mjs';

// Connections, operation queues, and fallback snapshots belong to one reader.
export function createBrowserLibrary({storageNamespace, capabilities}, {createDatabase = name => new Dexie(name)} = {}) {
  const db = createDatabase(storageNamespace);
  configureLibrarySchema(db);
  let persistent = true, warning = () => {}, writes = Promise.resolve();
  const memory = Object.fromEntries(LIBRARY_TABLES.map(name => [name, new Map()]));
  const copy = tables => Object.fromEntries(tables.map(name => [name, new Map(memory[name])]));
  const checkVersion = () => {
    // Dexie uses tenths of the native version; verno can still reflect our
    // declarations after opening a newer database.
    if (db.backendDB().version > LIBRARY_VERSION * 10) throw Object.assign(new Error('Newer library schema'), {code: 'newer-library'});
  };

  function enqueue(work) {
    const result = writes.then(work);
    writes = result.catch(() => {});
    return result;
  }

  // Catch outside the transaction so a failed write aborts every table.
  // Observed records retain committed input if a later write fails; tentative
  // writes never become the fallback's starting point.
  function transact(tables, mode, work) {
    return enqueue(async () => {
      const observed = copy(tables);
      if (persistent) {
        try {
          await db.open();
          checkVersion();
          const staged = copy(tables);
          const result = await db.transaction(mode, tables, async () => {
            // Check again inside the transaction in case the connection was
            // replaced by a concurrent upgrade between open and transaction.
            checkVersion();
            return work({
              async all(name) {
                const rows = await db[name].toArray();
                observed[name] = new Map(rows.map(row => [row.id, row]));
                staged[name] = new Map(observed[name]);
                return rows;
              },
              async get(name, ids) {
                const rows = await db[name].bulkGet(ids);
                ids.forEach((id, index) => {
                  for (const target of [observed, staged]) {
                    if (rows[index]) target[name].set(id, rows[index]);
                    else target[name].delete(id);
                  }
                });
                return rows;
              },
              async put(name, rows) {
                if (!rows.length) return;
                await db[name].bulkPut(rows);
                for (const row of rows) staged[name].set(row.id, row);
              },
              async remove(name, ids) {
                if (!ids.length) return;
                await db[name].bulkDelete(ids);
                for (const id of ids) staged[name].delete(id);
              },
            });
          });
          Object.assign(memory, staged);
          return result;
        } catch (error) {
          persistent = false;
          if (error.code === 'newer-library') db.close();
          warning((error.code === 'newer-library' ? 'This reader cannot open a library created by a newer version. Your stored library has not changed. Reload the page to get the current reader. Changes during this visit will be lost when you reload.' : 'The reader cannot save changes in this browser. You can keep reading, but you will lose new saves and read marks when you close or reload this page.') + (capabilities?.backups ? ' Open About this reader and choose Export reading backup before you leave.' : ''));
        }
      }
      const staged = observed;
      const result = await work({
        async all(name) {return [...staged[name].values()];},
        async get(name, ids) {return ids.map(id => staged[name].get(id));},
        async put(name, rows) {for (const row of rows) staged[name].set(row.id, row);},
        async remove(name, ids) {for (const id of ids) staged[name].delete(id);},
      });
      Object.assign(memory, staged);
      return result;
    });
  }

  // Read/Save are field patches, never replacements from a tab's stale state.
  // The same-field last transaction wins; unrelated flags survive.
  function updateStates(changes, {articles = [], combine = false} = {}) {
    return transact(['articles', 'state'], 'rw', async tx => {
      const ids = [...new Set(changes.map(item => item.id))];
      const current = await tx.get('state', ids);
      const states = new Map(ids.map((id, index) => [id, current[index]]));
      for (const change of changes) {
        const previous = states.get(change.id);
        const next = {...previous, id: change.id};
        for (const key of ['read', 'saved']) if (typeof change[key] === 'boolean') next[key] = combine ? Boolean(change[key] || previous?.[key]) : change[key];
        states.set(change.id, next);
      }
      const savedIds = [...states.values()].filter(item => item.saved).map(item => item.id);
      const candidates = new Map(articles.map(item => [item.id, item]));
      const bodies = await tx.get('articles', savedIds);
      const added = savedIds.flatMap((id, index) => !bodies[index] && candidates.has(id) ? [candidates.get(id)] : []);
      await tx.put('articles', added);
      const updates = [...states.values()].filter((item, index) => item.read !== current[index]?.read || item.saved !== current[index]?.saved);
      await tx.put('state', updates);
      return {states: [...states.values()], articles: savedIds.map((id, index) => bodies[index] || candidates.get(id)).filter(Boolean), previous: current.filter(Boolean), added: added.length};
    });
  }

  return {
    openLibrary(onWarning = warning) {
      warning = onWarning;
      return transact(LIBRARY_TABLES, 'r', async tx => {
        const result = {};
        for (const name of LIBRARY_TABLES) result[name] = await tx.all(name);
        return result;
      });
    },
    save(name, items) {
      if (!LIBRARY_TABLES.includes(name)) throw new Error('Unknown library table.');
      if (name === 'state') return updateStates(items);
      return transact([name], 'rw', tx => tx.put(name, items));
    },
    updateStates,
    importItems({states, articles}) {return updateStates(states, {articles, combine: true});},
    removeArticles(ids) {
      return transact(['articles', 'state'], 'rw', async tx => {
        const states = await tx.get('state', ids);
        const removable = ids.filter((id, index) => !states[index]?.saved);
        await tx.remove('articles', removable);
        return removable;
      });
    },
  };
}
