import type {
  ActiveProductionPack,
  ArticleBlockType,
  ArticleLanguage,
  ArticleParagraph,
  ArticleTranslatedVariant,
  Collocation3TierItem,
  CollocationTier,
  CollocationTopicBranch,
  CollocationWebData,
  CurriculumData,
  Language,
  NuanceDualPayload,
  NuanceExtraScenario,
  NuanceMatrixGroup,
  ProficiencyLevel,
  PronunciationAssessment,
  ReadingQuizQuestion,
  RubySegment,
  SentenceCoachFeedback,
  SmartChapter,
  SourceLanguage,
  StudySheetData,
  SubtitleLine,
  SyntaxXRay,
  ThematicCollocationEntry,
  VideoContextAnchor,
  WordExtraCollocation,
  WordProfile,
} from '../types';

import { sanitizeClientErrorMessage } from './languagePurity';
import {
  getCaptionsL1,
  setCaptionsL1,
  warmYouTubeThumbnail,
} from './cacheL1';
import { parseYouTubeUrlClient } from './youtube';

// In-flight deduplication maps so double-clicks, onPaste + submit, or rapid re-taps share 1 Promise
const inFlightCaptions = new Map<string, Promise<YouTubeCaptionsResponse>>();
const inFlightLookups = new Map<string, Promise<{ profile: WordProfile }>>();
const inFlightNuanceDual = new Map<string, Promise<{ nuance: NuanceDualPayload }>>();

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await resp.json().catch(() => ({}))) as T & {
    error?: string;
    isDailyQuota?: boolean;
    quotaExhausted?: boolean;
  };
  if (!resp.ok) {
    const safeMsg = sanitizeClientErrorMessage(
      data.error || '',
      'Hệ thống đang bận xử lý ngôn ngữ. Vui lòng thử lại sau giây lát.'
    );
    const err = new Error(safeMsg) as Error & {
      status?: number;
      isDailyQuota?: boolean;
      quotaExhausted?: boolean;
    };
    err.status = resp.status;
    err.isDailyQuota = Boolean(data.isDailyQuota);
    err.quotaExhausted = Boolean(data.quotaExhausted || resp.status === 429);
    throw err;
  }
  return data;
}

export interface RawApiCaptionLine {
  start: number;
  duration: number;
  text: string;
  readingMap?: string;
  ipaLine?: string;
  translationVi?: string;
}

export interface YouTubeCaptionsResponse {
  status: 'ok' | 'ai_auto_sub' | 'no_captions';
  videoId: string;
  title: string;
  channelName: string;
  startTime: number;
  videoDurationSec?: number;
  sourceLanguage: SourceLanguage;
  extractionTier: 'manual_vi' | 'asr_vi' | 'manual_target' | 'asr_target' | 'stt_ai' | 'none';
  detectedLanguage?: string;
  isAsr?: boolean;
  hasMoreStt?: boolean;
  nextSttOffsetSec?: number;
  directTranslated?: boolean;
  lines: RawApiCaptionLine[];
  availableTracks: Array<{ languageCode: string; name: string; isAsr: boolean }>;
  message?: string;
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.message === 'Aborted')) return true;
  if (typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'AbortError') {
    return true;
  }
  return false;
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export function fetchYouTubeCaptions(
  url: string,
  language: Language,
  signal?: AbortSignal,
  targetLevel?: ProficiencyLevel
) {
  const parsed = parseYouTubeUrlClient(url);
  const levelKey = targetLevel || 'auto';
  const dedupeKey = parsed
    ? `${parsed.videoId}_${language}_${levelKey}`
    : `${url}_${language}_${levelKey}`;

  // 0ms L1 RAM hit (e.g., from speculative onPaste or hover pre-fetch)
  const cached = getCaptionsL1(dedupeKey);
  if (cached) {
    return Promise.resolve({
      ...cached,
      startTime: parsed?.startTime ?? cached.startTime,
    });
  }

  // Share single in-flight Promise if onPaste speculative pre-fetch is already running!
  const existing = inFlightCaptions.get(dedupeKey);
  if (existing) {
    return awaitWithAbort(
      existing.then((res) => ({
        ...res,
        startTime: parsed?.startTime ?? res.startTime,
      })),
      signal
    );
  }

  // Note: do NOT pass caller signal to the shared network promise if speculative pre-fetch might share it,
  // unless caller is the sole owner — awaitWithAbort cancels caller immediately at 0ms!
  const req = postJson<YouTubeCaptionsResponse>('/api/youtube/captions', {
    url,
    language,
    targetLevel,
  })
    .then((res) => {
      if (res.status === 'ok' && res.lines.length > 0) {
        setCaptionsL1(dedupeKey, res);
      }
      return res;
    })
    .finally(() => {
      inFlightCaptions.delete(dedupeKey);
    });

  // Prevent unhandled rejection if caller aborts before shared promise settles
  req.catch(() => undefined);
  inFlightCaptions.set(dedupeKey, req);
  return awaitWithAbort(req, signal);
}

