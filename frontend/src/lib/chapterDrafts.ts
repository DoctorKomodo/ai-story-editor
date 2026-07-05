/**
 * Local (device-only) chapter-draft persistence.
 *
 * Plaintext TipTap JSON, stored in IndexedDB — NOT encrypted under the DEK,
 * because the client never holds it. This is a deliberate, user-approved
 * weakening of the at-rest story for a bounded window: drafts are transient
 * (deleted on every confirmed save; stale drafts discarded on load), one per
 * `(userId, chapterId, draftId)`, and scoped to the browser profile. See the
 * plan's "Design decisions" §1 for the accepted threat model.
 *
 * All functions swallow-and-warn on IndexedDB unavailability (e.g. private-
 * mode Firefox) — draft persistence silently degrades to a no-op; autosave
 * itself is unaffected.
 */

export interface ChapterDraft {
  userId: string;
  chapterId: string;
  draftId: string;
  storyId: string;
  bodyJson: unknown;
  /** Server draft.updatedAt (ISO) the edit was made against. */
  baseUpdatedAt: string;
  /** `Date.now()` of the local persist. */
  savedAt: number;
}

export type DraftDecision = 'offer' | 'discard';

const DB_NAME = 'inkwell-drafts';
const DB_VERSION = 2;
const STORE_NAME = 'chapterDrafts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // [9wk.6] v1→v2: keyPath gained draftId. keyPath is immutable, so the
      // store is dropped and recreated — v1 rows' baseUpdatedAt held the
      // CHAPTER's updatedAt, which can never equal a draft's updatedAt, so
      // every old row would fail resolveDraftDecision anyway. Nothing of
      // value is lost.
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: ['userId', 'chapterId', 'draftId'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function putDraft(draft: ChapterDraft): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[chapterDrafts] putDraft failed', err);
  }
}

export async function getDraft(
  userId: string,
  chapterId: string,
  draftId: string,
): Promise<ChapterDraft | null> {
  try {
    const db = await openDb();
    return await new Promise<ChapterDraft | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get([userId, chapterId, draftId]);
      req.onsuccess = () => resolve((req.result as ChapterDraft | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[chapterDrafts] getDraft failed', err);
    return null;
  }
}

export async function deleteDraft(
  userId: string,
  chapterId: string,
  draftId: string,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete([userId, chapterId, draftId]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[chapterDrafts] deleteDraft failed', err);
  }
}

/**
 * A draft is safe to offer only when the server hasn't moved past it — i.e.
 * its edits are provably unsaved. If the server moved (our keepalive flush
 * landed, or another writer won), the draft is stale and must be discarded.
 */
export function resolveDraftDecision(draft: ChapterDraft, serverUpdatedAt: string): DraftDecision {
  return draft.baseUpdatedAt === serverUpdatedAt ? 'offer' : 'discard';
}
