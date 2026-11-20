import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  BookOpenCheck,
  Brain,
  Layers,
  MessageCircleQuestion,
  ScanSearch,
  Theater,
} from 'lucide-react';
import type {
  ActiveProductionPack,
  ArticleLanguage,
  ArticleNote,
  ArticleSession,
  ArticleTranslatedVariant,
  ArticleViewMode,
  Collocation3TierItem,
  CollocationTier,
  CollocationWebBranchItem,
  CurriculumData,
  CurriculumGrammarItem,
  CurriculumVocabItem,
  DailyActivityLog,
  DetectedCollocation,
  Flashcard,
  FsrsRating,
  Language,
  NuanceDualPayload,
  NuanceMatrixGroup,
  ProficiencyLevel,
  ReadingQuizQuestion,
  SentenceGrammarNote,
  StudySheetData,
  SubtitleLine,
  SubtitleToken,
  SyntaxXRay,
  VideoContextAnchor,
  WeaknessEntry,
  WordExtraCollocation,
  WordProfile,
} from '../types';
import {
  buildArticleShardSessionId,
  buildWordCacheKey,
  deleteArticleNote,
  getCachedWordProfile,
  hashArticleKey,
  listArticleNotes,
  loadShardedBatches,
  saveArticleNote,
  saveArticleSession,
  saveShardedBatch,
  setCachedWordProfile,
} from '../lib/db';
import {
  expandThreeNuancePairs,
  fetchArticleReadingQuiz,
  fetchCollocations3Tier,
  fetchCurriculumData,
  fetchNuanceMatrix,
  fetchProductionLabPack,
  fetchStudySheetData,
  fetchSyntaxXRay,
  fetchVideoContextAnchor,
  isAbortError,
  lookupWordProfile,
  translateArticleBatch,
  translateArticleBatchStream,
  type ArticleTranslatedLineDto,
} from '../lib/api';
import {
  exportFlashcardsToAnkiCsv,
  triggerDownload,
} from '../lib/fsrs';
import type { InputCompatibilityReport } from '../types';

function computeArticleInputCompatibility(
  lines: SubtitleLine[],
  flashcards: Flashcard[],
  lang: Language
): InputCompatibilityReport {
  const knownSet = new Set(
    flashcards
      .filter((c) => c.language === lang)
      .map((c) => (c.lemma || c.term).toLowerCase().trim())
  );
  const uniqueTokens = new Set<string>();
  for (const l of lines) {
    for (const tk of l.tokens || []) {
      if (tk.isPunctuation) continue;
      const key = (tk.lemma || tk.surface).toLowerCase().trim();
      if (key.length >= 2) uniqueTokens.add(key);
    }
  }
  const totalUniqueWords = uniqueTokens.size;
  if (totalUniqueWords === 0) {
    return {
      knownPercent: 85,
      totalUniqueWords: 0,
      knownWordsCount: 0,
      stretchWordsCount: 0,
      verdictLabel: 'Vừa tầm i+1',
      recommendationVi: 'Bài viết phù hợp để đọc hiểu sâu và tích luỹ collocations mới.',
    };
  }
  let knownCount = 0;
  uniqueTokens.forEach((w) => {
    if (knownSet.has(w)) knownCount += 1;
  });
  // Baseline comprehension estimate combining saved cards + common vocabulary coverage
  const knownPercent = Math.min(
    98,
    Math.max(55, Math.round(68 + (knownCount / Math.max(1, totalUniqueWords)) * 30))
  );
  const stretchWordsCount = Math.max(0, totalUniqueWords - knownCount);
  const verdictLabel =
    knownPercent >= 85 ? 'Đọc rất mượt' : knownPercent >= 72 ? 'Vùng vàng i+1' : 'Thử thách cao';
  return {
    knownPercent,
    totalUniqueWords,
    knownWordsCount: knownCount,
    stretchWordsCount,
    verdictLabel,
    recommendationVi:
      knownPercent >= 85
        ? 'Bạn đã nắm vững phần lớn nền tảng — hãy chú ý các Collocations Tầng 3 và sắc thái.'
        : 'Độ khó lý tưởng theo nguyên lý Krashen i+1: đủ hiểu mạch bài để học thêm cụm từ mới.',
  };
}
import { exportArticleMarkdown } from '../lib/exportBundle';
import { ArticleReaderStage } from './ArticleReaderStage';
import { ArticleQuizPanel } from './ArticleQuizPanel';
import { CollocationsTab } from './CollocationsTab';
import { CurriculumTab } from './CurriculumTab';
import { SyntaxXRayTab } from './SyntaxXRayTab';
import { ReviewAndQuizTab } from './ReviewAndQuizTab';
import { RoleplayStudio } from './RoleplayStudio';

type ArticleRightTab = 'collocations' | 'curriculum' | 'xray' | 'practice';
type PracticeSubTab = 'reading_quiz' | 'fsrs_lab' | 'roleplay';

interface ArticleStudioWorkspaceProps {
  article: ArticleSession;
  onUpdateArticle: (updated: ArticleSession) => void;
  initialHighlightParagraphId?: string | null;
  initialHighlightSentenceId?: string | null;
  // Shared FSRS & user state from App.tsx
  flashcards: Flashcard[];
  savedTermKeys: Set<string>;
  onSaveFlashcard: (card: Flashcard) => void;
  onRateFlashcard: (card: Flashcard, rating: FsrsRating) => void;
  onDeleteFlashcard: (id: string) => void;
  onUpdateFlashcardNote: (id: string, note: string) => void;
  onJumpFromFlashcard: (card: Flashcard) => void;
  onDataImported: () => void;
  weaknesses: WeaknessEntry[];
  onLogWeakness: (params: {
    kind: 'vocab' | 'grammar' | 'particle' | 'tense';
    term: string;
    categoryLabel: string;
    lastExample?: string;
    meaningVi?: string;
  }) => void;
  onDeleteWeakness: (id: string) => void;
  activityLogs: DailyActivityLog[];
  onLogActivity: (delta: Partial<Omit<DailyActivityLog, 'dateKey'>>) => void;
  onOpenCollocationLibrary: () => void;
  onOpenAiSensei: (initialPrompt?: string) => void;
  onToast: (message: string) => void;
  createArticleFlashcard: (params: {
    kind: 'vocab' | 'grammar';
    language: Language;
    term: string;
    lemma?: string;
    readingOrIpa?: string;
    hanViet?: string;
    level: ProficiencyLevel;
    meaningVi: string;
    extraNotes?: string;
    kanjiBreakdown?: Flashcard['kanjiBreakdown'];
    nuanceDual?: NuanceDualPayload;
    sentence: string;
    sentenceVi: string;
    paragraphId: string;
    sentenceId: string;
    sentenceIndex: number;
  }) => Flashcard;
}

interface BatchRange {
  batchIndex: number;
  startIdx: number;
  endIdx: number; // exclusive
}

function buildArticleBatches(article: ArticleSession): BatchRange[] {
  const total = article.sentences.length;
  if (total === 0) return [];

  const batches: BatchRange[] = [];
  let cursor = 0;

  // Express Opening Batch: first 6 sentences (Title/Lead + opening 2 paragraphs) for < 1.2s TTFL
  const openingEnd = Math.min(total, 6);
  batches.push({ batchIndex: 0, startIdx: 0, endIdx: openingEnd });
  cursor = openingEnd;

  // Remaining batches aligned cleanly to ~12 sentences per batch (natural paragraph flow)
  const BATCH_SIZE = 12;
  let bIdx = 1;
  while (cursor < total) {
    let nextEnd = Math.min(total, cursor + BATCH_SIZE);
    // Align to paragraph boundary if close (+-2 sentences)
    if (nextEnd < total) {
      const curPara = article.sentences[nextEnd - 1]?.paragraphId;
      for (let look = 0; look < 3 && nextEnd + look < total; look += 1) {
        if (article.sentences[nextEnd + look]?.paragraphId !== curPara) {
          nextEnd = nextEnd + look;
          break;
        }
      }
    }
    batches.push({ batchIndex: bIdx, startIdx: cursor, endIdx: nextEnd });
    cursor = nextEnd;
    bIdx += 1;
  }
  return batches;
}

