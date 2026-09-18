// Schema history is append-only. Never delete a library to recover from an
// unsupported version or a failed upgrade. Keep paths from every past release.
export const LIBRARY_TABLES = Object.freeze(['articles', 'state', 'feeds', 'settings']);
export const LIBRARY_VERSION = 2;

export function configureLibrarySchema(db) {
  db.version(1).stores({articles: '&id, published, firstSeen, *feedIds', state: '&id', feeds: '&id'});
  db.version(2).stores({settings: '&id'});
}
