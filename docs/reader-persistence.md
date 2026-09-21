# Reader persistence and compatibility

The reader keeps its library in the browser. Collection ownership, transactions,
and version checks protect that library as sources and deployments change.
The [application boundary](reader-architecture.md) and
[item contract](reader-item-contract.md) describe the services and stored items.

## Collection and backup ownership

`storageNamespace` is the stable collection identifier, database name, and
backup's `collection` field. Branding, hostnames, and catalog contents can change
without changing this identifier. A new independent collection needs a new
namespace. Sharing a namespace deliberately shares a library on the same origin;
it is not a security boundary between applications on that origin.

Backup format `sound-and-state`, version 1 remains unchanged. Restore accepts an
exact collection match. Backups created before the collection field existed
belong to the original `sound-and-state` namespace. Missing, null, empty, or
foreign ownership must not silently import into another collection; only the
historical missing field has the legacy exception. Unsupported versions are
rejected before any write. Moving between collections requires a separate,
explicit conversion policy; this release does not guess how source IDs map.

[`backup.mjs`](../web/src/backup.mjs) validates the complete file and prepares
untrusted text before storage begins. The store passes only the backup's marks
to persistence. Its possibly stale local marks do not participate in the import.
Existing stored content wins over an older backup. Imported true read/saved
marks combine with current stored marks; an import never clears a current mark.
No account, publisher request, or server storage is involved in importing.

## Transactions and failure behavior

[`storage.mjs`](../web/src/storage.mjs) owns the IndexedDB transaction boundary.
One library's operations also share an invocation queue. Each successful
`openLibrary` reads all four tables in a single read transaction. Exports wait
for accepted reader actions, then use this stored snapshot, including saves made
by another tab. They do not export an arbitrary intermediate UI snapshot.

| Operation | Transaction and result |
| --- | --- |
| `updateStates(changes, {articles})` | Read current marks and candidate bodies, insert missing saved bodies, and patch only the requested read/saved flags in one transaction. Return resulting marks/bodies and previous marks. |
| `importItems({states, articles})` | The same transaction, combining true flags and keeping existing bodies. Return `added`, the number of bodies actually inserted. |
| `removeArticles(ids)` | Read saved marks and remove only unsaved bodies in one transaction. Return IDs actually removed; the store removes only these from its lists. |
| `save(table, items)` | One-table write for feed content, feed health, or settings. The compatibility `state` path delegates to field patches. |

The transaction callback waits only for database operations. File reading, JSON
validation, network work, and text preparation happen before it. Errors are
caught outside the transaction, so a failed mark write also rolls back inserted
content. This follows [Dexie's transaction contract](https://dexie.org/docs/Dexie/Dexie.transaction()).

After a storage failure, the library completes the whole accepted operation in
its private memory copy. It starts from the most recent committed records it
could read, never tentative writes from the aborted transaction. The reader's
warning explains that new changes will be lost after closing or reloading and,
when enabled, points to Export reading backup. An interrupted import therefore
leaves either the full import on disk or the previous disk contents. Its full
result remains usable and exportable for the current visit if disk failed.

Fallback does not retry writes or claim persistence. Reload creates a new
connection and checks storage again. Fallback libraries do not synchronize with
other tabs. No implementation can recover browser data the user cleared or
content that was never successfully stored or exported.

## Competing tabs

Transactions merge read/saved patches against the current database record. A
read action from an older tab cannot overwrite another tab's saved flag. Two
explicit changes to the same flag use transaction order: the last committed
change wins. Undo is an explicit change to the read flag and follows the same
rule; it preserves the saved flag. Bulk Read records prior read marks from the
transaction, so it does not undo marks already made in another tab.

Cleanup and Save use overlapping transaction scopes. If Save commits first,
cleanup retains the body. If cleanup commits first, Save reinserts the displayed
body together with its mark. Backup imports recheck existing content inside the
transaction, protecting content a different tab stored while the file was read.

The store reconciles marks on returning to the tab and on its next visible
one-minute tick, including Saved and offline views. It waits behind accepted
local actions and discards completions from a destroyed reader lifecycle. New
unsaved content stays buffered; saved content becomes available directly.
This is local reconciliation, not instant synchronization or cross-device sync.
Settings retain record-level last-write behavior and apply from storage on
reload. The existing namespaced feed-refresh lock remains independent.

Feed responses use the same retention rules as cleanup before adding items to
the new-items notification. The reader combines incoming items with stored and
pending items before selecting the newest 150 unsaved items per source, with a
30-day limit measured from first receipt. Saved items remain exempt. A feed can
omit newer stories that are still stored locally; its own response length does
not determine which older entries the reader can retain. Discarded entries must
not appear in the notification, even while other feeds are still loading.

## Schema evolution and deployment

[`library-schema.mjs`](../web/src/library-schema.mjs) is the append-only schema
history. Versions 1 and 2 and existing item identities remain unchanged. The
current increment needs no data migration or backup-version increase.

Before using a connection, storage checks the actual native IndexedDB version
(Dexie schema versions use one tenth of that number). A newer version is not
opened for reads or writes by this reader's storage operations. The reader keeps
the stored library intact, explains that reloading can obtain the current build,
and uses temporary memory for this visit. It never deletes and recreates the
database to handle a version mismatch. Dexie's normal version-change handling
closes older connections so a future upgrade can proceed.

For a future schema change:

1. Add a new declaration after existing versions. Keep released declarations.
2. Use a deterministic transactional upgrade for required record changes;
   perform no network work. Keep optional additive fields compatible where possible.
3. Test upgrades from every supported version, repeated reopening, interrupted
   upgrades, saved/read associations, and older-code access to newer databases.
4. Version backup changes separately. Do not change item identities or rewrite
   source references without an explicit compatibility and recovery procedure.

See [Dexie's upgrade guidance](https://dexie.org/docs/Version/Version.upgrade())
and [version-change behavior](https://dexie.org/docs/Dexie/Dexie.on.versionchange).

## Verification

[Transaction tests](../tests/library-transactions.test.mjs) run production Dexie
with an isolated IndexedDB implementation via the shared
[database fixture](../tests/fixtures/browser-library.mjs). They exercise separate
connections, aborted writes, saved-item cleanup, legacy upgrades, future-version
protection, and collection ownership. The dependency is test-only.

[Store tests](../tests/reader-store.test.mjs) cover stale local state, exports
behind pending saves, and Saved reconciliation without a feed refresh.
[Browser tests](../tests/browser/persistence.spec.mjs) repeat the key paths with
native IndexedDB: two tabs, an injected mid-import failure, collection rejection,
and a released version-one library. All publisher requests use shared fixtures.
