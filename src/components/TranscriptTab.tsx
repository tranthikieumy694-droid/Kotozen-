import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  Crosshair,
  FileUp,
  Loader2,
  Mic,
  Repeat1,
  ScanSearch,
  Search,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import type {
  Language,
  ProficiencyLevel,
  SourceLanguage,
  SubtitleLine,
  SubtitleSourceLayer,
} from '../types';
import { formatTime } from '../lib/youtube';
import { isPureTargetLanguage } from '../lib/languagePurity';
import { stripHtmlAndRubyArtifacts } from '../lib/compactUnpacker';

interface TranscriptTabProps {
  lines: SubtitleLine[];
  activeLineId: string | null;
  language: Language;
  sourceLanguage?: SourceLanguage;
  sourceLayer?: SubtitleSourceLayer;
  targetLevel?: ProficiencyLevel;
  showTranslationVi: boolean;
  isEnrichingBackground: boolean;
  enrichedCount: number;
  videoDurationSec?: number;
  currentTimeSec?: number;
  hasMoreStt?: boolean;
  isHarvestingStt?: boolean;
  aiAudioRestricted?: boolean;
  isTabAudioListening?: boolean;
  onToggleTabAudioCapture?: () => void;
  onOpenManualSrt?: () => void;
  slaProgress?: {
    startedAtMs: number | null;
    completedInSec: number | null;
    etaSec: number | null;
    emaCuesPerSec: number;
  };
  onJumpToLine: (line: SubtitleLine) => void;
  onRepeatLine: (line: SubtitleLine) => void;
  onOpenXRay: (line: SubtitleLine) => void;
  weaknessTerms?: string[];
}

const ESTIMATED_ROW_HEIGHT = 78;
const OVERSCAN_COUNT = 8;

interface TranscriptRowProps {
  line: SubtitleLine;
  rowIndex: number;
  isActive: boolean;
  ready: boolean;
  language: Language;
  targetLabel: string;
  showTranslationVi: boolean;
  matchedWeaknessTerm?: string | null;
  onJumpToLine: (line: SubtitleLine) => void;
  onRepeatLine: (line: SubtitleLine) => void;
  onOpenXRay: (line: SubtitleLine) => void;
  onMeasureHeight: (index: number, height: number) => void;
}

/**
 * Memoized Transcript Row — Guarantees ONLY the 2 changed rows (previous active + newly active)
 * re-render on each subtitle tick, sustaining smooth 60 FPS even on 90-minute podcasts.
 */
