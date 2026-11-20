import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  CheckCircle2,
  Compass,
  GitBranch,
  Layers,
  Loader2,
  Network,
  Plus,
  RotateCcw,
  ShieldAlert,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  CollocationTier,
  DetectedCollocation,
  Language,
  NuanceDualPayload,
  ProficiencyLevel,
  SubtitleLine,
  SubtitleToken,
  WordExtraCollocation,
  WordProfile,
} from '../types';
import { speakNative } from '../lib/youtube';
import { fetchMoreWordCollocations } from '../lib/api';
import {
  listCollocationHistoryExpressions,
  recordCollocationHistoryExpressions,
} from '../lib/db';
import { PitchAccentSvg } from './PitchAccentSvg';
import { DualModeNuancePanel } from './DualModeNuancePanel';

interface WordProfilePopoverProps {
  language: Language;
  activeToken: SubtitleToken;
  activeLine: SubtitleLine;
  profile: WordProfile | null;
  isLoading: boolean;
  error: string | null;
  isSaved: boolean;
  onClose: () => void;
  onSaveCard: (profile: WordProfile) => void;
  onReplayLine: () => void;
  // Feature 21: Atomic Collocation + Core-Word Map jump
  isDetectedCollocationSaved?: boolean;
  onSaveDetectedCollocation?: (col: DetectedCollocation, line: SubtitleLine) => void;
  onOpenCollocationWeb?: (coreWord: string) => void;
  // Save extra expanded collocation directly to FSRS
  savedTermKeys?: Set<string>;
  onSaveExtraCollocation?: (col: WordExtraCollocation, line: SubtitleLine) => void;
  // Dual-Mode Nuance Explanation (Summary 3s <-> Deep Dive 6-Dimension Dossier)
  targetLevel?: ProficiencyLevel;
  videoTitle?: string;
  prevSentence?: string;
  nextSentence?: string;
  onSaveNuanceDualCard?: (
    payload: NuanceDualPayload,
    context?: { timestamp?: number; sentence?: string; sentenceVi?: string }
  ) => void;
}

const TIER_META: Record<
  CollocationTier,
  { dot: string; label: string; shortLabel: string; accent: string; activeBg: string }
> = {
  casual: {
    dot: 'bg-emerald-500',
    label: 'Tầng 1 · Đời thường',
    shortLabel: 'Đời thường',
    accent: 'text-emerald-700 dark:text-emerald-300',
    activeBg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-200',
  },
  natural: {
    dot: 'bg-sky-500',
    label: 'Tầng 2 · Tự nhiên bản xứ',
    shortLabel: 'Tự nhiên',
    accent: 'text-sky-700 dark:text-sky-300',
    activeBg: 'bg-sky-500/15 border-sky-500/40 text-sky-800 dark:text-sky-200',
  },
  academic: {
    dot: 'bg-violet-500',
    label: 'Tầng 3 · Học thuật / Cao cấp',
    shortLabel: 'Học thuật',
    accent: 'text-violet-700 dark:text-violet-300',
    activeBg: 'bg-violet-500/15 border-violet-500/40 text-violet-800 dark:text-violet-200',
  },
};