/**
 * Speculative On-Paste Pre-fetch: fires silently the millisecond a valid YouTube URL is pasted,
 * warming both the hqdefault thumbnail and backend caption extraction before the user clicks Submit.
 */
export function speculativePrefetchVideo(rawUrl: string, language: Language): void {
  const parsed = parseYouTubeUrlClient(rawUrl);
  if (!parsed) return;
  warmYouTubeThumbnail(parsed.videoId);
  const key = `${parsed.videoId}_${language}`;
  if (getCaptionsL1(key) || inFlightCaptions.has(key)) return;
  void fetchYouTubeCaptions(parsed.cleanUrl, language).catch(() => {
    // Silent background pre-fetch
  });
}

/**
 * 150ms Hover Intent Prefetch for Hero / Discovery / +3 cards:
 * Preloads cover thumbnail + warms oEmbed / caption cache quietly.
 */
export function hoverPrefetchVideo(videoId: string, language: Language): void {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;
  warmYouTubeThumbnail(videoId);
  const key = `${videoId}_${language}`;
  if (getCaptionsL1(key) || inFlightCaptions.has(key)) return;
  void fetchYouTubeCaptions(`https://www.youtube.com/watch?v=${videoId}`, language).catch(() => {
    // Silent hover pre-fetch
  });
}

export function validateCatalogVideoIds(videoIds: string[], signal?: AbortSignal) {
  return postJson<{
    validIds: string[];
    metadata: Record<string, { title: string; channelName: string }>;
  }>('/api/youtube/validate-catalog', { videoIds }, signal);
}

export function continueYouTubeStt(
  params: {
    videoId: string;
    videoTitle: string;
    startOffsetSec: number;
    windowDurationSec?: number;
    knownDurationSec?: number;
    targetLanguage?: Language;
    targetLevel?: ProficiencyLevel;
    contextAnchor?: VideoContextAnchor;
    priority?: 'express' | 'background';
    timeoutMs?: number;
  },
  signal?: AbortSignal
) {
  return postJson<{
    spokenLanguage: SourceLanguage;
    lines: RawApiCaptionLine[];
    hasMoreContent: boolean;
    nextOffsetSec: number;
    directTranslated?: boolean;
  }>('/api/youtube/stt-continue', params, signal);
}

/**
 * 1-Pass Multimodal NDJSON Micro-Burst Streaming Client (Segment 0: 0s->30s & Instant Seek Teleport):
 * Emits each AI-generated target-language subtitle cue the instant gemini-3.8-flash hears it (1.5-3s TTFL).
 */
