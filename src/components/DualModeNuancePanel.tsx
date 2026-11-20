import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Loader2,
  Microscope,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  Language,
  NuanceAxisScore,
  NuanceDisplayMode,
  NuanceDualPayload,
  NuanceExtraScenario,
  NuanceToneTier,
  ProficiencyLevel,
  RubySegment,
} from '../types';
import { expandThreeNuanceScenarios, fetchNuanceDual, isAbortError } from '../lib/api';
import { getNuanceDualL1, setNuanceDualL1 } from '../lib/cacheL1';
import {
  buildNuanceDualCacheKey,
  getCachedNuanceDual,
  getPinnedNuanceMode,
  listNuanceScenarioHistory,
  recordNuanceScenarioHistory,
  setCachedNuanceDual,
  setPinnedNuanceMode,
} from '../lib/db';
import { speakNative } from '../lib/youtube';
import { sanitizeClientErrorMessage } from '../lib/languagePurity';

export interface DualModeNuanceRequestParams {
  term: string;
  lemma?: string;
  language: Language;
  targetLevel: ProficiencyLevel;
  kind?: NuanceDualPayload['kind'];
  sentence: string;
  prevSentence?: string;
  nextSentence?: string;
  videoTitle?: string;
  compareTerms?: string[];
  timestamp?: number;
}

interface DualModeNuancePanelProps {
  /** Controlled static payload (e.g. from FSRS Flashcard back side -> 0ms instant render) */
  initialData?: NuanceDualPayload | null;
  /** Auto-fetch + 2-tier RAM/IDB cache parameters */
  requestParams?: DualModeNuanceRequestParams;
  /** Default mode if user has not pinned a preference */
  defaultMode?: NuanceDisplayMode;
  /** Enable keyboard shortcut 'D' to toggle Summary <-> Deep Dive */
  enableHotkeyD?: boolean;
  /** Compact layout for inline expansion inside cards */
  compact?: boolean;
  /** Whether already saved to FSRS */
  isSaved?: boolean;
  /** Callback to save 2-sided Nuance FSRS flashcard */
  onSaveNuanceCard?: (payload: NuanceDualPayload) => void;
  /** Optional header label override */
  titleLabel?: string;
}

function renderRubyOrHighlighted(
  sentence: string,
  highlightTerm: string,
  language: Language,
  ruby?: RubySegment[]
) {
  if (language === 'ja' && Array.isArray(ruby) && ruby.length > 0) {
    return (
      <span className="font-jp leading-[2.15]">
        {ruby.map((seg, idx) => {
          const isMatch =
            highlightTerm.length > 0 &&
            (seg.base === highlightTerm || highlightTerm.includes(seg.base));
          const inner = seg.reading ? (
            <ruby>
              {seg.base}
              <rt className="text-[10px] opacity-75 font-normal select-none">{seg.reading}</rt>
            </ruby>
          ) : (
            seg.base
          );
          return (
            <span
              key={idx}
              className={
                isMatch ? 'font-bold text-indigo-700 dark:text-indigo-300 underline decoration-indigo-500/50 underline-offset-4' : ''
              }
            >
              {inner}
            </span>
          );
        })}
      </span>
    );
  }

  if (!highlightTerm || !sentence) return <span>{sentence}</span>;
  const escaped = highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = sentence.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <span className={language === 'ja' ? 'font-jp leading-[2.15]' : ''}>
      {parts.map((part, idx) =>
        part.toLowerCase() === highlightTerm.toLowerCase() ? (
          <strong
            key={idx}
            className="font-bold text-indigo-700 dark:text-indigo-300 underline decoration-indigo-500/50 underline-offset-2"
          >
            {part}
          </strong>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        )
      )}
    </span>
  );
}

function toneColorForFormality(text: string): string {
  const l = text.toLowerCase();
  if (/suồng sã|thân mật|futsukei|casual/.test(l)) {
    return 'text-teal-700 dark:text-teal-300 bg-teal-500/10 border-teal-500/25';
  }
  if (/trang trọng|keigo|học thuật|công sở|formal/.test(l)) {
    return 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border-indigo-500/25';
  }
  return 'text-slate-700 dark:text-slate-200 bg-slate-500/10 border-slate-500/25';
}

function toneColorForAttitude(text: string): string {
  const l = text.toLowerCase();
  if (/tích cực|\(\+\)|khen/.test(l)) {
    return 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25';
  }
  if (/tiêu cực|\(–\)|\(-\)|mỉa mai|chê/.test(l)) {
    return 'text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/25';
  }
  return 'text-amber-800 dark:text-amber-300 bg-amber-500/10 border-amber-500/25';
}

