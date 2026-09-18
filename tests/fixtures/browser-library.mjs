import Dexie from 'dexie';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';

// Run production Dexie transactions against an isolated IndexedDB engine.
// Connections share this test's databases; tests do not replace global APIs.
export function libraryDatabase(t) {
  const indexedDB = new IDBFactory(), connections = [];
  t.after(() => {for (const db of connections) db.close();});
  return name => {
    const db = new Dexie(name, {indexedDB, IDBKeyRange});
    connections.push(db);
    return db;
  };
}