export async function streamYouTubeSttWindow(
  params: {
    videoId: string;
    videoTitle: string;
    startOffsetSec: number;
    windowDurationSec?: number;
    knownDurationSec?: number;
    targetLanguage: Language;
    targetLevel?: ProficiencyLevel;
    contextAnchor?: VideoContextAnchor;
  },
  onLine: (line: RawApiCaptionLine) => void,
  signal?: AbortSignal
): Promise<{
  lines: RawApiCaptionLine[];
  nextOffsetSec: number;
  hasMoreContent: boolean;
}> {
  const resp = await fetch('/api/youtube/stt-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(params),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const errData = (await resp.json().catch(() => ({}))) as {
      error?: string;
      isDailyQuota?: boolean;
      quotaExhausted?: boolean;
    };
    const safeMsg = sanitizeClientErrorMessage(
      errData.error || '',
      'Chưa thể khởi chạy luồng tạo phụ đề AI trực tiếp.'
    );
    const err = new Error(safeMsg) as Error & {
      status?: number;
      isDailyQuota?: boolean;
      quotaExhausted?: boolean;
    };
    err.status = resp.status;
    err.isDailyQuota = Boolean(errData.isDailyQuota);
    err.quotaExhausted = Boolean(errData.quotaExhausted || resp.status === 429);
    throw err;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const received: RawApiCaptionLine[] = [];
  let nextOffsetSec = params.startOffsetSec + (params.windowDurationSec || 30);
  let hasMoreContent = true;
  let streamError: {
    status?: number;
    isDailyQuota?: boolean;
    restricted?: boolean;
    error?: string;
  } | null = null;

  const handleChunk = (raw: string) => {
    try {
      const msg = JSON.parse(raw) as {
        type?: string;
        line?: RawApiCaptionLine;
        nextOffsetSec?: number;
        hasMoreContent?: boolean;
        status?: number;
        isDailyQuota?: boolean;
        restricted?: boolean;
        error?: string;
      };
      if (msg.type === 'line' && msg.line) {
        received.push(msg.line);
        onLine(msg.line);
      } else if (msg.type === 'done') {
        if (typeof msg.nextOffsetSec === 'number') nextOffsetSec = msg.nextOffsetSec;
        if (typeof msg.hasMoreContent === 'boolean') hasMoreContent = msg.hasMoreContent;
      } else if (msg.type === 'error') {
        streamError = {
          status: msg.status,
          isDailyQuota: Boolean(msg.isDailyQuota),
          restricted: Boolean(msg.restricted),
          error: msg.error,
        };
      }
    } catch {
      // Skip malformed chunk
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (raw) handleChunk(raw);
        nl = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) handleChunk(tail);
  } finally {
    reader.releaseLock();
  }

  if (received.length === 0 && streamError) {
    const se = streamError as {
      status?: number;
      isDailyQuota?: boolean;
      restricted?: boolean;
      error?: string;
    };
    const safeMsg = sanitizeClientErrorMessage(
      se.error || '',
      'Không thể đọc trực tiếp luồng âm thanh YouTube của video này.'
    );
    const err = new Error(safeMsg) as Error & {
      status?: number;
      isDailyQuota?: boolean;
      quotaExhausted?: boolean;
      restricted?: boolean;
    };
    err.status = se.status || 500;
    err.isDailyQuota = Boolean(se.isDailyQuota);
    err.quotaExhausted = se.status === 429 || Boolean(se.isDailyQuota);
    err.restricted = Boolean(se.restricted);
    throw err;
  }

  return { lines: received, nextOffsetSec, hasMoreContent };
}

export function transcribeTabAudioChunkClient(
  params: {
    audioBase64: string;
    mimeType: string;
    chunkStartSec: number;
    chunkDurationSec?: number;
    videoTitle: string;
    targetLanguage: Language;
    targetLevel?: ProficiencyLevel;
    contextAnchor?: VideoContextAnchor;
  },
  signal?: AbortSignal
) {
  return postJson<{
    spokenLanguage: SourceLanguage;
    lines: RawApiCaptionLine[];
    hasMoreContent: boolean;
    nextOffsetSec: number;
    directTranslated?: boolean;
  }>('/api/youtube/tab-audio-stt', params, signal);
}

export function fetchVideoContextAnchor(
  params: {
    sampleLines: Array<{ start: number; text: string }>;
    language: Language;
    sourceLanguage?: SourceLanguage;
    targetLevel?: ProficiencyLevel;
    videoTitle: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ anchor: VideoContextAnchor }>(
    '/api/subtitles/context-anchor',
    params,
    signal
  );
}