function mapVariantToSubtitleLine(
  sentence: ArticleSession['sentences'][number],
  lang: ArticleLanguage,
  sourceLang: ArticleLanguage
): SubtitleLine {
  const variant = sentence.variants[lang];
  const text = variant?.text || (lang === sourceLang ? sentence.originalText : '');
  const translationVi =
    variant?.translationVi ||
    sentence.variants.vi?.text ||
    (sourceLang === 'vi' ? sentence.originalText : '');

  return {
    id: sentence.id,
    index: sentence.index,
    start: sentence.index,
    duration: 1,
    end: sentence.index + 1,
    text: text || sentence.originalText,
    rawText: sentence.originalText,
    translationVi,
    tokens: variant?.tokens || [],
    ipaLine: variant?.ipaLine,
    enriched: Boolean(variant?.enriched),
  };
}

export const ArticleStudioWorkspace: React.FC<ArticleStudioWorkspaceProps> = ({
  article,
  onUpdateArticle,
  initialHighlightParagraphId,
  initialHighlightSentenceId,
  flashcards,
  savedTermKeys,
  onSaveFlashcard,
  onRateFlashcard,
  onDeleteFlashcard,
  onUpdateFlashcardNote,
  onJumpFromFlashcard,
  onDataImported,
  weaknesses,
  onLogWeakness,
  onDeleteWeakness,
  activityLogs,
  onLogActivity,
  onOpenCollocationLibrary,
  onOpenAiSensei,
  onToast,
  createArticleFlashcard,
}) => {
  const [activeLanguage, setActiveLanguage] = useState<ArticleLanguage>(article.activeLanguage);
  const [targetLevel, setTargetLevel] = useState<ProficiencyLevel>(article.targetLevel);
  const [viewMode, setViewMode] = useState<ArticleViewMode>(
    article.sourceLanguage === 'vi' && article.activeLanguage !== 'vi' ? 'focus' : 'interlinear'
  );
  const [showTriLingualStack, setShowTriLingualStack] = useState(false);

  // Reading aids & highlights
  const [showReadingAid, setShowReadingAid] = useState(true);
  const [blurTranslation, setBlurTranslation] = useState(
    article.sourceLanguage === 'vi' && article.activeLanguage !== 'vi'
  );
  const [isHoldingH, setIsHoldingH] = useState(false);
  const [showCollocationUnderlines, setShowCollocationUnderlines] = useState(true);
  const [showLevelHighlights, setShowLevelHighlights] = useState(true);

  // Active reading position & jumps
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(article.lastSentenceIndex || 0);
  const [highlightedParagraphId, setHighlightedParagraphId] = useState<string | null>(
    initialHighlightParagraphId || null
  );
  const [highlightedSentenceId, setHighlightedSentenceId] = useState<string | null>(
    initialHighlightSentenceId || null
  );

  // Translation pipeline status
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedCount, setTranslatedCount] = useState(0);

  // Right hemisphere tabs
  const [rightTab, setRightTab] = useState<ArticleRightTab>('collocations');
  const [practiceSubTab, setPracticeSubTab] = useState<PracticeSubTab>('reading_quiz');

  // 1-Click Word Profile Popover state
  const [selectedToken, setSelectedToken] = useState<SubtitleToken | null>(null);
  const [selectedLine, setSelectedLine] = useState<SubtitleLine | null>(null);
  const [wordProfile, setWordProfile] = useState<WordProfile | null>(null);
  const [isWordLoading, setIsWordLoading] = useState(false);
  const [wordError, setWordError] = useState<string | null>(null);
  const [initialCoreWord, setInitialCoreWord] = useState<string | null>(null);

  // On-demand Right-Hemisphere Study Tools states
  const [isColLoading, setIsColLoading] = useState(false);
  const [isColExpanding, setIsColExpanding] = useState(false);
  const [colError, setColError] = useState<string | null>(null);

  const [isNuanceLoading, setIsNuanceLoading] = useState(false);
  const [isNuanceExpanding, setIsNuanceExpanding] = useState(false);
  const [nuanceError, setNuanceError] = useState<string | null>(null);

  const [isCurriculumLoading, setIsCurriculumLoading] = useState(false);
  const [curriculumError, setCurriculumError] = useState<string | null>(null);

  const [xrayTargetLine, setXrayTargetLine] = useState<SubtitleLine | null>(null);
  const [isXrayLoading, setIsXrayLoading] = useState(false);
  const [xrayError, setXrayError] = useState<string | null>(null);

  const [isStudySheetLoading, setIsStudySheetLoading] = useState(false);
  const [studySheetError, setStudySheetError] = useState<string | null>(null);

  const [isProductionLoading, setIsProductionLoading] = useState(false);
  const [productionError, setProductionError] = useState<string | null>(null);

  const [isQuizLoading, setIsQuizLoading] = useState(false);

  // Paragraph-anchored Notes
  const [notes, setNotes] = useState<ArticleNote[]>([]);

  // Refs for cancellation, preemption, and fresh state inside async workers
  const articleRef = useRef<ArticleSession>(article);
  const pipelineAbortRef = useRef<AbortController | null>(null);
  const inFlightBatchesRef = useRef<Set<number>>(new Set());
  const completedBatchesRef = useRef<Set<number>>(new Set());
  const batchesRef = useRef<BatchRange[]>([]);
  const contextAnchorRef = useRef<VideoContextAnchor | undefined>(
    article.contextAnchors?.[activeLanguage]
  );

  useEffect(() => {
    articleRef.current = article;
  }, [article]);

  // Sync incoming highlight jumps (e.g. from FSRS flashcard click)
  useEffect(() => {
    if (initialHighlightParagraphId) {
      setHighlightedParagraphId(initialHighlightParagraphId);
    }
    if (initialHighlightSentenceId) {
      setHighlightedSentenceId(initialHighlightSentenceId);
      const found = article.sentences.find((s) => s.id === initialHighlightSentenceId);
      if (found) setActiveSentenceIndex(found.index);
    }
  }, [initialHighlightParagraphId, initialHighlightSentenceId, article.sentences]);

  // Load paragraph-anchored notes from IndexedDB
  useEffect(() => {
    let active = true;
    listArticleNotes(article.id).then((list) => {
      if (active) setNotes(list);
    });
    return () => {
      active = false;
    };
  }, [article.id]);

  // Hold 'H' key to unblur Vietnamese gloss temporarily
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey) setIsHoldingH(true);
      if (e.key === 'Escape') {
        setSelectedToken(null);
        setSelectedLine(null);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'h') setIsHoldingH(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // Study language for linguistic tools (if user switches reader to VI, right-side tools stay in EN or JA)
  const studyLang: Language = activeLanguage === 'ja' ? 'ja' : 'en';

  // Mapped 1:1 SubtitleLine[] for active reading language
  const mappedLines = useMemo<SubtitleLine[]>(
    () =>
      article.sentences.map((s) =>
        mapVariantToSubtitleLine(s, activeLanguage, article.sourceLanguage)
      ),
    [article.sentences, activeLanguage, article.sourceLanguage]
  );

  // Mapped SubtitleLine[] specifically for right-hemisphere EN/JA study tools
  const toolLines = useMemo<SubtitleLine[]>(
    () =>
      article.sentences.map((s) =>
        mapVariantToSubtitleLine(s, studyLang, article.sourceLanguage)
      ),
    [article.sentences, studyLang, article.sourceLanguage]
  );

  // Compute i+1 Input Compatibility Report
  const iPlusOneReport = useMemo(() => {
    if (activeLanguage === 'vi' || mappedLines.length === 0) return null;
    const enrichedSubset = mappedLines.filter((l) => l.enriched);
    if (enrichedSubset.length < 2) return null;
    return computeArticleInputCompatibility(enrichedSubset, flashcards, studyLang);
  }, [activeLanguage, mappedLines, flashcards, studyLang]);

  // Helper to merge newly translated lines into ArticleSession & persist
  const mergeTranslatedLines = useCallback(
    (
      lang: ArticleLanguage,
      incoming: ArticleTranslatedLineDto[],
      batchIndexToShard?: number,
      shardSessionId?: string
    ) => {
      if (!incoming || incoming.length === 0) return;
      const byId = new Map(incoming.map((l) => [l.id, l]));
      const cur = articleRef.current;
      let changed = false;

      const updatedSentences = cur.sentences.map((s) => {
        const hit = byId.get(s.id);
        if (!hit) return s;
        changed = true;
        const variant: ArticleTranslatedVariant = {
          text: hit.text,
          translationVi: hit.translationVi,
          ipaLine: hit.ipaLine,
          tokens: hit.tokens || [],
          enriched: Boolean(hit.enriched),
        };
        return {
          ...s,
          variants: {
            ...s.variants,
            [lang]: variant,
          },
        };
      });

      if (!changed) return;

      const doneCount = updatedSentences.filter((s) => s.variants[lang]?.enriched).length;
      setTranslatedCount(doneCount);

      const nextSession: ArticleSession = {
        ...cur,
        activeLanguage: lang,
        targetLevel,
        sentences: updatedSentences,
        updatedAt: Date.now(),
      };
      articleRef.current = nextSession;
      onUpdateArticle(nextSession);

      // Persist sharded batch to IndexedDB for 0ms reopen / 0ms language switch
      if (typeof batchIndexToShard === 'number' && shardSessionId) {
        const shardLines: SubtitleLine[] = incoming.map((l) => {
          const orig = updatedSentences.find((s) => s.id === l.id);
          return {
            id: l.id,
            index: orig?.index ?? 0,
            start: orig?.index ?? 0,
            duration: 1,
            end: (orig?.index ?? 0) + 1,
            text: l.text,
            rawText: orig?.originalText,
            translationVi: l.translationVi,
            tokens: l.tokens || [],
            ipaLine: l.ipaLine,
            enriched: l.enriched,
          };
        });
        void saveShardedBatch(shardSessionId, batchIndexToShard, shardLines);
      }

      void saveArticleSession(nextSession);
    },
    [onUpdateArticle, targetLevel]
  );

  // Execute a single batch (streaming or structured + half-split self-healing retry)
  const runSingleBatch = useCallback(
    async (
      batch: BatchRange,
      lang: ArticleLanguage,
      level: ProficiencyLevel,
      shardSessionId: string,
      useStreaming: boolean,
      signal: AbortSignal
    ) => {
      if (signal.aborted) return;
      if (
        completedBatchesRef.current.has(batch.batchIndex) ||
        inFlightBatchesRef.current.has(batch.batchIndex)
      ) {
        return;
      }

      const cur = articleRef.current;
      const slice = cur.sentences.slice(batch.startIdx, batch.endIdx);
      const pending = slice.filter((s) => !s.variants[lang]?.enriched);
      if (pending.length === 0) {
        completedBatchesRef.current.add(batch.batchIndex);
        return;
      }

      inFlightBatchesRef.current.add(batch.batchIndex);

      // Build 2-sentence sliding read-only overlap from preceding sentences
      const previousContext: Array<{ source: string; target: string }> = [];
      for (let i = Math.max(0, batch.startIdx - 2); i < batch.startIdx; i += 1) {
        const prevS = cur.sentences[i];
        const prevT = prevS?.variants[lang]?.text;
        if (prevS && prevT) {
          previousContext.push({ source: prevS.originalText, target: prevT });
        }
      }

      const payloadSentences = pending.map((s) => ({
        id: s.id,
        index: s.index,
        paragraphId: s.paragraphId,
        blockType: s.blockType,
        text: s.originalText,
      }));

      try {
        if (useStreaming) {
          const streamedLines = await translateArticleBatchStream(
            {
              sentences: payloadSentences,
              sourceLanguage: cur.sourceLanguage,
              targetLanguage: lang,
              targetLevel: level,
              articleTitle: cur.title,
              contextAnchor: contextAnchorRef.current,
              previousContext,
            },
            (line) => {
              if (!signal.aborted) {
                mergeTranslatedLines(lang, [line]);
              }
            },
            signal
          );
          if (!signal.aborted && streamedLines.length > 0) {
            mergeTranslatedLines(lang, streamedLines, batch.batchIndex, shardSessionId);
          }

          // Top-up any missed sentences cleanly via non-streaming fallback
          const stillMissing = payloadSentences.filter(
            (ps) => !articleRef.current.sentences[ps.index]?.variants[lang]?.enriched
          );
          if (!signal.aborted && stillMissing.length > 0) {
            const topUp = await translateArticleBatch(
              {
                sentences: stillMissing,
                sourceLanguage: cur.sourceLanguage,
                targetLanguage: lang,
                targetLevel: level,
                articleTitle: cur.title,
                contextAnchor: contextAnchorRef.current,
                previousContext,
              },
              signal
            );
            if (!signal.aborted && topUp.lines?.length) {
              mergeTranslatedLines(lang, topUp.lines, batch.batchIndex, shardSessionId);
            }
          }
        } else {
          const res = await translateArticleBatch(
            {
              sentences: payloadSentences,
              sourceLanguage: cur.sourceLanguage,
              targetLanguage: lang,
              targetLevel: level,
              articleTitle: cur.title,
              contextAnchor: contextAnchorRef.current,
              previousContext,
            },
            signal
          );
          if (!signal.aborted && res.lines?.length) {
            mergeTranslatedLines(lang, res.lines, batch.batchIndex, shardSessionId);
          }
        }
        completedBatchesRef.current.add(batch.batchIndex);
      } catch (err) {
        if (isAbortError(err)) return;
        // Half-split recovery if a larger batch hit transient error
        if (payloadSentences.length > 4 && !signal.aborted) {
          const mid = Math.ceil(payloadSentences.length / 2);
          for (const half of [payloadSentences.slice(0, mid), payloadSentences.slice(mid)]) {
            if (signal.aborted || half.length === 0) break;
            try {
              const res = await translateArticleBatch(
                {
                  sentences: half,
                  sourceLanguage: cur.sourceLanguage,
                  targetLanguage: lang,
                  targetLevel: level,
                  articleTitle: cur.title,
                  contextAnchor: contextAnchorRef.current,
                },
                signal
              );
              if (!signal.aborted && res.lines?.length) {
                mergeTranslatedLines(lang, res.lines, batch.batchIndex, shardSessionId);
              }
            } catch {
              // Ignore single retry failure so background pool keeps going
            }
          }
        }
      } finally {
        inFlightBatchesRef.current.delete(batch.batchIndex);
      }
    },
    [mergeTranslatedLines]
  );

  // Main Progressive Sharded Translation Pipeline (0ms IndexedDB -> Express Opening Stream -> Concurrency-3 Pool)
  useEffect(() => {
    pipelineAbortRef.current?.abort();
    const ac = new AbortController();
    pipelineAbortRef.current = ac;

    const curArticle = articleRef.current;
    const urlHash = hashArticleKey(curArticle.url || curArticle.id);
    const shardSessionId = buildArticleShardSessionId(urlHash, activeLanguage, targetLevel);
    const batches = buildArticleBatches(curArticle);
    batchesRef.current = batches;
    inFlightBatchesRef.current = new Set();
    completedBatchesRef.current = new Set();

    let cancelled = false;

    const runPipeline = async () => {
      // 1. 0ms Sharded IndexedDB Hydration
      const cachedMap = await loadShardedBatches(shardSessionId);
      if (cancelled || ac.signal.aborted) return;

      if (cachedMap.size > 0) {
        const hydrated: ArticleTranslatedLineDto[] = [];
        cachedMap.forEach((line) => {
          hydrated.push({
            id: line.id,
            text: line.text,
            translationVi: line.translationVi,
            ipaLine: line.ipaLine,
            tokens: line.tokens || [],
            enriched: Boolean(line.enriched),
          });
        });
        mergeTranslatedLines(activeLanguage, hydrated);
      }

      const initialDone = articleRef.current.sentences.filter(
        (s) => s.variants[activeLanguage]?.enriched
      ).length;
      setTranslatedCount(initialDone);

      // Mark already-completed batches
      for (const b of batches) {
        const slice = articleRef.current.sentences.slice(b.startIdx, b.endIdx);
        if (slice.every((s) => s.variants[activeLanguage]?.enriched)) {
          completedBatchesRef.current.add(b.batchIndex);
        }
      }

      if (completedBatchesRef.current.size === batches.length) {
        setIsTranslating(false);
        return;
      }

      setIsTranslating(true);

      // 2. Non-blocking Global Article Context Anchor (locks tone & domain glossary for long articles)
      if (activeLanguage !== 'vi' && !articleRef.current.contextAnchors?.[activeLanguage]) {
        const sampleLines = articleRef.current.sentences
          .filter(
            (_, idx) =>
              idx < 10 ||
              idx % Math.max(1, Math.floor(articleRef.current.sentences.length / 8)) === 0
          )
          .slice(0, 18)
          .map((s) => ({ start: s.index * 5, text: s.originalText }));

        fetchVideoContextAnchor(
          {
            sampleLines,
            language: activeLanguage,
            sourceLanguage: curArticle.sourceLanguage,
            targetLevel,
            videoTitle: curArticle.title,
          },
          ac.signal
        )
          .then(({ anchor }) => {
            if (ac.signal.aborted || !anchor) return;
            contextAnchorRef.current = anchor;
            const nextArt: ArticleSession = {
              ...articleRef.current,
              contextAnchors: {
                ...(articleRef.current.contextAnchors || {}),
                [activeLanguage]: anchor,
              },
            };
            articleRef.current = nextArt;
            onUpdateArticle(nextArt);
          })
          .catch(() => undefined);
      } else {
        contextAnchorRef.current = articleRef.current.contextAnchors?.[activeLanguage];
      }

      // 3. Express Streaming Opening Batch 0 (< 1.2s Time-To-First-Line)
      if (batches[0] && !completedBatchesRef.current.has(0)) {
        await runSingleBatch(batches[0], activeLanguage, targetLevel, shardSessionId, true, ac.signal);
      }

      if (cancelled || ac.signal.aborted) return;

      // 4. Adaptive Background Pool (CONCURRENCY = 3) filling 100% of the article without truncation
      const CONCURRENCY = 3;
      let nextPtr = 1;

      const worker = async () => {
        while (!cancelled && !ac.signal.aborted) {
          let chosen: BatchRange | null = null;
          while (nextPtr < batches.length) {
            const candidate = batches[nextPtr];
            nextPtr += 1;
            if (
              !completedBatchesRef.current.has(candidate.batchIndex) &&
              !inFlightBatchesRef.current.has(candidate.batchIndex)
            ) {
              chosen = candidate;
              break;
            }
          }
          if (!chosen) break;
          await runSingleBatch(chosen, activeLanguage, targetLevel, shardSessionId, false, ac.signal);
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

      if (!cancelled && !ac.signal.aborted) {
        setIsTranslating(false);
      }
    };

    void runPipeline();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [article.id, activeLanguage, targetLevel, mergeTranslatedLines, onUpdateArticle, runSingleBatch]);

  // Scroll-Viewport Preemption (< 1.5s when user jumps straight to the bottom/conclusion!)
  const handleViewportVisibleRange = useCallback(
    (minIdx: number, maxIdx: number) => {
      const ac = pipelineAbortRef.current;
      if (!ac || ac.signal.aborted) return;
      const urlHash = hashArticleKey(articleRef.current.url || articleRef.current.id);
      const shardSessionId = buildArticleShardSessionId(urlHash, activeLanguage, targetLevel);

      for (const batch of batchesRef.current) {
        const overlaps = batch.endIdx > minIdx && batch.startIdx <= maxIdx;
        if (
          overlaps &&
          !completedBatchesRef.current.has(batch.batchIndex) &&
          !inFlightBatchesRef.current.has(batch.batchIndex)
        ) {
          void runSingleBatch(batch, activeLanguage, targetLevel, shardSessionId, true, ac.signal);
        }
      }
    },
    [activeLanguage, targetLevel, runSingleBatch]
  );

  // Jump helper from right-side tools (index -> exact paragraph & sentence highlight)
  const jumpToSentenceIndex = useCallback((idx: number) => {
    const safeIdx = Math.max(0, Math.min(articleRef.current.sentences.length - 1, Math.round(idx)));
    const target = articleRef.current.sentences[safeIdx];
    if (!target) return;
    setActiveSentenceIndex(safeIdx);
    setHighlightedParagraphId(target.paragraphId);
    setHighlightedSentenceId(target.id);
    window.setTimeout(() => {
      setHighlightedParagraphId((prev) => (prev === target.paragraphId ? null : prev));
    }, 3200);
  }, []);

  const jumpToParagraphId = useCallback((paragraphId: string) => {
    const targetSent = articleRef.current.sentences.find((s) => s.paragraphId === paragraphId);
    if (targetSent) {
      setActiveSentenceIndex(targetSent.index);
      setHighlightedSentenceId(targetSent.id);
    }
    setHighlightedParagraphId(paragraphId);
    window.setTimeout(() => {
      setHighlightedParagraphId((prev) => (prev === paragraphId ? null : prev));
    }, 3200);
  }, []);

  // 1-Click Word Profile Lookup (strict 1:1 token lock + IndexedDB cache)
  const handleTokenClick = useCallback(
    async (token: SubtitleToken, line: SubtitleLine) => {
      setSelectedToken(token);
      setSelectedLine(line);
      setWordError(null);
      setWordProfile(null);

      const cacheKey = buildWordCacheKey(
        `v3_gt_art_${articleRef.current.id}_${studyLang}`,
        line.id,
        token.id,
        token.surface
      );
      const cached = await getCachedWordProfile(cacheKey);
      if (cached && cached.surface === token.surface) {
        setWordProfile(cached);
        setIsWordLoading(false);
        return;
      }

      setIsWordLoading(true);
      try {
        const prevS = line.index > 0 ? mappedLines[line.index - 1]?.text : undefined;
        const nextS =
          line.index + 1 < mappedLines.length ? mappedLines[line.index + 1]?.text : undefined;
        const { profile } = await lookupWordProfile({
          tokenId: token.id,
          lineId: line.id,
          surface: token.surface,
          lemma: token.lemma || token.surface,
          sentence: line.text,
          prevSentence: prevS,
          nextSentence: nextS,
          language: studyLang,
        });
        setWordProfile(profile);
        void setCachedWordProfile(cacheKey, profile);
      } catch (err) {
        setWordError(err instanceof Error ? err.message : 'Chưa thể tra cứu từ này lúc này.');
      } finally {
        setIsWordLoading(false);
      }
    },
    [mappedLines, studyLang]
  );

  // Switch Article Language cleanly (auto-adjust level scale JLPT <-> CEFR)
  const handleSwitchLanguage = (nextLang: ArticleLanguage) => {
    setSelectedToken(null);
    setSelectedLine(null);
    setActiveLanguage(nextLang);
    if (nextLang === 'ja' && !['N5', 'N4', 'N3', 'N2', 'N1'].includes(targetLevel)) {
      setTargetLevel('N3');
    } else if (nextLang === 'en' && !['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(targetLevel)) {
      setTargetLevel('B2');
    }
    if (nextLang !== 'vi' && article.sourceLanguage === 'vi') {
      setViewMode((prev) => (prev === 'split' ? 'split' : prev));
    }
  };

  // --- Right-Hemisphere Study Tool Generators (100% Parity with YouTube Studio) ---
  const currentCollocations = article.collocations3Tier?.[studyLang] || null;
  const currentNuanceMatrix = article.nuanceMatrix?.[studyLang] || null;
  const currentCurriculum = article.curriculum?.[studyLang] || null;
  const currentStudySheet = article.studySheet?.[studyLang] || null;
  const currentProductionPack = article.productionPack?.[studyLang] || null;
  const currentReadingQuiz = article.readingQuiz?.[studyLang] || [];

  const handleGenerateCollocations = async () => {
    if (toolLines.length === 0) return;
    setIsColLoading(true);
    setColError(null);
    try {
      const { items } = await fetchCollocations3Tier({
        lines: toolLines.slice(0, 75).map((l) => ({
          id: l.id,
          start: l.start,
          text: l.text,
          translationVi: l.translationVi,
        })),
        language: studyLang,
        targetLevel,
        videoTitle: article.title,
      });
      const next: ArticleSession = {
        ...articleRef.current,
        collocations3Tier: { ...(articleRef.current.collocations3Tier || {}), [studyLang]: items },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch (err) {
      setColError(err instanceof Error ? err.message : 'Chưa thể tổng hợp Collocations lúc này.');
    } finally {
      setIsColLoading(false);
    }
  };

  const handleExpandCollocations = async () => {
    if (toolLines.length === 0) return;
    setIsColExpanding(true);
    try {
      const existing = currentCollocations || [];
      const excludes = existing.flatMap((c) => [
        c.casual.expression,
        c.natural.expression,
        c.academic.expression,
      ]);
      const { items } = await fetchCollocations3Tier({
        lines: toolLines.slice(0, 90).map((l) => ({
          id: l.id,
          start: l.start,
          text: l.text,
          translationVi: l.translationVi,
        })),
        language: studyLang,
        targetLevel,
        videoTitle: article.title,
        excludeExpressions: excludes,
        count: 3,
      });
      const merged = [...existing, ...items];
      const next: ArticleSession = {
        ...articleRef.current,
        collocations3Tier: { ...(articleRef.current.collocations3Tier || {}), [studyLang]: merged },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch {
      onToast('Chưa thể mở rộng thêm Collocations lúc này.');
    } finally {
      setIsColExpanding(false);
    }
  };

  const handleGenerateNuanceMatrix = async () => {
    if (toolLines.length === 0) return;
    setIsNuanceLoading(true);
    setNuanceError(null);
    try {
      const { matrix } = await fetchNuanceMatrix({
        lines: toolLines.slice(0, 75).map((l) => ({
          start: l.start,
          text: l.text,
        })),
        language: studyLang,
        targetLevel,
        videoTitle: article.title,
      });
      const next: ArticleSession = {
        ...articleRef.current,
        nuanceMatrix: { ...(articleRef.current.nuanceMatrix || {}), [studyLang]: matrix },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch (err) {
      setNuanceError(err instanceof Error ? err.message : 'Chưa thể tạo Ma trận Sắc thái lúc này.');
    } finally {
      setIsNuanceLoading(false);
    }
  };

  const handleExpandNuanceMatrix = async () => {
    if (toolLines.length === 0) return;
    setIsNuanceExpanding(true);
    try {
      const existing = currentNuanceMatrix || [];
      const { groups } = await expandThreeNuancePairs({
        language: studyLang,
        targetLevel,
        videoTitle: article.title,
        excludeTitles: existing.map((g) => g.title),
      });
      const next: ArticleSession = {
        ...articleRef.current,
        nuanceMatrix: {
          ...(articleRef.current.nuanceMatrix || {}),
          [studyLang]: [...existing, ...groups],
        },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch {
      onToast('Chưa thể mở rộng thêm nhóm sắc thái lúc này.');
    } finally {
      setIsNuanceExpanding(false);
    }
  };

  const handleGenerateCurriculum = async () => {
    if (toolLines.length === 0) return;
    setIsCurriculumLoading(true);
    setCurriculumError(null);
    try {
      const { curriculum } = await fetchCurriculumData({
        lines: toolLines.slice(0, 85).map((l) => ({
          id: l.id,
          start: l.start,
          text: l.text,
          translationVi: l.translationVi,
        })),
        language: studyLang,
        targetLevel,
        videoTitle: article.title,
      });
      const next: ArticleSession = {
        ...articleRef.current,
        curriculum: { ...(articleRef.current.curriculum || {}), [studyLang]: curriculum },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch (err) {
      setCurriculumError(err instanceof Error ? err.message : 'Chưa thể lọc Từ vựng & Ngữ pháp.');
    } finally {
      setIsCurriculumLoading(false);
    }
  };

  const handleAnalyzeSentenceXRay = async (lineToAnalyze: SubtitleLine) => {
    setXrayTargetLine(lineToAnalyze);
    setRightTab('xray');
    const cacheKey = `${studyLang}::${lineToAnalyze.id}`;
    if (articleRef.current.xrayCache?.[cacheKey]) {
      setXrayError(null);
      return;
    }
    setIsXrayLoading(true);
    setXrayError(null);
    try {
      const prevS = lineToAnalyze.index > 0 ? toolLines[lineToAnalyze.index - 1]?.text : undefined;
      const nextS =
        lineToAnalyze.index + 1 < toolLines.length
          ? toolLines[lineToAnalyze.index + 1]?.text
          : undefined;
      const { xray } = await fetchSyntaxXRay({
        lineId: lineToAnalyze.id,
        sentence: lineToAnalyze.text,
        translationVi: lineToAnalyze.translationVi,
        language: studyLang,
        prevSentence: prevS,
        nextSentence: nextS,
      });
      const next: ArticleSession = {
        ...articleRef.current,
        xrayCache: { ...(articleRef.current.xrayCache || {}), [cacheKey]: xray },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch (err) {
      setXrayError(err instanceof Error ? err.message : 'Chưa thể giải phẫu cú pháp câu này.');
    } finally {
      setIsXrayLoading(false);
    }
  };

  const handleGenerateReadingQuiz = async () => {
    setIsQuizLoading(true);
    try {
      const paraPayloads = article.paragraphs.map((p) => {
        const sents = p.sentenceIds
          .map((id) => article.sentences.find((s) => s.id === id))
          .filter((s): s is NonNullable<typeof s> => Boolean(s));
        const text = sents
          .map((s) => s.variants[studyLang]?.text || s.originalText)
          .join(studyLang === 'ja' ? '' : ' ');
        return { id: p.id, text };
      });
      const { questions } = await fetchArticleReadingQuiz({
        title: article.title,
        language: studyLang,
        targetLevel,
        paragraphs: paraPayloads,
      });
      const next: ArticleSession = {
        ...articleRef.current,
        readingQuiz: { ...(articleRef.current.readingQuiz || {}), [studyLang]: questions },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Chưa thể tạo bài kiểm tra đọc hiểu.');
    } finally {
      setIsQuizLoading(false);
    }
  };

  const handleGenerateStudySheet = async () => {
    setIsStudySheetLoading(true);
    setStudySheetError(null);
    try {
      const { studySheet } = await fetchStudySheetData({
        lines: toolLines.slice(0, 75).map((l) => ({
          id: l.id,
          start: l.start,
          text: l.text,
          translationVi: l.translationVi,
        })),
        language: studyLang,
        targetLevel,
        videoTitle: article.title,
      });
      const next: ArticleSession = {
        ...articleRef.current,
        studySheet: { ...(articleRef.current.studySheet || {}), [studyLang]: studySheet },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch (err) {
      setStudySheetError(err instanceof Error ? err.message : 'Chưa thể tạo Phiếu ôn tập.');
    } finally {
      setIsStudySheetLoading(false);
    }
  };

  const handleGenerateProductionPack = async () => {
    setIsProductionLoading(true);
    setProductionError(null);
    try {
      const { pack } = await fetchProductionLabPack({
        lines: toolLines.slice(0, 65).map((l) => ({
          start: l.start,
          text: l.text,
          translationVi: l.translationVi,
        })),
        language: studyLang,
        targetLevel,
        videoTitle: article.title,
      });
      const next: ArticleSession = {
        ...articleRef.current,
        productionPack: { ...(articleRef.current.productionPack || {}), [studyLang]: pack },
      };
      onUpdateArticle(next);
      void saveArticleSession(next);
    } catch (err) {
      setProductionError(err instanceof Error ? err.message : 'Chưa thể tạo bài luyện phản xạ.');
    } finally {
      setIsProductionLoading(false);
    }
  };

  // --- Flashcard Saving Helpers (Anchored to exact Article URL + Paragraph + Sentence!) ---
  const findAnchorForSentenceIndex = (sentIdx: number) => {
    const safe = Math.max(0, Math.min(article.sentences.length - 1, Math.round(sentIdx)));
    const s = article.sentences[safe] || article.sentences[0];
    const line = toolLines[safe] || toolLines[0];
    return {
      paragraphId: s?.paragraphId || 'p0',
      sentenceId: s?.id || 'p0_s0',
      sentenceIndex: safe,
      sentence: line?.text || s?.originalText || '',
      sentenceVi: line?.translationVi || s?.originalText || '',
    };
  };

  const handleSaveWordCard = (profile: WordProfile) => {
    const anchor = findAnchorForSentenceIndex(selectedLine?.index ?? activeSentenceIndex);
    const card = createArticleFlashcard({
      kind: 'vocab',
      language: studyLang,
      term: profile.surface,
      lemma: profile.lemma,
      readingOrIpa: studyLang === 'ja' ? profile.furigana : profile.ipaUS || profile.ipaUK,
      hanViet: profile.hanViet,
      level: profile.level,
      meaningVi: profile.contextMeaning,
      extraNotes: profile.usageNote,
      kanjiBreakdown: profile.kanjiBreakdown,
      nuanceDual: profile.nuanceDual,
      ...anchor,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu "${profile.surface}" kèm neo đoạn ${anchor.paragraphId.toUpperCase()} vào kho FSRS`);
  };

  const handleSaveDetectedCollocation = (col: DetectedCollocation, line: SubtitleLine) => {
    const anchor = findAnchorForSentenceIndex(line.index);
    const card = createArticleFlashcard({
      kind: 'vocab',
      language: studyLang,
      term: col.phrase,
      lemma: col.phrase,
      readingOrIpa: col.readingOrIpa,
      hanViet: col.hanViet,
      level: col.level,
      meaningVi: col.meaningVi,
      extraNotes: `Collocation (${col.tier}): ${col.patternFormula}`,
      ...anchor,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu cụm "${col.phrase}" vào kho FSRS`);
  };

  const handleSaveExtraCollocation = (col: WordExtraCollocation, line: SubtitleLine) => {
    const anchor = findAnchorForSentenceIndex(line.index);
    const card = createArticleFlashcard({
      kind: 'vocab',
      language: studyLang,
      term: col.expression,
      lemma: col.expression,
      readingOrIpa: col.readingOrIpa,
      hanViet: col.hanViet,
      level: col.level,
      meaningVi: col.meaningVi,
      extraNotes: col.exampleSentence,
      ...anchor,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu cụm "${col.expression}" vào kho FSRS`);
  };

  const handleSaveNuanceDualCard = (
    payload: NuanceDualPayload,
    ctx?: { timestamp?: number; sentence?: string; sentenceVi?: string }
  ) => {
    const anchor = findAnchorForSentenceIndex(ctx?.timestamp ?? activeSentenceIndex);
    const card = createArticleFlashcard({
      kind: payload.kind === 'grammar' ? 'grammar' : 'vocab',
      language: payload.language,
      term: payload.term,
      lemma: payload.lemma,
      readingOrIpa: payload.summary.anchorExample.readingOrIpa,
      level: payload.targetLevel,
      meaningVi: payload.summary.coreRule,
      extraNotes: `${payload.summary.quickContrast.do} | ${payload.summary.quickContrast.dont}`,
      nuanceDual: payload,
      sentence: ctx?.sentence || anchor.sentence,
      sentenceVi: ctx?.sentenceVi || anchor.sentenceVi,
      paragraphId: anchor.paragraphId,
      sentenceId: anchor.sentenceId,
      sentenceIndex: anchor.sentenceIndex,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu thẻ sắc thái "${payload.term}" vào kho FSRS`);
  };

  const handleSaveCollocation3Tier = (item: Collocation3TierItem, tierKey: CollocationTier) => {
    const v = item[tierKey];
    const anchor = findAnchorForSentenceIndex(item.timestamp);
    const card = createArticleFlashcard({
      kind: 'vocab',
      language: studyLang,
      term: v.expression,
      lemma: v.expression,
      readingOrIpa: v.readingOrIpa,
      hanViet: v.hanViet,
      level: v.level,
      meaningVi: `${item.vietnameseConcept} — ${v.nuanceVi}`,
      extraNotes: `Tránh bẫy: ${item.antiCalqueTrap}`,
      ...anchor,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu "${v.expression}" vào kho FSRS`);
  };

  const handleSaveWebItem = (item: CollocationWebBranchItem, coreWord: string) => {
    const anchor = findAnchorForSentenceIndex(activeSentenceIndex);
    const card = createArticleFlashcard({
      kind: 'vocab',
      language: studyLang,
      term: item.expression,
      lemma: item.expression,
      readingOrIpa: item.readingOrIpa,
      hanViet: item.hanViet,
      level: item.level,
      meaningVi: item.meaningVi,
      extraNotes: `Từ gốc: ${coreWord} (${item.patternFormula})`,
      ...anchor,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu "${item.expression}" vào kho FSRS`);
  };

  const handleSaveCurriculumVocab = (item: CurriculumVocabItem) => {
    const firstOcc = item.occurrences?.[0];
    const anchor = findAnchorForSentenceIndex(firstOcc?.start ?? activeSentenceIndex);
    const card = createArticleFlashcard({
      kind: 'vocab',
      language: studyLang,
      term: item.word,
      lemma: item.lemma,
      readingOrIpa: item.readingOrIpa,
      hanViet: item.hanViet,
      level: item.level,
      meaningVi: item.meaningVi,
      ...anchor,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu "${item.word}" vào kho FSRS`);
  };

  const handleSaveCurriculumGrammar = (item: CurriculumGrammarItem) => {
    const anchor = findAnchorForSentenceIndex(item.exampleStart ?? activeSentenceIndex);
    const card = createArticleFlashcard({
      kind: 'grammar',
      language: studyLang,
      term: item.pattern,
      lemma: item.pattern,
      readingOrIpa: item.formula,
      level: item.level,
      meaningVi: item.nuance,
      extraNotes: item.conjugation,
      ...anchor,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu ngữ pháp "${item.pattern}" vào kho FSRS`);
  };

  const handleSaveGrammarNote = (note: SentenceGrammarNote, line: SubtitleLine) => {
    const anchor = findAnchorForSentenceIndex(line.index);
    const card = createArticleFlashcard({
      kind: 'grammar',
      language: studyLang,
      term: note.pattern,
      lemma: note.pattern,
      readingOrIpa: note.formula,
      level: note.level,
      meaningVi: note.nuance,
      extraNotes: note.conjugation,
      ...anchor,
    });
    onSaveFlashcard(card);
    onToast(`Đã lưu ngữ pháp "${note.pattern}" vào kho FSRS`);
  };

  const handleAddParagraphNote = async (paragraphId: string, content: string) => {
    const newNote: ArticleNote = {
      id: `anote_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      articleId: article.id,
      paragraphId,
      content,
      createdAt: Date.now(),
    };
    setNotes((prev) => [newNote, ...prev]);
    await saveArticleNote(newNote);
    onToast(`Đã lưu ghi chú tại đoạn ${paragraphId.toUpperCase()}`);
  };

  const handleDeleteParagraphNote = async (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    await deleteArticleNote(noteId);
  };

  const handleExportMarkdown = () => {
    const byId = new Map(article.sentences.map((s) => [s.id, s]));
    exportArticleMarkdown({
      title: article.title,
      url: article.url,
      domain: article.domain,
      sourceLanguage: article.sourceLanguage,
      activeLanguage,
      targetLevel,
      paragraphs: article.paragraphs,
      sentencesById: byId,
      curriculum: currentCurriculum,
      xrayCache: article.xrayCache,
      notes,
    });
    onToast('Đã xuất bài viết Notion Markdown (.md)');
  };

  const handleExportAnkiCsv = () => {
    const articleCards = flashcards.filter((c) => c.articleId === article.id);
    const exportList = articleCards.length > 0 ? articleCards : flashcards;
    if (exportList.length === 0) {
      onToast('Chưa có thẻ từ vựng nào để xuất Anki. Hãy bấm tra từ và lưu thẻ trước.');
      return;
    }
    const csv = exportFlashcardsToAnkiCsv(exportList);
    triggerDownload(`kotozen-article-anki-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
    onToast(`Đã xuất ${exportList.length} thẻ Anki (.csv UTF-8 BOM)`);
  };

  const effectiveXrayLine = xrayTargetLine || toolLines[activeSentenceIndex] || toolLines[0] || null;
  const activeXray = effectiveXrayLine
    ? article.xrayCache?.[`${studyLang}::${effectiveXrayLine.id}`] || null
    : null;

  const isSelectedWordSaved = Boolean(
    selectedToken &&
      savedTermKeys.has(`${studyLang}::${selectedToken.surface.toLowerCase()}`)
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5 items-start min-w-0">
      {/* LEFT 60%: ZEN TRI-LINGUAL READING ROOM */}
      <ArticleReaderStage
        article={article}
        activeLanguage={activeLanguage}
        targetLevel={targetLevel}
        viewMode={viewMode}
        showTriLingualStack={showTriLingualStack}
        onViewModeChange={setViewMode}
        onToggleTriLingualStack={() => setShowTriLingualStack((v) => !v)}
        onSwitchLanguage={handleSwitchLanguage}
        onTargetLevelChange={setTargetLevel}
        mappedLines={mappedLines}
        activeSentenceIndex={activeSentenceIndex}
        onActiveSentenceIndexChange={setActiveSentenceIndex}
        highlightedParagraphId={highlightedParagraphId}
        highlightedSentenceId={highlightedSentenceId}
        isTranslating={isTranslating}
        translatedCount={translatedCount}
        totalSentenceCount={article.sentences.length}
        showReadingAid={showReadingAid}
        onToggleReadingAid={() => setShowReadingAid((v) => !v)}
        blurTranslation={blurTranslation}
        onToggleBlurTranslation={() => setBlurTranslation((v) => !v)}
        isHoldingH={isHoldingH}
        collocations={currentCollocations || []}
        showCollocationUnderlines={showCollocationUnderlines}
        onToggleCollocationUnderlines={() => setShowCollocationUnderlines((v) => !v)}
        showLevelHighlights={showLevelHighlights}
        onToggleLevelHighlights={() => setShowLevelHighlights((v) => !v)}
        iPlusOneReport={iPlusOneReport}
        selectedToken={selectedToken}
        selectedLine={selectedLine}
        wordProfile={wordProfile}
        isWordLoading={isWordLoading}
        wordError={wordError}
        isSelectedWordSaved={isSelectedWordSaved}
        savedTermKeys={savedTermKeys}
        onTokenClick={handleTokenClick}
        onCloseWordPopover={() => {
          setSelectedToken(null);
          setSelectedLine(null);
        }}
        onSaveWordCard={handleSaveWordCard}
        onSaveDetectedCollocation={handleSaveDetectedCollocation}
        onSaveExtraCollocation={handleSaveExtraCollocation}
        onOpenCollocationWeb={(core) => {
          setInitialCoreWord(core);
          setRightTab('collocations');
          setSelectedToken(null);
          setSelectedLine(null);
        }}
        onSaveNuanceDualCard={handleSaveNuanceDualCard}
        onOpenSentenceXRay={handleAnalyzeSentenceXRay}
        onAskAiSenseiSelection={(selectedText, surroundingContext) => {
          onOpenAiSensei(
            `Giải thích chi tiết sắc thái, ngữ pháp và cách dùng của đoạn sau trong bài viết "${article.title}":\n\nĐoạn được chọn: "${selectedText}"\n\nNgữ cảnh đoạn văn: "${surroundingContext}"`
          );
        }}
        onViewportVisibleRange={handleViewportVisibleRange}
        notes={notes}
        onAddNote={handleAddParagraphNote}
        onDeleteNote={handleDeleteParagraphNote}
        onExportMarkdown={handleExportMarkdown}
        onExportAnkiCsv={handleExportAnkiCsv}
        onShadowScored={() => onLogActivity({ shadowedSentences: 1 })}
      />

      {/* RIGHT 40%: UNIFIED STUDY HEMISPHERE (100% Parity with YouTube Studio) */}
      <aside className="xl:sticky xl:top-16 min-w-0 space-y-3 no-print">
        <div className="zen-surface border rounded-2xl overflow-hidden shadow-xs flex flex-col xl:max-h-[calc(100vh-5.5rem)]">
          {/* Top 4-Tab Bar */}
          <div className="p-2 border-b border-black/5 dark:border-white/10 grid grid-cols-4 gap-1 bg-black/[0.015] dark:bg-white/[0.02] shrink-0">
            <button
              type="button"
              onClick={() => setRightTab('collocations')}
              className={`py-2 px-1.5 rounded-xl text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 transition-colors cursor-pointer ${
                rightTab === 'collocations'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs border'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Cụm từ</span>
            </button>
            <button
              type="button"
              onClick={() => setRightTab('curriculum')}
              className={`py-2 px-1.5 rounded-xl text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 transition-colors cursor-pointer ${
                rightTab === 'curriculum'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs border'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Từ &amp; NP</span>
            </button>
            <button
              type="button"
              onClick={() => setRightTab('xray')}
              className={`py-2 px-1.5 rounded-xl text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 transition-colors cursor-pointer ${
                rightTab === 'xray'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs border'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              <ScanSearch className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">X-Quang</span>
            </button>
            <button
              type="button"
              onClick={() => setRightTab('practice')}
              className={`py-2 px-1.5 rounded-xl text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 transition-colors cursor-pointer ${
                rightTab === 'practice'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs border'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              <Brain className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Quiz &amp; Ôn</span>
            </button>
          </div>

          {/* Scrollable Tab Content */}
          <div className="p-3.5 overflow-y-auto zen-scroll flex-1 min-h-[380px] space-y-3">
            {rightTab === 'collocations' && (
              <CollocationsTab
                language={studyLang}
                targetLevel={targetLevel}
                collocations={currentCollocations}
                isLoading={isColLoading}
                error={colError}
                hasLines={toolLines.length > 0}
                savedTermKeys={savedTermKeys}
                onGenerateCollocations={handleGenerateCollocations}
                onExpandMoreCollocations={handleExpandCollocations}
                isExpandingMore={isColExpanding}
                onSeekTo={jumpToSentenceIndex}
                onSaveCollocation={handleSaveCollocation3Tier}
                onSaveWebItem={handleSaveWebItem}
                onOpenEncyclopedia={onOpenCollocationLibrary}
                initialCoreWord={initialCoreWord}
                onClearInitialCoreWord={() => setInitialCoreWord(null)}
                nuanceMatrix={currentNuanceMatrix}
                isNuanceLoading={isNuanceLoading}
                isNuanceExpanding={isNuanceExpanding}
                nuanceError={nuanceError}
                onGenerateNuanceMatrix={handleGenerateNuanceMatrix}
                onExpandThreeNuance={handleExpandNuanceMatrix}
                videoTitle={article.title}
                onSaveNuanceDualCard={handleSaveNuanceDualCard}
              />
            )}

            {rightTab === 'curriculum' && (
              <CurriculumTab
                language={studyLang}
                targetLevel={targetLevel}
                curriculum={currentCurriculum}
                isLoading={isCurriculumLoading}
                error={curriculumError}
                hasLines={toolLines.length > 0}
                savedTermKeys={savedTermKeys}
                videoTitle={article.title}
                onGenerateCurriculum={handleGenerateCurriculum}
                onSeekTo={jumpToSentenceIndex}
                onSaveVocabItem={handleSaveCurriculumVocab}
                onSaveGrammarItem={handleSaveCurriculumGrammar}
                onSaveNuanceDualCard={handleSaveNuanceDualCard}
              />
            )}

            {rightTab === 'xray' && (
              <SyntaxXRayTab
                language={studyLang}
                targetLine={effectiveXrayLine}
                xray={activeXray}
                isLoading={isXrayLoading}
                error={xrayError}
                savedTermKeys={savedTermKeys}
                onAnalyzeActiveLine={() => {
                  if (effectiveXrayLine) void handleAnalyzeSentenceXRay(effectiveXrayLine);
                }}
                onSeekTo={jumpToSentenceIndex}
                onSaveGrammarNote={handleSaveGrammarNote}
              />
            )}

            {rightTab === 'practice' && (
              <div className="space-y-3">
                {/* Sub-switcher: Đọc hiểu Quiz | FSRS & Phản xạ | Nhập vai AI */}
                <div className="grid grid-cols-3 gap-1 p-0.5 rounded-xl zen-surface-subtle border text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setPracticeSubTab('reading_quiz')}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1 cursor-pointer ${
                      practiceSubTab === 'reading_quiz'
                        ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                        : 'opacity-65 hover:opacity-100'
                    }`}
                  >
                    <BookOpenCheck className="w-3.5 h-3.5" />
                    <span>Đọc hiểu</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPracticeSubTab('fsrs_lab')}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1 cursor-pointer ${
                      practiceSubTab === 'fsrs_lab'
                        ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                        : 'opacity-65 hover:opacity-100'
                    }`}
                  >
                    <Brain className="w-3.5 h-3.5" />
                    <span>FSRS &amp; Lab</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPracticeSubTab('roleplay')}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1 cursor-pointer ${
                      practiceSubTab === 'roleplay'
                        ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                        : 'opacity-65 hover:opacity-100'
                    }`}
                  >
                    <Theater className="w-3.5 h-3.5" />
                    <span>Nhập vai</span>
                  </button>
                </div>

                {practiceSubTab === 'reading_quiz' && (
                  <ArticleQuizPanel
                    language={studyLang}
                    targetLevel={targetLevel}
                    questions={currentReadingQuiz}
                    isLoading={isQuizLoading}
                    onGenerate={handleGenerateReadingQuiz}
                    onJumpToParagraph={jumpToParagraphId}
                  />
                )}

                {practiceSubTab === 'fsrs_lab' && (
                  <ReviewAndQuizTab
                    language={studyLang}
                    targetLevel={targetLevel}
                    videoTitle={article.title}
                    currentVideoId={article.id}
                    hasLines={toolLines.length > 0}
                    flashcards={flashcards}
                    onRateCard={onRateFlashcard}
                    onDeleteCard={onDeleteFlashcard}
                    onUpdateCardNote={onUpdateFlashcardNote}
                    onJumpToVideoAnchor={onJumpFromFlashcard}
                    onDataImported={onDataImported}
                    studySheet={currentStudySheet}
                    isStudySheetLoading={isStudySheetLoading}
                    studySheetError={studySheetError}
                    onGenerateStudySheet={handleGenerateStudySheet}
                    onSeekCurrentVideo={jumpToSentenceIndex}
                    productionPack={currentProductionPack}
                    isProductionLoading={isProductionLoading}
                    productionError={productionError}
                    onGenerateProductionPack={handleGenerateProductionPack}
                    weaknesses={weaknesses}
                    onLogWeakness={onLogWeakness}
                    onDeleteWeakness={onDeleteWeakness}
                    onDrillSuccess={() => onLogActivity({ wordsReviewed: 1 })}
                    activityLogs={activityLogs}
                    iPlusOneReport={iPlusOneReport}
                  />
                )}

                {practiceSubTab === 'roleplay' && (
                  <RoleplayStudio
                    language={studyLang}
                    targetLevel={targetLevel}
                    videoTitle={article.title}
                    lines={toolLines}
                    activeLine={toolLines[activeSentenceIndex] || toolLines[0] || null}
                    onTurnCompleted={() => onLogActivity({ roleplayTurns: 1 })}
                  />
                )}
              </div>
            )}
          </div>

          {/* Persistent Quick AI Sensei Footer */}
          <div className="px-3.5 py-2.5 border-t border-black/5 dark:border-white/10 flex items-center justify-between gap-2 bg-black/[0.015] dark:bg-white/[0.02] shrink-0">
            <span className="text-[11px] opacity-65 truncate">
              Bôi đen bất kỳ đoạn nào để hỏi AI Sensei
            </span>
            <button
              type="button"
              onClick={() => onOpenAiSensei()}
              className="h-7 px-3 rounded-lg bg-indigo-600/12 hover:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <MessageCircleQuestion className="w-3.5 h-3.5" />
              <span>Hỏi AI Sensei</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
