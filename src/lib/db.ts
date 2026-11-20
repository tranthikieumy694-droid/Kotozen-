import type {
  ArticleLanguage,
  ArticleNote,
  ArticleSession,
  DailyActivityLog,
  Flashcard,
  Language,
  NuanceDisplayMode,
  NuanceDualPayload,
  ProficiencyLevel,
  SmartClip,
  SubtitleLine,
  TimestampedNote,
  VideoSession,
  WeaknessEntry,
  WordProfile,
} from '../types';

const DB_NAME = 'kotozen_offline_db';
const DB_VERSION = 7;

const STORE_SESSIONS = 'sessions';
const STORE_SHARDED_BATCHES = 'shardedBatches';
const STORE_ARTICLES = 'articles';
const STORE_ARTICLE_NOTES = 'articleNotes';
const STORE_FLASHCARDS = 'flashcards';
const STORE_WORD_CACHE = 'wordCache';
const STORE_NUANCE_CACHE = 'nuanceCache';
const STORE_NUANCE_SCENARIO_HISTORY = 'nuanceScenarioHistory';
const STORE_PREFERENCES = 'preferences';
const STORE_CLIPS = 'clips';
const STORE_NOTES = 'notes';
const STORE_ACTIVITY = 'activityLogs';
const STORE_COLLOCATION_HISTORY = 'collocationHistory';
const STORE_WEAKNESSES = 'weaknesses';

interface ShardedBatchEntry {
  shardKey: string;
  sessionId: string;
  batchIndex: number;
  lines: SubtitleLine[];
  updatedAt: number;
}

interface CachedWordEntry {
  cacheKey: string;
  profile: WordProfile;
  savedAt: number;
}

interface CachedNuanceEntry {
  cacheKey: string;
  payload: NuanceDualPayload;
  savedAt: number;
}

interface NuanceScenarioHistoryEntry {
  hashKey: string;
  scopeKey: string;
  situation: string;
  seenAt: number;
}

interface PreferenceEntry {
  key: string;
  value: string;
  updatedAt: number;
}