export function enrichSubtitleBatch(
  params: {
    lines: Array<{ id: string; index: number; start: number; duration: number; text: string }>;
    language: Language;
    sourceLanguage?: SourceLanguage;
    targetLevel?: ProficiencyLevel;
    isAsr: boolean;
    videoTitle: string;
    contextAnchor?: VideoContextAnchor;
    previousContext?: Array<{ source: string; target: string }>;
    priority?: 'express' | 'background';
    timeoutMs?: number;
    compactWire?: boolean;
  },
  signal?: AbortSignal
) {
  return postJson<{ lines: SubtitleLine[] }>('/api/subtitles/enrich', params, signal);
}

/**
 * Sub-Second Micro-Batch Streaming Client (NDJSON over fetch ReadableStream):
 * Delivers each translated EN/JA subtitle line to `onLine` the instant gemini-3.8-flash emits it.
 */
export async function enrichSubtitleBatchStream(
  params: {
    lines: Array<{ id: string; index: number; start: number; duration: number; text: string }>;
    language: Language;
    sourceLanguage?: SourceLanguage;
    targetLevel?: ProficiencyLevel;
    isAsr: boolean;
    videoTitle: string;
    contextAnchor?: VideoContextAnchor;
    previousContext?: Array<{ source: string; target: string }>;
    priority?: 'express' | 'background';
    timeoutMs?: number;
    compactWire?: boolean;
  },
  onLine: (line: SubtitleLine) => void,
  signal?: AbortSignal
): Promise<SubtitleLine[]> {
  const resp = await fetch('/api/subtitles/enrich-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(params),
    signal,
  });

  if (!resp.ok || !resp.body) {
    if (resp.status === 429) {
      const errData = (await resp.json().catch(() => ({}))) as {
        error?: string;
        isDailyQuota?: boolean;
        quotaExhausted?: boolean;
      };
      const safeMsg = sanitizeClientErrorMessage(
        errData.error || '',
        'Hệ thống AI đang có lưu lượng truy cập cao. Vui lòng thử lại sau vài giây.'
      );
      const err = new Error(safeMsg) as Error & {
        status?: number;
        isDailyQuota?: boolean;
        quotaExhausted?: boolean;
      };
      err.status = 429;
      err.isDailyQuota = Boolean(errData.isDailyQuota);
      err.quotaExhausted = true;
      throw err;
    }
    // Graceful fallback to standard batch endpoint only if stream endpoint itself is unavailable
    const fallback = await enrichSubtitleBatch(params, signal);
    for (const l of fallback.lines) onLine(l);
    return fallback.lines;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const received: SubtitleLine[] = [];
  let streamError: { status?: number; isDailyQuota?: boolean; error?: string } | null = null;

  const handleChunkObj = (raw: string) => {
    try {
      const msg = JSON.parse(raw) as {
        type?: string;
        line?: SubtitleLine;
        status?: number;
        isDailyQuota?: boolean;
        error?: string;
      };
      if (msg.type === 'line' && msg.line) {
        received.push(msg.line);
        onLine(msg.line);
      } else if (msg.type === 'error') {
        streamError = {
          status: msg.status,
          isDailyQuota: Boolean(msg.isDailyQuota),
          error: msg.error,
        };
      }
    } catch {
      // Skip malformed chunk
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (raw) handleChunkObj(raw);
        nl = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) handleChunkObj(tail);
  } finally {
    reader.releaseLock();
  }

  if (received.length === 0 && streamError) {
    const se = streamError as { status?: number; isDailyQuota?: boolean; error?: string };
    const safeMsg = sanitizeClientErrorMessage(
      se.error || '',
      'Hệ thống AI đang có lưu lượng truy cập cao. Vui lòng thử lại sau vài giây.'
    );
    const err = new Error(safeMsg) as Error & {
      status?: number;
      isDailyQuota?: boolean;
      quotaExhausted?: boolean;
    };
    err.status = se.status || 500;
    err.isDailyQuota = Boolean(se.isDailyQuota);
    err.quotaExhausted = se.status === 429 || Boolean(se.isDailyQuota);
    throw err;
  }

  return received;
}

