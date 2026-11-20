import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Brain,
  CheckCircle2,
  FileUp,
  Gauge,
  Layers,
  ListVideo,
  Play,
  Plus,
  ScanSearch,
} from 'lucide-react';
import type {
  ActiveProductionPack,
  ArticleLanguage,
  ArticleSession,
  Collocation3TierItem,
  CollocationTier,
  CollocationWebBranchItem,
  CurriculumData,
  CurriculumGrammarItem,
  CurriculumVocabItem,
  DailyActivityLog,
  DetectedCollocation,
  DiscoveryVideoItem,
  Flashcard,
  FsrsRating,
  InputCompatibilityReport,
  Language,
  NuanceDualPayload,
  NuanceMatrixGroup,
  ProficiencyLevel,
  RawSourceLine,
  RightTab,
  SentenceGrammarNote,
  SmartChapter,
  SmartClip,
  SourceLanguage,
  StudySheetData,
  SubtitleLine,
  SubtitleSourceLayer,
  SubtitleToken,
  SyntaxXRay,
  ThematicCollocationEntry,
  ThemeMode,
  TimestampedNote,
  VideoContextAnchor,
  VideoSession,
  WeaknessEntry,
  WordExtraCollocation,
  WordProfile,
} from './types';
import {
  buildYouTubeTimestampUrl,
  CEFR_LEVELS,
  createBasicTokens,
  JLPT_LEVELS,
  normalizeMonotonicSubtitleLines,
  parseYouTubeUrlClient,
} from './lib/youtube';
import {
  buildArticleId,
  buildWordCacheKey,
  deleteArticleSession,
  deleteFlashcard,
  deleteSmartClip,
  deleteTimestampedNote,
  deleteVideoSession,
  deleteWeakness,
  getArticleSession,
  getCachedWordProfile,
  getVideoSession,
  incrementDailyActivity,
  listActivityLogs,
  listArticleSessions,
  listCollocationHistoryExpressions,
  listFlashcards,
  listSmartClips,
  listTimestampedNotes,
  listVideoSessions,
  listWeaknesses,
  loadShardedBatches,
  markWeaknessResolved,
  purgeLegacyShardedBatches,
  purgeLegacyTruncatedSessions,
  purgeLegacyWordCache,
  recordCollocationHistoryExpressions,
  recordWeakness,
  saveArticleSession,
  saveFlashcard,
  saveShardedBatch,
  saveSmartClip,
  saveTimestampedNote,
  saveVideoSession,
  setCachedWordProfile,
} from './lib/db';
import { createInitialFsrsState, scheduleFsrsCard } from './lib/fsrs';
import {
  classifyInputUrl,
  continueYouTubeStt,
  enrichSubtitleBatch,
  enrichSubtitleBatchStream,
  expandThreeNuancePairs,
  extractWebArticleApi,
  fetchCollocations3Tier,
  fetchCurriculumData,
  fetchNuanceMatrix,
  fetchProductionLabPack,
  fetchSmartChapters,
  fetchStudySheetData,
  fetchSyntaxXRay,
  fetchVideoContextAnchor,
  fetchYouTubeCaptions,
  hoverPrefetchVideo,
  isAbortError,
  lookupWordProfile,
  streamYouTubeSttWindow,
  transcribeTabAudioChunkClient,
  type ExtractedArticleApiResponse,
} from './lib/api';
import {
  deleteSessionL1,
  getSessionL1,
  getWordL1,
  setSessionL1,
  setWordL1,
  warmYouTubeThumbnail,
} from './lib/cacheL1';
import { downloadVisualQuoteCard } from './lib/quoteCard';
import { exportCompleteLessonMarkdown } from './lib/exportBundle';
import { DEFAULT_VIETNAMESE_SAMPLE, getSimilarVideos } from './data/discoveryCatalog';
import type { CuratedArticleSample } from './data/articleSamples';
import { TopBar } from './components/TopBar';
import { HeroAndBentoShowcase } from './components/HeroAndBentoShowcase';
import {
  preloadYouTubeIframeApi,
  YouTubePlayer,
  type YouTubePlayerHandle,
} from './components/YouTubePlayer';
import { InteractiveSubtitleStage } from './components/InteractiveSubtitleStage';
import { TranscriptTab } from './components/TranscriptTab';
import { CollocationsTab } from './components/CollocationsTab';
import { CurriculumTab } from './components/CurriculumTab';
import { SyntaxXRayTab } from './components/SyntaxXRayTab';
import { ReviewAndQuizTab } from './components/ReviewAndQuizTab';
import { SubtitleUploadModal } from './components/SubtitleUploadModal';
import { HistoryDrawer, ShortcutsModal } from './components/Overlays';
import { DiscoveryHub } from './components/DiscoveryHub';
import { RoleplayStudio } from './components/RoleplayStudio';
import { ClipsAndNotesPanel, SmartChaptersPanel } from './components/ChaptersAndClipsPanel';
import { AiSenseiModal } from './components/AiSenseiModal';
import { CollocationEncyclopediaModal } from './components/CollocationEncyclopediaModal';
import { ArticleRescueModal } from './components/ArticleRescueModal';
import { ArticleStudioWorkspace } from './components/ArticleStudioWorkspace';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isPureTargetLanguage, sanitizeClientErrorMessage } from './lib/languagePurity';
import {
  stripHtmlAndRubyArtifacts,
  unpackCompactSubtitleBatch,
  unpackSingleCompactLine,
} from './lib/compactUnpacker';

function buildSessionKey(
  vid: string,
  lang: Language,
  lvl: ProficiencyLevel,
  layer?: SubtitleSourceLayer
): string {
  if (layer === 'stt_ai') {
    return `v12_ai_sub_gen_${vid}_${lang}_${lvl}`;
  }
  return `v10_hyperspeed_exact_${vid}_${lang}_${lvl}`;
}

/**
 * O(log n) Binary Search — STRICT ZERO-EARLY / ZERO-LATE / ZERO-FORWARD-JUMP Active Spoken Line:
 * Returns the exact cue ONLY when cue.start <= timeSec && timeSec <= cue.end.
 * Returns null during intros, outros, and music/silence gaps so outdated or future subtitles NEVER jump or freeze on screen.
 */
function findActiveSpokenLineBinarySearch(lines: SubtitleLine[], timeSec: number): SubtitleLine | null {
  const n = lines.length;
  if (n === 0) return null;
  if (timeSec < lines[0].start) return null;

  let lo = 0;
  let hi = n - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].start <= timeSec) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best === -1) return null;
  const candidate = lines[best];
  if (candidate.start <= timeSec && timeSec <= candidate.end) {
    return candidate;
  }
  return null;
}

/**
 * O(log n) Nearest Line Lookup (for Prev/Next navigation, X-Ray fallback & Replay during silence gaps).
 */
function findNearestLineBinarySearch(lines: SubtitleLine[], timeSec: number): SubtitleLine | null {
  const n = lines.length;
  if (n === 0) return null;
  if (timeSec < lines[0].start) return lines[0];

  let lo = 0;
  let hi = n - 1;
  let best = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].start <= timeSec) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return lines[best] || lines[0];
}

/**
 * Evenly samples up to 24 lines across 0%..100% of any-length video (10m to 3h+)
 * to build the Global Video Context Anchor + Dynamic Glossary Lock.
 */
function sampleLinesAcrossTimeline(
  lines: SubtitleLine[],
  sourceLanguage: SourceLanguage,
  maxSamples = 24
): Array<{ start: number; text: string }> {
  if (lines.length === 0) return [];
  const step = Math.max(1, Math.floor(lines.length / maxSamples));
  const picked: Array<{ start: number; text: string }> = [];
  for (let i = 0; i < lines.length && picked.length < maxSamples; i += step) {
    const l = lines[i];
    const txt = (sourceLanguage === 'vi' ? l.rawText || l.translationVi || l.text : l.text).trim();
    if (txt) picked.push({ start: l.start, text: txt });
  }
  // Always include final cue so outro/conclusion terminology is anchored too
  const last = lines[lines.length - 1];
  const lastTxt = (sourceLanguage === 'vi' ? last.rawText || last.translationVi || last.text : last.text).trim();
  if (lastTxt && (picked.length === 0 || picked[picked.length - 1].start !== last.start)) {
    picked.push({ start: last.start, text: lastTxt });
  }
  return picked;
}