interface CollocationHistoryEntry {
  hashKey: string;
  language: 'en' | 'ja';
  expression: string;
  seenAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const s = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_FLASHCARDS)) {
        const c = db.createObjectStore(STORE_FLASHCARDS, { keyPath: 'id' });
        c.createIndex('due', 'due', { unique: false });
        c.createIndex('videoId', 'videoId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_WORD_CACHE)) {
        db.createObjectStore(STORE_WORD_CACHE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(STORE_CLIPS)) {
        const cl = db.createObjectStore(STORE_CLIPS, { keyPath: 'id' });
        cl.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        const n = db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
        n.createIndex('videoId', 'videoId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ACTIVITY)) {
        db.createObjectStore(STORE_ACTIVITY, { keyPath: 'dateKey' });
      }
      if (!db.objectStoreNames.contains(STORE_COLLOCATION_HISTORY)) {
        const ch = db.createObjectStore(STORE_COLLOCATION_HISTORY, { keyPath: 'hashKey' });
        ch.createIndex('language', 'language', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_WEAKNESSES)) {
        const w = db.createObjectStore(STORE_WEAKNESSES, { keyPath: 'id' });
        w.createIndex('language', 'language', { unique: false });
        w.createIndex('errorCount', 'errorCount', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_NUANCE_CACHE)) {
        db.createObjectStore(STORE_NUANCE_CACHE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(STORE_NUANCE_SCENARIO_HISTORY)) {
        const nh = db.createObjectStore(STORE_NUANCE_SCENARIO_HISTORY, { keyPath: 'hashKey' });
        nh.createIndex('scopeKey', 'scopeKey', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PREFERENCES)) {
        db.createObjectStore(STORE_PREFERENCES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_ARTICLES)) {
        const a = db.createObjectStore(STORE_ARTICLES, { keyPath: 'id' });
        a.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ARTICLE_NOTES)) {
        const an = db.createObjectStore(STORE_ARTICLE_NOTES, { keyPath: 'id' });
        an.createIndex('articleId', 'articleId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SHARDED_BATCHES)) {
        const sb = db.createObjectStore(STORE_SHARDED_BATCHES, { keyPath: 'shardKey' });
        sb.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = action(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

// --- Sessions ---
export async function saveVideoSession(session: VideoSession): Promise<void> {
  try {
    await runTx(STORE_SESSIONS, 'readwrite', (store) => store.put(session));
  } catch {
    // Graceful fallback
  }
}

export async function getVideoSession(id: string): Promise<VideoSession | undefined> {
  try {
    return await runTx<VideoSession | undefined>(STORE_SESSIONS, 'readonly', (store) =>
      store.get(id)
    );
  } catch {
    return undefined;
  }
}

export async function listVideoSessions(): Promise<VideoSession[]> {
  try {
    const all = await runTx<VideoSession[]>(STORE_SESSIONS, 'readonly', (store) => store.getAll());
    return (all || []).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function deleteVideoSession(id: string): Promise<void> {
  try {
    await runTx(STORE_SESSIONS, 'readwrite', (store) => store.delete(id));
  } catch {
    // Ignore
  }
}

/**
 * Purges legacy truncated or coarse-timestamp video sessions that predate v7_zero_skip_exact_.
 */
export async function purgeLegacyTruncatedSessions(
  validPrefix: string | string[]
): Promise<number> {
  const prefixes = Array.isArray(validPrefix) ? validPrefix : [validPrefix];
  try {
    const all = await runTx<VideoSession[]>(STORE_SESSIONS, 'readonly', (store) => store.getAll());
    let deleted = 0;
    for (const s of all || []) {
      if (s?.id && !prefixes.some((p) => s.id.startsWith(p))) {
        await runTx(STORE_SESSIONS, 'readwrite', (store) => store.delete(s.id));
        deleted += 1;
      }
    }
    await purgeLegacyShardedBatches(prefixes);
    return deleted;
  } catch {
    return 0;
  }
}

// --- Sharded Batch / Chunk Storage (<2ms writes for 1-5+ hour videos with 10,000+ lines) ---
export function buildShardKey(sessionId: string, batchIndex: number): string {
  const suffix = sessionId.startsWith('v12_ai_sub_gen_') ? 'chunk' : 'batch';
  return `${sessionId}_${suffix}_${batchIndex}`;
}

export async function saveShardedBatch(
  sessionId: string,
  batchIndex: number,
  lines: SubtitleLine[]
): Promise<void> {
  if (!sessionId || lines.length === 0) return;
  try {
    const entry: ShardedBatchEntry = {
      shardKey: buildShardKey(sessionId, batchIndex),
      sessionId,
      batchIndex,
      lines,
      updatedAt: Date.now(),
    };
    await runTx(STORE_SHARDED_BATCHES, 'readwrite', (store) => store.put(entry));
  } catch {
    // Graceful fallback
  }
}

export async function loadShardedBatches(sessionId: string): Promise<Map<string, SubtitleLine>> {
  const byId = new Map<string, SubtitleLine>();
  if (!sessionId) return byId;
  try {
    const db = await openDb();
    const shards = await new Promise<ShardedBatchEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SHARDED_BATCHES, 'readonly');
      const idx = tx.objectStore(STORE_SHARDED_BATCHES).index('sessionId');
      const req = idx.getAll(IDBKeyRange.only(sessionId));
      req.onsuccess = () => resolve((req.result as ShardedBatchEntry[]) || []);
      req.onerror = () => reject(req.error);
    });
    shards.sort((a, b) => a.batchIndex - b.batchIndex);
    for (const shard of shards) {
      for (const line of shard.lines || []) {
        if (line?.id && line.enriched) {
          byId.set(line.id, line);
        }
      }
    }
  } catch {
    // Graceful fallback
  }
  return byId;
}

export async function deleteShardedBatchesForSession(sessionId: string): Promise<void> {
  try {
    const db = await openDb();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SHARDED_BATCHES, 'readonly');
      const idx = tx.objectStore(STORE_SHARDED_BATCHES).index('sessionId');
      const req = idx.getAllKeys(IDBKeyRange.only(sessionId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    for (const key of keys) {
      await runTx(STORE_SHARDED_BATCHES, 'readwrite', (store) => store.delete(key));
    }
  } catch {
    // Ignore
  }
}

export async function purgeLegacyShardedBatches(
  validPrefix: string | string[]
): Promise<number> {
  const prefixes = Array.isArray(validPrefix) ? validPrefix : [validPrefix];
  try {
    const all = await runTx<ShardedBatchEntry[]>(STORE_SHARDED_BATCHES, 'readonly', (store) =>
      store.getAll()
    );
    let deleted = 0;
    for (const item of all || []) {
      if (
        item?.sessionId &&
        !prefixes.some((p) => item.sessionId.startsWith(p)) &&
        !item.sessionId.startsWith('v1_article_')
      ) {
        await runTx(STORE_SHARDED_BATCHES, 'readwrite', (store) => store.delete(item.shardKey));
        deleted += 1;
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}

// --- Flashcards ---
export async function saveFlashcard(card: Flashcard): Promise<void> {
  await runTx(STORE_FLASHCARDS, 'readwrite', (store) => store.put(card));
}

export async function listFlashcards(): Promise<Flashcard[]> {
  try {
    const all = await runTx<Flashcard[]>(STORE_FLASHCARDS, 'readonly', (store) => store.getAll());
    return (all || []).sort((a, b) => a.due - b.due);
  } catch {
    return [];
  }
}

export async function deleteFlashcard(id: string): Promise<void> {
  await runTx(STORE_FLASHCARDS, 'readwrite', (store) => store.delete(id));
}

// --- Strict 1:1 Token-Locked Word Cache ---
export function buildWordCacheKey(
  videoId: string,
  lineId: string,
  tokenId: string,
  surface: string
): string {
  return `${videoId}::${lineId}::${tokenId}::${surface}`;
}

export async function getCachedWordProfile(cacheKey: string): Promise<WordProfile | undefined> {
  try {
    const entry = await runTx<CachedWordEntry | undefined>(STORE_WORD_CACHE, 'readonly', (store) =>
      store.get(cacheKey)
    );
    return entry?.profile;
  } catch {
    return undefined;
  }
}

export async function setCachedWordProfile(cacheKey: string, profile: WordProfile): Promise<void> {
  try {
    await runTx(STORE_WORD_CACHE, 'readwrite', (store) =>
      store.put({ cacheKey, profile, savedAt: Date.now() })
    );
  } catch {
    // Ignore
  }
}

/**
 * Purges stale wordCache entries that predate the v3 Ground-Truth Kanji verification schema.
 */
export async function purgeLegacyWordCache(validPrefix: string): Promise<number> {
  try {
    const all = await runTx<CachedWordEntry[]>(STORE_WORD_CACHE, 'readonly', (store) =>
      store.getAll()
    );
    let deleted = 0;
    for (const item of all || []) {
      if (item?.cacheKey && !item.cacheKey.startsWith(validPrefix)) {
        await runTx(STORE_WORD_CACHE, 'readwrite', (store) => store.delete(item.cacheKey));
        deleted += 1;
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}

// --- Dual-Mode Nuance Explanation Cache (v4_nuance_dual_{lang}_{lemma}_{contextHash}) ---
function shortContextHash(input: string): string {
  const s = (input || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function buildNuanceDualCacheKey(
  lang: Language,
  lemma: string,
  sentenceContext: string
): string {
  const normLemma = (lemma || '').normalize('NFC').toLowerCase().replace(/\s+/g, '_').trim();
  return `v4_nuance_dual_${lang}_${normLemma}_${shortContextHash(sentenceContext)}`;
}

export async function getCachedNuanceDual(
  cacheKey: string
): Promise<NuanceDualPayload | undefined> {
  try {
    const entry = await runTx<CachedNuanceEntry | undefined>(
      STORE_NUANCE_CACHE,
      'readonly',
      (store) => store.get(cacheKey)
    );
    return entry?.payload;
  } catch {
    return undefined;
  }
}

export async function setCachedNuanceDual(
  cacheKey: string,
  payload: NuanceDualPayload
): Promise<void> {
  try {
    await runTx(STORE_NUANCE_CACHE, 'readwrite', (store) =>
      store.put({ cacheKey, payload, savedAt: Date.now() })
    );
  } catch {
    // Ignore
  }
}

export async function getPinnedNuanceMode(): Promise<NuanceDisplayMode | null> {
  try {
    const entry = await runTx<PreferenceEntry | undefined>(
      STORE_PREFERENCES,
      'readonly',
      (store) => store.get('nuance_pinned_mode')
    );
    if (entry?.value === 'summary' || entry?.value === 'deep') {
      return entry.value;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setPinnedNuanceMode(mode: NuanceDisplayMode | null): Promise<void> {
  try {
    if (mode === null) {
      await runTx(STORE_PREFERENCES, 'readwrite', (store) => store.delete('nuance_pinned_mode'));
      return;
    }
    await runTx(STORE_PREFERENCES, 'readwrite', (store) =>
      store.put({ key: 'nuance_pinned_mode', value: mode, updatedAt: Date.now() })
    );
  } catch {
    // Ignore
  }
}

export async function listNuanceScenarioHistory(
  lang: Language,
  lemma: string
): Promise<string[]> {
  const scopeKey = `${lang}::${lemma.normalize('NFC').toLowerCase().trim()}`;
  try {
    const all = await runTx<NuanceScenarioHistoryEntry[]>(
      STORE_NUANCE_SCENARIO_HISTORY,
      'readonly',
      (store) => store.getAll()
    );
    return (all || [])
      .filter((e) => e.scopeKey === scopeKey)
      .sort((a, b) => b.seenAt - a.seenAt)
      .map((e) => e.situation);
  } catch {
    return [];
  }
}

export async function recordNuanceScenarioHistory(
  lang: Language,
  lemma: string,
  situations: string[]
): Promise<void> {
  const scopeKey = `${lang}::${lemma.normalize('NFC').toLowerCase().trim()}`;
  const now = Date.now();
  for (const sit of situations) {
    const cleaned = sit.normalize('NFC').trim();
    if (!cleaned) continue;
    const entry: NuanceScenarioHistoryEntry = {
      hashKey: `${scopeKey}::${shortContextHash(cleaned)}`,
      scopeKey,
      situation: cleaned,
      seenAt: now,
    };
    try {
      await runTx(STORE_NUANCE_SCENARIO_HISTORY, 'readwrite', (store) => store.put(entry));
    } catch {
      // Ignore
    }
  }
}

// --- Feature 16: Smart Clip Bookmarks ("Câu Thoại Vàng") ---
export async function saveSmartClip(clip: SmartClip): Promise<void> {
  try {
    await runTx(STORE_CLIPS, 'readwrite', (store) => store.put(clip));
  } catch {
    // Ignore
  }
}

export async function listSmartClips(): Promise<SmartClip[]> {
  try {
    const all = await runTx<SmartClip[]>(STORE_CLIPS, 'readonly', (store) => store.getAll());
    return (all || []).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function deleteSmartClip(id: string): Promise<void> {
  try {
    await runTx(STORE_CLIPS, 'readwrite', (store) => store.delete(id));
  } catch {
    // Ignore
  }
}

// --- Feature 18: Timestamped Notes ---
export async function saveTimestampedNote(note: TimestampedNote): Promise<void> {
  try {
    await runTx(STORE_NOTES, 'readwrite', (store) => store.put(note));
  } catch {
    // Ignore
  }
}

export async function listTimestampedNotes(videoId?: string): Promise<TimestampedNote[]> {
  try {
    const all = await runTx<TimestampedNote[]>(STORE_NOTES, 'readonly', (store) => store.getAll());
    const filtered = videoId ? (all || []).filter((n) => n.videoId === videoId) : all || [];
    return filtered.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

export async function deleteTimestampedNote(id: string): Promise<void> {
  try {
    await runTx(STORE_NOTES, 'readwrite', (store) => store.delete(id));
  } catch {
    // Ignore
  }
}

// --- Feature 19: Activity Logs & Daily Study Streak Heatmap ---
export function getTodayDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function incrementDailyActivity(delta: {
  listeningMinutes?: number;
  shadowedSentences?: number;
  wordsReviewed?: number;
  roleplayTurns?: number;
}): Promise<DailyActivityLog> {
  const dateKey = getTodayDateKey();
  const existing = await runTx<DailyActivityLog | undefined>(
    STORE_ACTIVITY,
    'readonly',
    (store) => store.get(dateKey)
  ).catch(() => undefined);

  const updated: DailyActivityLog = {
    dateKey,
    listeningMinutes: Number(
      ((existing?.listeningMinutes || 0) + (delta.listeningMinutes || 0)).toFixed(2)
    ),
    shadowedSentences: (existing?.shadowedSentences || 0) + (delta.shadowedSentences || 0),
    wordsReviewed: (existing?.wordsReviewed || 0) + (delta.wordsReviewed || 0),
    roleplayTurns: (existing?.roleplayTurns || 0) + (delta.roleplayTurns || 0),
  };

  try {
    await runTx(STORE_ACTIVITY, 'readwrite', (store) => store.put(updated));
  } catch {
    // Ignore
  }
  return updated;
}

export async function listActivityLogs(): Promise<DailyActivityLog[]> {
  try {
    const all = await runTx<DailyActivityLog[]>(STORE_ACTIVITY, 'readonly', (store) =>
      store.getAll()
    );
    return (all || []).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  } catch {
    return [];
  }
}

// --- Feature 21: Zero-Duplicate Collocation History Hash (+3 Infinite Expansion) ---
export function normalizeCollocationHash(language: 'en' | 'ja', expression: string): string {
  return `${language}::${expression.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

export async function listCollocationHistoryExpressions(
  language: 'en' | 'ja'
): Promise<string[]> {
  try {
    const all = await runTx<CollocationHistoryEntry[]>(
      STORE_COLLOCATION_HISTORY,
      'readonly',
      (store) => store.getAll()
    );
    return (all || [])
      .filter((e) => e.language === language)
      .sort((a, b) => b.seenAt - a.seenAt)
      .map((e) => e.expression);
  } catch {
    return [];
  }
}

export async function recordCollocationHistoryExpressions(
  language: 'en' | 'ja',
  expressions: string[]
): Promise<void> {
  const now = Date.now();
  for (const expr of expressions) {
    const cleaned = expr.normalize('NFC').trim();
    if (!cleaned) continue;
    const entry: CollocationHistoryEntry = {
      hashKey: normalizeCollocationHash(language, cleaned),
      language,
      expression: cleaned,
      seenAt: now,
    };
    try {
      await runTx(STORE_COLLOCATION_HISTORY, 'readwrite', (store) => store.put(entry));
    } catch {
      // Ignore individual write failures
    }
  }
}

// --- Super-System 6: Personal Weakness Radar (Cross-Video Tracking) ---
export function buildWeaknessId(
  language: Language,
  kind: WeaknessEntry['kind'],
  term: string
): string {
  return `${language}::${kind}::${term.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

export async function recordWeakness(params: {
  language: Language;
  kind: WeaknessEntry['kind'];
  term: string;
  lemma?: string;
  categoryLabel: string;
  lastExample?: string;
  meaningVi?: string;
}): Promise<WeaknessEntry | null> {
  const cleanTerm = params.term.normalize('NFC').trim();
  if (!cleanTerm) return null;
  const id = buildWeaknessId(params.language, params.kind, cleanTerm);
  const existing = await runTx<WeaknessEntry | undefined>(
    STORE_WEAKNESSES,
    'readonly',
    (store) => store.get(id)
  ).catch(() => undefined);

  const entry: WeaknessEntry = {
    id,
    language: params.language,
    kind: params.kind,
    term: cleanTerm,
    lemma: (params.lemma || cleanTerm).normalize('NFC').trim(),
    categoryLabel: params.categoryLabel,
    errorCount: (existing?.errorCount || 0) + 1,
    resolvedCount: existing?.resolvedCount || 0,
    lastMissedAt: Date.now(),
    lastExample: params.lastExample || existing?.lastExample,
    meaningVi: params.meaningVi || existing?.meaningVi,
  };

  try {
    await runTx(STORE_WEAKNESSES, 'readwrite', (store) => store.put(entry));
  } catch {
    // Ignore storage error
  }
  return entry;
}

export async function markWeaknessResolved(
  language: Language,
  kind: WeaknessEntry['kind'],
  term: string
): Promise<void> {
  const id = buildWeaknessId(language, kind, term);
  const existing = await runTx<WeaknessEntry | undefined>(
    STORE_WEAKNESSES,
    'readonly',
    (store) => store.get(id)
  ).catch(() => undefined);
  if (!existing) return;
  const updated: WeaknessEntry = {
    ...existing,
    resolvedCount: existing.resolvedCount + 1,
  };
  try {
    await runTx(STORE_WEAKNESSES, 'readwrite', (store) => store.put(updated));
  } catch {
    // Ignore
  }
}

export async function listWeaknesses(language?: Language): Promise<WeaknessEntry[]> {
  try {
    const all = await runTx<WeaknessEntry[]>(STORE_WEAKNESSES, 'readonly', (store) =>
      store.getAll()
    );
    const filtered = language ? (all || []).filter((w) => w.language === language) : all || [];
    return filtered.sort((a, b) => b.errorCount - a.errorCount || b.lastMissedAt - a.lastMissedAt);
  } catch {
    return [];
  }
}

export async function deleteWeakness(id: string): Promise<void> {
  try {
    await runTx(STORE_WEAKNESSES, 'readwrite', (store) => store.delete(id));
  } catch {
    // Ignore
  }
}

// --- Full Multi-Store Backup Export / Import ---
export interface KotoZenBackup {
  version: number;
  exportedAt: number;
  sessions: VideoSession[];
  flashcards: Flashcard[];
  clips?: SmartClip[];
  notes?: TimestampedNote[];
  activityLogs?: DailyActivityLog[];
  weaknesses?: WeaknessEntry[];
}

export async function exportFullBackup(): Promise<KotoZenBackup> {
  const [sessions, flashcards, clips, notes, activityLogs, weaknesses] = await Promise.all([
    listVideoSessions(),
    listFlashcards(),
    listSmartClips(),
    listTimestampedNotes(),
    listActivityLogs(),
    listWeaknesses(),
  ]);
  return {
    version: 3,
    exportedAt: Date.now(),
    sessions,
    flashcards,
    clips,
    notes,
    activityLogs,
    weaknesses,
  };
}

export async function importFullBackup(backup: KotoZenBackup): Promise<{
  sessionsCount: number;
  cardsCount: number;
  clipsCount: number;
  notesCount: number;
}> {
  let sessionsCount = 0;
  let cardsCount = 0;
  let clipsCount = 0;
  let notesCount = 0;

  if (Array.isArray(backup.sessions)) {
    for (const s of backup.sessions) {
      if (s && s.id && s.videoId) {
        await saveVideoSession(s);
        sessionsCount++;
      }
    }
  }
  if (Array.isArray(backup.flashcards)) {
    for (const c of backup.flashcards) {
      if (c && c.id && c.term) {
        await saveFlashcard(c);
        cardsCount++;
      }
    }
  }
  if (Array.isArray(backup.clips)) {
    for (const cl of backup.clips) {
      if (cl && cl.id && cl.videoId) {
        await saveSmartClip(cl);
        clipsCount++;
      }
    }
  }
  if (Array.isArray(backup.notes)) {
    for (const n of backup.notes) {
      if (n && n.id && n.videoId) {
        await saveTimestampedNote(n);
        notesCount++;
      }
    }
  }
  if (Array.isArray(backup.activityLogs)) {
    for (const a of backup.activityLogs) {
      if (a && a.dateKey) {
        await runTx(STORE_ACTIVITY, 'readwrite', (store) => store.put(a)).catch(() => {});
      }
    }
  }
  if (Array.isArray(backup.weaknesses)) {
    for (const w of backup.weaknesses) {
      if (w && w.id && w.term) {
        await runTx(STORE_WEAKNESSES, 'readwrite', (store) => store.put(w)).catch(() => {});
      }
    }
  }
  return { sessionsCount, cardsCount, clipsCount, notesCount };
}

// ===========================================================================
// UNIVERSAL WEB ARTICLE STUDIO — Sharded IndexedDB Storage (v1_article_*)
// ===========================================================================
export function hashArticleKey(rawKey: string): string {
  let h = 2166136261;
  const s = String(rawKey || '').trim().toLowerCase();
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function buildArticleId(urlOrSeed: string): string {
  return `article_${hashArticleKey(urlOrSeed)}`;
}

export function buildArticleShardSessionId(
  urlHash: string,
  targetLang: ArticleLanguage,
  level: ProficiencyLevel | string
): string {
  return `v1_article_${urlHash}_${targetLang}_${level}`;
}

export async function saveArticleSession(session: ArticleSession): Promise<void> {
  try {
    await runTx(STORE_ARTICLES, 'readwrite', (store) =>
      store.put({ ...session, updatedAt: Date.now() })
    );
  } catch {
    // Graceful fallback
  }
}

export async function getArticleSession(id: string): Promise<ArticleSession | undefined> {
  try {
    return await runTx<ArticleSession | undefined>(STORE_ARTICLES, 'readonly', (store) =>
      store.get(id)
    );
  } catch {
    return undefined;
  }
}

export async function listArticleSessions(): Promise<ArticleSession[]> {
  try {
    const all = await runTx<ArticleSession[]>(STORE_ARTICLES, 'readonly', (store) =>
      store.getAll()
    );
    return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}

export async function deleteArticleSession(id: string): Promise<void> {
  try {
    await runTx(STORE_ARTICLES, 'readwrite', (store) => store.delete(id));
  } catch {
    // ignore
  }
}

export async function saveArticleNote(note: ArticleNote): Promise<void> {
  try {
    await runTx(STORE_ARTICLE_NOTES, 'readwrite', (store) => store.put(note));
  } catch {
    // ignore
  }
}

export async function listArticleNotes(articleId: string): Promise<ArticleNote[]> {
  try {
    const db = await openDb();
    const notes = await new Promise<ArticleNote[]>((resolve, reject) => {
      const tx = db.transaction(STORE_ARTICLE_NOTES, 'readonly');
      const idx = tx.objectStore(STORE_ARTICLE_NOTES).index('articleId');
      const req = idx.getAll(IDBKeyRange.only(articleId));
      req.onsuccess = () => resolve((req.result as ArticleNote[]) || []);
      req.onerror = () => reject(req.error);
    });
    return notes.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function deleteArticleNote(id: string): Promise<void> {
  try {
    await runTx(STORE_ARTICLE_NOTES, 'readwrite', (store) => store.delete(id));
  } catch {
    // ignore
  }
}