export function fetchCollocations3Tier(
  params: {
    lines: Array<{ start: number; text: string; translationVi?: string }>;
    language: Language;
    targetLevel: ProficiencyLevel;
    videoTitle: string;
    excludeExpressions?: string[];
    count?: number;
  },
  signal?: AbortSignal
) {
  return postJson<{ items: Collocation3TierItem[] }>(
    '/api/linguistics/collocations-3tier',
    params,
    signal
  );
}

export function fetchCollocationWeb(
  params: {
    coreWord: string;
    language: Language;
    excludeExpressions?: string[];
  },
  signal?: AbortSignal
) {
  return postJson<{ web: CollocationWebData }>(
    '/api/linguistics/collocation-web',
    params,
    signal
  );
}

export function expandThreeCollocations(
  params: {
    language: Language;
    topicId: string;
    topicTitleVi: string;
    branch: CollocationTopicBranch;
    tierFilter?: 'all' | CollocationTier;
    excludeExpressions?: string[];
  },
  signal?: AbortSignal
) {
  return postJson<{ entries: ThematicCollocationEntry[] }>(
    '/api/linguistics/collocations-expand',
    params,
    signal
  );
}

export function lookupWordProfile(
  params: {
    tokenId: string;
    lineId: string;
    surface: string;
    lemma: string;
    sentence: string;
    prevSentence?: string;
    nextSentence?: string;
    language: Language;
  },
  signal?: AbortSignal
) {
  const dedupeKey = `${params.language}::${params.lineId}::${params.tokenId}::${params.surface.toLowerCase()}`;
  const existing = inFlightLookups.get(dedupeKey);
  if (existing) {
    return awaitWithAbort(existing, signal);
  }
  const req = postJson<{ profile: WordProfile }>('/api/linguistics/lookup', params).finally(() => {
    inFlightLookups.delete(dedupeKey);
  });
  req.catch(() => undefined);
  inFlightLookups.set(dedupeKey, req);
  return awaitWithAbort(req, signal);
}

export function fetchSyntaxXRay(
  params: {
    lineId: string;
    sentence: string;
    translationVi?: string;
    language: Language;
    prevSentence?: string;
    nextSentence?: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ xray: SyntaxXRay }>('/api/linguistics/xray', params, signal);
}

export function fetchCurriculumData(
  params: {
    lines: Array<{ id: string; start: number; text: string; translationVi?: string }>;
    language: Language;
    targetLevel: ProficiencyLevel;
    videoTitle: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ curriculum: CurriculumData }>('/api/linguistics/curriculum', params, signal);
}

export function fetchStudySheetData(
  params: {
    lines: Array<{ id: string; start: number; text: string; translationVi?: string }>;
    language: Language;
    targetLevel: ProficiencyLevel;
    videoTitle: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ studySheet: StudySheetData }>('/api/linguistics/study-sheet', params, signal);
}

export function scorePronunciation(
  params: {
    audioBase64: string;
    mimeType: string;
    targetSentence: string;
    language: Language;
    ipaLine?: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ assessment: PronunciationAssessment }>(
    '/api/linguistics/pronunciation-score',
    params,
    signal
  );
}

export function startRoleplaySession(
  params: {
    videoTitle: string;
    sceneExcerpt: string;
    language: Language;
    targetLevel: ProficiencyLevel;
  },
  signal?: AbortSignal
) {
  return postJson<{
    startData: {
      personaName: string;
      scenarioVi: string;
      missions: Array<{ term: string; meaningVi: string }>;
      openingText: string;
      openingTranslationVi: string;
    };
  }>('/api/linguistics/roleplay', { action: 'start', ...params }, signal);
}

export function sendRoleplayReply(
  params: {
    language: Language;
    targetLevel: ProficiencyLevel;
    personaName: string;
    scenarioVi: string;
    missions: Array<{ term: string; meaningVi: string; used: boolean }>;
    history: Array<{ role: 'ai' | 'user'; text: string }>;
    userMessage: string;
  },
  signal?: AbortSignal
) {
  return postJson<{
    replyData: {
      aiReply: string;
      aiReplyTranslationVi: string;
      correctionVi: string;
      naturalAlternative: string;
      matchedMissionTerms: string[];
    };
  }>('/api/linguistics/roleplay', { action: 'reply', ...params }, signal);
}