const AxisBar: React.FC<{ title: string; axis: NuanceAxisScore; accentClass: string }> = ({
  title,
  axis,
  accentClass,
}) => {
  const score = Math.max(1, Math.min(5, Math.round(axis.score || 3)));
  const pct = (score / 5) * 100;
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold opacity-85 truncate">{title}</span>
        <span className="font-mono-tabular font-bold shrink-0">
          {score}/5 <span className="font-vi font-medium opacity-75">· {axis.label}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-black/8 dark:bg-white/10 overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-300 ${accentClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] opacity-60">
        <span className="truncate">{axis.leftEnd}</span>
        <span className="truncate text-right">{axis.rightEnd}</span>
      </div>
    </div>
  );
};

const ToneTierCard: React.FC<{
  tier: NuanceToneTier;
  language: Language;
  dotColor: string;
  labelPrefix: string;
}> = ({ tier, language, dotColor, labelPrefix }) => {
  return (
    <div className="p-2.5 rounded-xl zen-surface-subtle border space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold flex items-center gap-1.5 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />
          <span className="truncate">
            {labelPrefix} · {tier.label}
          </span>
        </span>
        <button
          type="button"
          onClick={() => speakNative(tier.sentence, language, 0.95)}
          title="Nghe phát âm tầng văn phong này"
          className="h-6 w-6 rounded-md hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center opacity-70 hover:opacity-100 shrink-0 cursor-pointer"
        >
          <Volume2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="text-[13px] font-semibold safe-wrap">
        {language === 'ja' && tier.ruby && tier.ruby.length > 0 ? (
          renderRubyOrHighlighted(tier.sentence, '', 'ja', tier.ruby)
        ) : (
          <span className={language === 'ja' ? 'font-jp leading-[2.15]' : ''}>{tier.sentence}</span>
        )}
      </div>
      {tier.readingOrIpa && (
        <div
          className={`text-[11px] opacity-65 safe-wrap ${
            language === 'en' ? 'font-ipa' : 'font-jp-compact'
          }`}
        >
          {tier.readingOrIpa}
        </div>
      )}
      {tier.translationVi && <p className="text-xs opacity-80 safe-wrap">{tier.translationVi}</p>}
      <p className="text-[11px] text-indigo-700 dark:text-indigo-300 font-medium safe-wrap">
        Cảm giác người nghe: {tier.listenerFeelingVi}
      </p>
    </div>
  );
};