export const WordProfilePopover: React.FC<WordProfilePopoverProps> = ({
  language,
  activeToken,
  activeLine,
  profile,
  isLoading,
  error,
  isSaved,
  onClose,
  onSaveCard,
  onReplayLine,
  isDetectedCollocationSaved = false,
  onSaveDetectedCollocation,
  onOpenCollocationWeb,
  savedTermKeys,
  onSaveExtraCollocation,
  targetLevel,
  videoTitle,
  prevSentence,
  nextSentence,
  onSaveNuanceDualCard,
}) => {
  const [ladderTier, setLadderTier] = useState<CollocationTier>('natural');
  const [showContextCompare, setShowContextCompare] = useState(false);
  const [extraCollocations, setExtraCollocations] = useState<WordExtraCollocation[]>([]);
  const [isLoadingMoreCols, setIsLoadingMoreCols] = useState(false);
  const [moreColsError, setMoreColsError] = useState<string | null>(null);
  const moreColsAbortRef = useRef<AbortController | null>(null);

  // Strict 1:1 Token Verification: never render a stale card from another token
  const verifiedProfile =
    profile && profile.tokenId === activeToken.id ? profile : null;

  // Reset extra collocations cleanly whenever clicked token changes
  useEffect(() => {
    moreColsAbortRef.current?.abort();
    setExtraCollocations([]);
    setMoreColsError(null);
    setIsLoadingMoreCols(false);
    setShowContextCompare(false);
    return () => {
      moreColsAbortRef.current?.abort();
    };
  }, [activeToken.id, language]);

  const detectedCol = verifiedProfile?.detectedCollocation;
  const ladder = verifiedProfile?.upgradeLadder;
  const activeLadderVariant = ladder ? ladder[ladderTier] : null;
  const coreWordForMap = verifiedProfile?.lemma || activeToken.lemma || activeToken.surface;

  const handleLoadThreeMoreCollocations = async () => {
    if (!verifiedProfile || isLoadingMoreCols) return;
    moreColsAbortRef.current?.abort();
    const ctrl = new AbortController();
    moreColsAbortRef.current = ctrl;
    setIsLoadingMoreCols(true);
    setMoreColsError(null);

    try {
      const history = await listCollocationHistoryExpressions(language);
      const localExcludes = [
        ...(verifiedProfile.collocations || []),
        ...(detectedCol ? [detectedCol.phrase] : []),
        ...(ladder
          ? [ladder.casual.expression, ladder.natural.expression, ladder.academic.expression]
          : []),
        ...extraCollocations.map((e) => e.expression),
        ...history,
      ];
      const { items } = await fetchMoreWordCollocations(
        {
          word: coreWordForMap,
          language,
          excludeExpressions: Array.from(new Set(localExcludes)).slice(0, 60),
        },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      if (items.length > 0) {
        setExtraCollocations((prev) => [...prev, ...items]);
        void recordCollocationHistoryExpressions(
          language,
          items.map((it) => it.expression)
        );
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setMoreColsError(err instanceof Error ? err.message : 'Chưa thể tải thêm cụm từ mới.');
    } finally {
      if (!ctrl.signal.aborted) {
        setIsLoadingMoreCols(false);
      }
    }
  };

  return (
    <>
      {/* Mobile Bottom Sheet Backdrop (<768px) */}
      <div
        className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-xs md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Responsive Container: Mobile Bottom Sheet (<768px) / Desktop Edge-Safe Anchored Card (>=768px) */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto zen-scroll rounded-t-2xl md:static md:z-auto md:max-h-none md:overflow-visible md:mt-3 md:rounded-xl zen-surface border shadow-2xl md:shadow-lg p-4 md:p-5 transition-all min-w-0 max-w-full"
        role="dialog"
        aria-label={`Hồ sơ từ vựng 5 lớp ${activeToken.surface}`}
      >
        {/* Mobile drag handle indicator */}
        <div className="w-10 h-1 rounded-full bg-black/15 dark:bg-white/20 mx-auto mb-3 md:hidden" />

        {/* Header row */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-black/5 dark:border-white/10">
          <div className="min-w-0">
            <div className="flex items-baseline flex-wrap gap-x-2.5 gap-y-1">
              <h3
                className={`text-xl font-bold safe-wrap ${
                  language === 'ja' ? 'font-jp-compact' : ''
                }`}
              >
                {verifiedProfile?.lemma || activeToken.lemma || activeToken.surface}
              </h3>
              {verifiedProfile && verifiedProfile.surface !== verifiedProfile.lemma && (
                <span className="text-xs opacity-65">
                  trong câu:{' '}
                  <span className={`font-semibold ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                    {verifiedProfile.surface}
                  </span>
                </span>
              )}
            </div>

            {/* Clean unboxed typographic metadata */}
            <div className="mt-1 flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs opacity-70">
              {verifiedProfile ? (
                <>
                  <span className="font-semibold">{verifiedProfile.partOfSpeech}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    {language === 'ja'
                      ? `JLPT ${verifiedProfile.level}`
                      : `CEFR ${verifiedProfile.level}`}
                  </span>
                  {verifiedProfile.isIeltsAcademic && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-teal-600 dark:text-teal-400">
                        IELTS Academic
                      </span>
                    </>
                  )}
                  {verifiedProfile.phraseType && verifiedProfile.phraseType !== 'Từ đơn' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{verifiedProfile.phraseType}</span>
                    </>
                  )}
                </>
              ) : (
                <span>Đang giải phẫu hồ sơ 5 lớp (Ngữ cảnh · Từ nguyên · Gia đình từ · Collocations)...</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                speakNative(
                  verifiedProfile?.lemma || activeToken.surface,
                  language,
                  0.95,
                  language === 'ja' ? verifiedProfile?.furigana || activeToken.furigana : undefined
                )
              }
              title="Nghe phát âm bản xứ"
              className="h-8 px-2.5 text-xs font-medium zen-surface-subtle border hover:border-indigo-500 rounded-lg flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Nghe</span>
            </button>

            <button
              type="button"
              onClick={onReplayLine}
              title="Phát lại câu này trong video"
              className="h-8 px-2.5 text-xs font-medium zen-surface-subtle border hover:border-indigo-500 rounded-lg flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Câu gốc</span>
            </button>

            {verifiedProfile && (
              <button
                type="button"
                onClick={() => onSaveCard(verifiedProfile)}
                disabled={isSaved}
                className={`h-8 px-3 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                  isSaved
                    ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30 cursor-default'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
              >
                {isSaved ? (
                  <>
                    <BookmarkCheck className="w-3.5 h-3.5 animate-star-pop" />
                    <span>Đã lưu FSRS</span>
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Lưu từ FSRS</span>
                    <span className="sm:hidden">Lưu</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng thẻ tra từ"
              className="w-8 h-8 flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Loading / Error */}
        {isLoading && !verifiedProfile && (
          <div className="py-6 flex items-center justify-center gap-2.5 text-sm opacity-70">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span>Đang giải phẫu từ “{activeToken.surface}” theo ngữ cảnh câu...</span>
          </div>
        )}

        {error && !verifiedProfile && (
          <div className="py-4 text-sm text-rose-600 dark:text-rose-400">
            Chưa thể tra cứu từ này: {error}
          </div>
        )}

        {verifiedProfile && (
          <div className="pt-3.5 space-y-4">
            {/* PRIORITY ATOMIC COLLOCATION DETECTED IN SENTENCE */}
            {detectedCol && (
              <div className="p-3.5 rounded-xl bg-indigo-500/7 border border-indigo-500/25 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-bold text-indigo-700 dark:text-indigo-300">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Cụm Collocation Nguyên Khối</span>
                    </span>
                    <span aria-hidden="true" className="opacity-40">·</span>
                    <span className={`font-semibold ${TIER_META[detectedCol.tier].accent}`}>
                      {TIER_META[detectedCol.tier].label} · {detectedCol.level}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => speakNative(detectedCol.phrase, language)}
                      className="h-7 px-2 text-xs font-medium rounded-md zen-surface border hover:border-indigo-500 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>Nghe cụm</span>
                    </button>
                    {onSaveDetectedCollocation && (
                      <button
                        type="button"
                        disabled={isDetectedCollocationSaved}
                        onClick={() => onSaveDetectedCollocation(detectedCol, activeLine)}
                        className={`h-7 px-2.5 text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                          isDetectedCollocationSaved
                            ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/30 cursor-default'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        {isDetectedCollocationSaved ? (
                          <>
                            <BookmarkCheck className="w-3 h-3 animate-star-pop" />
                            <span>Đã lưu cụm</span>
                          </>
                        ) : (
                          <>
                            <BookmarkPlus className="w-3 h-3" />
                            <span>Lưu cụm FSRS</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-baseline flex-wrap gap-x-2.5 gap-y-0.5">
                    <span className={`text-lg font-bold safe-wrap ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                      {detectedCol.phrase}
                    </span>
                    <span className="text-xs font-mono-tabular opacity-65">
                      [{detectedCol.patternFormula}]
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs opacity-80">
                    {detectedCol.readingOrIpa && (
                      <span className={language === 'ja' ? 'font-jp-compact' : 'font-ipa'}>
                        {detectedCol.readingOrIpa}
                      </span>
                    )}
                    {detectedCol.hanViet && (
                      <span className="font-semibold text-amber-700 dark:text-amber-300">
                        · Hán Việt: {detectedCol.hanViet}
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-semibold leading-snug pt-0.5 safe-wrap">
                    {detectedCol.meaningVi}
                  </p>
                </div>
              </div>
            )}

            {/* ================= LAYER 1: CONTEXT MATCH & PHONETICS ================= */}
            <section className="space-y-3">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold opacity-60">
                  01. Nghĩa khớp bối cảnh câu đang xem
                </div>
                <p className="text-base font-bold leading-snug safe-wrap">
                  {verifiedProfile.contextMeaning}
                </p>
                {verifiedProfile.otherMeanings && verifiedProfile.otherMeanings.length > 0 && (
                  <p className="text-xs opacity-70 leading-relaxed">
                    <span className="font-semibold">Nghĩa mở rộng khác: </span>
                    {verifiedProfile.otherMeanings.join(' · ')}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
                {language === 'ja' ? (
                  <>
                    <div className="p-3 rounded-lg zen-surface-subtle border space-y-1">
                      <div className="text-[11px] opacity-65">Furigana ngữ cảnh &amp; Hán Việt hiện đại</div>
                      <div className="font-jp-compact text-base font-semibold">
                        {verifiedProfile.furigana}
                        {verifiedProfile.romaji && (
                          <span className="ml-2 text-xs font-normal opacity-65 font-mono-tabular">
                            ({verifiedProfile.romaji})
                          </span>
                        )}
                      </div>
                      {verifiedProfile.hanViet && (
                        <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                          Hán Việt: {verifiedProfile.hanViet}
                        </div>
                      )}
                    </div>

                    {verifiedProfile.pitchAccent && (
                      <div className="p-3 rounded-lg zen-surface-subtle border">
                        <PitchAccentSvg pitchAccent={verifiedProfile.pitchAccent} />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="p-3 rounded-lg zen-surface-subtle border space-y-1">
                      <div className="text-[11px] opacity-65">Phiên âm IPA (Oxford / Cambridge)</div>
                      <div className="font-ipa text-sm font-medium flex flex-wrap gap-x-3 gap-y-1">
                        {verifiedProfile.ipaUS && (
                          <span>
                            <span className="opacity-55 mr-1 text-xs font-vi">US</span>
                            {verifiedProfile.ipaUS}
                          </span>
                        )}
                        {verifiedProfile.ipaUK && (
                          <span>
                            <span className="opacity-55 mr-1 text-xs font-vi">UK</span>
                            {verifiedProfile.ipaUK}
                          </span>
                        )}
                      </div>
                    </div>

                    {verifiedProfile.connectedSpeechNote && (
                      <div className="p-3 rounded-lg zen-surface-subtle border space-y-1">
                        <div className="text-[11px] opacity-65">Nối âm &amp; ngữ âm thực tế</div>
                        <p className="text-xs opacity-85 leading-relaxed">
                          {verifiedProfile.connectedSpeechNote}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* ================= DUAL-MODE NUANCE EXPLANATION (SUMMARY 3s <-> DEEP 6-DIMENSION) ================= */}
            <section className="pt-3 border-t border-black/5 dark:border-white/10 min-w-0">
              <DualModeNuancePanel
                initialData={verifiedProfile.nuanceDual || null}
                requestParams={{
                  term: verifiedProfile.surface || activeToken.surface,
                  lemma: verifiedProfile.lemma || activeToken.lemma || activeToken.surface,
                  language,
                  targetLevel: targetLevel || (language === 'ja' ? 'N3' : 'B2'),
                  kind: detectedCol ? 'collocation' : 'word',
                  sentence: activeLine.text,
                  prevSentence,
                  nextSentence,
                  videoTitle,
                  timestamp: activeLine.start,
                }}
                defaultMode="summary"
                enableHotkeyD={true}
                isSaved={isSaved}
                onSaveNuanceCard={
                  onSaveNuanceDualCard
                    ? (payload) =>
                        onSaveNuanceDualCard(payload, {
                          timestamp: activeLine.start,
                          sentence: activeLine.text,
                          sentenceVi: activeLine.translationVi,
                        })
                    : undefined
                }
                titleLabel="Giải thích Sắc thái"
              />
            </section>

            {/* ================= LAYER 2: MEMORY ANCHOR & ETYMOLOGY LAB ================= */}
            {((language === 'ja' &&
              verifiedProfile.kanjiBreakdown &&
              verifiedProfile.kanjiBreakdown.length > 0) ||
              verifiedProfile.radicalAnalysis ||
              verifiedProfile.morphemeBreakdown ||
              verifiedProfile.mnemonicVi) && (
              <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2.5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold min-w-0">
                    <Compass className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="truncate">
                      02. {language === 'ja' ? 'Cội Nguồn Hán Tự & Bộ Thủ' : 'Giải Phẫu Gốc Từ (Etymology Lab)'}
                    </span>
                  </div>
                  {language === 'ja' &&
                    verifiedProfile.kanjiBreakdown &&
                    verifiedProfile.kanjiBreakdown.length > 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 shrink-0">
                        Chuẩn 214 Bộ Khang Hy
                      </span>
                    )}
                </div>

                {/* === VERIFIED PER-KANJI ACADEMIC BREAKDOWN (ZERO-ERROR GROUND TRUTH) === */}
                {language === 'ja' &&
                verifiedProfile.kanjiBreakdown &&
                verifiedProfile.kanjiBreakdown.length > 0 ? (
                  <div className="space-y-2.5 min-w-0">
                    {verifiedProfile.kanjiBreakdown.map((entry, idx) => {
                      const structureBadgeClass =
                        entry.structureType === 'Hình thanh'
                          ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border-indigo-500/25'
                          : entry.structureType === 'Hội ý'
                            ? 'bg-teal-500/12 text-teal-700 dark:text-teal-300 border-teal-500/25'
                            : entry.structureType === 'Tượng hình'
                              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/25'
                              : entry.structureType === 'Chỉ sự'
                                ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25'
                                : 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/25';

                      return (
                        <div
                          key={`${entry.kanji}-${idx}`}
                          className="p-3 rounded-xl zen-surface-subtle border space-y-2.5 min-w-0"
                        >
                          {/* Row 1: Large Kanji + Han-Viet + Rikusho + Kyujitai + Meta */}
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-lg zen-surface border flex items-center justify-center shrink-0 shadow-xs">
                              <span className="font-jp-compact text-2xl font-bold leading-none">
                                {entry.kanji}
                              </span>
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-extrabold tracking-wide text-amber-700 dark:text-amber-300">
                                  {entry.hanViet}
                                </span>
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${structureBadgeClass}`}
                                >
                                  {entry.structureType === 'Quốc tự' ? 'Quốc tự · 国字' : entry.structureType}
                                </span>
                                {entry.kyujitai && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/25 font-jp-compact">
                                    旧字体: {entry.kyujitai}
                                  </span>
                                )}
                                {entry.jlpt && (
                                  <span className="text-[10px] font-mono-tabular opacity-65">
                                    {entry.jlpt}
                                  </span>
                                )}
                                {entry.strokeCount && (
                                  <span className="text-[10px] font-mono-tabular opacity-60">
                                    · {entry.strokeCount} nét
                                  </span>
                                )}
                              </div>

                              {/* Row 2: Official Kangxi Radical (Bộ thủ chính — 部首) */}
                              <div className="text-xs leading-snug safe-wrap">
                                <span className="font-semibold opacity-70">Bộ thủ chính (部首): </span>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-900 dark:text-amber-200 font-bold font-jp-compact">
                                  {entry.radical.symbol}
                                  {entry.radical.kangxiNumber ? (
                                    <span className="text-[10px] font-mono-tabular opacity-75">
                                      #{entry.radical.kangxiNumber}
                                    </span>
                                  ) : null}
                                </span>{' '}
                                <span className="font-semibold">{entry.radical.nameVi}</span>
                                {entry.radical.meaningVi && (
                                  <span className="opacity-75"> ({entry.radical.meaningVi})</span>
                                )}
                                {entry.radical.positionNote && (
                                  <div className="text-[11px] opacity-70 mt-0.5">
                                    ↳ {entry.radical.positionNote}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Row 3: Visual Components — Nghĩa phù vs Thanh phù */}
                          {entry.components && entry.components.length > 0 && (
                            <div className="space-y-1.5 pt-1 border-t border-black/5 dark:border-white/8">
                              <div className="text-[10px] font-semibold uppercase tracking-wider opacity-55">
                                Cấu tạo nét chữ (Nghĩa phù · Thanh phù)
                              </div>
                              <div className="flex flex-col gap-1">
                                {entry.components.map((comp, cIdx) => {
                                  const roleClass =
                                    comp.role === 'Nghĩa phù'
                                      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                                      : comp.role === 'Thanh phù'
                                        ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border-indigo-500/25'
                                        : 'bg-slate-500/12 text-slate-700 dark:text-slate-300 border-slate-500/20';
                                  return (
                                    <div
                                      key={`${comp.char}-${cIdx}`}
                                      className="flex items-start gap-2 text-xs leading-snug min-w-0"
                                    >
                                      <span className="font-jp-compact font-bold px-1.5 py-0.5 rounded zen-surface border shrink-0 min-w-[26px] text-center">
                                        {comp.char}
                                      </span>
                                      <span
                                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 whitespace-nowrap ${roleClass}`}
                                      >
                                        {comp.role}
                                      </span>
                                      <span className="opacity-85 safe-wrap min-w-0 flex-1 pt-0.5">
                                        {comp.meaning}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Row 4: On'yomi & Kun'yomi with Active Reading Highlight */}
                          {(entry.onyomi.length > 0 || entry.kunyomi.length > 0) && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] pt-1 border-t border-black/5 dark:border-white/8 font-jp-compact">
                              {entry.onyomi.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="font-vi font-semibold opacity-60">Âm On:</span>
                                  {entry.onyomi.map((on, oIdx) => {
                                    const isActive =
                                      entry.activeReading &&
                                      (entry.activeReading.includes(on) ||
                                        on.replace(/\./g, '') === entry.activeReading.replace(/\./g, ''));
                                    return (
                                      <span
                                        key={`${on}-${oIdx}`}
                                        className={
                                          isActive
                                            ? 'px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-bold'
                                            : 'opacity-80'
                                        }
                                      >
                                        {on}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                              {entry.kunyomi.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="font-vi font-semibold opacity-60">Âm Kun:</span>
                                  {entry.kunyomi.map((kun, kIdx) => {
                                    const cleanKun = kun.replace(/\./g, '');
                                    const isActive =
                                      entry.activeReading &&
                                      (entry.activeReading.includes(cleanKun) ||
                                        cleanKun.startsWith(entry.activeReading.replace(/\./g, '')));
                                    return (
                                      <span
                                        key={`${kun}-${kIdx}`}
                                        className={
                                          isActive
                                            ? 'px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-700 dark:text-teal-300 font-bold'
                                            : 'opacity-80'
                                        }
                                      >
                                        {kun}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Row 5: Scientific Etymology Fact (strictly separated from Mnemonic Tip) */}
                          <div className="space-y-1.5 pt-1 border-t border-black/5 dark:border-white/8 text-xs leading-relaxed">
                            <p className="opacity-90 safe-wrap">
                              <span className="font-semibold text-teal-700 dark:text-teal-300">
                                Cội nguồn học thuật:{' '}
                              </span>
                              {entry.etymologyFact}
                            </p>
                            {entry.mnemonicTip && (
                              <p className="text-[11.5px] opacity-80 safe-wrap px-2 py-1.5 rounded-md bg-indigo-500/6 border border-indigo-500/15">
                                <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                                  💡 Mẹo nhớ mặt chữ:{' '}
                                </span>
                                {entry.mnemonicTip}
                              </p>
                            )}
                          </div>

                          {/* Row 6: Confusable Kanji Guard */}
                          {entry.confusables && entry.confusables.length > 0 && (
                            <div className="pt-1.5 border-t border-black/5 dark:border-white/8 space-y-1">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600/80 dark:text-rose-400/80">
                                Cảnh báo dễ nhầm mặt chữ
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {entry.confusables.slice(0, 3).map((cf, cfIdx) => (
                                  <div
                                    key={`${cf.kanji}-${cfIdx}`}
                                    className="text-[11px] px-2 py-1 rounded-md zen-surface border flex items-baseline gap-1.5 max-w-full"
                                  >
                                    <span className="opacity-45 font-bold">≠</span>
                                    <span className="font-jp-compact font-bold text-sm leading-none">
                                      {cf.kanji}
                                    </span>
                                    <span className="font-semibold text-amber-700 dark:text-amber-300">
                                      {cf.hanViet}
                                    </span>
                                    <span className="opacity-75 truncate">· {cf.meaningVi}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    {language === 'ja' && verifiedProfile.radicalAnalysis && (
                      <div className="p-2.5 rounded-lg zen-surface-subtle border text-xs leading-relaxed font-jp-compact safe-wrap">
                        <span className="font-semibold text-amber-700 dark:text-amber-300 font-vi">
                          Gốc từ:{' '}
                        </span>
                        {verifiedProfile.radicalAnalysis}
                      </div>
                    )}

                    {language === 'en' && verifiedProfile.morphemeBreakdown && (
                      <div className="p-2.5 rounded-lg zen-surface-subtle border space-y-1.5 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono-tabular">
                          {verifiedProfile.morphemeBreakdown.prefix && (
                            <span className="px-2 py-0.5 rounded bg-sky-500/12 text-sky-700 dark:text-sky-300 font-semibold">
                              {verifiedProfile.morphemeBreakdown.prefix}
                            </span>
                          )}
                          {verifiedProfile.morphemeBreakdown.prefix && <span className="opacity-45">+</span>}
                          <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-bold">
                            {verifiedProfile.morphemeBreakdown.root}
                          </span>
                          {verifiedProfile.morphemeBreakdown.suffix && <span className="opacity-45">+</span>}
                          {verifiedProfile.morphemeBreakdown.suffix && (
                            <span className="px-2 py-0.5 rounded bg-violet-500/12 text-violet-700 dark:text-violet-300 font-semibold">
                              {verifiedProfile.morphemeBreakdown.suffix}
                            </span>
                          )}
                        </div>
                        <p className="opacity-85 leading-relaxed">
                          <span className="font-semibold">Gốc từ: </span>
                          {verifiedProfile.morphemeBreakdown.rootMeaningVi}
                        </p>
                      </div>
                    )}

                    {verifiedProfile.mnemonicVi && (
                      <p className="text-xs opacity-85 leading-relaxed">
                        <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                          💡 Mẹo nhớ 1 dòng:{' '}
                        </span>
                        {verifiedProfile.mnemonicVi}
                      </p>
                    )}
                  </>
                )}
              </section>
            )}

            {/* ================= LAYER 3: WORD FAMILY (EN) / TRANSITIVITY & JUKUGO (JA) ================= */}
            {((language === 'en' &&
              verifiedProfile.wordFamily &&
              verifiedProfile.wordFamily.length > 0) ||
              (language === 'ja' &&
                (verifiedProfile.transitivityPair ||
                  (verifiedProfile.topJukugo && verifiedProfile.topJukugo.length > 0)))) && (
              <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                  <span>
                    03.{' '}
                    {language === 'ja'
                      ? 'Cặp Tự / Tha Động Từ & Từ Ghép Jukugo'
                      : 'Gia Đình Từ (Word Family Matrix)'}
                  </span>
                </div>

                {/* English Word Family Grid */}
                {language === 'en' && verifiedProfile.wordFamily && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {verifiedProfile.wordFamily.slice(0, 4).map((wf, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg zen-surface-subtle border space-y-0.5 min-w-0"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-bold truncate">{wf.word}</span>
                          <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                            {wf.pos}
                          </span>
                        </div>
                        {wf.ipa && <div className="font-ipa text-[11px] opacity-65">{wf.ipa}</div>}
                        <div className="text-[11px] opacity-80 italic safe-wrap">
                          “{wf.exampleShort}”
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Japanese Transitivity Pair Lock */}
                {language === 'ja' && verifiedProfile.transitivityPair && (
                  <div className="p-3 rounded-xl zen-surface-subtle border space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg zen-surface border space-y-0.5">
                        <div className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                          Tự động từ (自動詞) · {verifiedProfile.transitivityPair.intransitiveParticle}
                        </div>
                        <div className="font-jp-compact text-sm font-bold">
                          {verifiedProfile.transitivityPair.intransitive}
                        </div>
                        <div className="font-jp-compact text-[11px] opacity-65">
                          {verifiedProfile.transitivityPair.intransitiveReading}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg zen-surface border space-y-0.5">
                        <div className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                          Tha động từ (他動詞) · {verifiedProfile.transitivityPair.transitiveParticle}
                        </div>
                        <div className="font-jp-compact text-sm font-bold">
                          {verifiedProfile.transitivityPair.transitive}
                        </div>
                        <div className="font-jp-compact text-[11px] opacity-65">
                          {verifiedProfile.transitivityPair.transitiveReading}
                        </div>
                      </div>
                    </div>
                    <p className="opacity-80 leading-relaxed">
                      {verifiedProfile.transitivityPair.differenceVi}
                    </p>
                  </div>
                )}

                {/* Japanese Top 3 Jukugo */}
                {language === 'ja' &&
                  verifiedProfile.topJukugo &&
                  verifiedProfile.topJukugo.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      {verifiedProfile.topJukugo.slice(0, 3).map((jk, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-lg zen-surface-subtle border space-y-0.5 min-w-0"
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="font-jp-compact font-bold">{jk.word}</span>
                            <button
                              type="button"
                              onClick={() => speakNative(jk.word, 'ja')}
                              aria-label={`Nghe ${jk.word}`}
                              className="opacity-60 hover:opacity-100 cursor-pointer"
                            >
                              <Volume2 className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="text-[11px] opacity-65 truncate">
                            <span className="font-jp-compact">{jk.reading}</span>
                            {jk.hanViet && (
                              <span className="text-amber-700 dark:text-amber-300 font-semibold ml-1">
                                · {jk.hanViet}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] opacity-85 line-clamp-2">{jk.meaningVi}</div>
                        </div>
                      ))}
                    </div>
                  )}
              </section>
            )}

            {/* ================= LAYER 4: 3-TIER COLLOCATION LADDER + [+3 MỚI] ================= */}
            {ladder && activeLadderVariant && (
              <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>04. Thang Máy Collocations 3 Tầng: {ladder.conceptVi}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowContextCompare((v) => !v)}
                      className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer whitespace-nowrap"
                    >
                      {showContextCompare ? 'Ẩn so sánh' : 'So sánh ngữ cảnh'}
                    </button>
                    <button
                      type="button"
                      onClick={handleLoadThreeMoreCollocations}
                      disabled={isLoadingMoreCols}
                      className="h-6 px-2 text-[11px] font-semibold rounded-md bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      {isLoadingMoreCols ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                      <span>+3 Cụm thực chiến</span>
                    </button>
                  </div>
                </div>

                {/* 3-Step Interactive Tier Selector */}
                <div className="grid grid-cols-3 gap-1.5">
                  {(['casual', 'natural', 'academic'] as CollocationTier[]).map((t) => {
                    const meta = TIER_META[t];
                    const isSelectedTier = ladderTier === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setLadderTier(t)}
                        className={`px-2 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                          isSelectedTier
                            ? meta.activeBg
                            : 'zen-surface opacity-75 hover:opacity-100'
                        }`}
                      >
                        <div className="text-[11px] font-bold truncate">{meta.shortLabel}</div>
                        <div
                          className={`text-xs font-semibold truncate mt-0.5 ${
                            language === 'ja' ? 'font-jp-compact' : ''
                          }`}
                        >
                          {ladder[t]?.expression}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Active Ladder Variant Detail */}
                <div className="p-2.5 rounded-lg zen-surface-subtle border space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] font-bold ${TIER_META[ladderTier].accent}`}>
                      {TIER_META[ladderTier].label} · {activeLadderVariant.level}
                    </span>
                    <button
                      type="button"
                      onClick={() => speakNative(activeLadderVariant.expression, language)}
                      className="h-6 px-2 text-[11px] rounded hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-1 cursor-pointer"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>Nghe</span>
                    </button>
                  </div>
                  <div
                    className={`text-sm font-bold safe-wrap ${
                      language === 'ja' ? 'font-jp-compact' : ''
                    }`}
                  >
                    {activeLadderVariant.expression}
                  </div>
                  {(activeLadderVariant.readingOrIpa || activeLadderVariant.hanViet) && (
                    <div className="flex flex-wrap items-center gap-x-2 text-xs opacity-70">
                      {activeLadderVariant.readingOrIpa && (
                        <span className={language === 'ja' ? 'font-jp-compact' : 'font-ipa'}>
                          {activeLadderVariant.readingOrIpa}
                        </span>
                      )}
                      {activeLadderVariant.hanViet && (
                        <span className="font-semibold text-amber-700 dark:text-amber-300">
                          · {activeLadderVariant.hanViet}
                        </span>
                      )}
                    </div>
                  )}
                  <p className={`text-xs italic opacity-80 ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                    “{activeLadderVariant.exampleSentence}”
                  </p>
                  <p className="text-xs opacity-80 leading-relaxed">
                    {activeLadderVariant.nuanceVi}
                  </p>
                </div>

                {showContextCompare && ladder.contextCompareVi && (
                  <div className="p-2.5 rounded-lg bg-indigo-500/8 border border-indigo-500/20 text-xs space-y-1.5 leading-relaxed">
                    <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                      <span className={language === 'ja' ? 'font-jp-compact' : ''}>
                        {ladder.casual.expression}
                      </span>
                      <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                      <span className={language === 'ja' ? 'font-jp-compact' : ''}>
                        {ladder.natural.expression}
                      </span>
                      <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                      <span className={language === 'ja' ? 'font-jp-compact' : ''}>
                        {ladder.academic.expression}
                      </span>
                    </div>
                    <p className="opacity-85">{ladder.contextCompareVi}</p>
                  </div>
                )}

                {moreColsError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">{moreColsError}</p>
                )}

                {/* Expanded +3 Practical Collocations */}
                {extraCollocations.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] font-semibold opacity-65">
                      Cụm thực chiến vừa mở rộng ({extraCollocations.length} cụm · không trùng lịch sử)
                    </div>
                    <div className="space-y-1.5">
                      {extraCollocations.map((col, idx) => {
                        const meta = TIER_META[col.tier] || TIER_META.natural;
                        const colSaved = savedTermKeys?.has(`vocab::${col.expression.toLowerCase()}`);
                        return (
                          <div
                            key={`${col.expression}_${idx}`}
                            className="p-2.5 rounded-lg zen-surface-subtle border text-xs space-y-1"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className={`font-bold ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                                  {col.expression}
                                </span>
                                <span className={`ml-2 text-[11px] font-semibold ${meta.accent}`}>
                                  {meta.shortLabel} · {col.level}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => speakNative(col.expression, language)}
                                  className="p-1 opacity-65 hover:opacity-100 cursor-pointer"
                                  aria-label="Nghe cụm"
                                >
                                  <Volume2 className="w-3 h-3" />
                                </button>
                                {onSaveExtraCollocation && (
                                  <button
                                    type="button"
                                    disabled={colSaved}
                                    onClick={() => onSaveExtraCollocation(col, activeLine)}
                                    className={`h-6 px-2 text-[11px] font-semibold rounded cursor-pointer ${
                                      colSaved
                                        ? 'text-teal-700 dark:text-teal-300 opacity-75 cursor-default'
                                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                    }`}
                                  >
                                    {colSaved ? 'Đã lưu' : 'Lưu'}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="text-[11px] opacity-70">
                              <span className={language === 'ja' ? 'font-jp-compact' : 'font-ipa'}>
                                {col.readingOrIpa}
                              </span>
                              {col.hanViet && (
                                <span className="ml-1.5 font-semibold text-amber-700 dark:text-amber-300">
                                  · {col.hanViet}
                                </span>
                              )}
                            </div>
                            <div className="font-semibold">{col.meaningVi}</div>
                            <div className={`italic opacity-75 ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                              “{col.exampleSentence}”
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ================= LAYER 5: ANTI-CALQUE TRAP CARD (✅ O / ❌ X) ================= */}
            {verifiedProfile.antiCalque && (
              <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-300">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>05. Cảnh Báo Bẫy Người Việt (✅ O / ❌ X)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-teal-500/10 border border-teal-500/25 flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-teal-700 dark:text-teal-300">
                        Dùng chuẩn bản xứ (O)
                      </div>
                      <div className={`font-bold safe-wrap ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                        {verifiedProfile.antiCalque.correctForm}
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25 flex items-start gap-1.5">
                    <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                        Tuyệt đối tránh (X)
                      </div>
                      <div className={`font-semibold line-through opacity-85 safe-wrap ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                        {verifiedProfile.antiCalque.wrongTrap}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-xs opacity-80 leading-relaxed">
                  {verifiedProfile.antiCalque.particleOrPrepHighlight && (
                    <span className="font-bold text-indigo-700 dark:text-indigo-300 mr-1.5">
                      [{verifiedProfile.antiCalque.particleOrPrepHighlight}]
                    </span>
                  )}
                  {verifiedProfile.antiCalque.explanationVi}
                </p>
              </section>
            )}

            {/* Extra Usage / Conjugation Note */}
            {(verifiedProfile.conjugationNote || verifiedProfile.usageNote) && (
              <div className="pt-2.5 border-t border-black/5 dark:border-white/10 space-y-1 text-xs opacity-80 leading-relaxed">
                {verifiedProfile.conjugationNote && (
                  <p>
                    <span className="font-semibold">Biến thể trong câu: </span>
                    {verifiedProfile.conjugationNote}
                  </p>
                )}
                {verifiedProfile.usageNote && (
                  <p>
                    <span className="font-semibold">Sắc thái bản xứ: </span>
                    {verifiedProfile.usageNote}
                  </p>
                )}
              </div>
            )}

            {/* Footer: Anchored sentence + Open Core-Word Collocation Map */}
            <div className="pt-2.5 border-t border-black/5 dark:border-white/10 flex flex-wrap items-center justify-between gap-2">
              <div
                className={`text-[11px] opacity-55 truncate max-w-full sm:max-w-[60%] ${
                  language === 'ja' ? 'font-jp-compact' : ''
                }`}
              >
                Ngữ cảnh: “{activeLine.text}”
              </div>

              {onOpenCollocationWeb && (
                <button
                  type="button"
                  onClick={() => onOpenCollocationWeb(coreWordForMap)}
                  className="h-7 px-2.5 text-xs font-semibold rounded-lg bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Network className="w-3.5 h-3.5" />
                  <span>Mở Bản đồ Từ gốc “{coreWordForMap}”</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