export function fetchSmartChapters(
  params: {
    lines: Array<{ start: number; end: number; text: string }>;
    language: Language;
    videoTitle: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ chapters: SmartChapter[] }>('/api/linguistics/chapters', params, signal);
}

export function fetchNuanceMatrix(
  params: {
    lines: Array<{ start: number; text: string }>;
    language: Language;
    targetLevel: ProficiencyLevel;
    videoTitle: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ matrix: NuanceMatrixGroup[] }>('/api/linguistics/nuance-matrix', params, signal);
}

export function askAiSensei(
  params: {
    selectedText: string;
    question: string;
    timestamp: number;
    surroundingLines: Array<{ start: number; text: string }>;
    videoTitle: string;
    language: Language;
    targetLevel: ProficiencyLevel;
  },
  signal?: AbortSignal
) {
  return postJson<{
    answer: {
      directAnswerVi: string;
      culturalOrPragmaticNote: string;
      nativeTakeaway: string;
    };
  }>('/api/linguistics/tutor', params, signal);
}

export function fetchMoreWordCollocations(
  params: {
    word: string;
    language: Language;
    excludeExpressions?: string[];
  },
  signal?: AbortSignal
) {
  return postJson<{ items: WordExtraCollocation[] }>(
    '/api/linguistics/word-more-collocations',
    params,
    signal
  );
}

export function expandThreeNuancePairs(
  params: {
    language: Language;
    targetLevel: ProficiencyLevel;
    videoTitle: string;
    excludeTitles?: string[];
  },
  signal?: AbortSignal
) {
  return postJson<{ groups: NuanceMatrixGroup[] }>(
    '/api/linguistics/nuance-expand',
    params,
    signal
  );
}

export function fetchProductionLabPack(
  params: {
    lines: Array<{ start: number; text: string; translationVi?: string }>;
    language: Language;
    targetLevel: ProficiencyLevel;
    videoTitle: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ pack: ActiveProductionPack }>(
    '/api/linguistics/production-lab',
    params,
    signal
  );
}

export function coachUserSentence(
  params: {
    userSentence: string;
    targetTerm?: string;
    language: Language;
    targetLevel: ProficiencyLevel;
    videoTitle?: string;
  },
  signal?: AbortSignal
) {
  return postJson<{ feedback: SentenceCoachFeedback }>(
    '/api/linguistics/coach-sentence',
    params,
    signal
  );
}

export function fetchNuanceDual(
  params: {
    term: string;
    lemma?: string;
    language: Language;
    targetLevel: ProficiencyLevel;
    kind: 'word' | 'grammar' | 'collocation' | 'nuance_group';
    sentence: string;
    prevSentence?: string;
    nextSentence?: string;
    videoTitle?: string;
    compareTerms?: string[];
  },
  signal?: AbortSignal
) {
  const dedupeKey = `${params.language}::${params.kind}::${(params.lemma || params.term).toLowerCase()}::${params.sentence.slice(0, 80)}`;
  const existing = inFlightNuanceDual.get(dedupeKey);
  if (existing) {
    return awaitWithAbort(existing, signal);
  }
  const req = postJson<{ nuance: NuanceDualPayload }>('/api/linguistics/nuance-dual', params).finally(
    () => {
      inFlightNuanceDual.delete(dedupeKey);
    }
  );
  req.catch(() => undefined);
  inFlightNuanceDual.set(dedupeKey, req);
  return awaitWithAbort(req, signal);
}

export function expandThreeNuanceScenarios(
  params: {
    term: string;
    lemma?: string;
    language: Language;
    targetLevel: ProficiencyLevel;
    sentence?: string;
    excludeSituations?: string[];
  },
  signal?: AbortSignal
) {
  return postJson<{ scenarios: NuanceExtraScenario[] }>(
    '/api/linguistics/nuance-scenarios-expand',
    params,
    signal
  );
}

