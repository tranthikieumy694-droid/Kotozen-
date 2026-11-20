import type { NuanceDualPayload, VideoSession, WordProfile } from '../types';
import type { YouTubeCaptionsResponse } from './api';

/**
 * L1 In-Memory Hot Cache & In-Flight Request Deduplicator (0ms Sync Reads)
 * Works alongside L2 IndexedDB for instant 0ms video re-open, EN <-> JP toggle,
 * speculative onPaste pre-fetch, and 1-Click word lookup deduplication.
 */

const MAX_SESSIONS = 14;
const MAX_WORDS = 260;
const MAX_NUANCE_DUAL = 200;
const MAX_CAPTIONS = 16;
const CAPTIONS_TTL_MS = 5 * 60 * 1000;

const sessionL1 = new Map<string, VideoSession>();
const wordL1 = new Map<string, WordProfile>();
const nuanceDualL1 = new Map<string, NuanceDualPayload>();
const captionsL1 = new Map<string, { data: YouTubeCaptionsResponse; expiresAt: number }>();
const prefetchedThumbs = new Set<string>();

function setLru<K, V>(map: Map<K, V>, key: K, value: V, maxSize: number) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > maxSize) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
}

export function getSessionL1(id: string): VideoSession | null {
  const hit = sessionL1.get(id);
  if (!hit) return null;
  // Refresh LRU order
  sessionL1.delete(id);
  sessionL1.set(id, hit);
  return hit;
}

export function setSessionL1(session: VideoSession): void {
  setLru(sessionL1, session.id, session, MAX_SESSIONS);
}

export function deleteSessionL1(id: string): void {
  sessionL1.delete(id);
}

export function getWordL1(cacheKey: string): WordProfile | null {
  const hit = wordL1.get(cacheKey);
  if (!hit) return null;
  wordL1.delete(cacheKey);
  wordL1.set(cacheKey, hit);
  return hit;
}

export function setWordL1(cacheKey: string, profile: WordProfile): void {
  setLru(wordL1, cacheKey, profile, MAX_WORDS);
}

export function getNuanceDualL1(cacheKey: string): NuanceDualPayload | null {
  const hit = nuanceDualL1.get(cacheKey);
  if (!hit) return null;
  nuanceDualL1.delete(cacheKey);
  nuanceDualL1.set(cacheKey, hit);
  return hit;
}

export function setNuanceDualL1(cacheKey: string, payload: NuanceDualPayload): void {
  setLru(nuanceDualL1, cacheKey, payload, MAX_NUANCE_DUAL);
}

export function getCaptionsL1(key: string): YouTubeCaptionsResponse | null {
  const entry = captionsL1.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    captionsL1.delete(key);
    return null;
  }
  return entry.data;
}

export function setCaptionsL1(key: string, data: YouTubeCaptionsResponse): void {
  setLru(captionsL1, key, { data, expiresAt: Date.now() + CAPTIONS_TTL_MS }, MAX_CAPTIONS);
}

export function warmYouTubeThumbnail(videoId: string): void {
  if (typeof window === 'undefined' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;
  if (prefetchedThumbs.has(videoId)) return;
  prefetchedThumbs.add(videoId);
  const img = new Image();
  img.decoding = 'async';
  img.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