const TranscriptRow = React.memo<TranscriptRowProps>(
  ({
    line,
    rowIndex,
    isActive,
    ready,
    language,
    targetLabel,
    showTranslationVi,
    matchedWeaknessTerm,
    onJumpToLine,
    onRepeatLine,
    onOpenXRay,
    onMeasureHeight,
  }) => {
    const rowRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const el = rowRef.current;
      if (!el) return;
      const report = () => {
        const h = el.getBoundingClientRect().height;
        if (h > 20) {
          onMeasureHeight(rowIndex, Math.ceil(h));
        }
      };
      report();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(report);
      ro.observe(el);
      return () => ro.disconnect();
    }, [rowIndex, line.text, line.translationVi, showTranslationVi, ready, onMeasureHeight]);

    return (
      <div
        ref={rowRef}
        onClick={() => onJumpToLine(line)}
        className={`group px-3.5 py-3 border-b border-black/5 dark:border-white/8 transition-colors cursor-pointer ${
          isActive ? 'bg-indigo-500/10' : 'hover:bg-black/3 dark:hover:bg-white/4'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] opacity-55 font-mono-tabular">
              <span
                className={
                  isActive ? 'text-indigo-600 dark:text-indigo-400 font-semibold opacity-100' : ''
                }
              >
                {formatTime(line.start)}
              </span>
              <span aria-hidden="true">·</span>
              <span>#{line.index + 1}</span>
              {matchedWeaknessTerm && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className="font-vi font-semibold text-amber-700 dark:text-amber-300 opacity-100 inline-flex items-center gap-1"
                    title={`Điểm cần củng cố gặp lại trong video này: ${matchedWeaknessTerm}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Cần củng cố: {matchedWeaknessTerm}
                  </span>
                </>
              )}
            </div>

            {ready ? (
              <>
                <p
                  className={`text-sm leading-relaxed safe-wrap ${
                    language === 'ja' ? 'font-jp' : ''
                  } ${isActive ? 'font-semibold' : 'opacity-90'}`}
                >
                  {stripHtmlAndRubyArtifacts(line.text)}
                </p>

                {showTranslationVi && line.translationVi && (
                  <p className="text-[11px] opacity-55 leading-relaxed safe-wrap">
                    {line.translationVi}
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-xs opacity-60 italic">
                <Loader2 className="w-3 h-3 animate-spin text-indigo-500 shrink-0" />
                <span>Đang chuyển ngữ sang {targetLabel}...</span>
              </div>
            )}
          </div>

          {/* Per-line quick actions */}
          {ready && (
            <div
              className="flex items-center gap-1 shrink-0 opacity-75 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onRepeatLine(line)}
                title="Lặp câu này"
                className="w-7 h-7 flex items-center justify-center rounded-md opacity-70 hover:opacity-100 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <Repeat1 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onOpenXRay(line)}
                title="Giải phẫu cú pháp câu này"
                className="w-7 h-7 flex items-center justify-center rounded-md opacity-70 hover:opacity-100 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <ScanSearch className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.isActive === next.isActive &&
    prev.ready === next.ready &&
    prev.showTranslationVi === next.showTranslationVi &&
    prev.matchedWeaknessTerm === next.matchedWeaknessTerm &&
    prev.language === next.language &&
    prev.targetLabel === next.targetLabel &&
    prev.rowIndex === next.rowIndex &&
    prev.line.id === next.line.id &&
    prev.line.text === next.line.text &&
    prev.line.translationVi === next.line.translationVi &&
    prev.line.enriched === next.line.enriched
);

TranscriptRow.displayName = 'TranscriptRow';

export const TranscriptTab: React.FC<TranscriptTabProps> = ({
  lines,
  activeLineId,
  language,
  sourceLanguage = 'en',
  sourceLayer,
  targetLevel,
  showTranslationVi,
  isEnrichingBackground,
  enrichedCount,
  videoDurationSec,
  currentTimeSec = 0,
  hasMoreStt = false,
  isHarvestingStt = false,
  aiAudioRestricted = false,
  isTabAudioListening = false,
  onToggleTabAudioCapture,
  onOpenManualSrt,
  slaProgress,
  onJumpToLine,
  onRepeatLine,
  onOpenXRay,
  weaknessTerms = [],
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [userScrollPaused, setUserScrollPaused] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const userScrollPauseTimerRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const heightCacheRef = useRef<Map<number, number>>(new Map());
  const [measureVersion, setMeasureVersion] = useState(0);

  const targetLabel =
    language === 'ja'
      ? `Tiếng Nhật${targetLevel ? ` (${targetLevel})` : ''}`
      : `Tiếng Anh${targetLevel ? ` (${targetLevel})` : ''}`;

  // Pause auto-scroll for 4 seconds whenever user manually scrolls/drags the transcript list
  const triggerManualScrollPause = useCallback(() => {
    setUserScrollPaused(true);
    if (userScrollPauseTimerRef.current !== null) {
      window.clearTimeout(userScrollPauseTimerRef.current);
    }
    userScrollPauseTimerRef.current = window.setTimeout(() => {
      setUserScrollPaused(false);
      userScrollPauseTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (userScrollPauseTimerRef.current !== null) {
        window.clearTimeout(userScrollPauseTimerRef.current);
      }
    };
  }, []);

  const isLineReadyTarget = useCallback(
    (line: SubtitleLine) => {
      if (!line.text.trim()) return false;
      if (sourceLanguage === 'vi') {
        return Boolean(line.enriched) && isPureTargetLanguage(line.text, language, line.rawText);
      }
      return true;
    },
    [language, sourceLanguage]
  );

  const filteredLines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        (isLineReadyTarget(l) && l.text.toLowerCase().includes(q)) ||
        (showTranslationVi && l.translationVi.toLowerCase().includes(q)) ||
        l.tokens.some(
          (t) =>
            t.surface.toLowerCase().includes(q) ||
            (t.furigana && t.furigana.toLowerCase().includes(q))
        )
    );
  }, [lines, searchQuery, showTranslationVi, isLineReadyTarget]);

  // Reset measured height cache when search or list identity changes significantly
  useEffect(() => {
    heightCacheRef.current.clear();
    setMeasureVersion((v) => v + 1);
  }, [searchQuery, language, showTranslationVi, lines.length === 0]);

  // Track viewport container height via ResizeObserver for accurate virtualization window
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const updateSize = () => {
      const h = container.clientHeight;
      if (h > 100) setViewportHeight(h);
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(updateSize);
    obs.observe(container);
    return () => obs.disconnect();
  }, [lines.length > 0]);

  const handleMeasureHeight = useCallback((index: number, height: number) => {
    const prev = heightCacheRef.current.get(index);
    if (prev === undefined || Math.abs(prev - height) >= 3) {
      heightCacheRef.current.set(index, height);
      setMeasureVersion((v) => v + 1);
    }
  }, []);

  // Prefix-sum offset table for O(log n) virtual scroll lookups across thousands of rows
  const { offsets, totalHeight } = useMemo(() => {
    const count = filteredLines.length;
    const arr = new Float64Array(count + 1);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      arr[i] = sum;
      sum += heightCacheRef.current.get(i) ?? ESTIMATED_ROW_HEIGHT;
    }
    arr[count] = sum;
    return { offsets: arr, totalHeight: sum };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLines.length, measureVersion]);

  // Binary search first visible row index for current scrollTop
  const { startIndex, endIndex, topSpacerHeight } = useMemo(() => {
    const count = filteredLines.length;
    if (count === 0) return { startIndex: 0, endIndex: -1, topSpacerHeight: 0 };

    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }

    const start = Math.max(0, lo - OVERSCAN_COUNT);
    const maxY = scrollTop + viewportHeight;
    let end = lo;
    while (end < count - 1 && offsets[end] < maxY) {
      end++;
    }
    end = Math.min(count - 1, end + OVERSCAN_COUNT);

    return {
      startIndex: start,
      endIndex: end,
      topSpacerHeight: offsets[start] || 0,
    };
  }, [filteredLines.length, offsets, scrollTop, viewportHeight]);

  const activeRowIndex = useMemo(() => {
    if (!activeLineId) return -1;
    return filteredLines.findIndex((l) => l.id === activeLineId);
  }, [activeLineId, filteredLines]);

  const isActiveRowInView = useMemo(() => {
    if (activeRowIndex === -1) return true;
    const rowTop = offsets[activeRowIndex] ?? activeRowIndex * ESTIMATED_ROW_HEIGHT;
    const rowHeight = heightCacheRef.current.get(activeRowIndex) ?? ESTIMATED_ROW_HEIGHT;
    return rowTop + rowHeight >= scrollTop + 12 && rowTop <= scrollTop + viewportHeight - 12;
  }, [activeRowIndex, offsets, scrollTop, viewportHeight]);

  const scrollToActiveRow = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const container = scrollContainerRef.current;
      if (!container || activeRowIndex === -1) return;
      const rowTop = offsets[activeRowIndex] ?? activeRowIndex * ESTIMATED_ROW_HEIGHT;
      const rowHeight = heightCacheRef.current.get(activeRowIndex) ?? ESTIMATED_ROW_HEIGHT;
      const targetTop = Math.max(0, rowTop - container.clientHeight / 2 + rowHeight / 2);
      container.scrollTo({ top: targetTop, behavior });
    },
    [activeRowIndex, offsets]
  );

  // Smooth Virtualized Auto-Scroll to center active spoken line ONLY when activeRowIndex genuinely exists at t
  useEffect(() => {
    if (!autoScroll || userScrollPaused || searchQuery.trim() || activeRowIndex === -1) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const rowTop = offsets[activeRowIndex] ?? activeRowIndex * ESTIMATED_ROW_HEIGHT;
    const rowHeight = heightCacheRef.current.get(activeRowIndex) ?? ESTIMATED_ROW_HEIGHT;
    const targetTop = Math.max(0, rowTop - container.clientHeight / 2 + rowHeight / 2);
    const delta = Math.abs(container.scrollTop - targetTop);

    // For large seeks (e.g. 00:30 -> 11:10), jump immediately so mounted rows measure cleanly without overshoot
    if (delta > container.clientHeight * 1.5) {
      container.scrollTop = targetTop;
      setScrollTop(targetTop);
    } else if (delta > rowHeight * 0.5) {
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [activeRowIndex, autoScroll, userScrollPaused, searchQuery, offsets, measureVersion]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleRelockToActiveLine = useCallback(() => {
    if (userScrollPauseTimerRef.current !== null) {
      window.clearTimeout(userScrollPauseTimerRef.current);
      userScrollPauseTimerRef.current = null;
    }
    setUserScrollPaused(false);
    setAutoScroll(true);
    scrollToActiveRow('smooth');
  }, [scrollToActiveRow]);

  if (lines.length === 0) {
    return (
      <div className="py-12 px-5 text-center text-sm opacity-80">
        {isEnrichingBackground || isHarvestingStt ? (
          <div className="inline-flex flex-col items-center gap-2 text-teal-700 dark:text-teal-300">
            <div className="inline-flex items-center gap-2 font-semibold">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>
                {sourceLayer === 'stt_ai'
                  ? `✨ AI đang nghe & tạo phụ đề ${targetLabel} trực tiếp (1.5–3s)...`
                  : `⚡ Đang tạo phụ đề ${targetLabel}...`}
              </span>
            </div>
            <p className="text-[11px] opacity-70 max-w-xs leading-relaxed">
              Video sẵn sàng phát ngay — câu phụ đề đầu tiên sẽ xả thẳng lên khung hình ngay khi AI nghe thấy lời thoại.
            </p>
          </div>
        ) : aiAudioRestricted || isTabAudioListening ? (
          <div className="max-w-xs mx-auto text-left p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 space-y-3">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                  {isTabAudioListening
                    ? 'AI đang nghe âm thanh tab & tạo phụ đề trực tiếp...'
                    : 'Video giới hạn đọc luồng từ xa'}
                </p>
                <p className="text-[11px] opacity-75 leading-relaxed">
                  {isTabAudioListening
                    ? 'Hãy bấm Phát video YouTube bên trái. Phụ đề sạch 100% sẽ tự xuất hiện sau mỗi 8–10 giây thoại.'
                    : 'Bật AI nghe trực tiếp luồng tiếng của tab đang phát hoặc nạp tệp .SRT thủ công để học ngay.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onToggleTabAudioCapture && (
                <button
                  type="button"
                  onClick={onToggleTabAudioCapture}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    isTabAudioListening
                      ? 'bg-rose-600 hover:bg-rose-700 text-white'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  }`}
                >
                  {isTabAudioListening ? (
                    <>
                      <Square className="w-3 h-3 fill-current" />
                      <span>Dừng nghe trực tiếp</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5" />
                      <span>Bật AI nghe &amp; tạo phụ đề trực tiếp</span>
                    </>
                  )}
                </button>
              )}
              {onOpenManualSrt && (
                <button
                  type="button"
                  onClick={onOpenManualSrt}
                  className="h-8 px-2.5 rounded-lg text-xs font-medium zen-surface-subtle border inline-flex items-center gap-1.5 cursor-pointer hover:opacity-100 opacity-85"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  <span>Nạp .SRT thủ công</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          'Toàn bộ bảng phụ đề đồng bộ thời gian thực sẽ hiển thị tại đây sau khi bạn nạp video YouTube hoặc tải lên file .srt / .vtt.'
        )}
      </div>
    );
  }

  const visibleSlice =
    endIndex >= startIndex ? filteredLines.slice(startIndex, endIndex + 1) : [];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search & Auto-Scroll Toolbar */}
      <div className="p-3 border-b border-black/5 dark:border-white/10 flex items-center gap-2 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 opacity-45 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Tìm từ ${language === 'ja' ? 'Tiếng Nhật / Furigana' : 'Tiếng Anh'} trong video...`}
            className="w-full h-8 pl-8 pr-7 text-xs rounded-lg zen-surface-subtle border focus:outline-none focus:border-indigo-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Xóa tìm kiếm"
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAutoScroll((v) => !v)}
          title="Tự động cuộn theo câu đang phát"
          className={`h-8 px-2.5 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            autoScroll
              ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300'
              : 'zen-surface-subtle opacity-70'
          }`}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          <span>Tự cuộn</span>
        </button>
      </div>

      {/* Zen Live Readiness Heat-Bar + AI Auto-Subtitle Status Strip */}
      {lines.length > 0 &&
        (() => {
          const safeDone = Math.min(lines.length, enrichedCount);
          const lastLineEnd = lines[lines.length - 1]?.end || 0;
          const totalDurationSec = Math.max(videoDurationSec || 0, lastLineEnd, 1);
          const isAiAutoSub = sourceLayer === 'stt_ai';

          let contiguousEnd = 0;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].enriched) {
              contiguousEnd = lines[i].end;
            } else {
              break;
            }
          }
          const coveredSec = Math.min(
            totalDurationSec,
            safeDone >= lines.length
              ? lastLineEnd
              : Math.max(
                  contiguousEnd,
                  Math.round((safeDone / Math.max(1, lines.length)) * lastLineEnd)
                )
          );

          const durationCovered = totalDurationSec <= 25 || lastLineEnd >= totalDurationSec - 20;
          const isComplete =
            !isEnrichingBackground &&
            !hasMoreStt &&
            !isHarvestingStt &&
            !isTabAudioListening &&
            safeDone >= lines.length &&
            durationCovered;

          const timeRatio = totalDurationSec > 0 ? Math.min(1, coveredSec / totalDurationSec) : 1;
          const lineRatio = lines.length > 0 ? Math.min(1, safeDone / lines.length) : 0;
          const combinedPct = isComplete
            ? 100
            : Math.min(
                99,
                Math.max(
                  2,
                  Math.round(
                    (hasMoreStt || !durationCovered ? timeRatio : lineRatio) * 100
                  )
                )
              );

          // Build 48-bucket Live Readiness Heat-Bar across [0 .. totalDurationSec]
          const BUCKETS = 48;
          const bucketReady = new Uint8Array(BUCKETS);
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (!l.enriched) continue;
            const bStart = Math.max(0, Math.min(BUCKETS - 1, Math.floor((l.start / totalDurationSec) * BUCKETS)));
            const bEnd = Math.max(bStart, Math.min(BUCKETS - 1, Math.floor((l.end / totalDurationSec) * BUCKETS)));
            for (let b = bStart; b <= bEnd; b++) {
              bucketReady[b] = 1;
            }
          }
          const playheadPct = Math.max(0, Math.min(100, (currentTimeSec / totalDurationSec) * 100));

          const formatEtaShort = (sec: number): string => {
            if (sec < 60) return `~${sec} giây`;
            const mins = Math.floor(sec / 60);
            const rem = sec % 60;
            return rem > 0 ? `~${mins} phút ${rem} giây` : `~${mins} phút`;
          };

          const formatElapsedMmSs = (sec: number): string => {
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          };

          if (isComplete) {
            const completedText =
              slaProgress?.completedInSec && slaProgress.completedInSec > 0
                ? ` · ${formatElapsedMmSs(slaProgress.completedInSec)}`
                : '';
            return (
              <div className="px-3.5 py-1.5 bg-teal-500/8 border-b border-teal-500/15 flex items-center justify-between gap-2 text-[11px] text-teal-800 dark:text-teal-300 shrink-0 min-w-0 overflow-x-clip">
                <span className="flex items-center gap-1.5 font-medium truncate min-w-0">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {isAiAutoSub
                      ? `✓ AI đã hoàn thiện 100% phụ đề toàn video (${formatTime(totalDurationSec)})`
                      : `✓ Hoàn tất 100% phụ đề toàn video (${formatTime(totalDurationSec)} · ${lines.length.toLocaleString('vi-VN')} câu${completedText})`}
                  </span>
                </span>
              </div>
            );
          }

          const etaFragment =
            slaProgress?.etaSec && slaProgress.etaSec > 0
              ? ` · Xong toàn bộ sau ${formatEtaShort(slaProgress.etaSec)}`
              : '';

          return (
            <div className="bg-teal-500/[0.06] dark:bg-teal-400/[0.06] border-b border-teal-500/15 shrink-0 min-w-0 overflow-x-clip">
              <div className="px-3.5 py-1.5 flex items-center justify-between gap-2 text-[11px] text-teal-900 dark:text-teal-200 min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  {isAiAutoSub ? (
                    <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0 animate-pulse" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 animate-spin shrink-0" />
                  )}
                  <span className="truncate">
                    {isAiAutoSub ? (
                      <>
                        ✨ AI Tạo Phụ Đề Trực Tiếp · Đã hoàn tất{' '}
                        <strong className="font-mono-tabular">
                          {formatTime(coveredSec)} / {formatTime(totalDurationSec)} ({combinedPct}%)
                        </strong>{' '}
                        — Xem ngay &amp; tua bất kỳ phút nào
                      </>
                    ) : (
                      <>
                        ⚡ Học ngay · Đã sẵn sàng{' '}
                        <strong className="font-mono-tabular">
                          {formatTime(coveredSec)} / {formatTime(totalDurationSec)}
                        </strong>
                        {etaFragment}
                      </>
                    )}
                  </span>
                </span>

                {isTabAudioListening && onToggleTabAudioCapture && (
                  <button
                    type="button"
                    onClick={onToggleTabAudioCapture}
                    className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-semibold shrink-0 cursor-pointer inline-flex items-center gap-1"
                  >
                    <Square className="w-2.5 h-2.5 fill-current" />
                    <span>Dừng nghe</span>
                  </button>
                )}
              </div>

              {/* Ultra-slim Live Readiness Heat-Bar showing exact ready segments across full timeline */}
              <div
                className="relative h-[4px] w-full bg-black/8 dark:bg-white/10 flex overflow-hidden"
                title={`Độ phủ sẵn sàng theo dòng thời gian: ${combinedPct}%`}
              >
                {Array.from({ length: BUCKETS }, (_, bIdx) => (
                  <div
                    key={bIdx}
                    className={`flex-1 h-full transition-colors duration-300 ${
                      bucketReady[bIdx] ? 'bg-emerald-500/85 dark:bg-emerald-400/85' : 'bg-transparent'
                    }`}
                  />
                ))}
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-indigo-600 dark:bg-white shadow-sm pointer-events-none"
                  style={{ left: `calc(${playheadPct}% - 1px)` }}
                />
              </div>
            </div>
          );
        })()}

      {/* Inline Restricted Fallback Bar if lines already exist partially or user wants live Tab Audio */}
      {lines.length > 0 && aiAudioRestricted && !isTabAudioListening && onToggleTabAudioCapture && (
        <div className="px-3.5 py-2 bg-indigo-500/8 border-b border-indigo-500/15 flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0">
          <span className="opacity-80">Video giới hạn đọc tự động từ xa.</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleTabAudioCapture}
              className="h-6 px-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Mic className="w-3 h-3" />
              <span>Bật AI nghe trực tiếp</span>
            </button>
            {onOpenManualSrt && (
              <button
                type="button"
                onClick={onOpenManualSrt}
                className="h-6 px-2 rounded-md zen-surface-subtle border font-medium inline-flex items-center gap-1 cursor-pointer"
              >
                <FileUp className="w-3 h-3" />
                <span>.SRT</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search result count */}
      {searchQuery.trim() && (
        <div className="px-3.5 py-1.5 text-[11px] opacity-65 border-b border-black/5 dark:border-white/10 shrink-0">
          Tìm thấy <span className="font-mono-tabular font-semibold">{filteredLines.length}</span> câu khớp — bấm để nhảy thẳng tới giây đó.
        </div>
      )}

      {/* 60 FPS Virtualized Synchronized Transcript List + 4s Manual Scroll Respect */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onWheel={triggerManualScrollPause}
          onTouchStart={triggerManualScrollPause}
          className="flex-1 overflow-y-auto zen-scroll relative"
        >
        {filteredLines.length > 0 ? (
          <div style={{ height: `${Math.max(totalHeight, 1)}px`, position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${topSpacerHeight}px)`,
                willChange: 'transform',
              }}
            >
              {visibleSlice.map((line, localIdx) => {
                const absIndex = startIndex + localIdx;
                const ready = isLineReadyTarget(line);
                let matchedWeaknessTerm: string | null = null;
                if (ready && weaknessTerms.length > 0 && line.text) {
                  const lowerText = line.text.toLowerCase();
                  for (const term of weaknessTerms) {
                    if (term.length >= 2 && lowerText.includes(term.toLowerCase())) {
                      matchedWeaknessTerm = term;
                      break;
                    }
                  }
                }
                return (
                  <TranscriptRow
                    key={line.id}
                    line={line}
                    rowIndex={absIndex}
                    isActive={line.id === activeLineId}
                    ready={ready}
                    language={language}
                    targetLabel={targetLabel}
                    showTranslationVi={showTranslationVi}
                    matchedWeaknessTerm={matchedWeaknessTerm}
                    onJumpToLine={onJumpToLine}
                    onRepeatLine={onRepeatLine}
                    onOpenXRay={onOpenXRay}
                    onMeasureHeight={handleMeasureHeight}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="py-12 px-6 text-center text-xs opacity-65">
            Không tìm thấy câu nào chứa “{searchQuery}”.
          </div>
        )}
        </div>

        {/* 0ms Re-Lock Button whenever user scrolled away from the currently spoken sentence */}
        {!searchQuery.trim() &&
          activeRowIndex !== -1 &&
          (!isActiveRowInView || userScrollPaused || !autoScroll) && (
            <div className="pointer-events-none absolute bottom-3 inset-x-0 flex justify-center z-10 px-3">
              <button
                type="button"
                onClick={handleRelockToActiveLine}
                className="pointer-events-auto h-8 px-3.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-lg flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95"
              >
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                <span>Quay về đúng câu đang nói</span>
              </button>
            </div>
          )}
      </div>
    </div>
  );
};