function WorkspaceApp() {
  // --- 3 Eye-Care Themes: Sáng Washi (#F9F8F4) · Tối Đêm Zen (#11151C) · Giấy Sepia (#F5EFE0) ---
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'washi';
    const saved = localStorage.getItem('kotozen_theme_v2') as ThemeMode | null;
    if (saved === 'washi' || saved === 'dark' || saved === 'sepia') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'washi';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'sepia');
    if (theme === 'dark') root.classList.add('dark');
    if (theme === 'sepia') root.classList.add('sepia');
    localStorage.setItem('kotozen_theme_v2', theme);
  }, [theme]);

  const cycleTheme = () => {
    setTheme((prev) => (prev === 'washi' ? 'dark' : prev === 'dark' ? 'sepia' : 'washi'));
  };

  // --- Core Video & Subtitle Session State ---
  const [urlInput, setUrlInput] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('en');
  const [sourceViLines, setSourceViLines] = useState<RawSourceLine[]>([]);
  const [targetLevel, setTargetLevel] = useState<ProficiencyLevel>('B2');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [channelName, setChannelName] = useState<string>('');
  const [sourceLayer, setSourceLayer] = useState<SubtitleSourceLayer>('manual');
  const [initialStartTime, setInitialStartTime] = useState<number>(0);
  const [videoDurationSec, setVideoDurationSec] = useState<number | undefined>(undefined);
  const [syncOffsetSec, setSyncOffsetSec] = useState<number>(0);
  const [contextAnchor, setContextAnchor] = useState<VideoContextAnchor | null>(null);

  // Tier-3 Windowed Audio STT pagination
  const [hasMoreStt, setHasMoreStt] = useState(false);
  const [nextSttOffsetSec, setNextSttOffsetSec] = useState(0);
  const [isLoadingMoreStt, setIsLoadingMoreStt] = useState(false);

  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [loadBannerError, setLoadBannerError] = useState<string | null>(null);
  const [isInvalidUrlError, setIsInvalidUrlError] = useState(false);
  const [isEnrichingBg, setIsEnrichingBg] = useState(false);
  const [slaProgress, setSlaProgress] = useState<{
    startedAtMs: number | null;
    completedInSec: number | null;
    etaSec: number | null;
    emaCuesPerSec: number;
  }>({ startedAtMs: null, completedInSec: null, etaSec: null, emaCuesPerSec: 0 });

  // --- Universal Web Article Studio State ---
  const [activeArticle, setActiveArticle] = useState<ArticleSession | null>(null);
  const [savedArticles, setSavedArticles] = useState<ArticleSession[]>([]);
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [articleRescueOpen, setArticleRescueOpen] = useState(false);
  const [articleRescueInfo, setArticleRescueInfo] = useState<{
    blockedUrl?: string;
    blockedDomain?: string;
    reasonVi?: string;
  }>({});
  const [articleJumpTarget, setArticleJumpTarget] = useState<{
    paragraphId?: string;
    sentenceId?: string;
  } | null>(null);
  const articleLoadAbortRef = useRef<AbortController | null>(null);

  // --- Motivational Toast Notification ---
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);

  // --- Display & Learning Modes ---
  const [showOriginal, setShowOriginal] = useState(true);
  const [showPhonetics, setShowPhonetics] = useState(true);
  // Secondary Vietnamese meaning hidden by default so eyes lock 100% onto English / Japanese
  const [showTranslationVi, setShowTranslationVi] = useState(false);
  const [blurOriginal, setBlurOriginal] = useState(false);
  const [blurTranslation, setBlurTranslation] = useState(false);
  const [isRevealHeld, setIsRevealHeld] = useState(false);
  const [dictationMode, setDictationMode] = useState(false);
  const [podcastMode, setPodcastMode] = useState(false);

  // --- Playback, A-B Loop & Shadowing Controls ---
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [loopSingleLine, setLoopSingleLine] = useState<boolean>(false);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [autoPausePerLine, setAutoPausePerLine] = useState<boolean>(false);
  const [autoPauseDelaySec, setAutoPauseDelaySec] = useState<number>(4);
  const [autoPauseOnClick, setAutoPauseOnClick] = useState<boolean>(true);

  // --- Right Hemisphere 5-Tab Navigation ---
  const [rightTab, setRightTab] = useState<RightTab>('transcript');
  const [transcriptSubTab, setTranscriptSubTab] = useState<'all' | 'chapters' | 'clips_notes'>('all');
  const [practiceSubTab, setPracticeSubTab] = useState<'fsrs' | 'roleplay'>('fsrs');

  // --- 1-Click Token Profile State (Strict 1:1 Token Lock) ---
  const [selectedToken, setSelectedToken] = useState<{
    line: SubtitleLine;
    token: SubtitleToken;
  } | null>(null);
  const [wordProfile, setWordProfile] = useState<WordProfile | null>(null);
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const wasPlayingBeforeLookupRef = useRef(false);

  // --- Linguistic Intelligence Caches ---
  const [xrayTargetLineId, setXrayTargetLineId] = useState<string | null>(null);
  const [xrayCache, setXrayCache] = useState<Record<string, SyntaxXRay>>({});
  const [isXrayLoading, setIsXrayLoading] = useState(false);
  const [xrayError, setXrayError] = useState<string | null>(null);

  const [curriculum, setCurriculum] = useState<CurriculumData | null>(null);
  const [isCurriculumLoading, setIsCurriculumLoading] = useState(false);
  const [curriculumError, setCurriculumError] = useState<string | null>(null);

  const [collocations3Tier, setCollocations3Tier] = useState<Collocation3TierItem[] | null>(null);
  const [isCollocationsLoading, setIsCollocationsLoading] = useState(false);
  const [isExpandingCollocations, setIsExpandingCollocations] = useState(false);
  const [collocationsError, setCollocationsError] = useState<string | null>(null);
  const [coreWordWebQuery, setCoreWordWebQuery] = useState<string | null>(null);

  const [studySheet, setStudySheet] = useState<StudySheetData | null>(null);
  const [isStudySheetLoading, setIsStudySheetLoading] = useState(false);
  const [studySheetError, setStudySheetError] = useState<string | null>(null);

  const [chapters, setChapters] = useState<SmartChapter[] | null>(null);
  const [isChaptersLoading, setIsChaptersLoading] = useState(false);
  const [chaptersError, setChaptersError] = useState<string | null>(null);

  const [nuanceMatrix, setNuanceMatrix] = useState<NuanceMatrixGroup[] | null>(null);
  const [isNuanceLoading, setIsNuanceLoading] = useState(false);
  const [isNuanceExpanding, setIsNuanceExpanding] = useState(false);
  const [nuanceError, setNuanceError] = useState<string | null>(null);

  const [productionPack, setProductionPack] = useState<ActiveProductionPack | null>(null);
  const [isProductionLoading, setIsProductionLoading] = useState(false);
  const [productionError, setProductionError] = useState<string | null>(null);

  // --- Web Worker i+1 Compatibility & Activity Analytics ---
  const [iPlusOneReport, setIPlusOneReport] = useState<InputCompatibilityReport | null>(null);
  const [activityLogs, setActivityLogs] = useState<DailyActivityLog[]>([]);

  // --- Offline IndexedDB Library, Flashcards, Smart Clips, Timestamped Notes & Weakness Radar ---
  const [savedSessions, setSavedSessions] = useState<VideoSession[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [weaknesses, setWeaknesses] = useState<WeaknessEntry[]>([]);
  const [clips, setClips] = useState<SmartClip[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [clipSavedFeedback, setClipSavedFeedback] = useState(false);
  const [notes, setNotes] = useState<TimestampedNote[]>([]);

  // --- Similar Videos & Modals ---
  const [similarFeed, setSimilarFeed] = useState<DiscoveryVideoItem[]>([]);
  const [discoveryModalOpen, setDiscoveryModalOpen] = useState(false);
  const [collocationLibraryOpen, setCollocationLibraryOpen] = useState(false);
  const [senseiOpen, setSenseiOpen] = useState(false);
  const [senseiSelectedText, setSenseiSelectedText] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [aiAudioRestricted, setAiAudioRestricted] = useState(false);
  const [isTabAudioListening, setIsTabAudioListening] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // --- Refs ---
  const playerRef = useRef<YouTubePlayerHandle | null>(null);
  const currentTimeRef = useRef<number>(0);
  const workerRef = useRef<Worker | null>(null);
  const videoLoadAbortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef<number>(0);
  const enrichAbortRef = useRef<AbortController | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const xrayAbortRef = useRef<AbortController | null>(null);
  const curriculumAbortRef = useRef<AbortController | null>(null);
  const collocationsAbortRef = useRef<AbortController | null>(null);
  const studySheetAbortRef = useRef<AbortController | null>(null);
  const chaptersAbortRef = useRef<AbortController | null>(null);
  const nuanceAbortRef = useRef<AbortController | null>(null);
  const nuanceExpandAbortRef = useRef<AbortController | null>(null);
  const productionAbortRef = useRef<AbortController | null>(null);
  const similarHoverTimerRef = useRef<number | null>(null);
  const seekPreemptTriggerRef = useRef<((targetSec: number) => void) | null>(null);
  const lastReportedTimeForSeekRef = useRef<number>(0);
  const videoDurationSecRef = useRef<number | undefined>(undefined);
  const durationUpdateNotifyRef = useRef<((durSec: number) => void) | null>(null);
  const manualSttTriggerRef = useRef<(() => void) | null>(null);
  const tabAudioStreamRef = useRef<MediaStream | null>(null);
  const tabAudioRecorderRef = useRef<MediaRecorder | null>(null);
  const tabAudioTimerRef = useRef<number | null>(null);
  const tabAudioActiveRef = useRef<boolean>(false);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const handleTimeUpdate = useCallback((nextSec: number) => {
    const prevSec = lastReportedTimeForSeekRef.current;
    lastReportedTimeForSeekRef.current = nextSec;
    currentTimeRef.current = nextSec;
    setCurrentTime(nextSec);

    // Instant Seek-Preemption Detection: if user scrubs > 6s on YouTube scrubber into an untranslated segment,
    // immediately preempt and stream 8 lines at the new timestamp (< 1.5s)!
    if (Math.abs(nextSec - prevSec) > 6) {
      seekPreemptTriggerRef.current?.(nextSec);
    }
  }, []);

  // Eagerly preload YouTube IFrame API on app mount so YT.Player is warm before user pastes any link
  useEffect(() => {
    void preloadYouTubeIframeApi();
  }, []);

  const workerAuditResolversRef = useRef<Map<string, (lines: SubtitleLine[]) => void>>(new Map());
  const workerUnpackResolversRef = useRef<Map<string, (lines: SubtitleLine[]) => void>>(new Map());

  // Initialize Background Web Worker for 60 FPS i+1 Analytics, Timeline Auditing & Compact Tuple Unpacking
  useEffect(() => {
    try {
      const worker = new Worker(new URL('./workers/tokenizer.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (ev: MessageEvent) => {
        if (ev.data?.type === 'COMPUTE_I_PLUS_1_RESULT') {
          setIPlusOneReport(ev.data.report);
        } else if (ev.data?.type === 'AUDIT_AND_BUILD_TIMELINE_RESULT') {
          const reqId = String(ev.data.requestId || '');
          const resolver = workerAuditResolversRef.current.get(reqId);
          if (resolver) {
            workerAuditResolversRef.current.delete(reqId);
            resolver(Array.isArray(ev.data.lines) ? ev.data.lines : []);
          }
        } else if (ev.data?.type === 'UNPACK_COMPACT_BATCH_RESULT') {
          const reqId = String(ev.data.requestId || '');
          const resolver = workerUnpackResolversRef.current.get(reqId);
          if (resolver) {
            workerUnpackResolversRef.current.delete(reqId);
            resolver(Array.isArray(ev.data.lines) ? ev.data.lines : []);
          }
        }
      };
      workerRef.current = worker;
      return () => {
        workerAuditResolversRef.current.clear();
        workerUnpackResolversRef.current.clear();
        worker.terminate();
        workerRef.current = null;
      };
    } catch {
      return undefined;
    }
  }, []);

  // Off-Main-Thread Web Worker Compact Unpacker (<0.5ms per batch, instant local fallback if worker unavailable)
  const unpackBatchOffMainThread = useCallback(
    (
      batchLines: SubtitleLine[],
      lang: Language,
      lvl: ProficiencyLevel,
      immutableTimeMap?: Map<string, { start: number; duration: number; end: number }>
    ): Promise<SubtitleLine[]> => {
      if (batchLines.length === 0) return Promise.resolve([]);
      const timeEntries = immutableTimeMap
        ? batchLines
            .map((l) => {
              const t = immutableTimeMap.get(l.id);
              return t ? ([l.id, t] as [string, { start: number; duration: number; end: number }]) : null;
            })
            .filter((x): x is [string, { start: number; duration: number; end: number }] => x !== null)
        : undefined;

      if (!workerRef.current || batchLines.length < 6) {
        return Promise.resolve(unpackCompactSubtitleBatch(batchLines, lang, lvl, timeEntries));
      }

      return new Promise<SubtitleLine[]>((resolve) => {
        const requestId = `unpack_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let settled = false;
        const finish = (out: SubtitleLine[]) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(fallbackTimer);
          workerUnpackResolversRef.current.delete(requestId);
          resolve(out);
        };
        const fallbackTimer = window.setTimeout(() => {
          finish(unpackCompactSubtitleBatch(batchLines, lang, lvl, timeEntries));
        }, 350);

        workerUnpackResolversRef.current.set(requestId, finish);
        try {
          workerRef.current?.postMessage({
            type: 'UNPACK_COMPACT_BATCH',
            requestId,
            lines: batchLines,
            language: lang,
            targetLevel: lvl,
            immutableTimeEntries: timeEntries,
          });
        } catch {
          finish(unpackCompactSubtitleBatch(batchLines, lang, lvl, timeEntries));
        }
      });
    },
    []
  );

  // Load persisted offline IndexedDB data on startup
  const refreshOfflineData = useCallback(async () => {
    const [sessions, articles, cards, savedClips, logs, weaknessList] = await Promise.all([
      listVideoSessions(),
      listArticleSessions(),
      listFlashcards(),
      listSmartClips(),
      listActivityLogs(),
      listWeaknesses(),
    ]);
    setSavedSessions(sessions);
    setSavedArticles(articles);
    setFlashcards(cards);
    setClips(savedClips);
    setActivityLogs(logs);
    setWeaknesses(weaknessList);
  }, []);

  useEffect(() => {
    refreshOfflineData();
    void purgeLegacyWordCache('v3_kanji_verified::');
    void purgeLegacyTruncatedSessions(['v10_hyperspeed_exact_', 'v12_ai_sub_gen_']);
    void purgeLegacyShardedBatches(['v10_hyperspeed_exact_', 'v12_ai_sub_gen_']);
  }, [refreshOfflineData]);

  // Reload video-specific notes & similar videos
  useEffect(() => {
    if (!videoId) {
      setNotes([]);
      return;
    }
    listTimestampedNotes(videoId).then(setNotes);
    setSimilarFeed(getSimilarVideos(language, targetLevel, [videoId], undefined, 3));
  }, [videoId, language, targetLevel]);

  // Recompute i+1 Comprehensible Input via Web Worker
  useEffect(() => {
    if (lines.length === 0) {
      setIPlusOneReport(null);
      return;
    }
    const knownLemmas = flashcards
      .filter((c) => c.language === language)
      .map((c) => c.lemma || c.term);
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'COMPUTE_I_PLUS_1',
        requestId: `${videoId}_${lines.length}_${targetLevel}`,
        lines,
        language,
        targetLevel,
        knownLemmas,
      });
    }
  }, [lines, language, targetLevel, flashcards, videoId]);

  // Track Active Listening Minutes every 30s while playing
  useEffect(() => {
    if (!isPlaying || !videoId) return;
    const timer = window.setInterval(async () => {
      await incrementDailyActivity({ listeningMinutes: 0.5 });
      setActivityLogs(await listActivityLogs());
    }, 30000);
    return () => window.clearInterval(timer);
  }, [isPlaying, videoId]);

  // O(log n) Strict Zero-Ghost Active Spoken Line + Nearest Fallback (handles 3,000+ line 3h videos at 60 FPS)
  const activeSpokenLine = useMemo(
    () => findActiveSpokenLineBinarySearch(lines, currentTime),
    [lines, currentTime]
  );
  const nearestLine = useMemo(
    () => findNearestLineBinarySearch(lines, currentTime),
    [lines, currentTime]
  );
  // Active line alias for tools that need a contextual line even if paused during a silence gap
  const activeLine = activeSpokenLine ?? nearestLine;
  const isSilenceGap = lines.length > 0 && !activeSpokenLine && currentTime > 0.1;
  const prevSentence = useMemo(() => {
    if (!activeLine || activeLine.index <= 0) return undefined;
    const prev = lines[activeLine.index - 1];
    return prev?.text || prev?.rawText || undefined;
  }, [lines, activeLine]);
  const nextSentence = useMemo(() => {
    if (!activeLine || activeLine.index >= lines.length - 1) return undefined;
    const next = lines[activeLine.index + 1];
    return next?.text || next?.rawText || undefined;
  }, [lines, activeLine]);

  const enrichedCount = useMemo(() => lines.filter((l) => l.enriched).length, [lines]);
  const activeSessionId = videoId
    ? buildSessionKey(videoId, language, targetLevel, sourceLayer)
    : null;

  const persistCurrentSession = useCallback(
    async (overrides?: Partial<VideoSession>) => {
      const vid = overrides?.videoId ?? videoId;
      const lang = overrides?.language ?? language;
      const lvl = overrides?.targetLevel ?? targetLevel;
      const effLayer = overrides?.sourceLayer ?? sourceLayer;
      const currentLines = overrides?.lines ?? lines;
      if (!vid || currentLines.length === 0) return;

      const doneCount = currentLines.filter((l) => l.enriched).length;
      const effDuration =
        overrides?.videoDurationSec !== undefined
          ? overrides.videoDurationSec
          : videoDurationSecRef.current ?? videoDurationSec;
      const effHasMoreStt =
        overrides?.hasMoreStt !== undefined ? overrides.hasMoreStt : hasMoreStt;
      const lastLineEnd = currentLines.length > 0 ? currentLines[currentLines.length - 1].end : 0;
      const durationCovered = !effDuration || effDuration <= 25 || lastLineEnd >= effDuration - 20;
      const session: VideoSession = {
        id: buildSessionKey(vid, lang, lvl, effLayer),
        videoId: vid,
        url: `https://www.youtube.com/watch?v=${vid}`,
        title: overrides?.title ?? (videoTitle || `YouTube Video (${vid})`),
        channelName: overrides?.channelName ?? (channelName || 'YouTube'),
        language: lang,
        sourceLanguage: overrides?.sourceLanguage ?? sourceLanguage,
        sourceLayer: overrides?.sourceLayer ?? sourceLayer,
        targetLevel: lvl,
        videoDurationSec: effDuration,
        hasMoreStt: effHasMoreStt,
        nextSttOffsetSec:
          overrides?.nextSttOffsetSec !== undefined ? overrides.nextSttOffsetSec : nextSttOffsetSec,
        contextAnchor:
          overrides?.contextAnchor !== undefined
            ? overrides.contextAnchor
            : contextAnchor || undefined,
        isFullyTranslated:
          overrides?.isFullyTranslated !== undefined
            ? overrides.isFullyTranslated
            : doneCount >= currentLines.length &&
              currentLines.length > 0 &&
              !effHasMoreStt &&
              durationCovered,
        completedLineCount: overrides?.completedLineCount ?? doneCount,
        syncOffsetSec: overrides?.syncOffsetSec !== undefined ? overrides.syncOffsetSec : syncOffsetSec,
        sourceViLines:
          overrides?.sourceViLines !== undefined
            ? overrides.sourceViLines
            : sourceViLines.length > 0
              ? sourceViLines
              : undefined,
        lines: currentLines,
        curriculum: overrides?.curriculum !== undefined ? overrides.curriculum : curriculum || undefined,
        collocations3Tier:
          overrides?.collocations3Tier !== undefined
            ? overrides.collocations3Tier
            : collocations3Tier || undefined,
        studySheet: overrides?.studySheet !== undefined ? overrides.studySheet : studySheet || undefined,
        chapters: overrides?.chapters !== undefined ? overrides.chapters : chapters || undefined,
        nuanceMatrix:
          overrides?.nuanceMatrix !== undefined ? overrides.nuanceMatrix : nuanceMatrix || undefined,
        productionPack:
          overrides?.productionPack !== undefined
            ? overrides.productionPack
            : productionPack || undefined,
        xrayCache: overrides?.xrayCache ?? xrayCache,
        lastPosition: overrides?.lastPosition ?? currentTime,
        updatedAt: Date.now(),
      };
      setSessionL1(session);
      await saveVideoSession(session);
      setSavedSessions(await listVideoSessions());
    },
    [
      videoId,
      language,
      targetLevel,
      lines,
      videoTitle,
      channelName,
      sourceLanguage,
      sourceLayer,
      videoDurationSec,
      hasMoreStt,
      nextSttOffsetSec,
      contextAnchor,
      syncOffsetSec,
      sourceViLines,
      curriculum,
      collocations3Tier,
      studySheet,
      chapters,
      nuanceMatrix,
      productionPack,
      xrayCache,
      currentTime,
    ]
  );

  const handleAdjustSyncOffset = useCallback(
    (nextOffset: number) => {
      const clamped = Math.max(-0.5, Math.min(0.5, Number(nextOffset.toFixed(2))));
      setSyncOffsetSec(clamped);
      void persistCurrentSession({ syncOffsetSec: clamped });
    },
    [persistCurrentSession]
  );

  // Flush derived linguistic caches without dropping videoId
  const flushDerivedCaches = useCallback(() => {
    videoLoadAbortRef.current?.abort();
    enrichAbortRef.current?.abort();
    lookupAbortRef.current?.abort();
    xrayAbortRef.current?.abort();
    curriculumAbortRef.current?.abort();
    collocationsAbortRef.current?.abort();
    studySheetAbortRef.current?.abort();
    chaptersAbortRef.current?.abort();
    nuanceAbortRef.current?.abort();
    nuanceExpandAbortRef.current?.abort();
    productionAbortRef.current?.abort();

    setSelectedToken(null);
    setWordProfile(null);
    setLookupError(null);
    setIsLookupLoading(false);

    setXrayTargetLineId(null);
    setXrayCache({});
    setXrayError(null);
    setIsXrayLoading(false);

    setCurriculum(null);
    setCurriculumError(null);
    setIsCurriculumLoading(false);

    setCollocations3Tier(null);
    setCollocationsError(null);
    setIsCollocationsLoading(false);

    setStudySheet(null);
    setStudySheetError(null);
    setIsStudySheetLoading(false);

    setChapters(null);
    setChaptersError(null);
    setIsChaptersLoading(false);

    setNuanceMatrix(null);
    setNuanceError(null);
    setIsNuanceLoading(false);
    setIsNuanceExpanding(false);

    setProductionPack(null);
    setProductionError(null);
    setIsProductionLoading(false);

    setLoadBannerError(null);
    setIsInvalidUrlError(false);
    setIsEnrichingBg(false);
  }, []);

  const stopTabAudioCapture = useCallback(() => {
    tabAudioActiveRef.current = false;
    if (tabAudioTimerRef.current !== null) {
      window.clearInterval(tabAudioTimerRef.current);
      tabAudioTimerRef.current = null;
    }
    try {
      if (tabAudioRecorderRef.current && tabAudioRecorderRef.current.state !== 'inactive') {
        tabAudioRecorderRef.current.stop();
      }
    } catch {
      // Ignore recorder stop race
    }
    tabAudioRecorderRef.current = null;
    if (tabAudioStreamRef.current) {
      tabAudioStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      tabAudioStreamRef.current = null;
    }
    setIsTabAudioListening(false);
  }, []);

  useEffect(() => {
    return () => {
      stopTabAudioCapture();
    };
  }, [stopTabAudioCapture]);

  const toggleTabAudioCapture = useCallback(async () => {
    if (tabAudioActiveRef.current) {
      stopTabAudioCapture();
      showToast('Đã dừng chế độ AI nghe âm thanh trực tiếp.');
      return;
    }
    if (!videoId) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      showToast('Trình duyệt hiện tại chưa hỗ trợ thu âm tab. Bạn có thể nạp file .SRT thủ công.');
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        displayStream.getTracks().forEach((t) => t.stop());
        showToast('Hãy bật tùy chọn "Chia sẻ âm thanh tab" (Share tab audio) khi chọn tab YouTube.');
        return;
      }

      // Keep audio tracks active; stop unused video capture track to minimize CPU overhead
      displayStream.getVideoTracks().forEach((vt) => {
        try {
          vt.stop();
        } catch {
          // Ignore
        }
      });

      const audioOnlyStream = new MediaStream(audioTracks);
      tabAudioStreamRef.current = audioOnlyStream;
      tabAudioActiveRef.current = true;
      setIsTabAudioListening(true);
      setAiAudioRestricted(false);
      setSourceLayer('stt_ai');
      showToast('🎙️ AI đang nghe âm thanh tab và tự động tạo phụ đề mỗi 9 giây...');

      audioTracks[0].addEventListener(
        'ended',
        () => {
          stopTabAudioCapture();
        },
        { once: true }
      );

      const preferredMime =
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';

      const captureVideoId = videoId;
      const captureLang = language;
      const captureLvl = targetLevel;
      const captureTitle = videoTitle;
      const captureSessionKey = buildSessionKey(captureVideoId, captureLang, captureLvl, 'stt_ai');

      const startRollingSlice = () => {
        if (!tabAudioActiveRef.current || !tabAudioStreamRef.current) return;
        const sliceStartSec = Math.max(0, Number((currentTimeRef.current || 0).toFixed(2)));
        const chunks: BlobPart[] = [];
        const recorder = preferredMime
          ? new MediaRecorder(tabAudioStreamRef.current, { mimeType: preferredMime })
          : new MediaRecorder(tabAudioStreamRef.current);
        tabAudioRecorderRef.current = recorder;

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };

        recorder.onstop = async () => {
          if (chunks.length === 0) return;
          const mimeType = (preferredMime || recorder.mimeType || 'audio/webm').split(';')[0];
          const blob = new Blob(chunks, { type: mimeType });
          if (blob.size < 1200) return;

          try {
            const base64Audio = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const res = String(reader.result || '');
                const idx = res.indexOf(',');
                resolve(idx !== -1 ? res.slice(idx + 1) : res);
              };
              reader.onerror = () => reject(new Error('Không thể đọc âm thanh'));
              reader.readAsDataURL(blob);
            });

            const resp = await transcribeTabAudioChunkClient({
              audioBase64: base64Audio,
              mimeType,
              chunkStartSec: sliceStartSec,
              targetLanguage: captureLang,
              targetLevel: captureLvl,
              videoTitle: captureTitle,
            });
            if (!resp.lines || resp.lines.length === 0) return;

            const stamp = Date.now().toString(36).slice(-4);
            const drafts: SubtitleLine[] = resp.lines
              .map((r, i) => {
                const cleanTxt = stripHtmlAndRubyArtifacts(r.text || '').replace(/\s+/g, ' ').trim();
                if (!cleanTxt || isNonSpeechCueText(cleanTxt)) return null;
                const start = Math.max(0, Number(r.start.toFixed(2)));
                const duration = Math.max(0.45, Number(r.duration.toFixed(2)));
                const end = Number((start + duration).toFixed(2));
                return {
                  id: `tab_${Math.round(start * 100)}_${i}_${stamp}`,
                  index: i,
                  start,
                  duration,
                  end,
                  text: cleanTxt,
                  readingMap: r.readingMap,
                  ipaLine: r.ipaLine,
                  rawText: r.translationVi || undefined,
                  translationVi: r.translationVi || '',
                  tokens: [],
                  enriched: true,
                } as SubtitleLine;
              })
              .filter((x): x is SubtitleLine => x !== null);

            if (drafts.length === 0) return;
            const unpacked = unpackCompactSubtitleBatch(drafts, captureLang, captureLvl);
            let mergedSnapshot: SubtitleLine[] = [];
            setLines((prev) => {
              const next = [...prev];
              for (const u of unpacked) {
                const exists = next.some(
                  (ex) =>
                    Math.abs(ex.start - u.start) < 1.3 ||
                    (u.start >= ex.start && u.end <= ex.end + 0.3)
                );
                if (!exists) next.push(u);
              }
              next.sort((a, b) => a.start - b.start);
              mergedSnapshot = next.map((item, idx) => {
                const nxt = next[idx + 1];
                let end = item.end;
                if (nxt && end > nxt.start - 0.04) {
                  end = Math.max(item.start + 0.3, Number((nxt.start - 0.04).toFixed(2)));
                }
                return {
                  ...item,
                  index: idx,
                  end,
                  duration: Number(Math.max(0.3, end - item.start).toFixed(2)),
                };
              });
              return mergedSnapshot;
            });

            if (mergedSnapshot.length > 0) {
              const shardIdx = Math.floor(sliceStartSec / 60);
              void saveShardedBatch(captureSessionKey, shardIdx, unpacked).catch(() => undefined);
              void persistCurrentSession({
                lines: mergedSnapshot,
                sourceLayer: 'stt_ai',
                hasMoreStt: false,
              }).catch(() => undefined);
            }
          } catch (err) {
            const metaErr = err as { isDailyQuota?: boolean } | null;
            if (metaErr?.isDailyQuota) {
              stopTabAudioCapture();
              setLoadBannerError(
                err instanceof Error
                  ? err.message
                  : 'Hạn mức gọi AI miễn phí hôm nay đã tạm hết.'
              );
            }
          }
        };

        recorder.start();
        window.setTimeout(() => {
          try {
            if (recorder.state === 'recording') {
              recorder.stop();
            }
          } catch {
            // Ignore
          }
        }, 8800);
      };

      startRollingSlice();
      tabAudioTimerRef.current = window.setInterval(() => {
        if (!tabAudioActiveRef.current) return;
        startRollingSlice();
      }, 9000);
    } catch {
      stopTabAudioCapture();
    }
  }, [
    videoId,
    language,
    targetLevel,
    videoTitle,
    stopTabAudioCapture,
    persistCurrentSession,
    showToast,
  ]);

  const flushVideoWorkspaceState = useCallback(() => {
    stopTabAudioCapture();
    flushDerivedCaches();
    seekPreemptTriggerRef.current = null;
    durationUpdateNotifyRef.current = null;
    manualSttTriggerRef.current = null;
    videoDurationSecRef.current = undefined;
    setAiAudioRestricted(false);
    setLoopSingleLine(false);
    setLoopA(null);
    setLoopB(null);
    setActiveClipId(null);
    setHasMoreStt(false);
    setNextSttOffsetSec(0);
    setIsLoadingMoreStt(false);
    setSourceViLines([]);
    setVideoDurationSec(undefined);
    setContextAnchor(null);
    setSyncOffsetSec(0);
    setSlaProgress({ startedAtMs: null, completedInSec: null, etaSec: null, emaCuesPerSec: 0 });
    lastReportedTimeForSeekRef.current = 0;
  }, [flushDerivedCaches, stopTabAudioCapture]);

  // ZERO-WASTE NON-SPEECH OUTRO FILTER (music / applause / symbols / empty cues never waste an AI call)
  const isNonSpeechCueText = (raw: string): boolean => {
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return true;
    const stripped = t
      .replace(
        /[\[\(（【]\s*(?:âm nhạc|nhạc nền|nhạc|tiếng vỗ tay|vỗ tay|tiếng cười|cười|hò reo|tiếng động|im lặng|music|applause|laughter|cheering|silence|sound effects?|instrumental|outro|intro|音楽|拍手|笑い|歓声|効果音|bgm)\s*[\]\)）】]/gi,
        ''
      )
      .replace(/[♪♫♬♩🎵🎶•·\-–—_.…!?！？,，。:：;；\s]/g, '')
      .trim();
    return stripped.length === 0;
  };

  // O(1) CONSTANT-SIZE CONTEXT TRIMMER (<= 100 words header, <= 25 LRU glossary terms)
  const capWordsO1 = (raw: string, maxWords: number): string => {
    const clean = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!clean || maxWords <= 0) return '';
    const words = clean.split(' ');
    let out = words.length > maxWords ? words.slice(0, maxWords).join(' ') : clean;
    const maxChars = Math.max(24, Math.round(maxWords * 7));
    if (out.length > maxChars) out = out.slice(0, maxChars).trim();
    return out;
  };

  const clampContextAnchorO1 = (
    anchor?: VideoContextAnchor
  ): VideoContextAnchor | undefined => {
    if (!anchor) return undefined;
    const seen = new Set<string>();
    const cappedGlossary: Array<{ sourceTerm: string; targetTerm: string }> = [];
    for (const g of anchor.glossary || []) {
      const src = capWordsO1(g?.sourceTerm || '', 5);
      const tgt = capWordsO1(g?.targetTerm || '', 5);
      if (!src || !tgt) continue;
      const key = src.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cappedGlossary.push({ sourceTerm: src, targetTerm: tgt });
      if (cappedGlossary.length >= 20) break;
    }
    return {
      summaryVi: capWordsO1(anchor.summaryVi || '', 55),
      registerPolicy: capWordsO1(anchor.registerPolicy || '', 25),
      glossary: cappedGlossary,
    };
  };

  // UNIFIED O(1) CONSTANT-LATENCY 0%-TO-100% ROLLING SUBTITLE & STT PIPELINE
  // 1. O(1) Constant-Size Prompt Cap: <=100w Header + <=25 LRU Glossary + 2-Sentence (<=40w) Overlap — Stateless per batch
  // 2. Dedicated Express Worker Slot (1 Express + 2 Background = 3): Express exclusively streams playhead & +120s buffer
  //    cue-by-cue (300-600ms TTFL) with 4.5s aggressive abort + instant half-split; Background runs 7s timeout + half-split
  // 3. Token-Bucket Smooth Pacing (220ms smooth cadence) + fast jittered backoff (500ms -> 1200ms -> 2500ms)
  // 4. O(1) lineIndexById Map + Normalized batchesByIndex + O(1) Local Boundary Check + Non-Blocking Sharded IndexedDB + 1000ms Debounced Manifest
  // 5. Zero-Waste Non-Speech Outro Filter + Uniform 14-Cue Smart Tail Balancing (18 -> 9+9, 15..16 -> single balanced batch)
  const runProgressiveEnrichment = useCallback(
    async (
      rawLines: SubtitleLine[],
      meta: {
        videoId: string;
        title: string;
        channelName: string;
        language: Language;
        sourceLanguage: SourceLanguage;
        sourceLayer: SubtitleSourceLayer;
        targetLevel: ProficiencyLevel;
        isAsr: boolean;
        sourceViLines?: RawSourceLine[];
        initialFocusSec?: number;
        videoDurationSec?: number;
        existingContextAnchor?: VideoContextAnchor;
        syncOffsetSec?: number;
        initialHasMoreStt?: boolean;
        initialNextSttOffsetSec?: number;
      }
    ) => {
      enrichAbortRef.current?.abort();
      const controller = new AbortController();
      enrichAbortRef.current = controller;

      setIsEnrichingBg(true);
      const workingLines: SubtitleLine[] = rawLines.map((l) => {
        if (!l.enriched) {
          const rawTxt =
            meta.sourceLanguage === 'vi' ? l.rawText || l.translationVi || l.text : l.text;
          if (isNonSpeechCueText(rawTxt)) {
            return { ...l, text: '', translationVi: '', tokens: [], enriched: true };
          }
        }
        return l;
      });
      let workingSourceViLines: RawSourceLine[] = meta.sourceViLines ? [...meta.sourceViLines] : [];

      const MICRO_BATCH_SIZE = 6;
      const EXPRESS_STREAM_SIZE = 14;
      const EXPRESS_TIMEOUT_MS = 3500;
      const BG_TIMEOUT_MS = 6000;
      const TAIL_PHASE_TIMEOUT_MS = 5500;
      const sessionKey = buildSessionKey(
        meta.videoId,
        meta.language,
        meta.targetLevel,
        meta.sourceLayer
      );

      // HYPER-SPEED ZERO-WAIT MODE + STRICT COMPLETION SLA BUDGET CONTROLLER
      // - Tier 1 (< 10m): 22 cues/batch, AIMD 4..6 bg workers + 1 Express Slot
      // - Tier 2 (10-30m -> HARD SLA <= 180s): 28 cues/batch, AIMD 6..8 bg workers + 1 Express Slot
      // - Tier 3 (> 30m to 3-5h+ -> HARD SLA <= 360s): 36-42 cues/batch, AIMD 8..10 bg workers + 1 Express Slot
      const initialLastCueEnd =
        workingLines.length > 0 ? workingLines[workingLines.length - 1].end : 0;
      const budgetDurationSec = Math.max(
        meta.videoDurationSec || 0,
        videoDurationSecRef.current || 0,
        initialLastCueEnd
      );
      const budgetDurationMin = budgetDurationSec / 60;
      const STT_WINDOW_SEC = budgetDurationMin >= 30 ? 130 : 105;
      const STT_PARALLEL_WORKERS = budgetDurationMin >= 30 ? 6 : 5;
      let initialPendingCount = 0;
      for (let i = 0; i < workingLines.length; i++) {
        if (!workingLines[i].enriched) initialPendingCount++;
      }

      let BATCH_SIZE = 22;
      let AIMD_INITIAL = 4;
      let AIMD_MAX = 6;
      if (budgetDurationMin >= 30 || initialPendingCount >= 550) {
        BATCH_SIZE = initialPendingCount >= 1400 ? 42 : 36;
        AIMD_INITIAL = 8;
        AIMD_MAX = 10;
      } else if (budgetDurationMin >= 10 || initialPendingCount >= 180) {
        BATCH_SIZE = 28;
        AIMD_INITIAL = 6;
        AIMD_MAX = 8;
      }

      // Adaptive AIMD Concurrency State (+1 after 2 consecutive clean fast batches; x0.5 on 429)
      let targetBgConcurrency = AIMD_INITIAL;
      let consecutiveCleanBatches = 0;
      let quotaCircuitOpen = false;
      let consecutive429Count = 0;
      const tripQuotaCircuit = (customMsg?: string) => {
        if (quotaCircuitOpen) return;
        quotaCircuitOpen = true;
        targetBgConcurrency = 1;
        setIsLoadingMoreStt(false);
        setLoadBannerError(
          customMsg ||
            'Hạn mức gọi AI miễn phí hôm nay đã tạm hết. Các phụ đề đã dịch vẫn được giữ nguyên; vui lòng chờ hạn mức làm mới hoặc chuyển sang khóa API trả phí trong Settings > Secrets.'
        );
        signalWorkers();
      };

      // Live SLA 10-Second Sliding EMA Speed & ETA Telemetry
      const slaStartedAtMs = Date.now();
      const emaSamples: Array<{ ts: number; count: number }> = [];
      let lastSlaUiUpdateMs = 0;
      setSlaProgress({
        startedAtMs: slaStartedAtMs,
        completedInSec: null,
        etaSec: null,
        emaCuesPerSec: 0,
      });

      const recordSlaProgress = (deltaCues: number, forceFinal = false) => {
        if (controller.signal.aborted) return;
        const now = Date.now();
        if (deltaCues > 0) {
          emaSamples.push({ ts: now, count: deltaCues });
        }
        const windowCutoff = now - 10_000;
        while (emaSamples.length > 0 && emaSamples[0].ts < windowCutoff) {
          emaSamples.shift();
        }

        if (!forceFinal && now - lastSlaUiUpdateMs < 420) return;
        lastSlaUiUpdateMs = now;

        const remainingCues = Math.max(0, workingLines.length - enrichedCount);
        const totalWindowCues = emaSamples.reduce((sum, s) => sum + s.count, 0);
        const spanSec =
          emaSamples.length > 0
            ? Math.max(1.2, (now - Math.max(slaStartedAtMs, emaSamples[0].ts - 800)) / 1000)
            : Math.max(1.2, (now - slaStartedAtMs) / 1000);
        const emaSpeed = totalWindowCues / spanSec;
        const etaSec =
          remainingCues === 0
            ? 0
            : emaSpeed > 0.1
              ? Math.max(1, Math.ceil(remainingCues / emaSpeed))
              : null;

        setSlaProgress({
          startedAtMs: slaStartedAtMs,
          completedInSec: forceFinal
            ? Math.max(1, Math.round((now - slaStartedAtMs) / 1000))
            : null,
          etaSec,
          emaCuesPerSec: Number(emaSpeed.toFixed(1)),
        });
      };

      // O(1) Normalized Lookups: lineIndexById + batchesByIndex + immutableTimeMap
      const lineIndexById = new Map<string, number>();
      const batchesByIndex = new Map<number, SubtitleLine[]>();
      const immutableTimeMap = new Map<string, { start: number; duration: number; end: number }>();

      const rebuildO1Indexes = () => {
        lineIndexById.clear();
        batchesByIndex.clear();
        for (let i = 0; i < workingLines.length; i++) {
          const l = workingLines[i];
          lineIndexById.set(l.id, i);
          if (!immutableTimeMap.has(l.id)) {
            immutableTimeMap.set(l.id, { start: l.start, duration: l.duration, end: l.end });
          }
          const shardIdx = Math.floor(i / BATCH_SIZE);
          let bucket = batchesByIndex.get(shardIdx);
          if (!bucket) {
            bucket = [];
            batchesByIndex.set(shardIdx, bucket);
          }
          bucket.push(l);
        }
      };
      rebuildO1Indexes();

      let enrichedCount = 0;
      for (let i = 0; i < workingLines.length; i++) {
        if (workingLines[i].enriched) enrichedCount++;
      }

      if (meta.videoDurationSec && meta.videoDurationSec > 5) {
        if (!videoDurationSecRef.current || meta.videoDurationSec > videoDurationSecRef.current) {
          videoDurationSecRef.current = meta.videoDurationSec;
        }
      }

      let liveContextAnchor: VideoContextAnchor | undefined = clampContextAnchorO1(
        meta.existingContextAnchor
      );
      const inFlightLineIds = new Set<string>();
      let persistChain: Promise<void> = Promise.resolve();
      let lastSavedDoneCount = enrichedCount;
      let lastSavedLineTotal = workingLines.length;
      let manifestDebounceTimer: number | null = null;
      let uiFlushRafId: number | null = null;

      // UI-First 60FPS Coalesced Render Flush (0ms latency, never stalls main thread)
      const scheduleUiFlush = (immediate = false) => {
        if (controller.signal.aborted) return;
        if (immediate) {
          if (uiFlushRafId !== null) {
            window.cancelAnimationFrame(uiFlushRafId);
            uiFlushRafId = null;
          }
          setLines(workingLines.slice());
          return;
        }
        if (uiFlushRafId !== null) return;
        uiFlushRafId = window.requestAnimationFrame(() => {
          uiFlushRafId = null;
          if (!controller.signal.aborted) {
            setLines(workingLines.slice());
          }
        });
      };

      // Non-blocking background idle scheduler for IndexedDB shard writes
      const runInIdle = (task: () => void) => {
        const ric = (
          window as unknown as {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
          }
        ).requestIdleCallback;
        if (typeof ric === 'function') {
          ric(task, { timeout: 600 });
        } else {
          window.setTimeout(task, 0);
        }
      };

      // O(1) Local Boundary Audit: verifies ONLY the touched batch's cues + 2 adjacent boundary cues
      const verifyLocalBatchBoundaries = (touchedIndices: number[]) => {
        if (touchedIndices.length === 0) return;
        let minIdx = touchedIndices[0];
        let maxIdx = touchedIndices[0];
        for (let i = 1; i < touchedIndices.length; i++) {
          if (touchedIndices[i] < minIdx) minIdx = touchedIndices[i];
          if (touchedIndices[i] > maxIdx) maxIdx = touchedIndices[i];
        }
        const startCheck = Math.max(0, minIdx - 1);
        const endCheck = Math.min(workingLines.length - 1, maxIdx + 1);
        for (let i = startCheck; i <= endCheck; i++) {
          const cur = workingLines[i];
          const locked = immutableTimeMap.get(cur.id);
          if (locked && (cur.start !== locked.start || cur.end !== locked.end)) {
            workingLines[i] = {
              ...cur,
              start: locked.start,
              duration: locked.duration,
              end: locked.end,
            };
          }
          const next = workingLines[i + 1];
          if (next && workingLines[i].end > next.start) {
            const clampedEnd = Math.max(
              workingLines[i].start + 0.2,
              Number(next.start.toFixed(3))
            );
            workingLines[i] = {
              ...workingLines[i],
              end: clampedEnd,
              duration: Number(Math.max(0.2, clampedEnd - workingLines[i].start).toFixed(3)),
            };
          }
          // Sync normalized shard slot in O(1)
          const shardIdx = Math.floor(i / BATCH_SIZE);
          const offsetInShard = i % BATCH_SIZE;
          const shardBucket = batchesByIndex.get(shardIdx);
          if (shardBucket && offsetInShard < shardBucket.length) {
            shardBucket[offsetInShard] = workingLines[i];
          }
        }
      };

      // Non-Blocking Sharded IndexedDB Write: writes ONLY the touched shard(s) AFTER UI render!
      const persistShardedByLineIdsAsync = (updatedIds: string[]) => {
        if (updatedIds.length === 0 || controller.signal.aborted) return;
        const touchedShardIndices = new Set<number>();
        for (const id of updatedIds) {
          const idx = lineIndexById.get(id);
          if (idx === undefined) continue;
          if (!workingLines[idx]?.enriched) continue;
          touchedShardIndices.add(Math.floor(idx / BATCH_SIZE));
        }
        if (touchedShardIndices.size === 0) return;

        // Snapshot only the touched shard arrays before idle write
        const shardPayloads: Array<{ shardIdx: number; lines: SubtitleLine[] }> = [];
        touchedShardIndices.forEach((shardIdx) => {
          const bucket = batchesByIndex.get(shardIdx);
          if (bucket && bucket.length > 0) {
            const enrichedInShard = bucket.filter((l) => l.enriched);
            if (enrichedInShard.length > 0) {
              shardPayloads.push({ shardIdx, lines: enrichedInShard });
            }
          }
        });

        runInIdle(() => {
          if (controller.signal.aborted) return;
          for (const item of shardPayloads) {
            void saveShardedBatch(sessionKey, item.shardIdx, item.lines).catch(() => undefined);
          }
        });
      };

      // High-Throughput Smooth Token-Bucket Pacer (Express Slot ALWAYS skips to front!)
      const TOKEN_BUCKET_CAPACITY = AIMD_MAX + 1;
      const TOKEN_REFILL_MS = 95;
      let availableTokens = Math.min(TOKEN_BUCKET_CAPACITY, AIMD_INITIAL + 1);
      let lastTokenRefillTs = Date.now();
      const expressTokenWaiters: Array<() => void> = [];
      const bgTokenWaiters: Array<() => void> = [];
      let tokenTimerId: number | null = null;

      const pumpTokenBucket = () => {
        const now = Date.now();
        const elapsed = now - lastTokenRefillTs;
        if (elapsed >= TOKEN_REFILL_MS) {
          const gained = Math.floor(elapsed / TOKEN_REFILL_MS);
          availableTokens = Math.min(TOKEN_BUCKET_CAPACITY, availableTokens + gained);
          lastTokenRefillTs += gained * TOKEN_REFILL_MS;
        }
        while (availableTokens > 0 && expressTokenWaiters.length > 0) {
          availableTokens--;
          expressTokenWaiters.shift()?.();
        }
        while (availableTokens > 0 && bgTokenWaiters.length > 0) {
          availableTokens--;
          bgTokenWaiters.shift()?.();
        }
        if (
          (expressTokenWaiters.length > 0 || bgTokenWaiters.length > 0) &&
          tokenTimerId === null &&
          !controller.signal.aborted
        ) {
          tokenTimerId = window.setTimeout(() => {
            tokenTimerId = null;
            pumpTokenBucket();
          }, Math.max(30, TOKEN_REFILL_MS - (Date.now() - lastTokenRefillTs)));
        }
      };

      const acquireSmoothToken = (priority: 'express' | 'background'): Promise<void> => {
        if (controller.signal.aborted) return Promise.resolve();
        pumpTokenBucket();
        if (availableTokens > 0 && (priority === 'express' || expressTokenWaiters.length === 0)) {
          availableTokens--;
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          if (priority === 'express') {
            expressTokenWaiters.push(done);
          } else {
            bgTokenWaiters.push(done);
          }
          controller.signal.addEventListener('abort', done, { once: true });
          pumpTokenBucket();
        });
      };

      // Per-Batch Child AbortController with Strict SLA Timeouts (4.0s Express / 6.5s BG / 5.5s Tail Phase)
      const createBatchAbortController = (timeoutMs: number) => {
        const batchAc = new AbortController();
        const onParentAbort = () => batchAc.abort();
        controller.signal.addEventListener('abort', onParentAbort, { once: true });
        const timer = window.setTimeout(() => {
          batchAc.abort(new Error(`Batch timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        const cleanup = () => {
          window.clearTimeout(timer);
          controller.signal.removeEventListener('abort', onParentAbort);
        };
        return { batchAc, cleanup };
      };

      // Track A (Rolling STT) state
      const isSttMode = meta.sourceLayer === 'stt_ai';
      const initialLastEnd =
        workingLines.length > 0 ? workingLines[workingLines.length - 1].end : 0;
      let sttNextOffsetSec =
        meta.initialNextSttOffsetSec !== undefined && meta.initialNextSttOffsetSec > 0
          ? meta.initialNextSttOffsetSec
          : Math.max(0, Math.floor(initialLastEnd > 4 ? initialLastEnd - 2 : 0));

      const harvestedIntervals: Array<[number, number]> = [];
      const mergeInterval = (start: number, end: number) => {
        const s = Math.max(0, Math.floor(start));
        const e = Math.max(s + 1, Math.ceil(end));
        harvestedIntervals.push([s, e]);
        harvestedIntervals.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [];
        for (const interval of harvestedIntervals) {
          if (merged.length === 0 || interval[0] > merged[merged.length - 1][1] + 4) {
            merged.push([interval[0], interval[1]]);
          } else {
            merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], interval[1]);
          }
        }
        harvestedIntervals.length = 0;
        harvestedIntervals.push(...merged);
      };

      if (isSttMode && workingLines.length > 0) {
        const firstStart = Math.max(0, Math.floor(workingLines[0].start));
        const seedEnd = Math.max(sttNextOffsetSec, Math.ceil(initialLastEnd + 2));
        mergeInterval(firstStart <= 25 ? 0 : firstStart, seedEnd);
      }

      const getEffectiveDurationSec = () =>
        Math.max(videoDurationSecRef.current || 0, meta.videoDurationSec || 0);

      let sttConsecutiveEmpty = 0;
      const sttEmptyRetriesByBucket = new Map<number, number>();
      let sttLoopActive = false;
      let urgentSttInFlight = false;
      let activeExpressWorkers = 0;
      let activeBgWorkers = 0;
      let sttHasMore = isSttMode
        ? Boolean(meta.initialHasMoreStt) ||
          (getEffectiveDurationSec() > 25 && initialLastEnd < getEffectiveDurationSec() - 20)
        : false;

      if (isSttMode) {
        setHasMoreStt(sttHasMore);
        setNextSttOffsetSec(sttNextOffsetSec);
      }

      const isTimestampHarvested = (sec: number) =>
        harvestedIntervals.some(([s, e]) => sec >= s - 2 && sec <= e + 2);

      const findNextUnharvestedOffset = (): number | null => {
        if (!isSttMode) return null;
        const knownDur = getEffectiveDurationSec();
        if (knownDur > 25) {
          let cursor = 0;
          for (const [s, e] of harvestedIntervals) {
            if (cursor + 10 < s) return cursor;
            cursor = Math.max(cursor, e);
          }
          if (cursor < knownDur - 12) return Math.max(0, cursor - 2);
          return null;
        }
        if (sttHasMore && sttConsecutiveEmpty < 2) {
          return Math.max(0, sttNextOffsetSec);
        }
        return null;
      };

      let wakeResolvers: Array<() => void> = [];
      const signalWorkers = () => {
        const list = wakeResolvers;
        wakeResolvers = [];
        list.forEach((fn) => fn());
      };

      const waitForWorkSignal = (timeoutMs: number) =>
        new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve();
          };
          const timer = window.setTimeout(finish, timeoutMs);
          wakeResolvers.push(finish);
          controller.signal.addEventListener('abort', finish, { once: true });
        });

      const sleepWithAbort = (ms: number) =>
        new Promise<void>((resolve) => {
          const id = window.setTimeout(resolve, ms);
          controller.signal.addEventListener(
            'abort',
            () => {
              window.clearTimeout(id);
              resolve();
            },
            { once: true }
          );
        });

      // 1000ms Debounced Non-Blocking Manifest Persistence (NEVER rewrites multi-MB full video on every batch!)
      const flushManifestNow = (refreshHistoryList = false) => {
        if (controller.signal.aborted) return persistChain;
        const doneCount = enrichedCount;
        if (!refreshHistoryList && doneCount <= lastSavedDoneCount && workingLines.length <= lastSavedLineTotal) {
          return persistChain;
        }
        lastSavedDoneCount = doneCount;
        lastSavedLineTotal = workingLines.length;
        const snapshotCopy = workingLines.slice();

        persistChain = persistChain
          .then(async () => {
            if (controller.signal.aborted) return;
            const existing =
              getSessionL1(sessionKey) || (await getVideoSession(sessionKey).catch(() => undefined));
            if (controller.signal.aborted) return;

            const knownDur = getEffectiveDurationSec() || existing?.videoDurationSec;
            const lastEnd = snapshotCopy.length > 0 ? snapshotCopy[snapshotCopy.length - 1].end : 0;
            const durationCovered = !knownDur || knownDur <= 25 || lastEnd >= knownDur - 20;
            const moreSttPending =
              isSttMode && (sttHasMore || sttLoopActive || findNextUnharvestedOffset() !== null);
            const isFullyComplete =
              snapshotCopy.length > 0 &&
              doneCount >= snapshotCopy.length &&
              !moreSttPending &&
              durationCovered;

            const sessionObj: VideoSession = {
              ...(existing || {}),
              id: sessionKey,
              videoId: meta.videoId,
              url: `https://www.youtube.com/watch?v=${meta.videoId}`,
              title: meta.title,
              channelName: meta.channelName,
              language: meta.language,
              sourceLanguage: meta.sourceLanguage,
              sourceLayer: meta.sourceLayer,
              targetLevel: meta.targetLevel,
              videoDurationSec: knownDur,
              hasMoreStt: moreSttPending,
              nextSttOffsetSec: sttNextOffsetSec,
              contextAnchor: liveContextAnchor ?? existing?.contextAnchor,
              isFullyTranslated: isFullyComplete,
              completedLineCount: doneCount,
              syncOffsetSec: meta.syncOffsetSec ?? existing?.syncOffsetSec ?? 0,
              sourceViLines:
                workingSourceViLines.length > 0 ? workingSourceViLines : existing?.sourceViLines,
              lines: snapshotCopy,
              xrayCache: existing?.xrayCache || {},
              lastPosition: currentTimeRef.current || existing?.lastPosition || 0,
              updatedAt: Date.now(),
            };
            setSessionL1(sessionObj);
            await saveVideoSession(sessionObj);
            if (refreshHistoryList && !controller.signal.aborted) {
              setSavedSessions(await listVideoSessions());
            }
          })
          .catch((err) => {
            console.warn('[KotoZen Debounced Manifest Persist]', err);
          });

        return persistChain;
      };

      const scheduleDebouncedManifestSave = () => {
        if (controller.signal.aborted) return;
        if (manifestDebounceTimer !== null) {
          window.clearTimeout(manifestDebounceTimer);
        }
        manifestDebounceTimer = window.setTimeout(() => {
          manifestDebounceTimer = null;
          runInIdle(() => {
            void flushManifestNow(false);
          });
        }, 1000);
      };

      // O(1) Lookup helpers
      const findIndexById = (lineId: string): number => {
        const idx = lineIndexById.get(lineId);
        return idx !== undefined ? idx : -1;
      };

      const isLinePending = (id: string): boolean => {
        const idx = lineIndexById.get(id);
        return idx !== undefined && !workingLines[idx].enriched;
      };

      const applySingleValidatedLineById = (lineId: string, updated: SubtitleLine): number => {
        const idx = findIndexById(lineId);
        if (idx === -1) return -1;
        const orig = workingLines[idx];
        if (!orig || !updated || !updated.enriched) return -1;

        const sourceVi =
          meta.sourceLanguage === 'vi' ? orig.rawText || orig.translationVi : undefined;
        // Allow intentional empty non-speech cues to pass directly
        const isEmptyNonSpeech =
          !updated.text.trim() && isNonSpeechCueText(sourceVi || orig.rawText || orig.text);
        if (!isEmptyNonSpeech && !isPureTargetLanguage(updated.text, meta.language, sourceVi)) {
          return -1;
        }

        const wasEnriched = orig.enriched;
        // Strict 1:1 Immutable Timestamp Vault lock — AI NEVER mutates start/duration/end
        const lockedTime = immutableTimeMap.get(orig.id) || {
          start: orig.start,
          duration: orig.duration,
          end: orig.end,
        };
        workingLines[idx] = {
          ...updated,
          id: orig.id,
          index: orig.index,
          start: lockedTime.start,
          duration: lockedTime.duration,
          end: lockedTime.end,
          rawText: orig.rawText,
          translationVi: isEmptyNonSpeech ? '' : updated.translationVi || orig.translationVi,
          enriched: true,
        };
        if (!wasEnriched) enrichedCount++;
        return idx;
      };

      const buildInputPayloadByIds = (lineIds: string[]) => {
        const out: Array<{ id: string; index: number; start: number; duration: number; text: string }> =
          [];
        for (const id of lineIds) {
          const idx = findIndexById(id);
          if (idx === -1) continue;
          const l = workingLines[idx];
          out.push({
            id: l.id,
            index: l.index,
            start: l.start,
            duration: l.duration,
            text:
              meta.sourceLanguage === 'vi' ? l.rawText || l.translationVi || '' : l.text,
          });
        }
        return out;
      };

      // O(1) Sliding Overlap: strictly last 2 translated sentences immediately before batch (<= 40 words total)
      const buildPreviousContextById = (
        firstLineId: string
      ): Array<{ source: string; target: string }> => {
        const firstIdx = findIndexById(firstLineId);
        if (firstIdx <= 0) return [];
        const out: Array<{ source: string; target: string }> = [];
        for (let k = firstIdx - 1; k >= Math.max(0, firstIdx - 6) && out.length < 2; k--) {
          const prev = workingLines[k];
          if (prev && prev.enriched && prev.text.trim()) {
            const src =
              meta.sourceLanguage === 'vi'
                ? prev.rawText || prev.translationVi || prev.text
                : prev.rawText || prev.text;
            out.unshift({
              source: capWordsO1(src, 10),
              target: capWordsO1(prev.text, 10),
            });
          }
        }
        return out;
      };

      // Smart Uniform Batch Sizer + Tail-End Balancing:
      // - Standard batch: 14 cues (within 12-15)
      // - Tail run 17..22 cues (e.g. 18 leftover cues): split evenly -> 9 + 9
      // - Tail run 15..16 cues (1-2 tiny leftover cues): merge neatly into 1 balanced batch
      const computeBalancedBatchSize = (contiguousPendingRunLen: number, maxCap: number): number => {
        if (contiguousPendingRunLen <= maxCap) return contiguousPendingRunLen;
        if (contiguousPendingRunLen <= maxCap + 2) return contiguousPendingRunLen; // e.g., 15..16 -> 1 balanced batch
        if (contiguousPendingRunLen <= maxCap + 8) {
          return Math.ceil(contiguousPendingRunLen / 2); // e.g., 18 -> 9 + 9, 20 -> 10 + 10
        }
        return maxCap;
      };

      // Forward reference for AIMD dynamic worker scaling
      let spawnBackgroundWorkerRef: (() => Promise<void>) | null = null;

      // Background / Healing Batch Executor with Compact Tuple Wire, Off-Main-Thread Web Worker Unpack,
      // Adaptive AIMD Concurrency Control, Tail-Phase 5.5s Tightening & Parallel Speculative Half-Split!
      const fetchAndHealIds = async (
        lineIds: string[],
        splitDepth = 0,
        priority: 'express' | 'background' = 'background'
      ): Promise<void> => {
        if (controller.signal.aborted || quotaCircuitOpen || lineIds.length === 0) return;

        const retryDelays = [400, 900, 1800];
        let remaining = lineIds.filter((id) => isLinePending(id) && !inFlightLineIds.has(id));
        if (remaining.length === 0) return;

        remaining.forEach((id) => inFlightLineIds.add(id));
        let timedOutHungSocket = false;
        let hitRateLimit = false;
        try {
          for (let attempt = 0; attempt <= retryDelays.length && remaining.length > 0; attempt++) {
            if (controller.signal.aborted || quotaCircuitOpen) return;
            await acquireSmoothToken(priority);
            if (controller.signal.aborted || quotaCircuitOpen) return;

            const remainingGlobal = Math.max(0, workingLines.length - enrichedCount);
            const inTailPhase =
              remainingGlobal > 0 &&
              remainingGlobal <= Math.max(45, Math.ceil(workingLines.length * 0.1));
            const batchSizeCount = remaining.length;
            const timeoutMs =
              priority === 'express'
                ? EXPRESS_TIMEOUT_MS
                : inTailPhase
                  ? batchSizeCount <= 20
                    ? TAIL_PHASE_TIMEOUT_MS
                    : 8500
                  : batchSizeCount <= 20
                    ? BG_TIMEOUT_MS
                    : 10_500;

            const batchStartTs = Date.now();
            const { batchAc, cleanup } = createBatchAbortController(timeoutMs);
            try {
              const payload = buildInputPayloadByIds(remaining);
              if (payload.length === 0) return;
              const previousContext = buildPreviousContextById(remaining[0]);
              const resp = await enrichSubtitleBatch(
                {
                  lines: payload,
                  language: meta.language,
                  sourceLanguage: meta.sourceLanguage,
                  targetLevel: meta.targetLevel,
                  isAsr: meta.isAsr,
                  videoTitle: meta.title,
                  contextAnchor: liveContextAnchor,
                  previousContext: previousContext.length > 0 ? previousContext : undefined,
                  priority,
                  timeoutMs,
                  compactWire: true,
                },
                batchAc.signal
              );
              if (controller.signal.aborted) return;

              // Off-Main-Thread Web Worker Unpacking (<0.5ms): expands inline 漢字[かんじ] / Oxford IPA -> <ruby> + tokens
              const unpackedLines = await unpackBatchOffMainThread(
                resp.lines,
                meta.language,
                meta.targetLevel,
                immutableTimeMap
              );
              if (controller.signal.aborted) return;

              const appliedIds: string[] = [];
              const touchedIndices: number[] = [];
              const enrichedMap = new Map(unpackedLines.map((l) => [l.id, l]));
              for (const id of remaining) {
                const updated = enrichedMap.get(id);
                if (updated) {
                  const appliedIdx = applySingleValidatedLineById(id, updated);
                  if (appliedIdx !== -1) {
                    appliedIds.push(id);
                    touchedIndices.push(appliedIdx);
                  }
                }
              }
              if (appliedIds.length > 0) {
                // O(1) Local Boundary Audit -> UI-First Render (0ms) -> Non-Blocking Sharded IndexedDB Write
                verifyLocalBatchBoundaries(touchedIndices);
                scheduleUiFlush(priority === 'express');
                recordSlaProgress(appliedIds.length);
                persistShardedByLineIdsAsync(appliedIds);
                scheduleDebouncedManifestSave();
              }

              // AIMD Fast Ramp-Up: +1 worker after 2 consecutive clean fast batches (up to Tier ceiling)
              if (appliedIds.length > 0) {
                consecutive429Count = 0;
              }
              const elapsedMs = Date.now() - batchStartTs;
              if (priority === 'background' && appliedIds.length > 0 && elapsedMs < 6500) {
                consecutiveCleanBatches++;
                if (consecutiveCleanBatches >= 2 && targetBgConcurrency < AIMD_MAX) {
                  targetBgConcurrency++;
                  consecutiveCleanBatches = 0;
                  if (activeBgWorkers < targetBgConcurrency && spawnBackgroundWorkerRef) {
                    void spawnBackgroundWorkerRef();
                  }
                }
              }

              remaining = remaining.filter((id) => isLinePending(id));
              if (remaining.length === 0) return;
            } catch (err) {
              if (controller.signal.aborted) return;
              const errMeta = err as { status?: number; isDailyQuota?: boolean } | null;
              const status = errMeta?.status;
              const isDailyQuota = Boolean(errMeta?.isDailyQuota);
              const is429 =
                isDailyQuota ||
                status === 429 ||
                (err instanceof Error && /\b429\b|RESOURCE_EXHAUSTED|quá tải|hạn mức/i.test(err.message));

              if (isDailyQuota) {
                hitRateLimit = true;
                tripQuotaCircuit(err instanceof Error ? err.message : undefined);
                return;
              }

              if (is429) {
                hitRateLimit = true;
                consecutiveCleanBatches = 0;
                consecutive429Count++;
                targetBgConcurrency = Math.max(1, Math.floor(targetBgConcurrency * 0.5));
                if (consecutive429Count >= 4) {
                  tripQuotaCircuit(err instanceof Error ? err.message : undefined);
                  return;
                }
                if (attempt < retryDelays.length) {
                  await sleepWithAbort(2200 + Math.floor(Math.random() * 500));
                }
                continue;
              }

              const isTimeout =
                batchAc.signal.aborted ||
                (err instanceof Error && /timeout|abort/i.test(err.message));
              if (isTimeout && remaining.length > 1 && splitDepth < 3) {
                // Speculative Straggler Hedging: immediately abort & parallel half-split on fresh sockets!
                timedOutHungSocket = true;
                break;
              }
            } finally {
              cleanup();
            }

            if (attempt < retryDelays.length && remaining.length > 0 && !quotaCircuitOpen) {
              const jitter = Math.floor(Math.random() * 160);
              await sleepWithAbort(retryDelays[attempt] + jitter);
            }
          }
        } finally {
          lineIds.forEach((id) => inFlightLineIds.delete(id));
        }

        // Speculative Parallel Half-Split Rescue ONLY on timeout/missing cues — NEVER on 429 rate-limit!
        if (!hitRateLimit && !quotaCircuitOpen && splitDepth < 3 && remaining.length > 1 && !controller.signal.aborted) {
          const mid = Math.ceil(remaining.length / 2);
          const remainingGlobal = Math.max(0, workingLines.length - enrichedCount);
          const inTailPhase =
            remainingGlobal > 0 &&
            remainingGlobal <= Math.max(45, Math.ceil(workingLines.length * 0.1));
          if (timedOutHungSocket || priority === 'express' || inTailPhase) {
            // Fire BOTH micro-halves simultaneously on fresh connections for zero straggler tail!
            await Promise.all([
              fetchAndHealIds(remaining.slice(0, mid), splitDepth + 1, priority),
              fetchAndHealIds(remaining.slice(mid), splitDepth + 1, priority),
            ]);
          } else {
            await fetchAndHealIds(remaining.slice(0, mid), splitDepth + 1, priority);
            await fetchAndHealIds(remaining.slice(mid), splitDepth + 1, priority);
          }
        }
      };

      // Dedicated Express Cue-by-Cue NDJSON Streamer (<1.0s first line with compactWire, 4.0s hard timeout -> parallel half-split!)
      const streamMicroBatchByIds = async (
        lineIds: string[],
        timeoutMs = EXPRESS_TIMEOUT_MS
      ): Promise<void> => {
        if (controller.signal.aborted || quotaCircuitOpen || lineIds.length === 0) return;
        const fresh = lineIds.filter((id) => isLinePending(id) && !inFlightLineIds.has(id));
        if (fresh.length === 0) return;

        await acquireSmoothToken('express');
        if (controller.signal.aborted || quotaCircuitOpen) return;

        fresh.forEach((id) => inFlightLineIds.add(id));
        const validSet = new Set(fresh);
        const appliedIds: string[] = [];
        const touchedIndices: number[] = [];
        let streamHitQuota = false;

        // Dynamic stall watchdog: 4.0s to receive FIRST cue; resets softly as cues actively stream in!
        const batchAc = new AbortController();
        const onParentAbort = () => batchAc.abort();
        controller.signal.addEventListener('abort', onParentAbort, { once: true });
        let stallTimer = window.setTimeout(() => {
          batchAc.abort(new Error(`Express stream timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        const resetStallTimer = (nextMs: number) => {
          window.clearTimeout(stallTimer);
          stallTimer = window.setTimeout(() => {
            batchAc.abort(new Error(`Express stream stall after ${nextMs}ms`));
          }, nextMs);
        };

        try {
          const payload = buildInputPayloadByIds(fresh);
          if (payload.length === 0) return;
          const previousContext = buildPreviousContextById(fresh[0]);
          await enrichSubtitleBatchStream(
            {
              lines: payload,
              language: meta.language,
              sourceLanguage: meta.sourceLanguage,
              targetLevel: meta.targetLevel,
              isAsr: meta.isAsr,
              videoTitle: meta.title,
              contextAnchor: liveContextAnchor,
              previousContext: previousContext.length > 0 ? previousContext : undefined,
              priority: 'express',
              timeoutMs,
              compactWire: true,
            },
            (streamedLine) => {
              if (controller.signal.aborted) return;
              if (!validSet.has(streamedLine.id)) return;
              resetStallTimer(4000);
              const unpacked = unpackSingleCompactLine(
                streamedLine,
                meta.language,
                meta.targetLevel,
                immutableTimeMap.get(streamedLine.id)
              );
              const appliedIdx = applySingleValidatedLineById(unpacked.id, unpacked);
              if (appliedIdx !== -1) {
                appliedIds.push(unpacked.id);
                touchedIndices.push(appliedIdx);
                verifyLocalBatchBoundaries([appliedIdx]);
                recordSlaProgress(1);
                // UI-First Instant Cue-by-Cue Flush (<1.0s TTFL!)
                scheduleUiFlush(appliedIds.length <= 2);
              }
            },
            batchAc.signal
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          const errMeta = err as { status?: number; isDailyQuota?: boolean } | null;
          if (errMeta?.isDailyQuota) {
            streamHitQuota = true;
            tripQuotaCircuit(err instanceof Error ? err.message : undefined);
          } else if (errMeta?.status === 429) {
            streamHitQuota = true;
            consecutive429Count++;
            targetBgConcurrency = Math.max(1, Math.floor(targetBgConcurrency * 0.5));
            if (consecutive429Count >= 4) {
              tripQuotaCircuit(err instanceof Error ? err.message : undefined);
            }
          }
        } finally {
          window.clearTimeout(stallTimer);
          controller.signal.removeEventListener('abort', onParentAbort);
          fresh.forEach((id) => inFlightLineIds.delete(id));
        }

        if (appliedIds.length > 0 && !controller.signal.aborted) {
          consecutive429Count = 0;
          verifyLocalBatchBoundaries(touchedIndices);
          scheduleUiFlush(true);
          persistShardedByLineIdsAsync(appliedIds);
          scheduleDebouncedManifestSave();
        }

        // If stream timed out or missed trailing cues (and NOT rate-limited), parallel half-split heal on Express priority!
        const missed = fresh.filter((id) => isLinePending(id));
        if (missed.length > 0 && !controller.signal.aborted && !quotaCircuitOpen && !streamHitQuota) {
          if (missed.length > 1) {
            const mid = Math.ceil(missed.length / 2);
            await Promise.all([
              fetchAndHealIds(missed.slice(0, mid), 1, 'express'),
              fetchAndHealIds(missed.slice(mid), 1, 'express'),
            ]);
          } else {
            await fetchAndHealIds(missed, 1, 'express');
          }
        }
      };

      // Merge newly harvested 1-Pass Direct (or raw) STT window cues into live workingLines
      const mergeSttWindowLines = (
        rawNewLines: Array<{
          start: number;
          duration: number;
          text: string;
          readingMap?: string;
          ipaLine?: string;
          translationVi?: string;
        }>,
        directTranslated = false
      ): string[] => {
        if (rawNewLines.length === 0) return [];
        const addedIds: string[] = [];
        const newlyEnrichedIds: string[] = [];
        const isVi = meta.sourceLanguage === 'vi';
        const stamp = Date.now().toString(36).slice(-3);

        const normDedupText = (s: string) =>
          s
            .toLowerCase()
            .replace(/[\s.,!?;:'"“”‘’()\[\]{}、。！？「」『』]/g, '')
            .trim();

        for (let i = 0; i < rawNewLines.length; i++) {
          const r = rawNewLines[i];
          const cleanText = stripHtmlAndRubyArtifacts(r.text || '').replace(/\s+/g, ' ').trim();
          if (!cleanText) continue;
          const startSec = Math.max(0, Number(r.start.toFixed(2)));
          const durSec = Math.max(0.45, Number(r.duration.toFixed(2)));
          const endSec = Number((startSec + durSec).toFixed(2));
          const normCandidate = normDedupText(cleanText);

          // 2-Second Boundary Overlap Smart Stitcher & Deduplicator
          const dupIdx = workingLines.findIndex((ex) => {
            const overlapStart = Math.max(ex.start, startSec);
            const overlapEnd = Math.min(ex.end, endSec);
            const overlapSec = Math.max(0, overlapEnd - overlapStart);
            const minDur = Math.max(0.4, Math.min(ex.duration || 1, durSec));
            if (Math.abs(ex.start - startSec) < 1.35) return true;
            if (overlapSec / minDur > 0.5) return true;
            if (startSec >= ex.start && endSec <= ex.end + 0.35) return true;
            if (Math.abs(ex.start - startSec) <= 3.0 && normCandidate.length >= 6) {
              const exNorm = normDedupText(ex.text || ex.rawText || '');
              if (
                exNorm.length >= 6 &&
                (exNorm === normCandidate ||
                  exNorm.includes(normCandidate) ||
                  normCandidate.includes(exNorm))
              ) {
                return true;
              }
            }
            return false;
          });

          const nonSpeech = isNonSpeechCueText(cleanText);
          const isValidDirect =
            directTranslated &&
            !nonSpeech &&
            isPureTargetLanguage(cleanText, meta.language, r.translationVi);

          if (dupIdx !== -1) {
            const ex = workingLines[dupIdx];
            // If overlap boundary version has cleaner/richer text and existing wasn't enriched or is shorter, upgrade in-place
            if (
              isValidDirect &&
              (!ex.enriched || cleanText.length > (ex.text || '').length + 6)
            ) {
              const upgraded = unpackSingleCompactLine(
                {
                  ...ex,
                  text: cleanText,
                  readingMap: r.readingMap || ex.readingMap,
                  ipaLine: r.ipaLine || ex.ipaLine,
                  rawText: r.translationVi || ex.rawText,
                  translationVi: r.translationVi || ex.translationVi,
                  enriched: true,
                },
                meta.language,
                meta.targetLevel
              );
              if (!ex.enriched) enrichedCount++;
              workingLines[dupIdx] = upgraded;
              newlyEnrichedIds.push(ex.id);
              addedIds.push(ex.id);
            }
            continue;
          }

          const uid = `stt_${Math.round(startSec * 100)}_${i}_${stamp}`;

          let newLine: SubtitleLine;
          if (isValidDirect) {
            const unpacked = unpackSingleCompactLine(
              {
                id: uid,
                index: workingLines.length,
                start: startSec,
                duration: durSec,
                end: endSec,
                text: cleanText,
                readingMap: r.readingMap,
                ipaLine: r.ipaLine,
                rawText: r.translationVi || undefined,
                translationVi: r.translationVi || '',
                tokens: [],
                enriched: true,
              },
              meta.language,
              meta.targetLevel
            );
            newLine = unpacked;
            enrichedCount++;
            newlyEnrichedIds.push(uid);
          } else {
            newLine = {
              id: uid,
              index: workingLines.length,
              start: startSec,
              duration: durSec,
              end: endSec,
              text: nonSpeech ? '' : isVi ? '' : cleanText,
              rawText: isVi ? r.translationVi || cleanText : undefined,
              translationVi: nonSpeech ? '' : isVi ? r.translationVi || cleanText : '',
              tokens: nonSpeech || isVi ? [] : createBasicTokens(cleanText, uid),
              enriched: nonSpeech,
            };
            if (nonSpeech) {
              enrichedCount++;
              newlyEnrichedIds.push(uid);
            }
          }

          workingLines.push(newLine);
          addedIds.push(uid);

          if (isVi) {
            workingSourceViLines.push({
              id: uid,
              index: workingSourceViLines.length,
              start: startSec,
              duration: durSec,
              text: r.translationVi || cleanText,
            });
          }
        }

        if (addedIds.length === 0) return [];

        workingLines.sort((a, b) => a.start - b.start);
        for (let i = 0; i < workingLines.length; i++) {
          const cur = workingLines[i];
          const next = workingLines[i + 1];
          let clampedEnd = cur.end;
          if (next && clampedEnd > next.start - 0.04) {
            clampedEnd = Math.max(cur.start + 0.3, Number((next.start - 0.04).toFixed(2)));
          }
          if (cur.index !== i || clampedEnd !== cur.end) {
            const nextDur = Number(Math.max(0.3, clampedEnd - cur.start).toFixed(3));
            workingLines[i] = {
              ...cur,
              index: i,
              end: clampedEnd,
              duration: nextDur,
            };
          }
          const finalCur = workingLines[i];
          immutableTimeMap.set(finalCur.id, {
            start: finalCur.start,
            duration: finalCur.duration,
            end: finalCur.end,
          });
        }

        // Refresh O(1) index map after STT insertion
        rebuildO1Indexes();

        if (isVi) {
          workingSourceViLines.sort((a, b) => a.start - b.start);
          workingSourceViLines = workingSourceViLines.map((item, idx) => ({ ...item, index: idx }));
          setSourceViLines([...workingSourceViLines]);
        }

        if (newlyEnrichedIds.length > 0) {
          recordSlaProgress(newlyEnrichedIds.length);
          persistShardedByLineIdsAsync(newlyEnrichedIds);
        }

        scheduleUiFlush(true);
        return addedIds;
      };

      // Harvest a single 105-130s 1-Pass Direct Audio STT window with 38s Multimodal timeout + automatic Half-Split retry (45-60s, max 3)
      const harvestSingleSttWindow = async (
        startSec: number,
        windowSec = STT_WINDOW_SEC,
        priority: 'express' | 'background' = 'background',
        splitDepth = 0
      ): Promise<string[]> => {
        if (controller.signal.aborted || !isSttMode || quotaCircuitOpen) return [];
        const backoff = [700, 1500, 2600];
        const safeStart = Math.max(0, Math.floor(startSec));

        for (let attempt = 0; attempt <= backoff.length; attempt++) {
          if (controller.signal.aborted || quotaCircuitOpen) return [];
          try {
            const knownDur = getEffectiveDurationSec();
            const resp = await continueYouTubeStt(
              {
                videoId: meta.videoId,
                videoTitle: meta.title,
                startOffsetSec: safeStart,
                windowDurationSec: windowSec,
                knownDurationSec: knownDur > 20 ? knownDur : undefined,
                targetLanguage: meta.language,
                targetLevel: meta.targetLevel,
                priority,
                contextAnchor: liveContextAnchor,
                timeoutMs: 38_000,
              },
              controller.signal
            );
            if (controller.signal.aborted) return [];

            const actualCoveredEnd =
              resp.nextOffsetSec && resp.nextOffsetSec > safeStart + 10
                ? resp.nextOffsetSec
                : safeStart +
                  Math.min(windowSec, knownDur > safeStart ? knownDur - safeStart : windowSec) -
                  2;

            const bucketKey = Math.floor(safeStart / 60);
            if (resp.lines.length === 0) {
              const prevEmptyCount = (sttEmptyRetriesByBucket.get(bucketKey) || 0) + 1;
              sttEmptyRetriesByBucket.set(bucketKey, prevEmptyCount);
              sttConsecutiveEmpty++;
              if (prevEmptyCount >= 2) {
                mergeInterval(safeStart, actualCoveredEnd);
                sttNextOffsetSec = Math.max(sttNextOffsetSec, actualCoveredEnd);
              } else if (attempt < backoff.length) {
                await sleepWithAbort(backoff[attempt]);
                continue;
              }
            } else {
              sttConsecutiveEmpty = 0;
              sttEmptyRetriesByBucket.delete(bucketKey);
              mergeInterval(safeStart, actualCoveredEnd);
              sttNextOffsetSec = Math.max(sttNextOffsetSec, actualCoveredEnd);
            }

            const addedIds = mergeSttWindowLines(resp.lines, Boolean(resp.directTranslated));

            const refreshedDur = getEffectiveDurationSec();
            if (refreshedDur > 25) {
              sttHasMore = findNextUnharvestedOffset() !== null;
            } else {
              sttHasMore = Boolean(resp.hasMoreContent) && sttConsecutiveEmpty < 2;
            }
            setHasMoreStt(sttHasMore);
            setNextSttOffsetSec(sttNextOffsetSec);

            signalWorkers();
            if (addedIds.length > 0 || !sttHasMore) {
              scheduleDebouncedManifestSave();
            }
            return addedIds;
          } catch (err) {
            if (controller.signal.aborted) return [];
            const errMeta = err as {
              status?: number;
              isDailyQuota?: boolean;
              restricted?: boolean;
            } | null;
            if (errMeta?.isDailyQuota) {
              tripQuotaCircuit(err instanceof Error ? err.message : undefined);
              return [];
            }
            if (errMeta?.restricted && workingLines.length === 0) {
              setAiAudioRestricted(true);
              sttHasMore = false;
              setHasMoreStt(false);
              return [];
            }
            if (errMeta?.status === 429) {
              consecutive429Count++;
              if (consecutive429Count >= 4) {
                tripQuotaCircuit(err instanceof Error ? err.message : undefined);
                return [];
              }
            }
            // Automatic Half-Split Retry (45-60s) on first timeout/error for large multimodal windows
            if (
              attempt === 1 &&
              windowSec > 60 &&
              splitDepth < 2 &&
              !quotaCircuitOpen &&
              errMeta?.status !== 429
            ) {
              const halfWindow = Math.max(45, Math.ceil(windowSec / 2) + 2);
              const secondHalfStart = safeStart + Math.max(40, Math.floor(windowSec / 2) - 2);
              const [firstIds, secondIds] = await Promise.all([
                harvestSingleSttWindow(safeStart, halfWindow, priority, splitDepth + 1),
                harvestSingleSttWindow(secondHalfStart, halfWindow, priority, splitDepth + 1),
              ]);
              return [...firstIds, ...secondIds];
            }
            if (attempt < backoff.length && !quotaCircuitOpen) {
              await sleepWithAbort(backoff[attempt]);
            }
          }
        }
        return [];
      };

      // TRACK A: PARALLEL 5-6 WORKER 1-PASS AUDIO HARVESTER WITH 2-SECOND BOUNDARY OVERLAP
      const sttInFlightRanges: Array<[number, number]> = [];
      const claimNextParallelSttOffset = (): number | null => {
        if (!isSttMode) return null;
        const knownDur = getEffectiveDurationSec();
        const combined = [...harvestedIntervals, ...sttInFlightRanges].sort((a, b) => a[0] - b[0]);
        if (knownDur > 25) {
          let cursor = 0;
          for (const [s, e] of combined) {
            if (cursor + 10 < s) {
              const start = Math.max(0, cursor > 2 ? cursor - 2 : cursor);
              sttInFlightRanges.push([start, Math.min(knownDur, start + STT_WINDOW_SEC)]);
              return start;
            }
            cursor = Math.max(cursor, e);
          }
          if (cursor < knownDur - 12) {
            const start = Math.max(0, cursor - 2);
            sttInFlightRanges.push([start, Math.min(knownDur, start + STT_WINDOW_SEC)]);
            return start;
          }
          return null;
        }
        // Unknown total duration: advance sequentially with 2s overlap until YouTube player reports duration
        if (sttInFlightRanges.length > 0) return null;
        if (sttHasMore && sttConsecutiveEmpty < 2) {
          const start = Math.max(0, sttNextOffsetSec > 2 ? sttNextOffsetSec - 2 : sttNextOffsetSec);
          sttInFlightRanges.push([start, start + STT_WINDOW_SEC]);
          return start;
        }
        return null;
      };

      const releaseSttInFlightRange = (start: number) => {
        const idx = sttInFlightRanges.findIndex(([s]) => s === start);
        if (idx !== -1) sttInFlightRanges.splice(idx, 1);
      };

      const runBackgroundSttHarvester = async () => {
        if (!isSttMode || sttLoopActive || controller.signal.aborted || quotaCircuitOpen) return;
        sttLoopActive = true;
        setIsLoadingMoreStt(true);
        try {
          const spawnSttWorker = async (workerIdx: number) => {
            // Stagger launch slightly (120ms) so connections ramp smoothly without burst spikes
            if (workerIdx > 0) {
              await sleepWithAbort(workerIdx * 140);
            }
            while (!controller.signal.aborted && !quotaCircuitOpen) {
              if (urgentSttInFlight && workerIdx > 1) {
                await sleepWithAbort(300);
                continue;
              }
              const nextOffset = claimNextParallelSttOffset();
              if (nextOffset === null) {
                // If total duration isn't known yet and worker 0 is running, wait briefly
                if (sttInFlightRanges.length > 0 && getEffectiveDurationSec() <= 25) {
                  await sleepWithAbort(500);
                  continue;
                }
                break;
              }
              try {
                await harvestSingleSttWindow(nextOffset, STT_WINDOW_SEC, 'background');
              } finally {
                releaseSttInFlightRange(nextOffset);
              }
              if (controller.signal.aborted || quotaCircuitOpen) break;
              await sleepWithAbort(80);
            }
          };

          const workerCount =
            getEffectiveDurationSec() > 180 ? STT_PARALLEL_WORKERS : Math.min(3, STT_PARALLEL_WORKERS);
          await Promise.all(Array.from({ length: workerCount }, (_, idx) => spawnSttWorker(idx)));

          if (findNextUnharvestedOffset() === null) {
            sttHasMore = false;
            setHasMoreStt(false);
          }
        } finally {
          sttLoopActive = false;
          if (!controller.signal.aborted) {
            setIsLoadingMoreStt(false);
          }
          signalWorkers();
        }
      };

      // Helper: find first line index with end >= targetSec via O(log N) binary search
      const binarySearchStartIdx = (targetSec: number): number => {
        let lo = 0;
        let hi = workingLines.length - 1;
        let ans = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          if (workingLines[mid].end >= targetSec) {
            ans = mid;
            hi = mid - 1;
          } else {
            lo = mid + 1;
          }
        }
        return ans;
      };

      // Picker 1 — DEDICATED EXPRESS SLOT: exclusively serves active playhead & +300s (5-Minute) Predictive Shield
      const pickExpressPlayheadBatch = (): string[] | null => {
        const nowSec = currentTimeRef.current || 0;
        const startIdx = binarySearchStartIdx(Math.max(0, nowSec - 2));
        if (startIdx === -1) return null;

        let firstPending = -1;
        for (let i = startIdx; i < workingLines.length; i++) {
          const l = workingLines[i];
          if (l.start > nowSec + 300) break;
          if (!l.enriched && !inFlightLineIds.has(l.id)) {
            firstPending = i;
            break;
          }
        }
        if (firstPending === -1) return null;

        // Measure contiguous pending run from firstPending to apply smart tail balancing
        let runEnd = firstPending;
        while (
          runEnd < workingLines.length &&
          runEnd - firstPending < EXPRESS_STREAM_SIZE + 8 &&
          !workingLines[runEnd].enriched &&
          !inFlightLineIds.has(workingLines[runEnd].id)
        ) {
          runEnd++;
        }
        const runLen = runEnd - firstPending;
        const targetCount = computeBalancedBatchSize(runLen, EXPRESS_STREAM_SIZE);
        const ids: string[] = [];
        for (let i = firstPending; i < workingLines.length && ids.length < targetCount; i++) {
          const l = workingLines[i];
          if (!l.enriched && !inFlightLineIds.has(l.id)) {
            ids.push(l.id);
          }
        }
        return ids.length > 0 ? ids : null;
      };

      // Picker 2 — BACKGROUND WORKERS: fill remaining batches uniformly (12-15 cues + smart tail balance)
      const pickBackgroundBatch = (): string[] | null => {
        const firstIdx = workingLines.findIndex(
          (l) => !l.enriched && !inFlightLineIds.has(l.id)
        );
        if (firstIdx === -1) return null;

        // Count remaining pending lines from firstIdx to smoothly balance the final 2 tail batches!
        let remainingPendingCount = 0;
        for (let i = firstIdx; i < workingLines.length && remainingPendingCount <= BATCH_SIZE + 8; i++) {
          const l = workingLines[i];
          if (!l.enriched && !inFlightLineIds.has(l.id)) {
            remainingPendingCount++;
          }
        }
        const targetCount = computeBalancedBatchSize(remainingPendingCount, BATCH_SIZE);
        const ids: string[] = [];
        for (let i = firstIdx; i < workingLines.length && ids.length < targetCount; i++) {
          const l = workingLines[i];
          if (!l.enriched && !inFlightLineIds.has(l.id)) {
            ids.push(l.id);
          }
        }
        return ids.length > 0 ? ids : null;
      };

      // TRACK C1: DEDICATED EXPRESS WORKER SLOT (1 of 3 slots reserved strictly for Playhead + 2-Min Buffer)
      const spawnExpressWorker = async () => {
        activeExpressWorkers++;
        try {
          while (!controller.signal.aborted && !quotaCircuitOpen) {
            const expressIds = pickExpressPlayheadBatch();
            if (expressIds) {
              try {
                // Always use Cue-by-Cue NDJSON Streaming (300-600ms first line!) for the playhead / tail scrub zone
                await streamMicroBatchByIds(expressIds, EXPRESS_TIMEOUT_MS);
              } catch {
                // Isolated worker error handled by streamMicroBatchByIds
              }
              continue;
            }

            // If playhead + 2-min buffer is 100% ready, check if ALL cues in the entire video are done
            const anyPendingLeft = enrichedCount < workingLines.length;
            const moreStt =
              isSttMode &&
              (sttLoopActive || urgentSttInFlight || findNextUnharvestedOffset() !== null);

            if (!anyPendingLeft && !moreStt) {
              break;
            }

            // Stay warm & idle-ready (wakes instantaneously on user seek or playhead advance!)
            await waitForWorkSignal(650);
          }
        } finally {
          activeExpressWorkers--;
        }
      };

      // TRACK C2: ADAPTIVE AIMD BACKGROUND WORKER POOL (dynamically scales 1..AIMD_MAX)
      const spawnBackgroundWorker = async () => {
        activeBgWorkers++;
        try {
          while (!controller.signal.aborted && !quotaCircuitOpen) {
            // Respect AIMD multiplicative decrease smoothly without dropping in-flight work
            if (activeBgWorkers > targetBgConcurrency) {
              break;
            }
            const bgIds = pickBackgroundBatch();
            if (bgIds) {
              try {
                await fetchAndHealIds(bgIds, 0, 'background');
              } catch {
                // Isolated worker error handled by fetchAndHealIds
              }
              continue;
            }

            const moreStt =
              isSttMode &&
              (sttLoopActive || urgentSttInFlight || findNextUnharvestedOffset() !== null);
            if (moreStt) {
              await waitForWorkSignal(1200);
              continue;
            }
            break;
          }
        } finally {
          activeBgWorkers--;
        }
      };
      spawnBackgroundWorkerRef = spawnBackgroundWorker;

      // TRACK B: Instant Seek-Preemption (fires Dedicated Express Slot immediately when scrubbing to tail minutes!)
      let lastSeekPreemptSec = -999;
      seekPreemptTriggerRef.current = (targetSec: number) => {
        if (controller.signal.aborted || quotaCircuitOpen) return;
        if (Math.abs(targetSec - lastSeekPreemptSec) < 3) return;
        lastSeekPreemptSec = targetSec;

        const foundIdx = binarySearchStartIdx(Math.max(0, targetSec - 0.5));
        const hasLineAtTarget =
          foundIdx !== -1 && workingLines[foundIdx].start <= targetSec + 18;

        if (hasLineAtTarget) {
          const urgentIds: string[] = [];
          for (
            let i = foundIdx;
            i < workingLines.length && urgentIds.length < EXPRESS_STREAM_SIZE;
            i++
          ) {
            const l = workingLines[i];
            if (!l.enriched && !inFlightLineIds.has(l.id)) {
              urgentIds.push(l.id);
            }
          }
          if (urgentIds.length > 0) {
            // Wake Dedicated Express Slot immediately; if Express is busy, stream directly with Express priority!
            if (activeExpressWorkers === 0) {
              void spawnExpressWorker();
            } else {
              void streamMicroBatchByIds(urgentIds, EXPRESS_TIMEOUT_MS);
            }
          }
          signalWorkers();
          return;
        }

        // Target timestamp not harvested yet in AI Auto-Subtitle Mode -> fire 1-Pass Streaming Seek Teleport (45s burst, 1.5-3s TTFL)!
        if (isSttMode && !isTimestampHarvested(targetSec) && !urgentSttInFlight) {
          urgentSttInFlight = true;
          const seekWindowStart = Math.max(0, Math.floor(targetSec - 3));
          const seekBurstSec = 45;
          setIsLoadingMoreStt(true);
          void streamYouTubeSttWindow(
            {
              videoId: meta.videoId,
              videoTitle: meta.title,
              startOffsetSec: seekWindowStart,
              windowDurationSec: seekBurstSec,
              knownDurationSec: getEffectiveDurationSec() > 20 ? getEffectiveDurationSec() : undefined,
              targetLanguage: meta.language,
              targetLevel: meta.targetLevel,
              contextAnchor: liveContextAnchor,
            },
            (streamedLine) => {
              if (!controller.signal.aborted) {
                mergeSttWindowLines([streamedLine], true);
              }
            },
            controller.signal
          )
            .then((res) => {
              urgentSttInFlight = false;
              if (controller.signal.aborted) return;
              const coveredEnd = Math.max(seekWindowStart + seekBurstSec - 2, res.nextOffsetSec || 0);
              mergeInterval(seekWindowStart, coveredEnd);
              sttNextOffsetSec = Math.max(sttNextOffsetSec, coveredEnd);
              setNextSttOffsetSec(sttNextOffsetSec);
              scheduleDebouncedManifestSave();
              signalWorkers();
              if (!sttLoopActive && findNextUnharvestedOffset() !== null) {
                void runBackgroundSttHarvester();
              }
            })
            .catch(async (err) => {
              urgentSttInFlight = false;
              if (controller.signal.aborted) return;
              const errMeta = err as { isDailyQuota?: boolean; restricted?: boolean } | null;
              if (errMeta?.isDailyQuota) {
                tripQuotaCircuit(err instanceof Error ? err.message : undefined);
                return;
              }
              if (!errMeta?.restricted) {
                // Fallback to non-streaming chunk harvester at seek point
                await harvestSingleSttWindow(seekWindowStart, Math.min(90, STT_WINDOW_SEC), 'express');
              }
              signalWorkers();
              if (!sttLoopActive && !quotaCircuitOpen && findNextUnharvestedOffset() !== null) {
                void runBackgroundSttHarvester();
              }
            });
        }
      };

      durationUpdateNotifyRef.current = (newDurSec: number) => {
        if (controller.signal.aborted || !isSttMode) return;
        if (newDurSec > 25 && findNextUnharvestedOffset() !== null) {
          sttHasMore = true;
          setHasMoreStt(true);
          if (!sttLoopActive) {
            void runBackgroundSttHarvester();
          }
          signalWorkers();
        }
      };

      manualSttTriggerRef.current = () => {
        if (controller.signal.aborted || !isSttMode) return;
        sttConsecutiveEmpty = 0;
        sttHasMore = true;
        setHasMoreStt(true);
        if (!sttLoopActive) {
          void runBackgroundSttHarvester();
        }
      };

      // TRACK D: 2.5-Second Anti-Stall Watchdog (guarantees progress NEVER freezes at 95%-99%)
      const watchdogId = window.setInterval(() => {
        if (controller.signal.aborted || quotaCircuitOpen) {
          window.clearInterval(watchdogId);
          return;
        }
        const nowSec = currentTimeRef.current || 0;

        // 0. Ensure Dedicated Express Slot is servicing active playhead / tail position
        const phIdx = binarySearchStartIdx(Math.max(0, nowSec - 1));
        if (phIdx !== -1) {
          const cur = workingLines[phIdx];
          if (cur && cur.start <= nowSec + 5 && !cur.enriched && !inFlightLineIds.has(cur.id)) {
            const urgentIds: string[] = [];
            for (let i = phIdx; i < workingLines.length && urgentIds.length < EXPRESS_STREAM_SIZE; i++) {
              const l = workingLines[i];
              if (!l.enriched && !inFlightLineIds.has(l.id)) urgentIds.push(l.id);
            }
            if (urgentIds.length > 0) {
              void streamMicroBatchByIds(urgentIds, EXPRESS_TIMEOUT_MS);
            }
          }
        }

        // 1. Re-wake STT Harvester if video duration or playhead region is uncovered
        if (
          isSttMode &&
          !sttLoopActive &&
          !urgentSttInFlight &&
          findNextUnharvestedOffset() !== null
        ) {
          sttHasMore = true;
          setHasMoreStt(true);
          void runBackgroundSttHarvester();
        }

        // 2. Re-wake Express & Background workers if any idle untranslated cue exists anywhere
        const hasIdleUntranslated = workingLines.some(
          (l) => !l.enriched && !inFlightLineIds.has(l.id)
        );
        if (hasIdleUntranslated) {
          signalWorkers();
          if (activeExpressWorkers < 1) {
            void spawnExpressWorker();
          }
          if (activeBgWorkers < targetBgConcurrency) {
            void spawnBackgroundWorker();
          }
        }
      }, 2500);

      try {
        // STEP 0 (Parallel): Generate O(1) Global Video Context Anchor + <=25 LRU Glossary Lock if not cached yet
        let anchorPromise: Promise<void> = Promise.resolve();
        if (!liveContextAnchor && workingLines.length > MICRO_BATCH_SIZE) {
          const sampled = sampleLinesAcrossTimeline(workingLines, meta.sourceLanguage, 24);
          if (sampled.length > 0) {
            anchorPromise = fetchVideoContextAnchor(
              {
                sampleLines: sampled,
                language: meta.language,
                sourceLanguage: meta.sourceLanguage,
                targetLevel: meta.targetLevel,
                videoTitle: meta.title,
              },
              controller.signal
            )
              .then((res) => {
                if (!controller.signal.aborted && res.anchor) {
                  liveContextAnchor = clampContextAnchorO1(res.anchor);
                  setContextAnchor(liveContextAnchor || null);
                }
              })
              .catch(() => {
                // Non-blocking: rolling batches still proceed seamlessly even if anchor call times out
              });
          }
        }

        // STEP 1A (AI AUTO-SUBTITLE ENGINE): 1-Pass Micro-Burst Streaming Opener (0s -> 30s, TTFL 1.5-3s!)
        const focusSec = meta.initialFocusSec ?? currentTimeRef.current ?? 0;
        if (isSttMode && workingLines.length === 0 && !quotaCircuitOpen) {
          const opStart = Math.max(0, Math.floor(focusSec));
          const opWindowSec = 30;
          setIsLoadingMoreStt(true);
          try {
            const openRes = await streamYouTubeSttWindow(
              {
                videoId: meta.videoId,
                videoTitle: meta.title,
                startOffsetSec: opStart,
                windowDurationSec: opWindowSec,
                knownDurationSec:
                  getEffectiveDurationSec() > 20 ? getEffectiveDurationSec() : undefined,
                targetLanguage: meta.language,
                targetLevel: meta.targetLevel,
                contextAnchor: liveContextAnchor,
              },
              (streamedLine) => {
                if (!controller.signal.aborted) {
                  mergeSttWindowLines([streamedLine], true);
                }
              },
              controller.signal
            );
            if (controller.signal.aborted) return;

            if (openRes.lines.length > 0) {
              const coveredEnd = Math.max(opStart + opWindowSec - 2, openRes.nextOffsetSec || 0);
              mergeInterval(opStart, coveredEnd);
              sttNextOffsetSec = Math.max(sttNextOffsetSec, coveredEnd);
              setNextSttOffsetSec(sttNextOffsetSec);
              sttHasMore = Boolean(openRes.hasMoreContent) || findNextUnharvestedOffset() !== null;
              setHasMoreStt(sttHasMore);
              scheduleDebouncedManifestSave();
            } else {
              // If 0 lines in opening 30s (possible music intro), still mark 0..28s and let parallel workers scan onward
              const coveredEnd = opStart + opWindowSec - 2;
              mergeInterval(opStart, coveredEnd);
              sttNextOffsetSec = Math.max(sttNextOffsetSec, coveredEnd);
              setNextSttOffsetSec(sttNextOffsetSec);
              sttHasMore = true;
              setHasMoreStt(true);
            }
          } catch (err) {
            if (controller.signal.aborted) return;
            const errMeta = err as {
              isDailyQuota?: boolean;
              restricted?: boolean;
              status?: number;
            } | null;
            if (errMeta?.isDailyQuota) {
              tripQuotaCircuit(err instanceof Error ? err.message : undefined);
              setIsLoadingMoreStt(false);
              return;
            }
            if (errMeta?.restricted && workingLines.length === 0) {
              setAiAudioRestricted(true);
              sttHasMore = false;
              setHasMoreStt(false);
              setIsLoadingMoreStt(false);
              return;
            }
            // Non-restricted stream error: fall back smoothly to single-window STT harvester
            await harvestSingleSttWindow(opStart, 60, 'express');
            if (controller.signal.aborted || quotaCircuitOpen) return;
          }
        }

        // STEP 1B (CAPTION TRACKS): Stream Micro-Batch 0 immediately (< 1s TTFL!) in parallel with Context Anchor
        let focusStartIdx = 0;
        if (focusSec > 2) {
          const found = binarySearchStartIdx(Math.max(0, focusSec - 1));
          if (found !== -1) focusStartIdx = found;
        }

        const microIds: string[] = [];
        for (
          let i = focusStartIdx;
          i < workingLines.length && microIds.length < MICRO_BATCH_SIZE;
          i++
        ) {
          if (!workingLines[i].enriched) microIds.push(workingLines[i].id);
        }

        if (microIds.length > 0) {
          await streamMicroBatchByIds(microIds, EXPRESS_TIMEOUT_MS);
        }

        if (controller.signal.aborted) return;

        // Wait briefly (up to 500ms) for O(1) Global Context Anchor so Rolling Batches lock into Glossary immediately
        await Promise.race([anchorPromise, sleepWithAbort(500)]);
        if (controller.signal.aborted) return;

        // STEP 2 & 3: Launch Track A (Rolling 5-6 Worker AI Audio Harvester) + 1 Dedicated Express Slot + AIMD Tier Background Pool IN PARALLEL
        const sttHarvesterPromise =
          isSttMode && !quotaCircuitOpen && findNextUnharvestedOffset() !== null
            ? runBackgroundSttHarvester()
            : Promise.resolve();

        const expressWorkerPromise = spawnExpressWorker();
        const bgWorkers = Array.from({ length: targetBgConcurrency }, () => spawnBackgroundWorker());

        await Promise.all([sttHarvesterPromise, expressWorkerPromise, ...bgWorkers]);

        // STEP 4: Final Straggler Sweep — parallel micro-healing to guarantee 100% completion to the last second!
        if (!controller.signal.aborted && !quotaCircuitOpen) {
          if (isSttMode && findNextUnharvestedOffset() !== null) {
            await runBackgroundSttHarvester();
          }

          const stragglerIds = quotaCircuitOpen
            ? []
            : workingLines.filter((l) => !l.enriched).map((l) => l.id);
          if (stragglerIds.length > 0 && !quotaCircuitOpen) {
            const chunks: string[][] = [];
            for (let s = 0; s < stragglerIds.length; s += 10) {
              chunks.push(stragglerIds.slice(s, s + 10));
            }
            await Promise.all(
              chunks.map((chunk) => fetchAndHealIds(chunk, 1, 'express'))
            );
          }

          const finalStragglers = workingLines.filter((l) => !l.enriched).map((l) => l.id);
          if (finalStragglers.length > 0) {
            const chunks: string[][] = [];
            for (let s = 0; s < finalStragglers.length; s += 5) {
              chunks.push(finalStragglers.slice(s, s + 5));
            }
            await Promise.all(
              chunks.map((chunk) => fetchAndHealIds(chunk, 2, 'express'))
            );
          }

          recordSlaProgress(0, true);

          if (manifestDebounceTimer !== null) {
            window.clearTimeout(manifestDebounceTimer);
            manifestDebounceTimer = null;
          }
          await flushManifestNow(true);
        }
      } finally {
        window.clearInterval(watchdogId);
        if (manifestDebounceTimer !== null) {
          window.clearTimeout(manifestDebounceTimer);
          manifestDebounceTimer = null;
        }
        if (tokenTimerId !== null) {
          window.clearTimeout(tokenTimerId);
          tokenTimerId = null;
        }
        if (uiFlushRafId !== null) {
          window.cancelAnimationFrame(uiFlushRafId);
          uiFlushRafId = null;
        }
        if (enrichAbortRef.current === controller) {
          seekPreemptTriggerRef.current = null;
          durationUpdateNotifyRef.current = null;
          manualSttTriggerRef.current = null;
        }
        if (!controller.signal.aborted) {
          setIsEnrichingBg(false);
          setIsLoadingMoreStt(false);
        }
      }
    },
    [unpackBatchOffMainThread]
  );

  // Build RawSourceLine[] helper with stable id & index
  const toRawSourceLines = (
    raw: Array<{ start: number; duration: number; text: string }>,
    startIndex = 0
  ): RawSourceLine[] =>
    raw.map((r, i) => ({
      id: `line_${startIndex + i}`,
      index: startIndex + i,
      start: Number(r.start.toFixed(2)),
      duration: Math.max(0.5, Number(r.duration.toFixed(2))),
      text: r.text,
    }));

  // Strict Target-Language Gate + Zero-Waste Non-Speech Filter + Monotonic Timeline Guarantee
  const buildInitialLines = (
    raw: Array<{ start: number; duration: number; text: string }>,
    srcLang: SourceLanguage,
    isAsr: boolean,
    startIndex = 0
  ): SubtitleLine[] => {
    const built = raw.map((r, i) => {
      const idx = startIndex + i;
      const id = `line_${idx}`;
      const start = Number(r.start.toFixed(3));
      const dur = Math.max(0.25, Number(r.duration.toFixed(3)));
      const isVi = srcLang === 'vi';
      const nonSpeech = isNonSpeechCueText(r.text);
      return {
        id,
        index: idx,
        start,
        duration: dur,
        end: Number((start + dur).toFixed(3)),
        text: nonSpeech ? '' : isVi ? '' : r.text,
        rawText: isVi || isAsr ? r.text : undefined,
        translationVi: nonSpeech ? '' : isVi ? r.text : '',
        tokens: nonSpeech || isVi ? [] : createBasicTokens(r.text, id),
        enriched: nonSpeech,
      };
    });
    return startIndex === 0 ? normalizeMonotonicSubtitleLines(built) : built;
  };

  // Off-Main-Thread Web Worker Timeline Audit for long videos (>= 150 lines) to guarantee 60FPS!
  const buildAuditedInitialLines = useCallback(
    async (
      raw: Array<{ start: number; duration: number; text: string }>,
      srcLang: SourceLanguage,
      isAsr: boolean
    ): Promise<SubtitleLine[]> => {
      if (raw.length < 150 || !workerRef.current) {
        return buildInitialLines(raw, srcLang, isAsr);
      }
      const reqId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      return new Promise<SubtitleLine[]>((resolve) => {
        const timer = window.setTimeout(() => {
          workerAuditResolversRef.current.delete(reqId);
          resolve(buildInitialLines(raw, srcLang, isAsr));
        }, 1500);

        workerAuditResolversRef.current.set(reqId, (audited) => {
          window.clearTimeout(timer);
          if (audited.length > 0) {
            resolve(audited);
          } else {
            resolve(buildInitialLines(raw, srcLang, isAsr));
          }
        });

        try {
          workerRef.current?.postMessage({
            type: 'AUDIT_AND_BUILD_TIMELINE',
            requestId: reqId,
            rawLines: raw,
            sourceLanguage: srcLang,
            isAsr,
          });
        } catch {
          window.clearTimeout(timer);
          workerAuditResolversRef.current.delete(reqId);
          resolve(buildInitialLines(raw, srcLang, isAsr));
        }
      });
    },
    []
  );

  // Master Zero-Latency 3-Stream Concurrent Video Loader (Supports 100% Vietnamese, English & Japanese)
  const loadYouTubeVideo = useCallback(
    async (rawUrl: string, langOverride?: Language, levelOverride?: ProficiencyLevel) => {
      const targetLang = langOverride ?? language;
      const targetLvl =
        levelOverride ??
        (targetLang === 'ja'
          ? JLPT_LEVELS.includes(targetLevel as (typeof JLPT_LEVELS)[number])
            ? targetLevel
            : 'N3'
          : CEFR_LEVELS.includes(targetLevel as (typeof CEFR_LEVELS)[number])
            ? targetLevel
            : 'B2');

      const parsed = parseYouTubeUrlClient(rawUrl);
      if (!parsed) {
        setIsInvalidUrlError(true);
        setLoadBannerError(
          'Đường link bạn dán không phải link YouTube hợp lệ (hệ thống từ chối link ngoài như Facebook/TikTok hoặc văn bản thường). Hãy dán link youtube.com/watch?v=..., youtu.be/..., shorts/... hoặc bấm thử video mẫu bên cạnh!'
        );
        return;
      }

      // 0ms STRICT ABORT: cancel every active fetch & Gemini stream from any previous video!
      const myGeneration = ++loadGenerationRef.current;
      flushVideoWorkspaceState();
      const loadController = new AbortController();
      videoLoadAbortRef.current = loadController;

      setIsInvalidUrlError(false);
      setUrlInput(parsed.cleanUrl);
      setLanguage(targetLang);
      setTargetLevel(targetLvl);

      // STREAM 1 (t = 0ms): Immediately warm cover thumbnail & switch Warm YT.Player via loadVideoById!
      warmYouTubeThumbnail(parsed.videoId);
      setVideoId(parsed.videoId);
      setInitialStartTime(parsed.startTime || 0);
      setLines([]);
      setIsLoadingVideo(true);

      const sessionKey = buildSessionKey(parsed.videoId, targetLang, targetLvl);
      const aiSubSessionKey = buildSessionKey(parsed.videoId, targetLang, targetLvl, 'stt_ai');

      const hydrateCachedSession = async (existing: VideoSession) => {
        // Merge any newer Sharded IndexedDB Batch records onto the cached session manifest
        const shardMap = await loadShardedBatches(existing.id).catch(() => new Map<string, SubtitleLine>());
        const cachedSrcLang = existing.sourceLanguage || existing.language;
        const sanitizedLines = existing.lines.map((baseLine) => {
          const sharded = shardMap.get(baseLine.id);
          const l =
            sharded && sharded.enriched
              ? {
                  ...sharded,
                  id: baseLine.id,
                  index: baseLine.index,
                  start: baseLine.start,
                  duration: baseLine.duration,
                  end: baseLine.end,
                  rawText: baseLine.rawText ?? sharded.rawText,
                }
              : baseLine;
          if (
            cachedSrcLang === 'vi' &&
            (!l.enriched || !isPureTargetLanguage(l.text, existing.language, l.rawText))
          ) {
            return { ...l, text: '', tokens: [], enriched: false };
          }
          return l;
        });
        setSessionL1({ ...existing, lines: sanitizedLines });

        setVideoId(existing.videoId);
        setVideoTitle(existing.title);
        setChannelName(existing.channelName);
        setSourceLanguage(cachedSrcLang);
        setSourceLayer(existing.sourceLayer);
        setAiAudioRestricted(false);
        videoDurationSecRef.current = existing.videoDurationSec;
        setVideoDurationSec(existing.videoDurationSec);
        const lastEnd =
          sanitizedLines.length > 0 ? sanitizedLines[sanitizedLines.length - 1].end : 0;
        const needsMoreStt =
          existing.sourceLayer === 'stt_ai' &&
          (Boolean(existing.hasMoreStt) ||
            ((existing.videoDurationSec || 0) > 25 &&
              lastEnd < (existing.videoDurationSec || 0) - 20));
        const resumeSttOffset =
          existing.nextSttOffsetSec || Math.max(0, Math.floor(lastEnd > 4 ? lastEnd - 2 : 0));
        setHasMoreStt(needsMoreStt);
        setNextSttOffsetSec(resumeSttOffset);
        setContextAnchor(existing.contextAnchor || null);
        setSyncOffsetSec(existing.syncOffsetSec || 0);
        setSourceViLines(existing.sourceViLines || []);
        setInitialStartTime(parsed.startTime || existing.lastPosition || 0);
        setLines(sanitizedLines);
        setXrayCache(existing.xrayCache || {});
        setCurriculum(existing.curriculum || null);
        setCollocations3Tier(existing.collocations3Tier || null);
        setStudySheet(existing.studySheet || null);
        setChapters(existing.chapters || null);
        setNuanceMatrix(existing.nuanceMatrix || null);
        setProductionPack(existing.productionPack || null);
        setRightTab('transcript');
        setTranscriptSubTab('all');
        setIsLoadingVideo(false);

        // Auto-Resume: if video was closed mid-STT or mid-translation, silently resume missing windows & batches to 100%!
        if (
          !existing.isFullyTranslated ||
          sanitizedLines.some((l) => !l.enriched) ||
          needsMoreStt
        ) {
          runProgressiveEnrichment(sanitizedLines, {
            videoId: existing.videoId,
            title: existing.title,
            channelName: existing.channelName,
            language: existing.language,
            sourceLanguage: cachedSrcLang,
            sourceLayer: existing.sourceLayer,
            targetLevel: targetLvl,
            isAsr:
              existing.sourceLayer === 'asr_restored' ||
              existing.sourceLayer === 'vi_to_target',
            sourceViLines: existing.sourceViLines,
            initialFocusSec: parsed.startTime || existing.lastPosition || 0,
            videoDurationSec: existing.videoDurationSec,
            existingContextAnchor: existing.contextAnchor,
            syncOffsetSec: existing.syncOffsetSec || 0,
            initialHasMoreStt: needsMoreStt,
            initialNextSttOffsetSec: resumeSttOffset,
          });
        }
      };

      try {
        // STREAM 2A (0ms Sync): Instant L1 RAM Hot Cache Check (both Caption & AI Auto-Sub namespaces)!
        const l1Hit = getSessionL1(sessionKey) || getSessionL1(aiSubSessionKey);
        if (l1Hit && l1Hit.lines.length > 0) {
          await hydrateCachedSession(l1Hit);
          return;
        }

        // STREAM 2B + STREAM 3 CONCURRENT LAUNCH AT t = 0ms (L2 IndexedDB || Caption Unlock Race)
        const captionAbort = new AbortController();
        loadController.signal.addEventListener('abort', () => captionAbort.abort(), { once: true });

        const idbPromise = Promise.all([
          getVideoSession(sessionKey).catch(() => undefined),
          getVideoSession(aiSubSessionKey).catch(() => undefined),
        ]).then(([normalHit, aiHit]) => (normalHit && normalHit.lines.length > 0 ? normalHit : aiHit));
        const captionsPromise = fetchYouTubeCaptions(
          parsed.cleanUrl,
          targetLang,
          captionAbort.signal,
          targetLvl
        );
        // CRITICAL: Attach immediate no-op rejection handler so aborting on L2 IndexedDB hit
        // or rapid video switching NEVER fires an unhandled DOMException('Aborted')!
        captionsPromise.catch(() => undefined);

        // Check L2 IndexedDB first (~3–8ms); if cached, abort redundant network caption fetch!
        const existing = await idbPromise;
        if (loadGenerationRef.current !== myGeneration || loadController.signal.aborted) {
          captionAbort.abort();
          return;
        }

        if (existing && existing.lines.length > 0) {
          captionAbort.abort();
          await hydrateCachedSession(existing);
          return;
        }

        // Await already-in-flight Stream 3 (Caption Unlock Race — < 2.4s handoff)
        const resp = await captionsPromise;
        if (loadGenerationRef.current !== myGeneration || loadController.signal.aborted) {
          return;
        }

        setVideoId(resp.videoId);
        setVideoTitle(resp.title);
        setChannelName(resp.channelName);
        setInitialStartTime(resp.startTime || 0);
        setRightTab('transcript');
        setTranscriptSubTab('all');

        // SEAMLESS AI AUTO-SUBTITLE HANDOFF (NO BLOCKING UPLOAD POPUP!)
        if (resp.status === 'ai_auto_sub') {
          const detectedSrcLang: SourceLanguage = resp.sourceLanguage || 'vi';
          const mergedDurationSec = resp.videoDurationSec ?? videoDurationSecRef.current;
          if (mergedDurationSec) {
            videoDurationSecRef.current = mergedDurationSec;
            setVideoDurationSec(mergedDurationSec);
          }
          setSourceLanguage(detectedSrcLang);
          setSourceLayer('stt_ai');
          setAiAudioRestricted(false);
          setHasMoreStt(true);
          setNextSttOffsetSec(resp.nextSttOffsetSec || 0);
          setLines([]);
          setIsLoadingVideo(false);

          runProgressiveEnrichment([], {
            videoId: resp.videoId,
            title: resp.title,
            channelName: resp.channelName,
            language: targetLang,
            sourceLanguage: detectedSrcLang,
            sourceLayer: 'stt_ai',
            targetLevel: targetLvl,
            isAsr: false,
            initialFocusSec: resp.startTime || 0,
            videoDurationSec: mergedDurationSec,
            syncOffsetSec: 0,
            initialHasMoreStt: true,
            initialNextSttOffsetSec: resp.nextSttOffsetSec || 0,
          });
          return;
        }

        if (resp.status === 'no_captions' || resp.lines.length === 0) {
          setLines([]);
          setSourceLanguage('vi');
          setSourceLayer('stt_ai');
          setHasMoreStt(false);
          setAiAudioRestricted(true);
          setUploadNotice(
            resp.message ||
              'Video này giới hạn truy cập âm thanh từ xa. Bạn có thể bật AI nghe âm thanh trực tiếp từ tab trình duyệt hoặc nạp file .SRT thủ công.'
          );
          return;
        }

        const detectedSrcLang: SourceLanguage = resp.sourceLanguage || targetLang;
        const resolvedLayer: SubtitleSourceLayer =
          resp.extractionTier === 'stt_ai'
            ? 'stt_ai'
            : detectedSrcLang === 'vi'
              ? 'vi_to_target'
              : resp.isAsr
                ? 'asr_restored'
                : 'manual';

        setSourceLanguage(detectedSrcLang);
        setSourceLayer(resolvedLayer);
        const mergedDurationSec = resp.videoDurationSec ?? videoDurationSecRef.current;
        if (mergedDurationSec) {
          videoDurationSecRef.current = mergedDurationSec;
          setVideoDurationSec(mergedDurationSec);
        }
        const initialSttHasMore =
          resolvedLayer === 'stt_ai'
            ? Boolean(resp.hasMoreStt) ||
              (mergedDurationSec !== undefined &&
                mergedDurationSec > 25 &&
                (resp.lines[resp.lines.length - 1]?.start || 0) < mergedDurationSec - 20)
            : false;
        setHasMoreStt(initialSttHasMore);
        setNextSttOffsetSec(resp.nextSttOffsetSec || 0);

        const normalizedRawVi =
          detectedSrcLang === 'vi'
            ? toRawSourceLines(
                resp.lines.map((l) => ({
                  start: l.start,
                  duration: l.duration,
                  text: resp.directTranslated ? l.translationVi || l.text : l.text,
                }))
              )
            : undefined;
        if (normalizedRawVi) {
          setSourceViLines(normalizedRawVi);
        }

        let initialLines: SubtitleLine[];
        if (resp.directTranslated) {
          const directDrafts: SubtitleLine[] = resp.lines.map((r, i) => {
            const id = `line_${i}`;
            const start = Number(r.start.toFixed(3));
            const dur = Math.max(0.25, Number(r.duration.toFixed(3)));
            const cleanTxt = stripHtmlAndRubyArtifacts(r.text || '');
            const nonSpeech = isNonSpeechCueText(cleanTxt);
            const pureTarget =
              !nonSpeech && isPureTargetLanguage(cleanTxt, targetLang, r.translationVi);
            return {
              id,
              index: i,
              start,
              duration: dur,
              end: Number((start + dur).toFixed(3)),
              text: nonSpeech ? '' : pureTarget ? cleanTxt : detectedSrcLang === 'vi' ? '' : cleanTxt,
              readingMap: pureTarget ? r.readingMap : undefined,
              ipaLine: pureTarget ? r.ipaLine : undefined,
              rawText: detectedSrcLang === 'vi' ? r.translationVi || r.text : undefined,
              translationVi: nonSpeech ? '' : r.translationVi || (detectedSrcLang === 'vi' ? r.text : ''),
              tokens: [],
              enriched: nonSpeech || pureTarget,
            };
          });
          initialLines = normalizeMonotonicSubtitleLines(
            unpackCompactSubtitleBatch(directDrafts, targetLang, targetLvl)
          );
        } else {
          initialLines = await buildAuditedInitialLines(
            resp.lines,
            detectedSrcLang,
            Boolean(resp.isAsr)
          );
        }
        if (loadGenerationRef.current !== myGeneration || loadController.signal.aborted) {
          return;
        }
        setLines(initialLines);
        setIsLoadingVideo(false);

        runProgressiveEnrichment(initialLines, {
          videoId: resp.videoId,
          title: resp.title,
          channelName: resp.channelName,
          language: targetLang,
          sourceLanguage: detectedSrcLang,
          sourceLayer: resolvedLayer,
          targetLevel: targetLvl,
          isAsr: Boolean(resp.isAsr),
          sourceViLines: normalizedRawVi,
          initialFocusSec: resp.startTime || 0,
          videoDurationSec: mergedDurationSec,
          syncOffsetSec: 0,
          initialHasMoreStt: initialSttHasMore,
          initialNextSttOffsetSec: resp.nextSttOffsetSec || 0,
        });
      } catch (err) {
        if (
          loadGenerationRef.current !== myGeneration ||
          loadController.signal.aborted ||
          isAbortError(err)
        ) {
          return;
        }
        setLoadBannerError(
          sanitizeClientErrorMessage(
            err,
            'Không thể nạp phụ đề cho video này ngay lúc này. Bạn có thể thử lại hoặc nạp file .SRT/.VTT.'
          )
        );
      } finally {
        if (loadGenerationRef.current === myGeneration) {
          setIsLoadingVideo(false);
        }
      }
    },
    [language, targetLevel, flushVideoWorkspaceState, runProgressiveEnrichment]
  );

  // Seamless Instant EN <-> JP OR Level Switch on Vietnamese Source Videos (Zero IFrame Reload!)
  const switchTargetOnSameVietnameseVideo = useCallback(
    async (newLang: Language, newLvl: ProficiencyLevel) => {
      if (!videoId) return;
      setLanguage(newLang);
      setTargetLevel(newLvl);
      flushDerivedCaches();

      // Check 2-Tier L1 RAM (0ms) -> L2 IndexedDB (<10ms) composite cache first!
      const targetCacheKey = buildSessionKey(videoId, newLang, newLvl, sourceLayer);
      const cached = getSessionL1(targetCacheKey) || (await getVideoSession(targetCacheKey));
      if (cached && cached.lines.length > 0) {
        const shardMap = await loadShardedBatches(targetCacheKey).catch(
          () => new Map<string, SubtitleLine>()
        );
        const sanitizedCached = cached.lines.map((baseLine) => {
          const sharded = shardMap.get(baseLine.id);
          const l =
            sharded && sharded.enriched
              ? {
                  ...sharded,
                  id: baseLine.id,
                  index: baseLine.index,
                  start: baseLine.start,
                  duration: baseLine.duration,
                  end: baseLine.end,
                  rawText: baseLine.rawText ?? sharded.rawText,
                }
              : baseLine;
          return !l.enriched || !isPureTargetLanguage(l.text, newLang, l.rawText)
            ? { ...l, text: '', tokens: [], enriched: false }
            : l;
        });
        setSessionL1({ ...cached, lines: sanitizedCached });
        setLines(sanitizedCached);
        setContextAnchor(cached.contextAnchor || null);
        setXrayCache(cached.xrayCache || {});
        setCurriculum(cached.curriculum || null);
        setCollocations3Tier(cached.collocations3Tier || null);
        setStudySheet(cached.studySheet || null);
        setChapters(cached.chapters || null);
        setNuanceMatrix(cached.nuanceMatrix || null);
        setProductionPack(cached.productionPack || null);
        showToast(
          `Đã chuyển tức thì sang ${newLang === 'ja' ? `Tiếng Nhật ${newLvl}` : `Tiếng Anh ${newLvl}`} (giữ nguyên mốc phát)`
        );
        if (!cached.isFullyTranslated || sanitizedCached.some((l) => !l.enriched) || cached.hasMoreStt) {
          runProgressiveEnrichment(sanitizedCached, {
            videoId,
            title: videoTitle,
            channelName,
            language: newLang,
            sourceLanguage: 'vi',
            sourceLayer,
            targetLevel: newLvl,
            isAsr: sourceLayer === 'vi_to_target' || sourceLayer === 'asr_restored',
            sourceViLines: cached.sourceViLines || sourceViLines,
            initialFocusSec: currentTimeRef.current || 0,
            videoDurationSec: videoDurationSecRef.current ?? videoDurationSec,
            existingContextAnchor: cached.contextAnchor,
            syncOffsetSec,
            initialHasMoreStt: Boolean(cached.hasMoreStt),
            initialNextSttOffsetSec: cached.nextSttOffsetSec || nextSttOffsetSec,
          });
        }
        return;
      }

      // Rebuild from preserved sourceViLines without touching YouTubePlayer!
      const viBase: RawSourceLine[] =
        sourceViLines.length > 0
          ? sourceViLines
          : lines.map((l, idx) => ({
              id: l.id || `line_${idx}`,
              index: l.index ?? idx,
              start: l.start,
              duration: l.duration,
              text: l.rawText || l.translationVi || l.text,
            }));

      const freshLines = buildInitialLines(viBase, 'vi', true);
      setContextAnchor(null);
      setLines(freshLines);
      showToast(
        `Đang chuyển ngữ sang ${newLang === 'ja' ? `Tiếng Nhật ${newLvl}` : `Tiếng Anh ${newLvl}`} — video vẫn phát liên tục!`
      );

      runProgressiveEnrichment(freshLines, {
        videoId,
        title: videoTitle,
        channelName,
        language: newLang,
        sourceLanguage: 'vi',
        sourceLayer,
        targetLevel: newLvl,
        isAsr: sourceLayer === 'vi_to_target' || sourceLayer === 'asr_restored',
        sourceViLines: viBase,
        initialFocusSec: currentTimeRef.current || 0,
        videoDurationSec: videoDurationSecRef.current ?? videoDurationSec,
        syncOffsetSec,
        initialHasMoreStt: sourceLayer === 'stt_ai' && hasMoreStt,
        initialNextSttOffsetSec: nextSttOffsetSec,
      });
    },
    [
      videoId,
      sourceViLines,
      lines,
      videoTitle,
      channelName,
      sourceLayer,
      videoDurationSec,
      hasMoreStt,
      nextSttOffsetSec,
      syncOffsetSec,
      flushDerivedCaches,
      runProgressiveEnrichment,
      showToast,
    ]
  );

  // Real Duration Bridge from YouTubePlayer (browser iframe knows exact length e.g. 24:12 = 1452s even when server IP gets LOGIN_REQUIRED)
  const handleVideoDurationChange = useCallback(
    (durSec: number) => {
      if (!durSec || durSec < 5) return;
      const prev = videoDurationSecRef.current;
      if (prev !== undefined && Math.abs(prev - durSec) < 2) return;

      videoDurationSecRef.current = durSec;
      setVideoDurationSec(durSec);

      // Wake active Rolling STT Harvester immediately if pipeline is running
      if (durationUpdateNotifyRef.current) {
        durationUpdateNotifyRef.current(durSec);
        return;
      }

      // If pipeline already went idle on an STT video whose transcript ended early (e.g. cached stub), auto-resume to 100%!
      if (videoId && sourceLayer === 'stt_ai' && lines.length > 0 && !isEnrichingBg) {
        const lastEnd = lines[lines.length - 1]?.end || 0;
        if (durSec > 25 && lastEnd < durSec - 20) {
          const resumeOffset = Math.max(0, Math.floor(lastEnd > 4 ? lastEnd - 2 : 0));
          setHasMoreStt(true);
          setNextSttOffsetSec(resumeOffset);
          runProgressiveEnrichment(lines, {
            videoId,
            title: videoTitle || `YouTube Video (${videoId})`,
            channelName: channelName || 'YouTube',
            language,
            sourceLanguage,
            sourceLayer,
            targetLevel,
            isAsr: false,
            sourceViLines: sourceLanguage === 'vi' ? sourceViLines : undefined,
            initialFocusSec: currentTimeRef.current || 0,
            videoDurationSec: durSec,
            existingContextAnchor: contextAnchor || undefined,
            syncOffsetSec,
            initialHasMoreStt: true,
            initialNextSttOffsetSec: resumeOffset,
          });
        }
      }
    },
    [
      videoId,
      sourceLayer,
      lines,
      isEnrichingBg,
      videoTitle,
      channelName,
      language,
      sourceLanguage,
      targetLevel,
      sourceViLines,
      contextAnchor,
      syncOffsetSec,
      runProgressiveEnrichment,
    ]
  );

  // Tier-3 Windowed STT Continuation (safe poke without aborting active translation workers)
  const handleLoadMoreStt = async () => {
    if (!videoId || isLoadingMoreStt) return;
    if (manualSttTriggerRef.current) {
      manualSttTriggerRef.current();
      return;
    }
    if (!hasMoreStt) return;
    const lastEnd = lines.length > 0 ? lines[lines.length - 1].end : 0;
    const startOff = nextSttOffsetSec || Math.max(0, Math.floor(lastEnd > 4 ? lastEnd - 2 : 0));
    runProgressiveEnrichment(lines, {
      videoId,
      title: videoTitle || `YouTube Video (${videoId})`,
      channelName: channelName || 'YouTube',
      language,
      sourceLanguage,
      sourceLayer: 'stt_ai',
      targetLevel,
      isAsr: false,
      sourceViLines: sourceLanguage === 'vi' ? sourceViLines : undefined,
      initialFocusSec: currentTimeRef.current || 0,
      videoDurationSec: videoDurationSecRef.current ?? videoDurationSec,
      existingContextAnchor: contextAnchor || undefined,
      syncOffsetSec,
      initialHasMoreStt: true,
      initialNextSttOffsetSec: startOff,
    });
  };

  // Build ArticleSession from extracted web/raw article payload
  const openExtractedArticle = useCallback(
    (
      extracted: ExtractedArticleApiResponse,
      preferredLang?: Language,
      preferredLevel?: ProficiencyLevel
    ) => {
      flushVideoWorkspaceState();
      setVideoId(null);
      setLines([]);
      setLoadBannerError(null);
      setIsInvalidUrlError(false);

      const defaultStudyLang: ArticleLanguage =
        extracted.sourceLanguage === 'vi'
          ? preferredLang || language
          : extracted.sourceLanguage;
      const defaultLevel: ProficiencyLevel =
        preferredLevel ||
        (defaultStudyLang === 'ja'
          ? JLPT_LEVELS.includes(targetLevel as (typeof JLPT_LEVELS)[number])
            ? targetLevel
            : 'N3'
          : CEFR_LEVELS.includes(targetLevel as (typeof CEFR_LEVELS)[number])
            ? targetLevel
            : 'B2');

      const idSeed =
        extracted.url && extracted.url !== 'manual://pasted-article'
          ? extracted.url
          : `${extracted.title}_${extracted.sentences[0]?.text || Date.now()}`;
      const articleId = buildArticleId(idSeed);

      const session: ArticleSession = {
        id: articleId,
        url: extracted.url,
        domain: extracted.domain,
        title: extracted.title,
        author: extracted.author,
        siteName: extracted.siteName,
        publishedDate: extracted.publishedDate,
        lead: extracted.lead,
        sourceLanguage: extracted.sourceLanguage,
        activeLanguage: defaultStudyLang,
        targetLevel: defaultLevel,
        wordCount: extracted.wordCount,
        estimatedReadMinutes: extracted.estimatedReadMinutes,
        extractionTier: extracted.extractionTier,
        paragraphs: extracted.paragraphs,
        sentences: extracted.sentences.map((s) => ({
          id: s.id,
          index: s.index,
          paragraphId: s.paragraphId,
          sentenceIndexInParagraph: s.sentenceIndexInParagraph,
          blockType: s.blockType,
          originalText: s.text,
          nativeRuby: s.nativeRuby,
          variants: {},
        })),
        xrayCache: {},
        lastSentenceIndex: 0,
        updatedAt: Date.now(),
      };

      setActiveArticle(session);
      setArticleJumpTarget(null);
      void saveArticleSession(session).then(async () => {
        setSavedArticles(await listArticleSessions());
      });
    },
    [flushVideoWorkspaceState, language, targetLevel]
  );

  // Master Universal Web Article Loader (0ms IndexedDB Hit -> 3-Tier Extractor -> Tier 3 Paywall Rescue)
  const loadWebArticle = useCallback(
    async (
      rawUrl: string,
      preferredLang?: Language,
      jumpTarget?: { paragraphId?: string; sentenceId?: string }
    ) => {
      const normalizedUrl = /^https?:\/\//i.test(rawUrl.trim())
        ? rawUrl.trim()
        : `https://${rawUrl.trim()}`;

      articleLoadAbortRef.current?.abort();
      const ac = new AbortController();
      articleLoadAbortRef.current = ac;

      setLoadBannerError(null);
      setIsInvalidUrlError(false);
      setUrlInput(normalizedUrl);
      setIsLoadingArticle(true);

      try {
        // 0ms Offline IndexedDB hit first
        const existingId = buildArticleId(normalizedUrl);
        const cached = await getArticleSession(existingId);
        if (cached && cached.sentences.length > 0 && !ac.signal.aborted) {
          flushVideoWorkspaceState();
          setVideoId(null);
          setLines([]);
          setActiveArticle(cached);
          setArticleJumpTarget(jumpTarget || null);
          setIsLoadingArticle(false);
          return;
        }

        const extracted = await extractWebArticleApi(normalizedUrl, ac.signal);
        if (ac.signal.aborted) return;

        if (extracted.status === 'blocked_paywall') {
          setArticleRescueInfo({
            blockedUrl: extracted.url,
            blockedDomain: extracted.domain,
            reasonVi: extracted.reasonVi,
          });
          setArticleRescueOpen(true);
          return;
        }

        openExtractedArticle(extracted, preferredLang);
        if (jumpTarget) setArticleJumpTarget(jumpTarget);
      } catch (err) {
        if (isAbortError(err)) return;
        // Graceful fallback: open Smart Paste Modal instead of dead-end red screen
        let domain = '';
        try {
          domain = new URL(normalizedUrl).hostname.replace(/^www\./, '');
        } catch {
          domain = normalizedUrl;
        }
        setArticleRescueInfo({
          blockedUrl: normalizedUrl,
          blockedDomain: domain,
          reasonVi:
            err instanceof Error
              ? err.message
              : 'Trang web này chưa hỗ trợ đọc tự động. Bạn có thể dán trực tiếp nội dung bài viết vào khung dưới đây.',
        });
        setArticleRescueOpen(true);
      } finally {
        if (!ac.signal.aborted) setIsLoadingArticle(false);
      }
    },
    [flushVideoWorkspaceState, openExtractedArticle]
  );

  const handleSubmitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    const kind = classifyInputUrl(trimmed);
    if (kind === 'youtube') {
      setActiveArticle(null);
      loadYouTubeVideo(trimmed);
      return;
    }
    if (kind === 'article') {
      void loadWebArticle(trimmed);
      return;
    }
    setIsInvalidUrlError(true);
    setLoadBannerError(
      'Đường link chưa đúng định dạng. Hãy dán link YouTube, bất kỳ bài báo/blog web nào (https://...), hoặc bấm "Dán bài viết / PDF" để nạp văn bản trực tiếp.'
    );
  };

  const handleLanguageChange = (newLang: Language) => {
    if (newLang === language) return;
    const nextLvl: ProficiencyLevel = newLang === 'ja' ? 'N3' : 'B2';
    if (videoId && sourceLanguage === 'vi') {
      switchTargetOnSameVietnameseVideo(newLang, nextLvl);
      return;
    }
    setLanguage(newLang);
    setTargetLevel(nextLvl);
    if (videoId) {
      loadYouTubeVideo(`https://www.youtube.com/watch?v=${videoId}`, newLang, nextLvl);
    }
  };

  const handleTargetLevelChange = (newLvl: ProficiencyLevel) => {
    if (newLvl === targetLevel) return;
    if (videoId && sourceLanguage === 'vi') {
      switchTargetOnSameVietnameseVideo(language, newLvl);
      return;
    }
    setTargetLevel(newLvl);
  };

  const handleConfirmUploadedSubtitles = (
    parsedLines: SubtitleLine[],
    uploadedSrcLang: SourceLanguage
  ) => {
    setUploadModalOpen(false);
    setUploadNotice(null);
    flushDerivedCaches();

    const effectiveVid = videoId || parseYouTubeUrlClient(urlInput)?.videoId || 'local_video';
    const effectiveTitle = videoTitle || 'Bài học phụ đề tùy chỉnh';
    const effectiveChannel = channelName || 'Tải lên cục bộ';

    if (!videoId && effectiveVid !== 'local_video') setVideoId(effectiveVid);
    setVideoTitle(effectiveTitle);
    setChannelName(effectiveChannel);
    setSourceLanguage(uploadedSrcLang);
    setSourceLayer('uploaded');

    const viRaw: RawSourceLine[] =
      uploadedSrcLang === 'vi'
        ? parsedLines.map((l, idx) => ({
            id: l.id || `line_${idx}`,
            index: l.index ?? idx,
            start: l.start,
            duration: l.duration,
            text: l.text,
          }))
        : [];
    setSourceViLines(viRaw);

    const preparedLines =
      uploadedSrcLang === 'vi'
        ? parsedLines.map((l) => ({
            ...l,
            text: '',
            tokens: [],
            rawText: l.text,
            translationVi: l.text,
            enriched: false,
          }))
        : parsedLines;

    setLines(preparedLines);
    setRightTab('transcript');
    setTranscriptSubTab('all');

    runProgressiveEnrichment(preparedLines, {
      videoId: effectiveVid,
      title: effectiveTitle,
      channelName: effectiveChannel,
      language,
      sourceLanguage: uploadedSrcLang,
      sourceLayer: 'uploaded',
      targetLevel,
      isAsr: false,
      sourceViLines: viRaw.length > 0 ? viRaw : undefined,
    });
  };

  const handleSelectSavedSession = (session: VideoSession) => {
    flushVideoWorkspaceState();
    const sessionSrcLang: SourceLanguage = session.sourceLanguage || session.language;
    const sanitizedLines =
      sessionSrcLang === 'vi'
        ? session.lines.map((l) => {
            const pure = l.enriched && isPureTargetLanguage(l.text, session.language, l.rawText);
            if (pure) return l;
            return {
              ...l,
              rawText: l.rawText || l.translationVi || l.text,
              translationVi: l.translationVi || l.rawText || l.text,
              text: '',
              tokens: [],
              enriched: false,
            };
          })
        : session.lines;

    setVideoId(session.videoId);
    setUrlInput(session.url);
    setVideoTitle(session.title);
    setChannelName(session.channelName);
    setLanguage(session.language);
    setSourceLanguage(sessionSrcLang);
    setTargetLevel(session.targetLevel);
    setSourceLayer(session.sourceLayer);
    setVideoDurationSec(session.videoDurationSec);
    setContextAnchor(session.contextAnchor || null);
    setSyncOffsetSec(session.syncOffsetSec || 0);
    setSourceViLines(session.sourceViLines || []);
    setInitialStartTime(session.lastPosition || 0);
    setLines(sanitizedLines);
    setXrayCache(session.xrayCache || {});
    setCurriculum(session.curriculum || null);
    setCollocations3Tier(session.collocations3Tier || null);
    setStudySheet(session.studySheet || null);
    setChapters(session.chapters || null);
    setNuanceMatrix(session.nuanceMatrix || null);
    setProductionPack(session.productionPack || null);
    setRightTab('transcript');

    if (!session.isFullyTranslated || sanitizedLines.some((l) => !l.enriched)) {
      runProgressiveEnrichment(sanitizedLines, {
        videoId: session.videoId,
        title: session.title,
        channelName: session.channelName,
        language: session.language,
        sourceLanguage: sessionSrcLang,
        sourceLayer: session.sourceLayer,
        targetLevel: session.targetLevel,
        isAsr:
          session.sourceLayer === 'asr_restored' || session.sourceLayer === 'vi_to_target',
        sourceViLines: session.sourceViLines,
        initialFocusSec: session.lastPosition || 0,
        videoDurationSec: session.videoDurationSec,
        existingContextAnchor: session.contextAnchor,
        syncOffsetSec: session.syncOffsetSec || 0,
      });
    }
  };

  const handleDeleteSavedSession = async (id: string) => {
    deleteSessionL1(id);
    await deleteVideoSession(id);
    setSavedSessions(await listVideoSessions());
  };

  // --- 1-Click Tokenized Word Lookup (Strict 1:1 Lock + 0ms L1 RAM + L2 IndexedDB + In-Flight Dedupe) ---
  const handleTokenClick = useCallback(
    async (line: SubtitleLine, token: SubtitleToken) => {
      lookupAbortRef.current?.abort();
      const controller = new AbortController();
      lookupAbortRef.current = controller;

      if (autoPauseOnClick && playerRef.current) {
        if (!selectedToken) {
          wasPlayingBeforeLookupRef.current = playerRef.current.isPlaying();
        }
        playerRef.current.pause();
      }

      setSelectedToken({ line, token });
      setLookupError(null);

      const cacheKey = `v3_kanji_verified::${buildWordCacheKey(videoId || 'local', line.id, token.id, token.surface)}`;

      // 0ms Sync L1 RAM Hit
      const l1Word = getWordL1(cacheKey);
      if (l1Word && l1Word.tokenId === token.id) {
        setWordProfile(l1Word);
        setIsLookupLoading(false);
        return;
      }

      setWordProfile(null);
      setIsLookupLoading(true);

      const cached = await getCachedWordProfile(cacheKey);
      if (cached && cached.tokenId === token.id && !controller.signal.aborted) {
        setWordL1(cacheKey, cached);
        setWordProfile(cached);
        setIsLookupLoading(false);
        return;
      }

      try {
        const resp = await lookupWordProfile(
          {
            tokenId: token.id,
            lineId: line.id,
            surface: token.surface,
            lemma: token.lemma,
            sentence: line.text,
            prevSentence: lines[line.index - 1]?.text,
            nextSentence: lines[line.index + 1]?.text,
            language,
          },
          controller.signal
        );
        if (controller.signal.aborted) return;
        if (resp.profile.tokenId === token.id) {
          setWordL1(cacheKey, resp.profile);
          setWordProfile(resp.profile);
          await setCachedWordProfile(cacheKey, resp.profile);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setLookupError(
          sanitizeClientErrorMessage(
            err,
            'Hệ thống tra cứu từ điển đang tạm bận. Vui lòng bấm lại.'
          )
        );
      } finally {
        if (!controller.signal.aborted) setIsLookupLoading(false);
      }
    },
    [autoPauseOnClick, selectedToken, videoId, lines, language]
  );

  const handleCloseWordPopover = useCallback(() => {
    lookupAbortRef.current?.abort();
    setSelectedToken(null);
    setWordProfile(null);
    setLookupError(null);
    setIsLookupLoading(false);

    if (autoPauseOnClick && wasPlayingBeforeLookupRef.current && playerRef.current) {
      wasPlayingBeforeLookupRef.current = false;
      playerRef.current.play();
    }
  }, [autoPauseOnClick]);

  // --- Sentence Syntax X-Ray ---
  const triggerSyntaxXRay = useCallback(
    async (line: SubtitleLine, forceRefresh = false) => {
      setXrayTargetLineId(line.id);
      setRightTab('xray');
      setXrayError(null);
      if (!forceRefresh && xrayCache[line.id]) return;

      xrayAbortRef.current?.abort();
      const controller = new AbortController();
      xrayAbortRef.current = controller;
      setIsXrayLoading(true);

      try {
        const resp = await fetchSyntaxXRay(
          {
            lineId: line.id,
            sentence: line.text,
            translationVi: line.translationVi,
            language,
            prevSentence: lines[line.index - 1]?.text,
            nextSentence: lines[line.index + 1]?.text,
          },
          controller.signal
        );
        if (controller.signal.aborted) return;
        const nextCache = { ...xrayCache, [line.id]: resp.xray };
        setXrayCache(nextCache);
        persistCurrentSession({ xrayCache: nextCache });
      } catch (err) {
        if (controller.signal.aborted) return;
        setXrayError(err instanceof Error ? err.message : 'Lỗi giải phẫu cú pháp câu.');
      } finally {
        if (!controller.signal.aborted) setIsXrayLoading(false);
      }
    },
    [xrayCache, language, lines, persistCurrentSession]
  );

  // --- Collocations 3-Tier, Infinite +3 Zero-Duplicate Expand, Curriculum, Study Sheet, Chapters, Nuance Matrix ---
  const handleGenerateCollocations = useCallback(async () => {
    if (lines.length === 0) return;
    collocationsAbortRef.current?.abort();
    const controller = new AbortController();
    collocationsAbortRef.current = controller;
    setIsCollocationsLoading(true);
    setCollocationsError(null);
    try {
      const resp = await fetchCollocations3Tier(
        {
          lines: lines.map((l) => ({
            start: l.start,
            text: l.text,
            translationVi: l.translationVi,
          })),
          language,
          targetLevel,
          videoTitle,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setCollocations3Tier(resp.items);
      persistCurrentSession({ collocations3Tier: resp.items });
      const exprs = resp.items.flatMap((it) => [
        it.casual?.expression,
        it.natural?.expression,
        it.academic?.expression,
      ]).filter(Boolean);
      await recordCollocationHistoryExpressions(language, exprs);
    } catch (err) {
      if (controller.signal.aborted) return;
      setCollocationsError(err instanceof Error ? err.message : 'Lỗi trích xuất Collocations 3 Tầng.');
    } finally {
      if (!controller.signal.aborted) setIsCollocationsLoading(false);
    }
  }, [lines, language, targetLevel, videoTitle, persistCurrentSession]);

  const handleExpandMoreVideoCollocations = useCallback(async () => {
    if (lines.length === 0 || isExpandingCollocations) return;
    setIsExpandingCollocations(true);
    setCollocationsError(null);
    try {
      const historyExprs = await listCollocationHistoryExpressions(language);
      const currentExprs = (collocations3Tier || []).flatMap((it) => [
        it.casual?.expression,
        it.natural?.expression,
        it.academic?.expression,
      ]).filter(Boolean);
      const excludeExpressions = Array.from(new Set([...historyExprs, ...currentExprs]));

      const resp = await fetchCollocations3Tier({
        lines: lines.map((l) => ({
          start: l.start,
          text: l.text,
          translationVi: l.translationVi,
        })),
        language,
        targetLevel,
        videoTitle,
        excludeExpressions,
        count: 3,
      });

      if (resp.items.length > 0) {
        const merged = [...(collocations3Tier || []), ...resp.items];
        setCollocations3Tier(merged);
        persistCurrentSession({ collocations3Tier: merged });
        const addedExprs = resp.items.flatMap((it) => [
          it.casual?.expression,
          it.natural?.expression,
          it.academic?.expression,
        ]).filter(Boolean);
        await recordCollocationHistoryExpressions(language, addedExprs);
        showToast(`Đã mở rộng thêm +${resp.items.length} bộ Collocations mới (0% trùng lặp)!`);
      } else {
        showToast('Đã khai thác hết các cụm Collocations mới trong đoạn phụ đề này.');
      }
    } catch (err) {
      setCollocationsError(
        err instanceof Error ? err.message : 'Không thể mở rộng thêm +3 Collocations mới.'
      );
    } finally {
      setIsExpandingCollocations(false);
    }
  }, [
    lines,
    isExpandingCollocations,
    language,
    collocations3Tier,
    targetLevel,
    videoTitle,
    persistCurrentSession,
    showToast,
  ]);

  const handleGenerateCurriculum = useCallback(async () => {
    if (lines.length === 0) return;
    curriculumAbortRef.current?.abort();
    const controller = new AbortController();
    curriculumAbortRef.current = controller;
    setIsCurriculumLoading(true);
    setCurriculumError(null);
    try {
      const resp = await fetchCurriculumData(
        {
          lines: lines.map((l) => ({
            id: l.id,
            start: l.start,
            text: l.text,
            translationVi: l.translationVi,
          })),
          language,
          targetLevel,
          videoTitle,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setCurriculum(resp.curriculum);
      persistCurrentSession({ curriculum: resp.curriculum });
    } catch (err) {
      if (controller.signal.aborted) return;
      setCurriculumError(err instanceof Error ? err.message : 'Lỗi tổng hợp Từ vựng & Ngữ pháp.');
    } finally {
      if (!controller.signal.aborted) setIsCurriculumLoading(false);
    }
  }, [lines, language, targetLevel, videoTitle, persistCurrentSession]);

  const handleGenerateStudySheet = useCallback(async () => {
    if (lines.length === 0) return;
    studySheetAbortRef.current?.abort();
    const controller = new AbortController();
    studySheetAbortRef.current = controller;
    setIsStudySheetLoading(true);
    setStudySheetError(null);
    try {
      const resp = await fetchStudySheetData(
        {
          lines: lines.map((l) => ({
            id: l.id,
            start: l.start,
            text: l.text,
            translationVi: l.translationVi,
          })),
          language,
          targetLevel,
          videoTitle,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setStudySheet(resp.studySheet);
      persistCurrentSession({ studySheet: resp.studySheet });
    } catch (err) {
      if (controller.signal.aborted) return;
      setStudySheetError(err instanceof Error ? err.message : 'Lỗi tạo Phiếu Học Tập & Quiz.');
    } finally {
      if (!controller.signal.aborted) setIsStudySheetLoading(false);
    }
  }, [lines, language, targetLevel, videoTitle, persistCurrentSession]);

  const handleGenerateChapters = useCallback(async () => {
    if (lines.length === 0) return;
    chaptersAbortRef.current?.abort();
    const controller = new AbortController();
    chaptersAbortRef.current = controller;
    setIsChaptersLoading(true);
    setChaptersError(null);
    try {
      const resp = await fetchSmartChapters(
        {
          lines: lines.map((l) => ({ start: l.start, end: l.end, text: l.text })),
          language,
          videoTitle,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setChapters(resp.chapters);
      persistCurrentSession({ chapters: resp.chapters });
    } catch (err) {
      if (controller.signal.aborted) return;
      setChaptersError(err instanceof Error ? err.message : 'Lỗi chia chương học.');
    } finally {
      if (!controller.signal.aborted) setIsChaptersLoading(false);
    }
  }, [lines, language, videoTitle, persistCurrentSession]);

  const handleGenerateNuanceMatrix = useCallback(async () => {
    if (lines.length === 0) return;
    nuanceAbortRef.current?.abort();
    const controller = new AbortController();
    nuanceAbortRef.current = controller;
    setIsNuanceLoading(true);
    setNuanceError(null);
    try {
      const resp = await fetchNuanceMatrix(
        {
          lines: lines.map((l) => ({ start: l.start, text: l.text })),
          language,
          targetLevel,
          videoTitle,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setNuanceMatrix(resp.matrix);
      persistCurrentSession({ nuanceMatrix: resp.matrix });
    } catch (err) {
      if (controller.signal.aborted) return;
      setNuanceError(
        sanitizeClientErrorMessage(err, 'Lỗi phân tích Ma trận sắc thái.')
      );
    } finally {
      if (!controller.signal.aborted) setIsNuanceLoading(false);
    }
  }, [lines, language, targetLevel, videoTitle, persistCurrentSession]);

  // Super-System 2: Expand +3 Non-Duplicate Confusable Nuance Pairs
  const handleExpandThreeNuancePairs = useCallback(async () => {
    if (lines.length === 0 || isNuanceExpanding) return;
    nuanceExpandAbortRef.current?.abort();
    const controller = new AbortController();
    nuanceExpandAbortRef.current = controller;
    setIsNuanceExpanding(true);
    setNuanceError(null);
    try {
      const excludeTitles = (nuanceMatrix || []).map((g) => g.title);
      const resp = await expandThreeNuancePairs(
        {
          language,
          targetLevel,
          videoTitle,
          excludeTitles,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      if (resp.groups.length > 0) {
        const merged = [...(nuanceMatrix || []), ...resp.groups];
        setNuanceMatrix(merged);
        persistCurrentSession({ nuanceMatrix: merged });
        showToast(`Đã bổ sung thêm +${resp.groups.length} nhóm phân biệt sắc thái mới!`);
      } else {
        showToast('Đã khai thác hết các cặp từ dễ nhầm tiêu biểu trong video này.');
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setNuanceError(
        sanitizeClientErrorMessage(err, 'Không thể mở rộng thêm +3 cặp từ dễ nhầm lúc này.')
      );
    } finally {
      if (!controller.signal.aborted) setIsNuanceExpanding(false);
    }
  }, [lines, isNuanceExpanding, nuanceMatrix, language, targetLevel, videoTitle, persistCurrentSession, showToast]);

  // Super-System 5: Generate 4-Mode Active Production Lab Pack
  const handleGenerateProductionPack = useCallback(async () => {
    if (lines.length === 0) return;
    productionAbortRef.current?.abort();
    const controller = new AbortController();
    productionAbortRef.current = controller;
    setIsProductionLoading(true);
    setProductionError(null);
    try {
      const resp = await fetchProductionLabPack(
        {
          lines: lines.map((l) => ({
            id: l.id,
            start: l.start,
            text: l.text,
            translationVi: l.translationVi,
          })),
          language,
          targetLevel,
          videoTitle,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setProductionPack(resp.pack);
      persistCurrentSession({ productionPack: resp.pack });
    } catch (err) {
      if (controller.signal.aborted) return;
      setProductionError(
        sanitizeClientErrorMessage(err, 'Chưa thể tạo gói luyện phản xạ 4 chế độ. Vui lòng thử lại.')
      );
    } finally {
      if (!controller.signal.aborted) setIsProductionLoading(false);
    }
  }, [lines, language, targetLevel, videoTitle, persistCurrentSession]);

  // Super-System 6: Personal Weakness Radar Handlers & Cross-Video Lookup
  const handleLogWeakness = useCallback(
    async (params: {
      kind: 'vocab' | 'grammar' | 'particle' | 'tense';
      term: string;
      categoryLabel: string;
      lastExample?: string;
      meaningVi?: string;
    }) => {
      if (!params.term.trim()) return;
      await recordWeakness({
        language,
        kind: params.kind,
        term: params.term,
        categoryLabel: params.categoryLabel,
        lastExample: params.lastExample,
        meaningVi: params.meaningVi,
      });
      setWeaknesses(await listWeaknesses());
    },
    [language]
  );

  const handleDeleteWeakness = useCallback(async (id: string) => {
    await deleteWeakness(id);
    setWeaknesses(await listWeaknesses());
  }, []);

  const weaknessMap = useMemo(() => {
    const map = new Map<string, WeaknessEntry>();
    for (const w of weaknesses) {
      if (w.language !== language || w.errorCount <= 0) continue;
      const key = w.term.trim().toLowerCase();
      if (key) map.set(key, w);
    }
    return map;
  }, [weaknesses, language]);

  const weaknessTerms = useMemo(
    () =>
      weaknesses
        .filter((w) => w.language === language && w.errorCount > 0)
        .map((w) => w.term.trim())
        .filter((t) => t.length >= 2),
    [weaknesses, language]
  );

  // --- Smart Clip Cutter ("Câu Thoại Vàng") ---
  const handleSaveSmartClip = async () => {
    if (!videoId || !activeLine) return;
    const startSec = Math.max(0, Number((activeLine.start - 1).toFixed(2)));
    const endSec = Number(Math.max(activeLine.end + 1, startSec + 12).toFixed(2));
    const clipLines = lines.filter((l) => l.start >= startSec - 0.5 && l.start <= endSec);
    const clip: SmartClip = {
      id: `clip_${videoId}_${Math.floor(startSec)}_${Date.now()}`,
      videoId,
      videoTitle: videoTitle || 'YouTube Lesson',
      language,
      start: startSec,
      end: endSec,
      text: clipLines.map((l) => l.text).join(' ').slice(0, 260) || activeLine.text,
      translationVi: clipLines
        .map((l) => l.translationVi)
        .filter(Boolean)
        .join(' ')
        .slice(0, 260),
      createdAt: Date.now(),
    };
    await saveSmartClip(clip);
    setClips(await listSmartClips());
    setClipSavedFeedback(true);
    showToast('Đã lưu đoạn Clip vàng 12 giây vào Kho Clip & Ghi chú!');
    window.setTimeout(() => setClipSavedFeedback(false), 1800);
  };

  const handlePlaySmartClip = (clip: SmartClip) => {
    if (clip.videoId !== videoId) {
      loadYouTubeVideo(buildYouTubeTimestampUrl(clip.videoId, clip.start), clip.language);
      return;
    }
    setLoopSingleLine(false);
    setLoopA(clip.start);
    setLoopB(clip.end);
    setActiveClipId(clip.id);
    playerRef.current?.seekTo(clip.start, true);
  };

  const handleDeleteSmartClip = async (id: string) => {
    await deleteSmartClip(id);
    if (activeClipId === id) {
      setActiveClipId(null);
      setLoopA(null);
      setLoopB(null);
    }
    setClips(await listSmartClips());
  };

  // --- Timestamped Notes & Visual Quote Card ---
  const handleAddTimestampedNote = async (content: string, timestamp: number) => {
    if (!videoId) return;
    const note: TimestampedNote = {
      id: `note_${videoId}_${Date.now()}`,
      videoId,
      timestamp: Number(timestamp.toFixed(1)),
      content,
      createdAt: Date.now(),
    };
    await saveTimestampedNote(note);
    setNotes(await listTimestampedNotes(videoId));
    showToast('Đã lưu ghi chú gắn mốc thời gian!');
  };

  const handleDeleteTimestampedNote = async (id: string) => {
    await deleteTimestampedNote(id);
    if (videoId) setNotes(await listTimestampedNotes(videoId));
  };

  const handleDownloadQuoteCard = (line: SubtitleLine) => {
    const firstGrammar = xrayCache[line.id]?.grammarPoints?.[0];
    downloadVisualQuoteCard({
      line,
      language,
      videoTitle: videoTitle || 'KotoZen Lesson',
      grammarNote: firstGrammar ? `${firstGrammar.pattern} — ${firstGrammar.nuance}` : undefined,
      theme,
    });
    showToast('Đã xuất thẻ trích dẫn song ngữ .PNG!');
  };

  // --- FSRS Flashcards ---
  const savedTermKeys = useMemo(() => {
    const set = new Set<string>();
    flashcards.forEach((c) => {
      set.add(`${c.kind}::${(c.lemma || c.term).toLowerCase()}`);
      set.add(`${c.kind}::${c.term.toLowerCase()}`);
    });
    return set;
  }, [flashcards]);

  const dueCardsCount = useMemo(() => {
    const now = Date.now();
    return flashcards.filter((c) => c.due <= now).length;
  }, [flashcards]);

  const addFlashcard = useCallback(
    async (
      cardInput: Omit<
        Flashcard,
        | 'id'
        | 'createdAt'
        | 'stability'
        | 'difficulty'
        | 'elapsedDays'
        | 'scheduledDays'
        | 'reps'
        | 'lapses'
        | 'state'
        | 'due'
      >
    ) => {
      const now = Date.now();
      const card: Flashcard = {
        ...cardInput,
        id: `fc_${cardInput.kind}_${cardInput.videoId}_${Math.floor(cardInput.timestamp)}_${now}`,
        createdAt: now,
        ...createInitialFsrsState(now),
      };
      await saveFlashcard(card);
      setFlashcards(await listFlashcards());
      showToast(`Đã lưu “${cardInput.term}” vào kho thẻ nhớ FSRS!`);
    },
    [showToast]
  );

  const handleSaveWordProfileCard = (profile: WordProfile) => {
    if (!selectedToken) return;
    const line = selectedToken.line;
    const vid = videoId || 'local';
    addFlashcard({
      kind: 'vocab',
      language,
      term: profile.lemma || profile.surface,
      lemma: profile.lemma,
      readingOrIpa: language === 'ja' ? profile.furigana : profile.ipaUS || profile.ipaUK,
      hanViet: profile.hanViet,
      level: profile.level,
      meaningVi: profile.contextMeaning,
      extraNotes: profile.usageNote || profile.connectedSpeechNote,
      kanjiBreakdown: profile.kanjiBreakdown,
      nuanceDual: profile.nuanceDual,
      videoId: vid,
      videoTitle: videoTitle || 'YouTube Lesson',
      videoUrl: buildYouTubeTimestampUrl(vid, line.start),
      timestamp: line.start,
      sentence: line.text,
      sentenceVi: line.translationVi,
    });
  };

  // Save 2-Sided Dual-Mode Nuance FSRS Card (Front = optional 3s summary hint, Back = 0ms full 6-dimension dossier)
  const handleSaveNuanceDualCard = useCallback(
    async (
      payload: NuanceDualPayload,
      context?: { timestamp?: number; sentence?: string; sentenceVi?: string }
    ) => {
      const vid = videoId || 'local';
      const ts = context?.timestamp ?? activeLine?.start ?? 0;
      const sent =
        context?.sentence ||
        payload.summary.anchorExample.sentence ||
        activeLine?.text ||
        payload.term;
      const sentVi =
        context?.sentenceVi ||
        payload.summary.anchorExample.translationVi ||
        activeLine?.translationVi ||
        payload.summary.coreRule;
      const cardKind: 'vocab' | 'grammar' = payload.kind === 'grammar' ? 'grammar' : 'vocab';
      const normalizedTerm = (payload.lemma || payload.term).toLowerCase();

      // If an FSRS card already exists for this term, enrich it in-place with the 2-sided nuanceDual dossier
      const existingCard = flashcards.find(
        (c) =>
          c.kind === cardKind &&
          c.language === payload.language &&
          ((c.lemma || c.term).toLowerCase() === normalizedTerm ||
            c.term.toLowerCase() === payload.term.toLowerCase())
      );

      const primaryRow = payload.deepDive.contrastMatrix[0];
      const resolvedReading =
        payload.summary.anchorExample.readingOrIpa || primaryRow?.readingOrIpa;
      const resolvedHanViet = primaryRow?.hanViet;
      const badgeSummary = `${payload.summary.badges.formality} · ${payload.summary.badges.attitude} · ${payload.summary.badges.channel}`;

      if (existingCard) {
        const upgraded: Flashcard = {
          ...existingCard,
          nuanceDual: payload,
          readingOrIpa: existingCard.readingOrIpa || resolvedReading,
          hanViet: existingCard.hanViet || resolvedHanViet,
          extraNotes: existingCard.extraNotes || payload.summary.coreRule,
        };
        await saveFlashcard(upgraded);
        setFlashcards(await listFlashcards());
        showToast(`Đã gắn Hồ sơ Sắc thái 2 tầng vào thẻ FSRS “${payload.term}”!`);
        return;
      }

      await addFlashcard({
        kind: cardKind,
        language: payload.language,
        term: payload.lemma || payload.term,
        lemma: payload.lemma || payload.term,
        readingOrIpa: resolvedReading,
        hanViet: resolvedHanViet,
        level: payload.targetLevel,
        meaningVi: payload.summary.coreRule,
        extraNotes: badgeSummary,
        nuanceDual: payload,
        videoId: vid,
        videoTitle: videoTitle || 'YouTube Lesson',
        videoUrl: buildYouTubeTimestampUrl(vid, ts),
        timestamp: ts,
        sentence: sent,
        sentenceVi: sentVi,
      });
    },
    [videoId, videoTitle, activeLine, flashcards, addFlashcard, showToast]
  );

  const handleSaveCollocationCard = (
    item: Collocation3TierItem,
    tierKey: CollocationTier
  ) => {
    const chosen = item[tierKey];
    const vid = videoId || 'local';
    addFlashcard({
      kind: 'vocab',
      language,
      term: chosen.expression,
      lemma: chosen.expression,
      readingOrIpa: chosen.readingOrIpa,
      hanViet: chosen.hanViet,
      level: chosen.level,
      meaningVi: item.vietnameseConcept,
      extraNotes: [item.patternFormula ? `[${item.patternFormula}]` : '', chosen.nuanceVi]
        .filter(Boolean)
        .join(' · '),
      videoId: vid,
      videoTitle: videoTitle || 'YouTube Lesson',
      videoUrl: buildYouTubeTimestampUrl(vid, item.timestamp),
      timestamp: item.timestamp,
      sentence: chosen.exampleSentence || chosen.expression,
      sentenceVi: item.vietnameseConcept,
    });
  };

  const handleSaveDetectedCollocationCard = (col: DetectedCollocation, line: SubtitleLine) => {
    const vid = videoId || 'local';
    addFlashcard({
      kind: 'vocab',
      language,
      term: col.phrase,
      lemma: col.phrase,
      readingOrIpa: col.readingOrIpa,
      hanViet: col.hanViet,
      level: col.level,
      meaningVi: col.meaningVi,
      extraNotes: `[${col.patternFormula}] · Cụm Collocation nguyên khối`,
      videoId: vid,
      videoTitle: videoTitle || 'YouTube Lesson',
      videoUrl: buildYouTubeTimestampUrl(vid, line.start),
      timestamp: line.start,
      sentence: line.text,
      sentenceVi: line.translationVi,
    });
  };

  const handleSaveExtraWordCollocation = (col: WordExtraCollocation, line: SubtitleLine) => {
    const vid = videoId || 'local';
    addFlashcard({
      kind: 'vocab',
      language,
      term: col.expression,
      lemma: col.expression,
      readingOrIpa: col.readingOrIpa,
      level: col.level,
      meaningVi: col.meaningVi,
      extraNotes: `Cụm thực chiến (${col.tier})`,
      videoId: vid,
      videoTitle: videoTitle || 'YouTube Lesson',
      videoUrl: buildYouTubeTimestampUrl(vid, line.start),
      timestamp: line.start,
      sentence: col.exampleSentence || line.text,
      sentenceVi: col.meaningVi,
    });
  };

  const handleSaveWebCollocationCard = (item: CollocationWebBranchItem, coreWord: string) => {
    const vid = videoId || 'collocation_web';
    addFlashcard({
      kind: 'vocab',
      language,
      term: item.expression,
      lemma: item.expression,
      readingOrIpa: item.readingOrIpa,
      hanViet: item.hanViet,
      level: item.level,
      meaningVi: item.meaningVi,
      extraNotes: `[${item.patternFormula}] · Bản đồ từ gốc: ${coreWord}`,
      videoId: vid,
      videoTitle: videoTitle || `Bản đồ Collocations: ${coreWord}`,
      videoUrl: videoId ? buildYouTubeTimestampUrl(videoId, currentTime) : '',
      timestamp: videoId ? currentTime : 0,
      sentence: item.exampleSentence,
      sentenceVi: item.meaningVi,
    });
  };

  const handleSaveEncyclopediaEntryCard = (entry: ThematicCollocationEntry) => {
    addFlashcard({
      kind: 'vocab',
      language: entry.language,
      term: entry.expression,
      lemma: entry.expression,
      readingOrIpa: entry.readingOrIpa,
      hanViet: entry.hanViet,
      level: entry.level,
      meaningVi: entry.meaningVi,
      extraNotes: `[${entry.patternFormula}] · ✅ ${entry.antiCalque.correctForm} (❌ ${entry.antiCalque.wrongTrap})`,
      videoId: `colloc_lib_${entry.topicId}`,
      videoTitle: 'Thư viện Collocations Bách Khoa',
      videoUrl: '',
      timestamp: 0,
      sentence: entry.exampleSentence,
      sentenceVi: entry.exampleTranslationVi,
    });
  };

  const handleSaveCurriculumVocab = (item: CurriculumVocabItem) => {
    const occ = item.occurrences[0];
    const matchedLine = lines.find((l) => l.id === occ?.lineId);
    const vid = videoId || 'local';
    addFlashcard({
      kind: 'vocab',
      language,
      term: item.word,
      lemma: item.lemma,
      readingOrIpa: item.readingOrIpa,
      hanViet: item.hanViet,
      level: item.level,
      meaningVi: item.meaningVi,
      videoId: vid,
      videoTitle: videoTitle || 'YouTube Lesson',
      videoUrl: buildYouTubeTimestampUrl(vid, occ?.start ?? 0),
      timestamp: occ?.start ?? 0,
      sentence: occ?.sentence || item.word,
      sentenceVi: matchedLine?.translationVi || '',
    });
  };

  const handleSaveCurriculumGrammar = (item: CurriculumGrammarItem) => {
    const vid = videoId || 'local';
    addFlashcard({
      kind: 'grammar',
      language,
      term: item.pattern,
      lemma: item.pattern,
      readingOrIpa: item.formula,
      level: item.level,
      meaningVi: item.nuance,
      extraNotes: item.conjugation,
      videoId: vid,
      videoTitle: videoTitle || 'YouTube Lesson',
      videoUrl: buildYouTubeTimestampUrl(vid, item.exampleStart),
      timestamp: item.exampleStart,
      sentence: item.exampleSentence,
      sentenceVi: item.exampleTranslationVi,
    });
  };

  const handleSaveXRayGrammar = (gp: SentenceGrammarNote, line: SubtitleLine) => {
    const vid = videoId || 'local';
    addFlashcard({
      kind: 'grammar',
      language,
      term: gp.pattern,
      lemma: gp.pattern,
      readingOrIpa: gp.formula,
      level: gp.level,
      meaningVi: gp.nuance,
      extraNotes: gp.conjugation,
      videoId: vid,
      videoTitle: videoTitle || 'YouTube Lesson',
      videoUrl: buildYouTubeTimestampUrl(vid, line.start),
      timestamp: line.start,
      sentence: line.text,
      sentenceVi: line.translationVi,
    });
  };

  const handleRateFlashcard = async (card: Flashcard, rating: FsrsRating) => {
    const { updated } = scheduleFsrsCard(card, rating);
    await saveFlashcard(updated);
    await incrementDailyActivity({ wordsReviewed: 1 });
    if (rating === 1 || rating === 2) {
      await recordWeakness({
        language: card.language,
        kind: card.kind === 'grammar' ? 'grammar' : 'vocab',
        term: card.lemma || card.term,
        categoryLabel:
          card.kind === 'grammar'
            ? `Mẫu ngữ pháp ${card.level} hay quên`
            : `Từ vựng & cụm ${card.level} hay quên`,
        lastExample: card.sentence,
        meaningVi: card.meaningVi,
      });
    } else {
      await markWeaknessResolved(
        card.language,
        card.kind === 'grammar' ? 'grammar' : 'vocab',
        card.lemma || card.term
      );
    }
    const [cards, logs, weaknessList] = await Promise.all([
      listFlashcards(),
      listActivityLogs(),
      listWeaknesses(),
    ]);
    setFlashcards(cards);
    setActivityLogs(logs);
    setWeaknesses(weaknessList);
  };

  const handleDeleteFlashcard = async (cardId: string) => {
    await deleteFlashcard(cardId);
    setFlashcards(await listFlashcards());
  };

  const handleUpdateFlashcardNote = async (cardId: string, note: string) => {
    const target = flashcards.find((c) => c.id === cardId);
    if (!target) return;
    const updated = { ...target, userNote: note };
    await saveFlashcard(updated);
    setFlashcards((prev) => prev.map((c) => (c.id === cardId ? updated : c)));
  };

  const handleJumpToCardVideoAnchor = (card: Flashcard) => {
    if (card.sourceKind === 'article' && (card.articleId || card.articleUrl)) {
      const targetJump = { paragraphId: card.paragraphId, sentenceId: card.sentenceId };
      if (activeArticle && activeArticle.id === card.articleId) {
        setArticleJumpTarget({ ...targetJump });
        return;
      }
      if (card.articleId) {
        void getArticleSession(card.articleId).then((found) => {
          if (found) {
            flushVideoWorkspaceState();
            setVideoId(null);
            setLines([]);
            setActiveArticle(found);
            setArticleJumpTarget(targetJump);
          } else if (card.articleUrl && /^https?:\/\//i.test(card.articleUrl)) {
            void loadWebArticle(card.articleUrl, card.language, targetJump);
          }
        });
      }
      return;
    }
    setActiveArticle(null);
    if (card.videoId === videoId) {
      playerRef.current?.seekTo(card.timestamp, true);
      return;
    }
    loadYouTubeVideo(card.videoUrl, card.language);
  };

  // --- Navigation & Playback Actions (Exact Cue Start + Instant Seek-Preemption) ---
  const handleSeekTo = useCallback(
    (seconds: number) => {
      const targetRaw = Math.max(0, Number((seconds - syncOffsetSec).toFixed(3)));
      playerRef.current?.seekTo(targetRaw, true);
      seekPreemptTriggerRef.current?.(seconds);
    },
    [syncOffsetSec]
  );

  const handlePrevLine = useCallback(() => {
    if (!activeLine || lines.length === 0) return;
    const prevTarget = lines[Math.max(0, activeLine.index - 1)];
    handleSeekTo(prevTarget.start);
  }, [activeLine, lines, handleSeekTo]);

  const handleNextLine = useCallback(() => {
    if (!activeLine || lines.length === 0) return;
    const nextTarget = lines[Math.min(lines.length - 1, activeLine.index + 1)];
    handleSeekTo(nextTarget.start);
  }, [activeLine, lines, handleSeekTo]);

  const handleReplayCurrentLine = useCallback(() => {
    if (!activeLine) return;
    handleSeekTo(activeLine.start);
  }, [activeLine, handleSeekTo]);

  const handleCycleABLoop = useCallback(() => {
    const nowSec = playerRef.current?.getCurrentTime() ?? currentTime;
    if (loopA === null) {
      setLoopSingleLine(false);
      setActiveClipId(null);
      setLoopA(Number(nowSec.toFixed(2)));
      setLoopB(null);
    } else if (loopB === null) {
      const bVal = Math.max(loopA + 1, Number(nowSec.toFixed(2)));
      setLoopB(bVal);
      playerRef.current?.seekTo(loopA, true);
    } else {
      setLoopA(null);
      setLoopB(null);
      setActiveClipId(null);
    }
  }, [loopA, loopB, currentTime]);

  // --- Keyboard Power Shortcuts ---
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (selectedToken) {
          handleCloseWordPopover();
          return;
        }
        if (senseiOpen) setSenseiOpen(false);
        if (discoveryModalOpen) setDiscoveryModalOpen(false);
        if (collocationLibraryOpen) setCollocationLibraryOpen(false);
        if (uploadModalOpen) setUploadModalOpen(false);
        if (shortcutsOpen) setShortcutsOpen(false);
        if (historyOpen) setHistoryOpen(false);
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        playerRef.current?.togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevLine();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextLine();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setLoopA(null);
        setLoopB(null);
        setActiveClipId(null);
        setLoopSingleLine((prev) => {
          const next = !prev;
          if (next && activeLine) handleSeekTo(activeLine.start);
          return next;
        });
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleCycleABLoop();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowPhonetics((prev) => !prev);
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setShowTranslationVi((prev) => !prev);
      } else if (e.key.toLowerCase() === 'h') {
        setIsRevealHeld(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'h') setIsRevealHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    selectedToken,
    senseiOpen,
    discoveryModalOpen,
    collocationLibraryOpen,
    uploadModalOpen,
    shortcutsOpen,
    historyOpen,
    activeLine,
    handleCloseWordPopover,
    handlePrevLine,
    handleNextLine,
    handleSeekTo,
    handleCycleABLoop,
  ]);

  const xrayTargetLine = useMemo(() => {
    if (xrayTargetLineId) {
      const found = lines.find((l) => l.id === xrayTargetLineId);
      if (found) return found;
    }
    return activeLine;
  }, [xrayTargetLineId, lines, activeLine]);

  const isCurrentWordSaved = useMemo(() => {
    if (!wordProfile) return false;
    return (
      savedTermKeys.has(`vocab::${wordProfile.lemma.toLowerCase()}`) ||
      savedTermKeys.has(`vocab::${wordProfile.surface.toLowerCase()}`)
    );
  }, [wordProfile, savedTermKeys]);

  const isDetectedCollocationSaved = useMemo(() => {
    const phrase = wordProfile?.detectedCollocation?.phrase;
    if (!phrase) return false;
    return savedTermKeys.has(`vocab::${phrase.toLowerCase()}`);
  }, [wordProfile, savedTermKeys]);

  const sourceLayerLabel = (() => {
    switch (sourceLayer) {
      case 'vi_to_target':
        return 'Phụ đề Việt gốc ➔ Song ngữ bản xứ (Tầng 1–2)';
      case 'stt_ai':
        return 'Giải mã giọng nói âm thanh (Tầng 3)';
      case 'manual':
        return 'Phụ đề chính thức (Tầng 1)';
      case 'asr_restored':
        return 'Phục hồi từ Auto-ASR (Tầng 2)';
      case 'curated':
        return 'Nội dung kiểm chuẩn';
      default:
        return 'Nội dung nạp cục bộ (Tầng 4)';
    }
  })();

  const handleExpandThreeMoreSimilar = () => {
    const exclude = [
      ...(videoId ? [videoId] : []),
      ...similarFeed.map((s) => s.videoId),
    ];
    const nextBatch = getSimilarVideos(language, targetLevel, exclude, undefined, 3);
    if (nextBatch.length > 0) {
      setSimilarFeed((prev) => [...prev, ...nextBatch]);
    }
  };

  return (
    <div className="min-h-screen flex flex-col zen-canvas font-vi">
      <TopBar
        urlInput={urlInput}
        onUrlInputChange={setUrlInput}
        onSubmitUrl={handleSubmitUrl}
        language={language}
        onLanguageChange={handleLanguageChange}
        targetLevel={targetLevel}
        onTargetLevelChange={handleTargetLevelChange}
        isLoading={isLoadingVideo || isLoadingArticle}
        theme={theme}
        onCycleTheme={cycleTheme}
        onGoHome={() => {
          flushVideoWorkspaceState();
          articleLoadAbortRef.current?.abort();
          setVideoId(null);
          setActiveArticle(null);
          setLines([]);
          setVideoTitle('');
          setChannelName('');
        }}
        onOpenDiscovery={() => setDiscoveryModalOpen(true)}
        onOpenCollocationLibrary={() => setCollocationLibraryOpen(true)}
        onOpenUploadModal={() => {
          setUploadNotice(null);
          setUploadModalOpen(true);
        }}
        onOpenArticlePasteModal={() => {
          setArticleRescueInfo({});
          setArticleRescueOpen(true);
        }}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onExportBundle={() => {
          exportCompleteLessonMarkdown({
            title: videoTitle || 'KotoZen Lesson',
            url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : '',
            language,
            targetLevel,
            lines,
            chapters,
            curriculum,
            studySheet,
            xrayCache,
            notes,
          });
          showToast('Đã xuất trọn bộ bài học sang file Markdown (.MD)!');
        }}
        hasActiveLesson={lines.length > 0}
        historyCount={savedSessions.length + savedArticles.length}
        dueCardsCount={dueCardsCount}
        onJumpToReview={() => {
          setRightTab('practice');
          setPracticeSubTab('fsrs');
        }}
      />

      {/* Mobile compact Language + Level bar (shown only when video active or below md) */}
      <div className="md:hidden px-3 py-2 zen-surface border-b flex items-center justify-between gap-2 no-print">
        <div className="flex items-center p-0.5 zen-surface-subtle rounded-lg border">
          <button
            type="button"
            onClick={() => handleLanguageChange('en')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer ${
              language === 'en' ? 'zen-surface text-indigo-700 dark:text-indigo-300' : 'opacity-65'
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => handleLanguageChange('ja')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md font-jp cursor-pointer ${
              language === 'ja' ? 'zen-surface text-indigo-700 dark:text-indigo-300' : 'opacity-65'
            }`}
          >
            日本語
          </button>
        </div>

        <select
          value={targetLevel}
          onChange={(e) => handleTargetLevelChange(e.target.value as ProficiencyLevel)}
          aria-label="Chọn cấp độ mục tiêu"
          className="h-8 px-2.5 text-xs font-semibold rounded-lg zen-surface-subtle border"
        >
          {(language === 'ja' ? JLPT_LEVELS : CEFR_LEVELS).map((lvl) => (
            <option key={lvl} value={lvl}>
              {language === 'ja' ? `JLPT ${lvl}` : `CEFR ${lvl}`}
            </option>
          ))}
        </select>
      </div>

      {/* Main Centered Zen Container */}
      <main className="flex-1 w-full zen-container py-4 lg:py-6">
        {/* Friendly Error / Non-YouTube Link Rejection Banner */}
        {loadBannerError && (
          <div className="mb-4 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <span className="leading-relaxed safe-wrap">{loadBannerError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isInvalidUrlError && (
                <button
                  type="button"
                  onClick={() =>
                    loadYouTubeVideo(DEFAULT_VIETNAMESE_SAMPLE.url, language, targetLevel)
                  }
                  className="h-8 px-3 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Thử ngay 1 video mẫu Tiếng Việt</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setLoadBannerError(null);
                  setIsInvalidUrlError(false);
                }}
                className="text-xs font-semibold underline cursor-pointer"
              >
                Ẩn
              </button>
            </div>
          </div>
        )}

        {/* LANDING VIEW (!videoId && !activeArticle) */}
        {!videoId && !activeArticle ? (
          <div className="space-y-6">
            <HeroAndBentoShowcase
              urlInput={urlInput}
              onUrlInputChange={setUrlInput}
              onSubmitUrl={handleSubmitUrl}
              language={language}
              onLanguageChange={handleLanguageChange}
              targetLevel={targetLevel}
              onTargetLevelChange={handleTargetLevelChange}
              isLoading={isLoadingVideo || isLoadingArticle}
              activityLogs={activityLogs}
              flashcards={flashcards}
              onSelectSampleVideo={(item) => {
                setActiveArticle(null);
                loadYouTubeVideo(
                  item.url,
                  item.sourceLanguage === 'vi' ? language : item.language,
                  item.sourceLanguage === 'vi' ? targetLevel : item.level
                );
              }}
              onSelectSampleArticle={(art: CuratedArticleSample) => {
                void loadWebArticle(art.url, art.sourceLanguage === 'vi' ? language : art.suggestedTarget);
              }}
              onOpenArticlePasteModal={() => {
                setArticleRescueInfo({});
                setArticleRescueOpen(true);
              }}
              onOpenCollocationLibrary={() => setCollocationLibraryOpen(true)}
            />

            <DiscoveryHub
              language={language}
              targetLevel={targetLevel}
              currentVideoId={videoId}
              onSelectVideo={(item) => {
                setActiveArticle(null);
                loadYouTubeVideo(
                  item.url,
                  item.sourceLanguage === 'vi' ? language : item.language,
                  item.sourceLanguage === 'vi' ? targetLevel : item.level
                );
              }}
            />
          </div>
        ) : activeArticle ? (
          /* UNIVERSAL WEB ARTICLE STUDIO (60/40 Tri-Lingual Zen Reading Room) */
          <ErrorBoundary inline sectionName="Phòng Đọc Bài Viết 3 Ngôn Ngữ">
            <ArticleStudioWorkspace
              article={activeArticle}
              onUpdateArticle={(updated) => {
                setActiveArticle(updated);
                setSavedArticles((prev) => {
                  const rest = prev.filter((a) => a.id !== updated.id);
                  return [updated, ...rest];
                });
              }}
              initialHighlightParagraphId={articleJumpTarget?.paragraphId || null}
              initialHighlightSentenceId={articleJumpTarget?.sentenceId || null}
              flashcards={flashcards}
              savedTermKeys={savedTermKeys}
              onSaveFlashcard={async (card) => {
                await saveFlashcard(card);
                setFlashcards(await listFlashcards());
              }}
              onRateFlashcard={handleRateFlashcard}
              onDeleteFlashcard={handleDeleteFlashcard}
              onUpdateFlashcardNote={handleUpdateFlashcardNote}
              onJumpFromFlashcard={handleJumpToCardVideoAnchor}
              onDataImported={refreshOfflineData}
              weaknesses={weaknesses}
              onLogWeakness={handleLogWeakness}
              onDeleteWeakness={handleDeleteWeakness}
              activityLogs={activityLogs}
              onLogActivity={async (delta) => {
                await incrementDailyActivity(delta);
                setActivityLogs(await listActivityLogs());
              }}
              onOpenCollocationLibrary={() => setCollocationLibraryOpen(true)}
              onOpenAiSensei={(initialPrompt) => {
                setSenseiSelectedText(initialPrompt || activeArticle.title);
                setSenseiOpen(true);
              }}
              onToast={showToast}
              createArticleFlashcard={(p) => ({
                id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                kind: p.kind,
                language: p.language,
                term: p.term,
                lemma: p.lemma,
                readingOrIpa: p.readingOrIpa,
                hanViet: p.hanViet,
                level: p.level,
                meaningVi: p.meaningVi,
                extraNotes: p.extraNotes,
                kanjiBreakdown: p.kanjiBreakdown,
                nuanceDual: p.nuanceDual,
                videoId: activeArticle.id,
                videoTitle: activeArticle.title,
                videoUrl: activeArticle.url,
                timestamp: p.sentenceIndex,
                sourceKind: 'article',
                articleId: activeArticle.id,
                articleUrl: activeArticle.url,
                paragraphId: p.paragraphId,
                sentenceId: p.sentenceId,
                sentence: p.sentence,
                sentenceVi: p.sentenceVi,
                createdAt: Date.now(),
                ...createInitialFsrsState(),
              })}
            />
          </ErrorBoundary>
        ) : (
          /* STUDY ROOM VIEW (60% Left / 40% Right Desktop, Stacked Mobile) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* ============ LEFT HEMISPHERE (60% -> 7/12 columns) ============ */}
            <section className="lg:col-span-7 min-w-0 max-w-full space-y-3.5 no-print">
              <ErrorBoundary inline sectionName="Trình phát Video YouTube">
                <YouTubePlayer
                  ref={playerRef}
                  videoId={videoId}
                  videoTitle={videoTitle}
                  language={language}
                  targetLevel={targetLevel}
                  initialStartTime={initialStartTime}
                  playbackRate={playbackRate}
                  syncOffsetSec={syncOffsetSec}
                  activeLine={activeSpokenLine}
                  allLines={lines}
                  loopSingleLine={loopSingleLine}
                  loopA={loopA}
                  loopB={loopB}
                  autoPausePerLine={autoPausePerLine}
                  autoPauseDelaySec={autoPauseDelaySec}
                  dictationMode={dictationMode}
                  podcastMode={podcastMode}
                  onTogglePodcastMode={() => setPodcastMode((v) => !v)}
                  onTimeUpdate={handleTimeUpdate}
                  onPlayStateChange={setIsPlaying}
                  onDurationChange={handleVideoDurationChange}
                  onSelectReplacementVideo={(item) =>
                    loadYouTubeVideo(item.url, item.language, item.level)
                  }
                />
              </ErrorBoundary>

              {/* Video Title + Source Layer + i+1 Compatibility Strip */}
              <div className="space-y-2 px-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <h1 className="text-base md:text-lg font-bold leading-snug text-balance safe-wrap">
                      {videoTitle || 'Đang tải thông tin video...'}
                    </h1>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs opacity-65">
                      <span>{channelName || 'YouTube'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        {language === 'ja'
                          ? `Học Tiếng Nhật · JLPT ${targetLevel}`
                          : `Học Tiếng Anh · CEFR ${targetLevel}`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{sourceLayerLabel}</span>
                    </div>
                  </div>

                  {lines.length === 0 && !isLoadingVideo && (
                    <button
                      type="button"
                      onClick={() => setUploadModalOpen(true)}
                      className="h-8 px-3 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      <span>Mở hộp nạp phụ đề</span>
                    </button>
                  )}
                </div>

                {iPlusOneReport && iPlusOneReport.totalUniqueWords > 0 && (
                  <div className="p-2.5 rounded-xl zen-surface border flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Gauge className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                      <span className="font-semibold text-teal-700 dark:text-teal-300 whitespace-nowrap font-mono-tabular">
                        Độ vừa sức i+1: {iPlusOneReport.knownPercent}%
                      </span>
                      <span className="opacity-75 truncate">{iPlusOneReport.recommendationVi}</span>
                    </div>
                    <span className="text-[11px] font-medium opacity-60 whitespace-nowrap shrink-0">
                      {iPlusOneReport.verdictLabel}
                    </span>
                  </div>
                )}
              </div>

              {/* Interactive Tri-Script Subtitle Stage + Progressive Controls */}
              <ErrorBoundary inline sectionName="Khung Phụ đề Tương tác">
                <InteractiveSubtitleStage
                  language={language}
                  sourceLanguage={sourceLanguage}
                  targetLevel={targetLevel}
                  activeLine={activeSpokenLine}
                  totalLines={lines.length}
                  currentTime={currentTime}
                  videoTitle={videoTitle}
                  prevSentence={prevSentence}
                  nextSentence={nextSentence}
                  isPlaying={isPlaying}
                  isSilenceGap={isSilenceGap}
                  syncOffsetSec={syncOffsetSec}
                  onAdjustSyncOffset={handleAdjustSyncOffset}
                  onInstantLanguageSwitch={
                    sourceLanguage === 'vi'
                      ? (newLang) => {
                          const nextLvl: ProficiencyLevel = newLang === 'ja' ? 'N3' : 'B2';
                          switchTargetOnSameVietnameseVideo(newLang, nextLvl);
                        }
                      : undefined
                  }
                  hasMoreStt={hasMoreStt}
                  isLoadingMoreStt={isLoadingMoreStt}
                  onLoadMoreStt={handleLoadMoreStt}
                  showOriginal={showOriginal}
                  onToggleOriginal={() => setShowOriginal((v) => !v)}
                  showPhonetics={showPhonetics}
                  onTogglePhonetics={() => setShowPhonetics((v) => !v)}
                  showTranslationVi={showTranslationVi}
                  onToggleTranslationVi={() => setShowTranslationVi((v) => !v)}
                  blurOriginal={blurOriginal}
                  onToggleBlurOriginal={() => setBlurOriginal((v) => !v)}
                  blurTranslation={blurTranslation}
                  onToggleBlurTranslation={() => setBlurTranslation((v) => !v)}
                  isRevealHeld={isRevealHeld}
                  playbackRate={playbackRate}
                  onChangePlaybackRate={(rate) => {
                    setPlaybackRate(rate);
                    playerRef.current?.setPlaybackRate(rate);
                  }}
                  loopSingleLine={loopSingleLine}
                  onToggleLoopSingleLine={() => {
                    setLoopA(null);
                    setLoopB(null);
                    setActiveClipId(null);
                    setLoopSingleLine((prev) => {
                      const next = !prev;
                      if (next && activeLine) handleSeekTo(activeLine.start);
                      return next;
                    });
                  }}
                  loopA={loopA}
                  loopB={loopB}
                  onCycleABLoop={handleCycleABLoop}
                  onClearABLoop={() => {
                    setLoopA(null);
                    setLoopB(null);
                    setActiveClipId(null);
                  }}
                  autoPausePerLine={autoPausePerLine}
                  onToggleAutoPausePerLine={() => setAutoPausePerLine((v) => !v)}
                  autoPauseDelaySec={autoPauseDelaySec}
                  onChangeAutoPauseDelaySec={setAutoPauseDelaySec}
                  autoPauseOnClick={autoPauseOnClick}
                  onToggleAutoPauseOnClick={() => setAutoPauseOnClick((v) => !v)}
                  dictationMode={dictationMode}
                  onToggleDictationMode={() => setDictationMode((v) => !v)}
                  onTogglePlay={() => playerRef.current?.togglePlay()}
                  onPrevLine={handlePrevLine}
                  onNextLine={handleNextLine}
                  onReplayCurrentLine={handleReplayCurrentLine}
                  onOpenXRay={(line) => triggerSyntaxXRay(line)}
                  onOpenAiSensei={(text) => {
                    setSenseiSelectedText(text);
                    setSenseiOpen(true);
                  }}
                  onOpenRoleplay={() => {
                    setRightTab('practice');
                    setPracticeSubTab('roleplay');
                  }}
                  onSaveSmartClip={handleSaveSmartClip}
                  onDownloadQuoteCard={handleDownloadQuoteCard}
                  onShadowScored={async () => {
                    await incrementDailyActivity({ shadowedSentences: 1 });
                    setActivityLogs(await listActivityLogs());
                    showToast('Tuyệt vời! Đã ghi nhận 1 câu luyện Shadowing hôm nay.');
                  }}
                  clipSavedFeedback={clipSavedFeedback}
                  selectedToken={selectedToken}
                  wordProfile={wordProfile}
                  isLookupLoading={isLookupLoading}
                  lookupError={lookupError}
                  isCurrentWordSaved={isCurrentWordSaved}
                  onTokenClick={handleTokenClick}
                  onCloseWordPopover={handleCloseWordPopover}
                  onSaveWordCard={handleSaveWordProfileCard}
                  isDetectedCollocationSaved={isDetectedCollocationSaved}
                  onSaveDetectedCollocation={handleSaveDetectedCollocationCard}
                  onOpenCollocationWeb={(coreWord) => {
                    handleCloseWordPopover();
                    setCoreWordWebQuery(coreWord);
                    setRightTab('collocations');
                  }}
                  savedTermKeys={savedTermKeys}
                  onSaveExtraCollocation={handleSaveExtraWordCollocation}
                  onSaveNuanceDualCard={handleSaveNuanceDualCard}
                  weaknessMap={weaknessMap}
                />
              </ErrorBoundary>

              {/* Next Lesson Suggestions Strip */}
              {similarFeed.length > 0 && (
                <div className="rounded-2xl zen-surface border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold">
                      Gợi ý học tiếp cùng trình độ {targetLevel}
                    </h3>
                    <button
                      type="button"
                      onClick={handleExpandThreeMoreSimilar}
                      className="h-7 px-2.5 text-[11px] font-semibold rounded-md zen-surface-subtle border hover:border-indigo-500 flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+3 Video Tương Tự</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {similarFeed.map((item) => (
                      <button
                        key={item.videoId}
                        type="button"
                        onMouseEnter={() => {
                          if (similarHoverTimerRef.current !== null) {
                            window.clearTimeout(similarHoverTimerRef.current);
                          }
                          similarHoverTimerRef.current = window.setTimeout(() => {
                            hoverPrefetchVideo(
                              item.url,
                              item.sourceLanguage === 'vi' ? language : item.language
                            );
                          }, 150);
                        }}
                        onMouseLeave={() => {
                          if (similarHoverTimerRef.current !== null) {
                            window.clearTimeout(similarHoverTimerRef.current);
                            similarHoverTimerRef.current = null;
                          }
                        }}
                        onClick={() =>
                          loadYouTubeVideo(
                            item.url,
                            item.sourceLanguage === 'vi' ? language : item.language,
                            item.sourceLanguage === 'vi' ? targetLevel : item.level
                          )
                        }
                        className="text-left p-2.5 rounded-xl zen-surface-subtle border hover:border-indigo-500 transition-colors space-y-1 cursor-pointer min-w-0"
                      >
                        <div className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 truncate">
                          {item.sourceLanguage === 'vi' ? '100% Việt' : item.level} · {item.durationLabel}
                        </div>
                        <div className="text-xs font-semibold line-clamp-2 leading-snug">
                          {item.title}
                        </div>
                        <div className="text-[10px] opacity-60 truncate">{item.channel}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ============ RIGHT HEMISPHERE (40% -> 5/12 columns, 5 Clean Tabs) ============ */}
            <aside className="lg:col-span-5 min-w-0 max-w-full lg:sticky lg:top-[4.5rem] lg:h-[calc(100vh-5.5rem)] rounded-2xl zen-surface border flex flex-col overflow-hidden">
              <nav
                className="grid grid-cols-5 border-b border-black/5 dark:border-white/10 zen-surface-subtle shrink-0 no-print"
                aria-label="Bảng điều hướng học tập 5 mục"
              >
                <button
                  type="button"
                  onClick={() => setRightTab('transcript')}
                  className={`py-2.5 px-1 text-[11px] font-semibold flex flex-col sm:flex-row items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                    rightTab === 'transcript'
                      ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300 zen-surface'
                      : 'border-transparent opacity-65 hover:opacity-100'
                  }`}
                >
                  <ListVideo className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Phụ đề</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRightTab('collocations')}
                  className={`py-2.5 px-1 text-[11px] font-semibold flex flex-col sm:flex-row items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                    rightTab === 'collocations'
                      ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300 zen-surface'
                      : 'border-transparent opacity-65 hover:opacity-100'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Cụm từ</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRightTab('curriculum')}
                  className={`py-2.5 px-1 text-[11px] font-semibold flex flex-col sm:flex-row items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                    rightTab === 'curriculum'
                      ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300 zen-surface'
                      : 'border-transparent opacity-65 hover:opacity-100'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Từ vựng</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRightTab('xray');
                    if (activeLine && !xrayTargetLineId) setXrayTargetLineId(activeLine.id);
                  }}
                  className={`py-2.5 px-1 text-[11px] font-semibold flex flex-col sm:flex-row items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                    rightTab === 'xray'
                      ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300 zen-surface'
                      : 'border-transparent opacity-65 hover:opacity-100'
                  }`}
                >
                  <ScanSearch className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">X-Quang</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRightTab('practice')}
                  className={`py-2.5 px-1 text-[11px] font-semibold flex flex-col sm:flex-row items-center justify-center gap-1 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                    rightTab === 'practice'
                      ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300 zen-surface'
                      : 'border-transparent opacity-65 hover:opacity-100'
                  }`}
                >
                  <Brain className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Luyện tập</span>
                </button>
              </nav>

              {/* Independent Scrolling Tab Views */}
              <div className="flex-1 min-h-0 flex flex-col">
                {/* TAB 1: Transcript · Chapters · Clips & Notes */}
                {rightTab === 'transcript' && (
                  <div className="flex flex-col h-full min-h-0">
                    <div className="px-3 pt-2.5 pb-2 border-b border-black/5 dark:border-white/10 flex items-center gap-1 shrink-0 overflow-x-auto">
                      {(
                        [
                          ['all', 'Toàn bộ phụ đề'],
                          ['chapters', 'Chương & Mind-Map'],
                          ['clips_notes', `Clip & Ghi chú (${clips.length + notes.length})`],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setTranscriptSubTab(key)}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                            transcriptSubTab === key
                              ? 'bg-indigo-600 text-white'
                              : 'zen-surface-subtle opacity-75 hover:opacity-100'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {transcriptSubTab === 'all' && (
                      <ErrorBoundary inline sectionName="Bảng Phụ đề Đồng bộ">
                        <TranscriptTab
                          lines={lines}
                          activeLineId={activeSpokenLine?.id || null}
                          language={language}
                          sourceLanguage={sourceLanguage}
                          sourceLayer={sourceLayer}
                          targetLevel={targetLevel}
                          showTranslationVi={showTranslationVi}
                          isEnrichingBackground={isEnrichingBg}
                          enrichedCount={enrichedCount}
                          videoDurationSec={videoDurationSec}
                          currentTimeSec={currentTime}
                          hasMoreStt={hasMoreStt}
                          isHarvestingStt={isLoadingMoreStt}
                          slaProgress={slaProgress}
                          aiAudioRestricted={aiAudioRestricted}
                          isTabAudioListening={isTabAudioListening}
                          onToggleTabAudioCapture={toggleTabAudioCapture}
                          onOpenManualSrt={() => setUploadModalOpen(true)}
                          onJumpToLine={(line) => handleSeekTo(line.start)}
                          onRepeatLine={(line) => {
                            setLoopA(null);
                            setLoopB(null);
                            setActiveClipId(null);
                            setLoopSingleLine(true);
                            handleSeekTo(line.start);
                          }}
                          onOpenXRay={(line) => triggerSyntaxXRay(line)}
                          weaknessTerms={weaknessTerms}
                        />
                      </ErrorBoundary>
                    )}

                    {transcriptSubTab === 'chapters' && (
                      <ErrorBoundary inline sectionName="Chương & Mind-Map">
                        <SmartChaptersPanel
                          language={language}
                          chapters={chapters}
                          currentTime={currentTime}
                          isLoading={isChaptersLoading}
                          error={chaptersError}
                          hasLines={lines.length > 0}
                          onGenerateChapters={handleGenerateChapters}
                          onSeekTo={handleSeekTo}
                        />
                      </ErrorBoundary>
                    )}

                    {transcriptSubTab === 'clips_notes' && (
                      <ErrorBoundary inline sectionName="Clip & Ghi chú">
                        <ClipsAndNotesPanel
                          videoId={videoId}
                          currentTime={currentTime}
                          clips={clips}
                          notes={notes}
                          activeClipId={activeClipId}
                          onPlayClip={handlePlaySmartClip}
                          onStopClipLoop={() => {
                            setActiveClipId(null);
                            setLoopA(null);
                            setLoopB(null);
                          }}
                          onDeleteClip={handleDeleteSmartClip}
                          onAddNote={handleAddTimestampedNote}
                          onDeleteNote={handleDeleteTimestampedNote}
                          onSeekTo={handleSeekTo}
                        />
                      </ErrorBoundary>
                    )}
                  </div>
                )}

                {/* TAB 2: Collocations 3 Tầng + Bản đồ Từ gốc + Luyện 15s + Nuance Matrix */}
                {rightTab === 'collocations' && (
                  <ErrorBoundary inline sectionName="Phân hệ Collocations & Sắc thái">
                    <CollocationsTab
                      language={language}
                      targetLevel={targetLevel}
                      collocations={collocations3Tier}
                      isLoading={isCollocationsLoading}
                      error={collocationsError}
                      hasLines={lines.length > 0}
                      savedTermKeys={savedTermKeys}
                      onGenerateCollocations={handleGenerateCollocations}
                      onExpandMoreCollocations={handleExpandMoreVideoCollocations}
                      isExpandingMore={isExpandingCollocations}
                      onSeekTo={handleSeekTo}
                      onSaveCollocation={handleSaveCollocationCard}
                      onSaveWebItem={handleSaveWebCollocationCard}
                      onOpenEncyclopedia={() => setCollocationLibraryOpen(true)}
                      initialCoreWord={coreWordWebQuery}
                      onClearInitialCoreWord={() => setCoreWordWebQuery(null)}
                      onDrillCompleted={async (score, total) => {
                        await incrementDailyActivity({ wordsReviewed: score });
                        setActivityLogs(await listActivityLogs());
                        showToast(`Xuất sắc! Hoàn thành bài luyện Collocations (${score}/${total}).`);
                      }}
                      nuanceMatrix={nuanceMatrix}
                      isNuanceLoading={isNuanceLoading}
                      isNuanceExpanding={isNuanceExpanding}
                      nuanceError={nuanceError}
                      onGenerateNuanceMatrix={handleGenerateNuanceMatrix}
                      onExpandThreeNuance={handleExpandThreeNuancePairs}
                      videoTitle={videoTitle}
                      onSaveNuanceDualCard={handleSaveNuanceDualCard}
                    />
                  </ErrorBoundary>
                )}

                {/* TAB 3: Curriculum Vocab & Grammar */}
                {rightTab === 'curriculum' && (
                  <ErrorBoundary inline sectionName="Kho Từ vựng & Ngữ pháp">
                    <CurriculumTab
                      language={language}
                      targetLevel={targetLevel}
                      curriculum={curriculum}
                      isLoading={isCurriculumLoading}
                      error={curriculumError}
                      hasLines={lines.length > 0}
                      savedTermKeys={savedTermKeys}
                      videoTitle={videoTitle}
                      onGenerateCurriculum={handleGenerateCurriculum}
                      onSeekTo={handleSeekTo}
                      onSaveVocabItem={handleSaveCurriculumVocab}
                      onSaveGrammarItem={handleSaveCurriculumGrammar}
                      onSaveNuanceDualCard={handleSaveNuanceDualCard}
                    />
                  </ErrorBoundary>
                )}

                {/* TAB 4: Syntax X-Ray + Grammar Contrast Lab + Register Prism */}
                {rightTab === 'xray' && (
                  <ErrorBoundary inline sectionName="X-Quang Cú pháp & Lăng kính Sắc thái">
                    <SyntaxXRayTab
                      language={language}
                      targetLine={xrayTargetLine}
                      xray={xrayTargetLine ? xrayCache[xrayTargetLine.id] || null : null}
                      isLoading={isXrayLoading}
                      error={xrayError}
                      savedTermKeys={savedTermKeys}
                      onAnalyzeActiveLine={() => {
                        if (xrayTargetLine) triggerSyntaxXRay(xrayTargetLine, true);
                      }}
                      onSeekTo={handleSeekTo}
                      onSaveGrammarNote={handleSaveXRayGrammar}
                    />
                  </ErrorBoundary>
                )}

                {/* TAB 5: Luyện tập & AI (Dual-Stream FSRS / 4-Mode Production Lab / Weakness Radar + Roleplay Studio) */}
                {rightTab === 'practice' && (
                  <div className="flex flex-col h-full min-h-0">
                    <div className="px-3 pt-2.5 pb-2 border-b border-black/5 dark:border-white/10 flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPracticeSubTab('fsrs')}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          practiceSubTab === 'fsrs'
                            ? 'bg-indigo-600 text-white'
                            : 'zen-surface-subtle opacity-75 hover:opacity-100'
                        }`}
                      >
                        FSRS · Phản xạ · Radar {dueCardsCount > 0 ? `(${dueCardsCount})` : ''}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPracticeSubTab('roleplay')}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          practiceSubTab === 'roleplay'
                            ? 'bg-indigo-600 text-white'
                            : 'zen-surface-subtle opacity-75 hover:opacity-100'
                        }`}
                      >
                        Nhập vai hội thoại AI
                      </button>
                    </div>

                    {practiceSubTab === 'fsrs' ? (
                      <ErrorBoundary inline sectionName="Phòng Luyện tập FSRS & Phản xạ">
                        <ReviewAndQuizTab
                          language={language}
                          targetLevel={targetLevel}
                          videoTitle={videoTitle || 'KotoZen Lesson'}
                          currentVideoId={videoId}
                          hasLines={lines.length > 0}
                          flashcards={flashcards}
                          onRateCard={handleRateFlashcard}
                          onDeleteCard={handleDeleteFlashcard}
                          onUpdateCardNote={handleUpdateFlashcardNote}
                          onJumpToVideoAnchor={handleJumpToCardVideoAnchor}
                          onDataImported={refreshOfflineData}
                          studySheet={studySheet}
                          isStudySheetLoading={isStudySheetLoading}
                          studySheetError={studySheetError}
                          onGenerateStudySheet={handleGenerateStudySheet}
                          onSeekCurrentVideo={handleSeekTo}
                          productionPack={productionPack}
                          isProductionLoading={isProductionLoading}
                          productionError={productionError}
                          onGenerateProductionPack={handleGenerateProductionPack}
                          weaknesses={weaknesses}
                          onLogWeakness={handleLogWeakness}
                          onDeleteWeakness={handleDeleteWeakness}
                          onDrillSuccess={async () => {
                            await incrementDailyActivity({ wordsReviewed: 1 });
                            setActivityLogs(await listActivityLogs());
                          }}
                          activityLogs={activityLogs}
                          iPlusOneReport={iPlusOneReport}
                        />
                      </ErrorBoundary>
                    ) : (
                      <ErrorBoundary inline sectionName="Phòng Nhập vai Hội thoại AI">
                        <RoleplayStudio
                          language={language}
                          targetLevel={targetLevel}
                          videoTitle={videoTitle || 'Video Lesson'}
                          lines={lines}
                          activeLine={activeLine}
                          onTurnCompleted={async () => {
                            await incrementDailyActivity({ roleplayTurns: 1 });
                            setActivityLogs(await listActivityLogs());
                          }}
                        />
                      </ErrorBoundary>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Subtle Motivational Micro-Feedback Toast */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 max-w-sm px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-xl text-xs font-semibold flex items-center gap-2 no-print"
        >
          <CheckCircle2 className="w-4 h-4 text-teal-400 dark:text-teal-600 shrink-0 animate-star-pop" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Modals & Drawers */}
      {discoveryModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setDiscoveryModalOpen(false)}
        >
          <div
            className="w-full max-w-4xl max-h-[85vh] overflow-y-auto zen-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            <DiscoveryHub
              language={language}
              targetLevel={targetLevel}
              currentVideoId={videoId}
              onSelectVideo={(item) =>
                loadYouTubeVideo(
                  item.url,
                  item.sourceLanguage === 'vi' ? language : item.language,
                  item.sourceLanguage === 'vi' ? targetLevel : item.level
                )
              }
              onCloseModal={() => setDiscoveryModalOpen(false)}
            />
          </div>
        </div>
      )}

      <ErrorBoundary inline sectionName="Gia sư AI Sensei">
        <AiSenseiModal
          isOpen={senseiOpen}
          selectedText={senseiSelectedText}
          activeLine={
            activeArticle
              ? (() => {
                  const s = activeArticle.sentences[activeArticle.lastSentenceIndex || 0];
                  if (!s) return null;
                  const v = s.variants[activeArticle.activeLanguage];
                  return {
                    id: s.id,
                    index: s.index,
                    start: s.index,
                    duration: 1,
                    end: s.index + 1,
                    text: v?.text || s.originalText,
                    translationVi: v?.translationVi || s.originalText,
                    tokens: v?.tokens || [],
                  };
                })()
              : activeLine
          }
          allLines={
            activeArticle
              ? activeArticle.sentences.slice(0, 60).map((s) => {
                  const v = s.variants[activeArticle.activeLanguage];
                  return {
                    id: s.id,
                    index: s.index,
                    start: s.index,
                    duration: 1,
                    end: s.index + 1,
                    text: v?.text || s.originalText,
                    translationVi: v?.translationVi || s.originalText,
                    tokens: v?.tokens || [],
                  };
                })
              : lines
          }
          videoTitle={activeArticle ? activeArticle.title : videoTitle}
          language={
            activeArticle
              ? activeArticle.activeLanguage === 'ja'
                ? 'ja'
                : 'en'
              : language
          }
          targetLevel={activeArticle ? activeArticle.targetLevel : targetLevel}
          onClose={() => setSenseiOpen(false)}
        />
      </ErrorBoundary>

      <ArticleRescueModal
        isOpen={articleRescueOpen}
        blockedUrl={articleRescueInfo.blockedUrl}
        blockedDomain={articleRescueInfo.blockedDomain}
        reasonVi={articleRescueInfo.reasonVi}
        onClose={() => setArticleRescueOpen(false)}
        onArticleParsed={(parsed) => openExtractedArticle(parsed)}
      />

      <SubtitleUploadModal
        isOpen={uploadModalOpen}
        noticeMessage={uploadNotice}
        videoTitle={videoTitle}
        language={language}
        onClose={() => setUploadModalOpen(false)}
        onConfirmSubtitles={handleConfirmUploadedSubtitles}
      />

      <ShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <ErrorBoundary inline sectionName="Thư viện Collocations Bách khoa">
        <CollocationEncyclopediaModal
          isOpen={collocationLibraryOpen}
          onClose={() => setCollocationLibraryOpen(false)}
          language={language}
          onChangeLanguage={handleLanguageChange}
          savedTermKeys={savedTermKeys}
          onSaveEntryToFsrs={handleSaveEncyclopediaEntryCard}
        />
      </ErrorBoundary>

      <HistoryDrawer
        isOpen={historyOpen}
        sessions={savedSessions}
        articleSessions={savedArticles}
        activeSessionId={activeSessionId}
        activeArticleId={activeArticle?.id || null}
        onClose={() => setHistoryOpen(false)}
        onSelectSession={(s) => {
          setActiveArticle(null);
          handleSelectSavedSession(s);
        }}
        onDeleteSession={handleDeleteSavedSession}
        onSelectArticle={(art) => {
          flushVideoWorkspaceState();
          setVideoId(null);
          setLines([]);
          setActiveArticle(art);
          setArticleJumpTarget(null);
        }}
        onDeleteArticle={async (id) => {
          await deleteArticleSession(id);
          setSavedArticles((prev) => prev.filter((a) => a.id !== id));
          if (activeArticle?.id === id) setActiveArticle(null);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WorkspaceApp />
    </ErrorBoundary>
  );
}