// ===========================================================================
// UNIVERSAL WEB ARTICLE STUDIO CLIENT API
// ===========================================================================
export interface ExtractedArticleApiResponse {
  status: 'ok' | 'blocked_paywall';
  url: string;
  domain: string;
  title: string;
  author?: string;
  siteName?: string;
  publishedDate?: string;
  lead?: string;
  sourceLanguage: ArticleLanguage;
  wordCount: number;
  estimatedReadMinutes: number;
  extractionTier?: 'readability_direct' | 'jsonld_fallback' | 'jina_reader' | 'raw_input';
  paragraphs: ArticleParagraph[];
  sentences: Array<{
    id: string;
    index: number;
    paragraphId: string;
    sentenceIndexInParagraph: number;
    blockType: ArticleBlockType;
    text: string;
    nativeRuby?: RubySegment[];
  }>;
  reasonVi?: string;
}

export function classifyInputUrl(rawInput: string): 'youtube' | 'article' | 'invalid' {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return 'invalid';
  if (parseYouTubeUrlClient(trimmed)) return 'youtube';
  if (/^https?:\/\/[^\s]+\.[^\s]+/i.test(trimmed)) return 'article';
  // Allow bare domain paths like "vnexpress.net/..." or "en.wikipedia.org/wiki/..."
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(trimmed)) return 'article';
  return 'invalid';
}

export function extractWebArticleApi(url: string, signal?: AbortSignal) {
  return postJson<ExtractedArticleApiResponse>('/api/article/extract', { url }, signal);
}

export function parseRawArticleApi(
  params: { rawText?: string; pdfBase64?: string; title?: string; sourceUrl?: string },
  signal?: AbortSignal
) {
  return postJson<ExtractedArticleApiResponse>('/api/article/parse-raw', params, signal);
}

export interface ArticleTranslatedLineDto extends ArticleTranslatedVariant {
  id: string;
}

export function translateArticleBatch(
  params: {
    sentences: Array<{
      id: string;
      index: number;
      paragraphId: string;
      blockType?: ArticleBlockType;
      text: string;
    }>;
    sourceLanguage: ArticleLanguage;
    targetLanguage: ArticleLanguage;
    targetLevel: ProficiencyLevel;
    articleTitle: string;
    contextAnchor?: VideoContextAnchor;
    previousContext?: Array<{ source: string; target: string }>;
  },
  signal?: AbortSignal
) {
  return postJson<{ lines: ArticleTranslatedLineDto[] }>(
    '/api/article/translate-batch',
    params,
    signal
  );
}

export async function translateArticleBatchStream(
  params: {
    sentences: Array<{
      id: string;
      index: number;
      paragraphId: string;
      blockType?: ArticleBlockType;
      text: string;
    }>;
    sourceLanguage: ArticleLanguage;
    targetLanguage: ArticleLanguage;
    targetLevel: ProficiencyLevel;
    articleTitle: string;
    contextAnchor?: VideoContextAnchor;
    previousContext?: Array<{ source: string; target: string }>;
  },
  onLine: (line: ArticleTranslatedLineDto) => void,
  signal?: AbortSignal
): Promise<ArticleTranslatedLineDto[]> {
  const resp = await fetch('/api/article/translate-batch-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(params),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const fallback = await translateArticleBatch(params, signal);
    for (const l of fallback.lines || []) onLine(l);
    return fallback.lines || [];
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const collected: ArticleTranslatedLineDto[] = [];

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      for (const rawLine of parts) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed) as {
            type?: string;
            line?: ArticleTranslatedLineDto;
          };
          if (evt.type === 'line' && evt.line?.id) {
            collected.push(evt.line);
            onLine(evt.line);
          }
        } catch {
          // ignore malformed chunk
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return collected;
}

export function fetchArticleReadingQuiz(
  params: {
    title: string;
    language: Language;
    targetLevel: ProficiencyLevel;
    paragraphs: Array<{ id: string; text: string; translationVi?: string }>;
  },
  signal?: AbortSignal
) {
  return postJson<{ questions: ReadingQuizQuestion[] }>(
    '/api/article/reading-quiz',
    params,
    signal
  );
}