export const DualModeNuancePanel: React.FC<DualModeNuancePanelProps> = ({
  initialData = null,
  requestParams,
  defaultMode = 'summary',
  enableHotkeyD = false,
  compact = false,
  isSaved = false,
  onSaveNuanceCard,
  titleLabel,
}) => {
  const [mode, setMode] = useState<NuanceDisplayMode>(defaultMode);
  const [pinnedMode, setPinnedModeState] = useState<NuanceDisplayMode | null>(null);
  const [data, setData] = useState<NuanceDualPayload | null>(initialData);
  const [isLoading, setIsLoading] = useState<boolean>(!initialData && Boolean(requestParams));
  const [error, setError] = useState<string | null>(null);

  // Deep-Dive modular accordion open states (scannable, never a wall of text)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    axes: true,
    pragmatics: true,
    matrix: true,
    traps: true,
    tiers: false,
    practice: true,
  });

  // Interactive 15s Micro-Quiz state
  const [selectedQuizOpt, setSelectedQuizOpt] = useState<number | null>(null);

  // Zero-duplicate [+3 Tình Huống Sắc Thái Mới] state
  const [extraScenarios, setExtraScenarios] = useState<NuanceExtraScenario[]>([]);
  const [isExpandingScenarios, setIsExpandingScenarios] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const expandAbortRef = useRef<AbortController | null>(null);

  // Load persisted pinned mode preference from IndexedDB once
  useEffect(() => {
    let active = true;
    getPinnedNuanceMode().then((pinned) => {
      if (!active) return;
      setPinnedModeState(pinned);
      if (pinned) setMode(pinned);
    });
    return () => {
      active = false;
    };
  }, []);

  // Keyboard shortcut 'D' to toggle Summary <-> Deep Dive in 0ms
  useEffect(() => {
    if (!enableHotkeyD) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setMode((prev) => (prev === 'summary' ? 'deep' : 'summary'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enableHotkeyD]);

  // Sync controlled static initialData (e.g. FSRS card back)
  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setIsLoading(false);
      setError(null);
      setSelectedQuizOpt(null);
      setExtraScenarios([]);
    }
  }, [initialData]);

  const cacheKey = useMemo(() => {
    if (!requestParams) return '';
    return buildNuanceDualCacheKey(
      requestParams.language,
      requestParams.lemma || requestParams.term,
      requestParams.sentence || requestParams.term
    );
  }, [
    requestParams?.language,
    requestParams?.lemma,
    requestParams?.term,
    requestParams?.sentence,
  ]);

  const loadNuanceDual = useCallback(
    async (forceRefresh = false) => {
      if (!requestParams || !requestParams.term.trim()) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setSelectedQuizOpt(null);
      setExtraScenarios([]);

      // Layer 1: 0ms RAM cache hit
      if (!forceRefresh && cacheKey) {
        const l1 = getNuanceDualL1(cacheKey);
        if (l1) {
          setData(l1);
          setIsLoading(false);
          return;
        }
      }

      setIsLoading(true);
      try {
        // Layer 2: <5ms IndexedDB cache hit
        if (!forceRefresh && cacheKey) {
          const idbHit = await getCachedNuanceDual(cacheKey);
          if (controller.signal.aborted) return;
          if (idbHit) {
            setNuanceDualL1(cacheKey, idbHit);
            setData(idbHit);
            setIsLoading(false);
            return;
          }
        }

        // Layer 3: gemini-3.8-flash unified dual-mode fetch
        const resp = await fetchNuanceDual(
          {
            term: requestParams.term,
            lemma: requestParams.lemma,
            language: requestParams.language,
            targetLevel: requestParams.targetLevel,
            kind: requestParams.kind || 'word',
            sentence: requestParams.sentence,
            prevSentence: requestParams.prevSentence,
            nextSentence: requestParams.nextSentence,
            videoTitle: requestParams.videoTitle,
            compareTerms: requestParams.compareTerms,
          },
          controller.signal
        );
        if (controller.signal.aborted) return;

        if (cacheKey) {
          setNuanceDualL1(cacheKey, resp.nuance);
          void setCachedNuanceDual(cacheKey, resp.nuance);
        }
        setData(resp.nuance);
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
        setError(
          sanitizeClientErrorMessage(
            err,
            'Chưa thể tải hồ sơ sắc thái lúc này. Bấm thử lại sau giây lát.'
          )
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [
      cacheKey,
      requestParams?.term,
      requestParams?.lemma,
      requestParams?.language,
      requestParams?.targetLevel,
      requestParams?.kind,
      requestParams?.sentence,
      requestParams?.prevSentence,
      requestParams?.nextSentence,
      requestParams?.videoTitle,
      requestParams?.compareTerms?.join('|'),
    ]
  );

  useEffect(() => {
    if (initialData) return;
    if (requestParams) {
      void loadNuanceDual(false);
    }
    return () => {
      abortRef.current?.abort();
      expandAbortRef.current?.abort();
    };
  }, [initialData, loadNuanceDual, requestParams ? cacheKey : '']);

  const handleTogglePin = async () => {
    const nextPinned = pinnedMode === mode ? null : mode;
    setPinnedModeState(nextPinned);
    await setPinnedNuanceMode(nextPinned);
  };

  const handleExpandThreeScenarios = async () => {
    if (!data || isExpandingScenarios) return;
    expandAbortRef.current?.abort();
    const controller = new AbortController();
    expandAbortRef.current = controller;

    setIsExpandingScenarios(true);
    setExpandError(null);
    try {
      const seenHistory = await listNuanceScenarioHistory(data.language, data.lemma || data.term);
      const localSeen = extraScenarios.map((s) => s.situationVi);
      const excludeSituations = Array.from(new Set([...seenHistory, ...localSeen]));

      const resp = await expandThreeNuanceScenarios(
        {
          term: data.term,
          lemma: data.lemma,
          language: data.language,
          targetLevel: data.targetLevel,
          sentence: data.summary.anchorExample.sentence,
          excludeSituations,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;

      const fresh = (resp.scenarios || []).filter(
        (sc) => !excludeSituations.some((ex) => ex.toLowerCase() === sc.situationVi.toLowerCase())
      );
      if (fresh.length > 0) {
        setExtraScenarios((prev) => [...prev, ...fresh]);
        await recordNuanceScenarioHistory(
          data.language,
          data.lemma || data.term,
          fresh.map((f) => f.situationVi)
        );
      }
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      setExpandError(
        sanitizeClientErrorMessage(err, 'Không thể mở rộng thêm tình huống lúc này.')
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsExpandingScenarios(false);
      }
    }
  };

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const lang = data?.language || requestParams?.language || 'en';

  return (
    <div className="min-w-0 max-w-full rounded-xl zen-surface border overflow-hidden">
      {/* FIXED TOP DUAL-MODE SWITCHER (0ms Switch + Hotkey D + Pin Preference + FSRS Save) */}
      <div className="px-3 py-2.5 zen-surface-subtle border-b flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {titleLabel && (
            <span className="text-[11px] font-bold opacity-75 truncate hidden sm:inline">
              {titleLabel}
            </span>
          )}
          <div
            role="tablist"
            aria-label="Chế độ giải thích sắc thái"
            className="inline-flex items-center p-0.5 rounded-lg zen-surface border shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'summary'}
              onClick={() => setMode('summary')}
              className={`h-7 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'summary'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'opacity-75 hover:opacity-100'
              }`}
            >
              <Zap className="w-3 h-3 shrink-0" />
              <span>Rút gọn · 3 giây</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'deep'}
              onClick={() => setMode('deep')}
              className={`h-7 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'deep'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'opacity-75 hover:opacity-100'
              }`}
            >
              <Microscope className="w-3 h-3 shrink-0" />
              <span>Chuyên sâu · Toàn diện</span>
            </button>
          </div>
          {enableHotkeyD && (
            <span
              title="Nhấn phím D để chuyển nhanh Rút gọn ↔ Chuyên sâu"
              className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono-tabular opacity-60 border rounded"
            >
              D
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleTogglePin}
            title={
              pinnedMode === mode
                ? 'Bỏ ghim chế độ mặc định này'
                : `Ghim chế độ ${mode === 'summary' ? 'Rút gọn' : 'Chuyên sâu'} làm mặc định`
            }
            className={`h-7 px-2 rounded-md text-[11px] font-medium border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              pinnedMode === mode
                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-400/50'
                : 'zen-surface opacity-70 hover:opacity-100'
            }`}
          >
            {pinnedMode === mode ? (
              <PinOff className="w-3 h-3 shrink-0" />
            ) : (
              <Pin className="w-3 h-3 shrink-0" />
            )}
            <span className="hidden sm:inline">
              {pinnedMode === mode ? 'Đã ghim' : 'Ghim mặc định'}
            </span>
          </button>

          {data && onSaveNuanceCard && (
            <button
              type="button"
              onClick={() => onSaveNuanceCard(data)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                isSaved
                  ? 'bg-teal-500/15 text-teal-800 dark:text-teal-300 border border-teal-500/35'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {isSaved ? (
                <BookmarkCheck className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Bookmark className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{isSaved ? 'Đã lưu FSRS' : 'Lưu sắc thái FSRS'}</span>
            </button>
          )}
        </div>
      </div>

      {/* BODY */}
      <div className={compact ? 'p-3 space-y-3' : 'p-3.5 space-y-3.5'}>
        {isLoading && !data ? (
          <div className="py-5 flex items-center justify-center gap-2 text-xs text-indigo-700 dark:text-indigo-300">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>Đang giải mã sắc thái ngữ dụng học 2 tầng...</span>
          </div>
        ) : error && !data ? (
          <div className="p-3 rounded-lg bg-rose-500/8 border border-rose-500/25 flex items-center justify-between gap-2 text-xs">
            <span className="safe-wrap opacity-85">{error}</span>
            <button
              type="button"
              onClick={() => void loadNuanceDual(true)}
              className="h-7 px-2.5 rounded-md bg-indigo-600 text-white font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Thử lại</span>
            </button>
          </div>
        ) : data ? (
          mode === 'summary' ? (
            /* =================================================================
               MODE 1: [⚡ RÚT GỌN · 3 GIÂY] — EXACTLY 4 ULTRA-CRISP MICRO-BLOCKS
               ================================================================= */
            <div className="space-y-2.5 min-w-0">
              {/* Block 1: Core Rule (1 sharp sentence) */}
              <p className="text-[13.5px] font-semibold leading-snug safe-wrap">
                {data.summary.coreRule}
              </p>

              {/* Block 2: 3 Color-Coded Coordinates (Formality · Attitude · Channel) */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span
                  className={`px-2 py-0.5 rounded-md border font-semibold ${toneColorForFormality(
                    data.summary.badges.formality
                  )}`}
                >
                  Độ trang trọng: {data.summary.badges.formality}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-md border font-semibold ${toneColorForAttitude(
                    data.summary.badges.attitude
                  )}`}
                >
                  Thái độ: {data.summary.badges.attitude}
                </span>
                <span className="px-2 py-0.5 rounded-md border zen-surface-subtle font-medium opacity-85">
                  Môi trường: {data.summary.badges.channel}
                </span>
              </div>

              {/* Block 3: 1 Instant Contrast Pair (✅ Dùng chuẩn — ❌ Dễ sai) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20 flex items-start gap-2 min-w-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-bold text-emerald-800 dark:text-emerald-300">
                      Dùng chuẩn:{' '}
                    </span>
                    <span className="opacity-90 safe-wrap">{data.summary.quickContrast.do}</span>
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-rose-500/8 border border-rose-500/20 flex items-start gap-2 min-w-0">
                  <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-bold text-rose-800 dark:text-rose-300">Dễ sai: </span>
                    <span className="opacity-90 safe-wrap">{data.summary.quickContrast.dont}</span>
                  </div>
                </div>
              </div>

              {/* Block 4: 1 In-Video Anchor Example (with Ruby Furigana / Oxford IPA + Audio) */}
              <div className="p-2.5 rounded-lg zen-surface-subtle border space-y-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-medium safe-wrap min-w-0">
                    {renderRubyOrHighlighted(
                      data.summary.anchorExample.sentence,
                      data.summary.anchorExample.highlightTerm,
                      lang,
                      data.summary.anchorExample.ruby
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => speakNative(data.summary.anchorExample.sentence, lang, 0.95)}
                    title="Nghe câu ví dụ đinh"
                    className="h-6 w-6 rounded-md hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center opacity-70 hover:opacity-100 shrink-0 cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] opacity-70">
                  {data.summary.anchorExample.readingOrIpa && (
                    <span className={lang === 'en' ? 'font-ipa' : 'font-jp-compact'}>
                      {data.summary.anchorExample.readingOrIpa}
                    </span>
                  )}
                  {data.summary.anchorExample.pitchAccent && (
                    <span className="font-mono-tabular font-semibold text-indigo-700 dark:text-indigo-300">
                      NHK Pitch: {data.summary.anchorExample.pitchAccent}
                    </span>
                  )}
                </div>
                <p className="text-xs opacity-75 safe-wrap">
                  {data.summary.anchorExample.translationVi}
                </p>
              </div>
            </div>
          ) : (
            /* =================================================================
               MODE 2: [🔬 CHUYÊN SÂU · TOÀN DIỆN] — 6 SCANNABLE ENCYCLOPEDIA CARDS
               ================================================================= */
            <div className="space-y-2.5 min-w-0">
              {/* Quick Core Rule Anchor Header */}
              <div className="p-2.5 rounded-lg bg-indigo-500/8 border border-indigo-500/20 text-xs leading-relaxed safe-wrap">
                <span className="font-bold text-indigo-700 dark:text-indigo-300">Chốt bản chất: </span>
                <span className="font-medium">{data.summary.coreRule}</span>
              </div>

              {/* 01. 4-Axis Nuance Spectrum Bars */}
              <div className="rounded-xl border zen-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('axes')}
                  className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs font-bold hover:bg-black/3 dark:hover:bg-white/5 cursor-pointer"
                >
                  <span>01. Biểu Đồ 4 Trục Tọa Độ Sắc Thái</span>
                  {openSections.axes ? (
                    <ChevronUp className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  )}
                </button>
                {openSections.axes && (
                  <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-black/5 dark:border-white/8">
                    <AxisBar
                      title="Cường độ cảm xúc (Intensity)"
                      axis={data.deepDive.axes.intensity}
                      accentClass="bg-amber-500"
                    />
                    <AxisBar
                      title={
                        lang === 'ja'
                          ? 'Khoảng cách & Uchi/Soto (Formality)'
                          : 'Độ trang trọng (Formality)'
                      }
                      axis={data.deepDive.axes.formality}
                      accentClass="bg-indigo-500"
                    />
                    <AxisBar
                      title="Sắc thái đánh giá (Connotation)"
                      axis={data.deepDive.axes.connotation}
                      accentClass="bg-emerald-500"
                    />
                    <AxisBar
                      title="Tần suất & Văn cảnh (Usage)"
                      axis={data.deepDive.axes.frequency}
                      accentClass="bg-teal-500"
                    />
                  </div>
                )}
              </div>

              {/* 02. In-Video Pragmatic Forensics & Cultural Subtext */}
              <div className="rounded-xl border zen-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('pragmatics')}
                  className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs font-bold hover:bg-black/3 dark:hover:bg-white/5 cursor-pointer"
                >
                  <span>02. Giải Phẫu Lý Do Chọn Từ Trong Đúng Cảnh Video</span>
                  {openSections.pragmatics ? (
                    <ChevronUp className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  )}
                </button>
                {openSections.pragmatics && (
                  <div className="px-3 pb-3 pt-2 space-y-2 border-t border-black/5 dark:border-white/8 text-xs leading-relaxed">
                    <p className="safe-wrap">{data.deepDive.inVideoPragmatics.whyChosenHereVi}</p>
                    <div className="p-2.5 rounded-lg zen-surface-subtle border space-y-1">
                      <div className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                        Tầng hàm ý văn hóa · {data.deepDive.inVideoPragmatics.culturalSubtextLabel}
                      </div>
                      <p className="opacity-85 safe-wrap">
                        {data.deepDive.inVideoPragmatics.culturalSubtextVi}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 03. Precision Contrast Matrix & Minimal Pair Swap Test */}
              <div className="rounded-xl border zen-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('matrix')}
                  className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs font-bold hover:bg-black/3 dark:hover:bg-white/5 cursor-pointer"
                >
                  <span>
                    03. Ma Trận Đối Chiếu ({data.deepDive.contrastMatrix.length} phương án) &amp;
                    Bài Test Thay Thế
                  </span>
                  {openSections.matrix ? (
                    <ChevronUp className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  )}
                </button>
                {openSections.matrix && (
                  <div className="px-3 pb-3 pt-2 space-y-2.5 border-t border-black/5 dark:border-white/8">
                    {data.deepDive.minimalPairSwap.frameSentence && (
                      <div className="p-2 rounded-lg zen-surface-subtle border text-xs space-y-0.5">
                        <div className="text-[11px] font-bold opacity-70">
                          Khung câu thử nghiệm (Minimal Pair Swap):
                        </div>
                        <div
                          className={`font-semibold safe-wrap ${
                            lang === 'ja' ? 'font-jp leading-[2.15]' : ''
                          }`}
                        >
                          {data.deepDive.minimalPairSwap.frameSentence}
                        </div>
                        {data.deepDive.minimalPairSwap.insightVi && (
                          <div className="text-[11px] opacity-75 safe-wrap">
                            {data.deepDive.minimalPairSwap.insightVi}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bi-directional overflow-safe horizontal table wrapper */}
                    <div className="overflow-x-auto max-w-full rounded-lg border border-black/8 dark:border-white/10">
                      <table className="w-full min-w-[480px] text-left border-collapse text-xs">
                        <thead>
                          <tr className="zen-surface-subtle border-b text-[11px] opacity-75">
                            <th className="py-2 px-2.5 font-semibold">Phương án</th>
                            <th className="py-2 px-2.5 font-semibold">Sắc thái lõi</th>
                            <th className="py-2 px-2.5 font-semibold">Lắp vào khung câu</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/8">
                          {data.deepDive.contrastMatrix.map((row, idx) => {
                            const verdictUi =
                              row.minimalPairVerdict === 'natural'
                                ? {
                                    text: 'Tự nhiên',
                                    cls: 'text-emerald-700 dark:text-emerald-300',
                                    icon: '✅',
                                  }
                                : row.minimalPairVerdict === 'awkward'
                                  ? {
                                      text: 'Hơi gượng',
                                      cls: 'text-amber-700 dark:text-amber-300',
                                      icon: '⚠',
                                    }
                                  : {
                                      text: 'Sai sắc thái',
                                      cls: 'text-rose-700 dark:text-rose-300',
                                      icon: '❌',
                                    };
                            return (
                              <tr key={`${row.term}_${idx}`} className="align-top">
                                <td className="py-2 px-2.5 space-y-0.5">
                                  <div
                                    className={`font-bold ${
                                      lang === 'ja' ? 'font-jp text-[13px]' : ''
                                    }`}
                                  >
                                    {row.term}
                                  </div>
                                  {row.readingOrIpa && (
                                    <div
                                      className={`text-[11px] opacity-65 ${
                                        lang === 'en' ? 'font-ipa' : 'font-jp-compact'
                                      }`}
                                    >
                                      {row.readingOrIpa}
                                    </div>
                                  )}
                                  {(row.hanViet || row.pitchAccent) && (
                                    <div className="text-[10px] opacity-70 font-mono-tabular">
                                      {[row.hanViet, row.pitchAccent].filter(Boolean).join(' · ')}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 px-2.5 space-y-1">
                                  <div className="font-medium safe-wrap">{row.coreNuanceVi}</div>
                                  <div className="text-[11px] opacity-70 safe-wrap">
                                    Khi dùng: {row.whenToUseVi}
                                  </div>
                                </td>
                                <td className="py-2 px-2.5 space-y-1">
                                  <div
                                    className={`font-medium safe-wrap ${
                                      lang === 'ja' ? 'font-jp leading-relaxed' : ''
                                    }`}
                                  >
                                    {row.minimalPairSentence}
                                  </div>
                                  <div className={`text-[11px] font-semibold ${verdictUi.cls}`}>
                                    {verdictUi.icon} {verdictUi.text}:{' '}
                                    <span className="font-normal opacity-90">
                                      {row.minimalPairNoteVi}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* 04. Collocation Lock & Vietnamese Cultural Traps */}
              <div className="rounded-xl border zen-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('traps')}
                  className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs font-bold hover:bg-black/3 dark:hover:bg-white/5 cursor-pointer"
                >
                  <span>04. Khóa Kết Hợp Từ (Collocation Lock) &amp; Bẫy Văn Hóa Người Việt</span>
                  {openSections.traps ? (
                    <ChevronUp className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  )}
                </button>
                {openSections.traps && (
                  <div className="px-3 pb-3 pt-2 space-y-2.5 border-t border-black/5 dark:border-white/8 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20 space-y-1">
                        <div className="font-bold text-emerald-800 dark:text-emerald-300 text-[11px]">
                          ✅ Nên đi kèm tự nhiên
                        </div>
                        <ul className="space-y-0.5 list-disc pl-4">
                          {data.deepDive.collocationAndTraps.mustPairWith.map((item, idx) => (
                            <li
                              key={idx}
                              className={`safe-wrap ${lang === 'ja' ? 'font-jp-compact' : ''}`}
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-2.5 rounded-lg bg-rose-500/8 border border-rose-500/20 space-y-1">
                        <div className="font-bold text-rose-800 dark:text-rose-300 text-[11px]">
                          ❌ Tuyệt đối tránh ghép
                        </div>
                        <ul className="space-y-0.5 list-disc pl-4">
                          {data.deepDive.collocationAndTraps.neverPairWith.map((item, idx) => (
                            <li
                              key={idx}
                              className={`safe-wrap ${lang === 'ja' ? 'font-jp-compact' : ''}`}
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 space-y-1">
                      <div className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5 text-[11px]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Bẫy văn hóa người Việt &amp; Hậu quả giao tiếp</span>
                      </div>
                      <p className="safe-wrap">
                        <strong>Bẫy dễ mắc:</strong>{' '}
                        {data.deepDive.collocationAndTraps.vietnameseCultureTrapVi}
                      </p>
                      <p className="opacity-85 safe-wrap">
                        <strong>Hậu quả khi nói nhầm:</strong>{' '}
                        {data.deepDive.collocationAndTraps.socialConsequenceVi}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 05. 3-Tier Tone Transformation */}
              <div className="rounded-xl border zen-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('tiers')}
                  className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs font-bold hover:bg-black/3 dark:hover:bg-white/5 cursor-pointer"
                >
                  <span>05. Lăng Kính Biến Hóa 3 Tầng Văn Phong (Đời thường ↔ Học thuật)</span>
                  {openSections.tiers ? (
                    <ChevronUp className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  )}
                </button>
                {openSections.tiers && (
                  <div className="px-3 pb-3 pt-2 space-y-2 border-t border-black/5 dark:border-white/8">
                    <ToneTierCard
                      tier={data.deepDive.threeTierTransform.casual}
                      language={lang}
                      dotColor="bg-emerald-500"
                      labelPrefix="Tầng Thân mật"
                    />
                    <ToneTierCard
                      tier={data.deepDive.threeTierTransform.standard}
                      language={lang}
                      dotColor="bg-sky-500"
                      labelPrefix="Tầng Chuẩn mực"
                    />
                    <ToneTierCard
                      tier={data.deepDive.threeTierTransform.formal}
                      language={lang}
                      dotColor="bg-violet-500"
                      labelPrefix="Tầng Trang trọng"
                    />
                  </div>
                )}
              </div>

              {/* 06. Interactive 15s Micro-Quiz + [+3 Tình Huống Sắc Thái Mới] */}
              <div className="rounded-xl border zen-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('practice')}
                  className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs font-bold hover:bg-black/3 dark:hover:bg-white/5 cursor-pointer"
                >
                  <span>06. Trắc Nghiệm 15 Giây &amp; Mở Rộng Tình Huống Thực Chiến</span>
                  {openSections.practice ? (
                    <ChevronUp className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  )}
                </button>
                {openSections.practice && (
                  <div className="px-3 pb-3 pt-2 space-y-3 border-t border-black/5 dark:border-white/8 text-xs">
                    {/* 15s Micro-Quiz */}
                    <div className="p-2.5 rounded-lg zen-surface-subtle border space-y-2">
                      <div className="font-semibold flex items-start gap-1.5">
                        <HelpCircle className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                        <span className="safe-wrap">{data.deepDive.microQuiz.situationVi}</span>
                      </div>
                      <div className="space-y-1.5">
                        {data.deepDive.microQuiz.options.map((opt, idx) => {
                          const answered = selectedQuizOpt !== null;
                          const isPicked = selectedQuizOpt === idx;
                          const isRight = idx === data.deepDive.microQuiz.correctIndex;
                          let cls =
                            'zen-surface border hover:border-indigo-400 text-left w-full px-2.5 py-2 rounded-lg transition-colors cursor-pointer flex items-center justify-between gap-2';
                          if (answered && isRight) {
                            cls =
                              'bg-emerald-500/15 border border-emerald-500 text-emerald-900 dark:text-emerald-200 text-left w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 font-semibold';
                          } else if (answered && isPicked && !isRight) {
                            cls =
                              'bg-rose-500/15 border border-rose-500 text-rose-900 dark:text-rose-200 text-left w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2';
                          }
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setSelectedQuizOpt(idx)}
                              className={cls}
                            >
                              <span
                                className={`safe-wrap ${
                                  lang === 'ja' ? 'font-jp-compact' : ''
                                }`}
                              >
                                {String.fromCharCode(65 + idx)}. {opt}
                              </span>
                              {answered && isRight && <Check className="w-3.5 h-3.5 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                      {selectedQuizOpt !== null && (
                        <p className="text-[11px] opacity-85 pt-1 leading-relaxed safe-wrap">
                          <strong>Giải thích:</strong> {data.deepDive.microQuiz.explanationVi}
                        </p>
                      )}
                    </div>

                    {/* [+3 Tình Huống Sắc Thái Mới] — Zero-Duplicate IndexedDB History */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={isExpandingScenarios}
                          onClick={() => void handleExpandThreeScenarios()}
                          className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                        >
                          {isExpandingScenarios ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          ) : (
                            <Plus className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>+3 Tình Huống Sắc Thái Mới</span>
                        </button>
                        {extraScenarios.length > 0 && (
                          <span className="text-[11px] font-mono-tabular opacity-65">
                            Đã mở rộng +{extraScenarios.length} tình huống không trùng lặp
                          </span>
                        )}
                      </div>

                      {expandError && (
                        <p className="text-[11px] text-rose-600 dark:text-rose-400">{expandError}</p>
                      )}

                      {extraScenarios.length > 0 && (
                        <div className="space-y-2">
                          {extraScenarios.map((sc, idx) => (
                            <div
                              key={`${sc.situationVi}_${idx}`}
                              className="p-2.5 rounded-lg zen-surface-subtle border space-y-1.5"
                            >
                              <div className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 safe-wrap">
                                Tình huống #{idx + 1}: {sc.situationVi}
                              </div>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                                    ✅ Nên nói:{' '}
                                  </span>
                                  <span
                                    className={`font-semibold safe-wrap ${
                                      lang === 'ja' ? 'font-jp leading-relaxed' : ''
                                    }`}
                                  >
                                    {sc.recommendedExpression}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => speakNative(sc.recommendedExpression, lang, 0.95)}
                                  className="h-6 w-6 rounded hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center shrink-0 cursor-pointer"
                                  title="Nghe phát âm"
                                >
                                  <Volume2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              {sc.readingOrIpa && (
                                <div
                                  className={`text-[11px] opacity-65 ${
                                    lang === 'en' ? 'font-ipa' : 'font-jp-compact'
                                  }`}
                                >
                                  {sc.readingOrIpa}
                                </div>
                              )}
                              <div className="text-[11px] safe-wrap">
                                <span className="font-semibold text-rose-700 dark:text-rose-300">
                                  ❌ Tránh dùng:{' '}
                                </span>
                                <span className="opacity-85">{sc.avoidExpression}</span>
                              </div>
                              <p className="text-[11px] opacity-80 safe-wrap">
                                {sc.translationVi} — {sc.whyVi}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
};
