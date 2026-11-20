import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  GraduationCap,
  HelpCircle,
  ImageDown,
  Loader2,
  Pause,
  PenTool,
  Play,
  PlusCircle,
  Repeat,
  Repeat1,
  ScanSearch,
  Scissors,
  SlidersHorizontal,
  Theater,
  Timer,
} from 'lucide-react';
import type {
  DetectedCollocation,
  Language,
  NuanceDualPayload,
  ProficiencyLevel,
  SourceLanguage,
  SubtitleLine,
  SubtitleToken,
  WeaknessEntry,
  WordExtraCollocation,
  WordProfile,
} from '../types';
import { formatTime, getAdaptiveHighlightTier } from '../lib/youtube';
import { isPureTargetLanguage } from '../lib/languagePurity';
import { sanitizeHiraganaReading, stripHtmlAndRubyArtifacts } from '../lib/compactUnpacker';
import { ShadowingRecorder } from './ShadowingRecorder';
import { WordProfilePopover } from './WordProfilePopover';

const SPEED_OPTIONS = [0.5, 0.75, 0.85, 1.0, 1.25, 1.5];

function formatTimeMs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000';
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}.${mmm}` : `${mm}:${ss}.${mmm}`;
}

interface InteractiveSubtitleStageProps {
  language: Language;
  sourceLanguage: SourceLanguage;
  targetLevel: ProficiencyLevel;
  activeLine: SubtitleLine | null;
  currentTime?: number;
  videoTitle?: string;
  prevSentence?: string;
  nextSentence?: string;
  totalLines: number;
  isPlaying: boolean;
  isSilenceGap?: boolean;
  syncOffsetSec?: number;
  onAdjustSyncOffset?: (nextOffsetSec: number) => void;
  // Seamless EN <-> JP switch on Vietnamese source videos
  onInstantLanguageSwitch?: (lang: Language) => void;
  // Tier-3 Windowed STT continuation
  hasMoreStt?: boolean;
  isLoadingMoreStt?: boolean;
  onLoadMoreStt?: () => void;
  // Display toggles
  showOriginal: boolean;
  onToggleOriginal: () => void;
  showPhonetics: boolean;
  onTogglePhonetics: () => void;
  showTranslationVi: boolean;
  onToggleTranslationVi: () => void;
  // Blur-to-reveal
  blurOriginal: boolean;
  onToggleBlurOriginal: () => void;
  blurTranslation: boolean;
  onToggleBlurTranslation: () => void;
  isRevealHeld: boolean;
  // Playback & Shadowing controls
  playbackRate: number;
  onChangePlaybackRate: (rate: number) => void;
  loopSingleLine: boolean;
  onToggleLoopSingleLine: () => void;
  loopA: number | null;
  loopB: number | null;
  onCycleABLoop: () => void;
  onClearABLoop: () => void;
  autoPausePerLine: boolean;
  onToggleAutoPausePerLine: () => void;
  autoPauseDelaySec: number;
  onChangeAutoPauseDelaySec: (sec: number) => void;
  autoPauseOnClick: boolean;
  onToggleAutoPauseOnClick: () => void;
  // Dictation mode
  dictationMode: boolean;
  onToggleDictationMode: () => void;
  // Actions
  onTogglePlay: () => void;
  onPrevLine: () => void;
  onNextLine: () => void;
  onReplayCurrentLine: () => void;
  onOpenXRay: (line: SubtitleLine) => void;
  onOpenAiSensei: (highlightedText: string) => void;
  onOpenRoleplay: () => void;
  onSaveSmartClip: () => void;
  onDownloadQuoteCard: (line: SubtitleLine) => void;
  onShadowScored: () => void;
  clipSavedFeedback: boolean;
  // 1-Click Token Lookup state
  selectedToken: { line: SubtitleLine; token: SubtitleToken } | null;
  wordProfile: WordProfile | null;
  isLookupLoading: boolean;
  lookupError: string | null;
  isCurrentWordSaved: boolean;
  onTokenClick: (line: SubtitleLine, token: SubtitleToken) => void;
  onCloseWordPopover: () => void;
  onSaveWordCard: (profile: WordProfile) => void;
  // Feature 21: Atomic Collocation & Core-Word Map jump
  isDetectedCollocationSaved?: boolean;
  onSaveDetectedCollocation?: (col: DetectedCollocation, line: SubtitleLine) => void;
  onOpenCollocationWeb?: (coreWord: string) => void;
  // Super-Systems 1 & 6: Save extra collocations + Cross-video Weakness Radar highlight
  savedTermKeys?: Set<string>;
  onSaveExtraCollocation?: (col: WordExtraCollocation, line: SubtitleLine) => void;
  onSaveNuanceDualCard?: (payload: NuanceDualPayload, context?: { timestamp?: number }) => void;
  weaknessMap?: Map<string, WeaknessEntry>;
}

export const InteractiveSubtitleStage: React.FC<InteractiveSubtitleStageProps> = ({
  language,
  sourceLanguage,
  targetLevel,
  activeLine,
  currentTime = 0,
  videoTitle = '',
  prevSentence = '',
  nextSentence = '',
  totalLines,
  isPlaying,
  isSilenceGap = false,
  syncOffsetSec = 0,
  onAdjustSyncOffset,
  onInstantLanguageSwitch,
  hasMoreStt,
  isLoadingMoreStt,
  onLoadMoreStt,
  showOriginal,
  onToggleOriginal,
  showPhonetics,
  onTogglePhonetics,
  showTranslationVi,
  onToggleTranslationVi,
  blurOriginal,
  onToggleBlurOriginal,
  blurTranslation,
  onToggleBlurTranslation,
  isRevealHeld,
  playbackRate,
  onChangePlaybackRate,
  loopSingleLine,
  onToggleLoopSingleLine,
  loopA,
  loopB,
  onCycleABLoop,
  onClearABLoop,
  autoPausePerLine,
  onToggleAutoPausePerLine,
  autoPauseDelaySec,
  onChangeAutoPauseDelaySec,
  autoPauseOnClick,
  onToggleAutoPauseOnClick,
  dictationMode,
  onToggleDictationMode,
  onTogglePlay,
  onPrevLine,
  onNextLine,
  onReplayCurrentLine,
  onOpenXRay,
  onOpenAiSensei,
  onOpenRoleplay,
  onSaveSmartClip,
  onDownloadQuoteCard,
  onShadowScored,
  clipSavedFeedback,
  selectedToken,
  wordProfile,
  isLookupLoading,
  lookupError,
  isCurrentWordSaved,
  onTokenClick,
  onCloseWordPopover,
  onSaveWordCard,
  isDetectedCollocationSaved,
  onSaveDetectedCollocation,
  onOpenCollocationWeb,
  savedTermKeys,
  onSaveExtraCollocation,
  onSaveNuanceDualCard,
  weaknessMap,
}) => {
  const [dictationInputs, setDictationInputs] = useState<Record<string, string>>({});
  const [hintRevealed, setHintRevealed] = useState<Record<string, boolean>>({});
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [showSyncHud, setShowSyncHud] = useState(false);

  useEffect(() => {
    setDictationInputs({});
    setHintRevealed({});
  }, [activeLine?.id, dictationMode]);

  const clozeTokenIds = useMemo(() => {
    if (!dictationMode || !activeLine) return new Set<string>();
    const contentTokens = activeLine.tokens.filter(
      (t) => !t.isPunctuation && t.surface.trim().length > 0
    );
    if (contentTokens.length === 0) return new Set<string>();
    const adaptive = contentTokens.filter(
      (t) => getAdaptiveHighlightTier(t.level, targetLevel, language) !== null
    );
    const chosen =
      adaptive.length > 0
        ? adaptive.slice(0, 3)
        : contentTokens.filter((t) => t.surface.length >= (language === 'ja' ? 2 : 4)).slice(0, 2);
    const finalPick = chosen.length > 0 ? chosen : [contentTokens[contentTokens.length - 1]];
    return new Set(finalPick.map((t) => t.id));
  }, [dictationMode, activeLine, targetLevel, language]);

  const checkTokenExactMatch = (token: SubtitleToken, userVal: string): boolean => {
    const cleanUser = userVal.trim().toLowerCase();
    const cleanTarget = token.surface.trim().toLowerCase();
    if (!cleanUser) return false;
    if (cleanUser === cleanTarget) return true;
    if (language === 'ja' && token.furigana && cleanUser === token.furigana.trim().toLowerCase()) {
      return true;
    }
    return false;
  };

  const renderCharDiff = (target: string, typed: string) => {
    if (!typed) return null;
    const tChars = Array.from(target);
    const uChars = Array.from(typed);
    return (
      <span className="inline-flex items-center font-mono-tabular text-[11px] ml-1.5">
        {uChars.map((ch, idx) => {
          const ok = (tChars[idx] || '').toLowerCase() === ch.toLowerCase();
          return (
            <span
              key={idx}
              className={
                ok ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400 underline'
              }
            >
              {ch}
            </span>
          );
        })}
      </span>
    );
  };

  const renderJapaneseTokenText = (token: SubtitleToken) => {
    const cleanSurface = stripHtmlAndRubyArtifacts(token.surface);
    if (!showPhonetics) return <span>{cleanSurface}</span>;
    if (token.ruby && token.ruby.length > 0) {
      return (
        <>
          {token.ruby.map((seg, i) => {
            const safeBase = stripHtmlAndRubyArtifacts(seg.base);
            const safeReading = sanitizeHiraganaReading(seg.reading);
            if (!safeBase) return null;
            return safeReading ? (
              <ruby key={i}>
                {safeBase}
                <rt className="opacity-70">{safeReading}</rt>
              </ruby>
            ) : (
              <React.Fragment key={i}>{safeBase}</React.Fragment>
            );
          })}
        </>
      );
    }
    const safeFuri = sanitizeHiraganaReading(token.furigana);
    if (/[\u4E00-\u9FAF]/.test(cleanSurface) && safeFuri) {
      return (
        <ruby>
          {cleanSurface}
          <rt className="opacity-70">{safeFuri}</rt>
        </ruby>
      );
    }
    return <span>{cleanSurface}</span>;
  };

  const handleAskSenseiClick = () => {
    const browserSel =
      typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    onOpenAiSensei(browserSel || activeLine?.text || '');
  };

  // Strict Target-Language Subtitle Gate: NEVER render raw Vietnamese as primary subtitle
  const isActiveLinePureTarget = useMemo(() => {
    if (!activeLine || !activeLine.text.trim()) return false;
    if (sourceLanguage === 'vi') {
      return (
        Boolean(activeLine.enriched) &&
        isPureTargetLanguage(activeLine.text, language, activeLine.rawText)
      );
    }
    return true;
  }, [activeLine, sourceLanguage, language]);

  const targetLangDisplayLabel =
    language === 'ja' ? `Tiếng Nhật (JLPT ${targetLevel})` : `Tiếng Anh (CEFR ${targetLevel})`;

  return (
    <div className="space-y-3 min-w-0 max-w-full">
      {/* Main Interactive Subtitle Stage Card */}
      <div className="rounded-2xl zen-surface border p-4 md:p-5 min-w-0">
        {/* Stage Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-black/5 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2 text-xs opacity-75">
            {activeLine ? (
              <>
                <span className="font-mono-tabular font-semibold">
                  Câu {activeLine.index + 1}/{totalLines}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {formatTime(activeLine.start)} – {formatTime(activeLine.end)}
                </span>
              </>
            ) : isSilenceGap && totalLines > 0 ? (
              <span className="font-mono-tabular opacity-75">
                ♪ Khoảng lặng · {totalLines.toLocaleString('vi-VN')} câu sẵn sàng
              </span>
            ) : (
              <span>Sẵn sàng hiển thị phụ đề song ngữ tương tác</span>
            )}

            {/* Instant EN <-> JP Toggle on Vietnamese Source Videos (Zero IFrame Reload!) */}
            {sourceLanguage === 'vi' && onInstantLanguageSwitch && (
              <>
                <span aria-hidden="true">·</span>
                <div className="inline-flex items-center p-0.5 zen-surface-subtle rounded-md border">
                  <button
                    type="button"
                    onClick={() => onInstantLanguageSwitch('en')}
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded transition-colors cursor-pointer ${
                      language === 'en'
                        ? 'bg-indigo-600 text-white'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    Anh
                  </button>
                  <button
                    type="button"
                    onClick={() => onInstantLanguageSwitch('ja')}
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded font-jp transition-colors cursor-pointer ${
                      language === 'ja'
                        ? 'bg-indigo-600 text-white'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    日本語
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleOriginal}
              className={`h-7 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                showOriginal
                  ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              {language === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}
            </button>

            <button
              type="button"
              onClick={onTogglePhonetics}
              title="Phím tắt F"
              className={`h-7 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                showPhonetics
                  ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              {language === 'ja' ? 'Furigana' : 'IPA'}
            </button>

            <button
              type="button"
              onClick={onToggleTranslationVi}
              title="Bật/tắt dòng chú thích nghĩa Tiếng Việt bên dưới (Phím tắt V)"
              className={`h-7 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                showTranslationVi
                  ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              {showTranslationVi ? 'Ẩn nghĩa Việt' : 'Hiện nghĩa Việt'}
            </button>

            {activeLine && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenXRay(activeLine)}
                  className="h-7 px-2.5 text-xs font-semibold rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 flex items-center gap-1 transition-opacity whitespace-nowrap cursor-pointer"
                >
                  <ScanSearch className="w-3.5 h-3.5" />
                  <span>X-Quang</span>
                </button>

                <button
                  type="button"
                  onClick={handleAskSenseiClick}
                  title="Bôi đen đoạn thoại bất kỳ rồi bấm để hỏi AI Sensei theo ngữ cảnh video"
                  className="h-7 px-2.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <GraduationCap className="w-3.5 h-3.5" />
                  <span>AI Sensei</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Subtitle Display Area (Zero-Ghost Rule: clean silence display when speaker pauses) */}
        {!activeLine ? (
          <div className="min-h-[112px] flex flex-col items-center justify-center text-center py-4">
            {isSilenceGap && totalLines > 0 ? (
              <>
                <p className="text-sm font-medium opacity-70">
                  ♪ Khoảng lặng / Nhạc nền — phụ đề sẽ tự hiện đúng khoảnh khắc nhân vật bắt đầu câu tiếp theo
                </p>
                <p className="text-xs opacity-50 mt-1">
                  Dùng phím ← / → để nhảy câu, hoặc tinh chỉnh lệch nhịp ±0.1s bên dưới nếu cần.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm opacity-75">
                  {totalLines > 0
                    ? `Nhấn Phát video hoặc chọn một dòng phụ đề ${targetLangDisplayLabel} bên phải để bắt đầu.`
                    : 'Nhấn Phát video hoặc chọn một dòng phụ đề bên phải để bắt đầu học.'}
                </p>
                <p className="text-xs opacity-55 mt-1">
                  Chạm vào bất kỳ từ hoặc cụm Collocation nào để mở hồ sơ từ vựng 1:1, IPA / Furigana &amp; Pitch Accent.
                </p>
              </>
            )}
          </div>
        ) : !isActiveLinePureTarget ? (
          <div className="min-h-[112px] flex flex-col items-center justify-center text-center py-4 gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                Đang đồng bộ lời thoại {formatTime(activeLine.start)} sang {targetLangDisplayLabel}...
              </span>
            </div>
            <p className="text-xs opacity-60">
              Dịch hỏa tốc 1:1 khớp chính xác mốc [{formatTime(activeLine.start)} ➔ {formatTime(activeLine.end)}] — tuyệt đối không nhảy vọt sang đoạn khác
            </p>
          </div>
        ) : (
          <div className="min-h-[112px] flex flex-col justify-center space-y-3">
            {showOriginal && (
              <div
                className={`${
                  blurOriginal && !dictationMode
                    ? `blur-reveal ${isRevealHeld ? 'revealed' : ''}`
                    : ''
                }`}
              >
                <div
                  className={`flex flex-wrap items-end ${
                    language === 'ja' ? 'gap-x-1 gap-y-2 font-jp' : 'gap-x-1.5 gap-y-2'
                  }`}
                >
                  {activeLine.tokens.map((token, idx) => {
                    const isSelected =
                      selectedToken?.line.id === activeLine.id &&
                      selectedToken?.token.id === token.id;
                    const adaptiveTier = getAdaptiveHighlightTier(
                      token.level,
                      targetLevel,
                      language
                    );

                    if (dictationMode && clozeTokenIds.has(token.id)) {
                      const typed = dictationInputs[token.id] || '';
                      const isCorrect = checkTokenExactMatch(token, typed);
                      const showHint = Boolean(hintRevealed[token.id]);
                      const minChars = Math.max(5, token.surface.length + 2);

                      return (
                        <span key={token.id} className="inline-flex items-center gap-1 align-middle">
                          <input
                            type="text"
                            value={typed}
                            onChange={(e) =>
                              setDictationInputs((prev) => ({
                                ...prev,
                                [token.id]: e.target.value,
                              }))
                            }
                            placeholder={
                              showHint
                                ? `${token.surface.slice(0, 1)}${'·'.repeat(
                                    Math.max(1, token.surface.length - 1)
                                  )}`
                                : 'gõ từ...'
                            }
                            style={{ width: `${Math.min(20, minChars)}ch` }}
                            className={`h-9 px-2.5 text-base font-medium rounded-lg border focus:outline-none transition-colors ${
                              isCorrect
                                ? 'bg-teal-500/15 border-teal-500 text-teal-800 dark:text-teal-200'
                                : 'zen-surface-subtle border-indigo-400'
                            }`}
                          />
                          {isCorrect ? (
                            <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setHintRevealed((prev) => ({ ...prev, [token.id]: true }))
                              }
                              title={`Gợi ý (${token.surface.length} ký tự)`}
                              className="opacity-55 hover:text-indigo-600 cursor-pointer"
                            >
                              <HelpCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!isCorrect && typed.length > 0 && renderCharDiff(token.surface, typed)}
                        </span>
                      );
                    }

                    if (token.isPunctuation) {
                      return (
                        <span key={token.id} className="text-xl md:text-2xl opacity-55 select-none">
                          {token.surface}
                        </span>
                      );
                    }

                    const isCollocationToken = Boolean(
                      token.isMultiWord ||
                        token.phraseType === 'collocation' ||
                        token.phraseType === 'phrasal_verb' ||
                        token.phraseType === 'idiom'
                    );

                    const matchedWeakness = weaknessMap
                      ? weaknessMap.get(token.surface.trim().toLowerCase()) ||
                        (token.lemma
                          ? weaknessMap.get(token.lemma.trim().toLowerCase())
                          : undefined)
                      : undefined;

                    const underlineClass = matchedWeakness
                      ? 'underline decoration-amber-500 dark:decoration-amber-400 decoration-wavy decoration-2 underline-offset-4'
                      : isCollocationToken
                        ? 'underline decoration-indigo-600 dark:decoration-indigo-400 decoration-2 underline-offset-4'
                        : adaptiveTier === 'target'
                          ? 'underline decoration-indigo-500/75 dark:decoration-indigo-400/75 decoration-2 underline-offset-4'
                          : adaptiveTier === 'stretch'
                            ? 'underline decoration-teal-500/80 dark:decoration-teal-400/80 decoration-2 underline-offset-4'
                            : '';

                    const tokenTitle = matchedWeakness
                      ? `Điểm cần củng cố (từng sai ${matchedWeakness.errorCount} lần · ${matchedWeakness.categoryLabel}) — chạm để ôn lại ngay!`
                      : isCollocationToken
                        ? 'Cụm Collocation / Cụm cố định — chạm để xem nguyên khối & Thang nâng cấp 3 tầng'
                        : undefined;

                    return (
                      <React.Fragment key={token.id}>
                        <button
                          type="button"
                          onClick={() => onTokenClick(activeLine, token)}
                          title={tokenTitle}
                          className={`group relative inline-flex flex-col items-center px-1.5 py-0.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : matchedWeakness
                                ? 'bg-amber-500/12 hover:bg-amber-500/20'
                                : isCollocationToken
                                  ? 'bg-indigo-500/10 hover:bg-indigo-500/20'
                                  : 'hover:bg-black/5 dark:hover:bg-white/10'
                          }`}
                        >
                          {matchedWeakness && !isSelected && (
                            <span
                              aria-hidden="true"
                              className="w-1.5 h-1.5 rounded-full bg-amber-500 absolute -top-0.5 right-0.5"
                            />
                          )}
                          <span
                            className={`text-xl md:text-[23px] font-medium tracking-tight ${
                              isSelected ? '' : underlineClass
                            }`}
                          >
                            {language === 'ja' ? renderJapaneseTokenText(token) : token.surface}
                          </span>

                          {language === 'en' && showPhonetics && token.ipa && (
                            <span
                              className={`font-ipa text-[12px] leading-tight mt-0.5 ${
                                isSelected
                                  ? 'text-indigo-100'
                                  : token.weakForm
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'opacity-65'
                              }`}
                            >
                              {token.ipa}
                            </span>
                          )}
                        </button>

                        {language === 'en' &&
                          showPhonetics &&
                          token.linkedToNext &&
                          idx < activeLine.tokens.length - 1 && (
                            <span
                              className="text-teal-600 dark:text-teal-400 font-semibold text-base select-none -mx-1 mb-1"
                              title="Nối âm (Connected Speech Linking)"
                            >
                              ‿
                            </span>
                          )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {language === 'en' &&
                  showPhonetics &&
                  activeLine.connectedSpeech &&
                  activeLine.connectedSpeech.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-80">
                      <span className="font-semibold text-teal-700 dark:text-teal-300">
                        Nối âm / Nuốt âm:
                      </span>
                      {activeLine.connectedSpeech.slice(0, 3).map((cs, i) => (
                        <span key={i}>
                          <span className="font-ipa font-medium">{cs.notation}</span>{' '}
                          <span className="opacity-75">({cs.explanation})</span>
                        </span>
                      ))}
                    </div>
                  )}
                {/* Cross-Video Smart Reminder when active line contains a tracked Weakness */}
                {weaknessMap &&
                  weaknessMap.size > 0 &&
                  (() => {
                    const hits: WeaknessEntry[] = [];
                    const seenIds = new Set<string>();
                    const lowerSentence = activeLine.text.toLowerCase();
                    for (const tok of activeLine.tokens) {
                      const hit =
                        weaknessMap.get(tok.surface.trim().toLowerCase()) ||
                        (tok.lemma ? weaknessMap.get(tok.lemma.trim().toLowerCase()) : undefined);
                      if (hit && !seenIds.has(hit.id)) {
                        seenIds.add(hit.id);
                        hits.push(hit);
                      }
                    }
                    if (hits.length === 0) {
                      for (const [key, entry] of weaknessMap.entries()) {
                        if (key.length >= 2 && lowerSentence.includes(key) && !seenIds.has(entry.id)) {
                          seenIds.add(entry.id);
                          hits.push(entry);
                          if (hits.length >= 2) break;
                        }
                      }
                    }
                    if (hits.length === 0) return null;
                    return (
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-amber-800 dark:text-amber-300">
                        <span className="font-bold inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Điểm cần củng cố gặp lại:
                        </span>
                        {hits.slice(0, 3).map((w) => (
                          <span key={w.id} className={language === 'ja' ? 'font-jp' : ''}>
                            <strong>{w.term}</strong>
                            <span className="opacity-75 font-vi">
                              {' '}
                              (từng sai {w.errorCount} lần{w.meaningVi ? ` · ${w.meaningVi}` : ''})
                            </span>
                          </span>
                        ))}
                      </div>
                    );
                  })()}
              </div>
            )}

            {/* Optional Secondary Vietnamese Reference (Hidden by default to lock brain on EN/JA) */}
            {showTranslationVi && activeLine.translationVi && (
              <div
                className={`pt-2 border-t border-black/5 dark:border-white/10 ${
                  blurTranslation ? `blur-reveal ${isRevealHeld ? 'revealed' : ''}` : ''
                }`}
              >
                <p className="font-vi text-xs md:text-[13px] opacity-65 leading-relaxed safe-wrap">
                  {activeLine.translationVi}
                </p>
              </div>
            )}

            {dictationMode && (
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs opacity-75">
                <span>
                  Luyện Nghe Chép Chính Tả: Video tự dừng cuối câu để bạn gõ từ bị ẩn.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onReplayCurrentLine}
                    className="h-7 px-2.5 font-medium rounded-md zen-surface-subtle border cursor-pointer"
                  >
                    Nghe lại câu (R)
                  </button>
                  <button
                    type="button"
                    onClick={onNextLine}
                    className="h-7 px-2.5 font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                  >
                    Câu tiếp theo →
                  </button>
                </div>
              </div>
            )}

            {/* Tier-3 Windowed STT Continuation Trigger */}
            {hasMoreStt && onLoadMoreStt && (
              <div className="pt-2 border-t border-black/5 dark:border-white/10 flex items-center justify-between gap-2 text-xs">
                <span className="opacity-70">
                  Đang giải mã âm thanh thông minh từng phần để tiết kiệm thời gian chờ.
                </span>
                <button
                  type="button"
                  disabled={isLoadingMoreStt}
                  onClick={onLoadMoreStt}
                  className="h-7 px-3 font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isLoadingMoreStt ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PlusCircle className="w-3.5 h-3.5" />
                  )}
                  <span>{isLoadingMoreStt ? 'Đang nghe phần tiếp...' : 'Tải tiếp phần sau'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Optional Sync Verification HUD (Real-time HH:MM:SS.mmm vs Active Cue Window [start -> end]) */}
      {showSyncHud && totalLines > 0 && (
        <div className="rounded-xl zen-surface border px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tabular">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              <span className="font-vi opacity-65">Giờ thực:</span>{' '}
              <strong className="text-indigo-700 dark:text-indigo-300">
                {formatTimeMs(currentTime)}
              </strong>
            </span>
            {activeLine ? (
              <>
                <span>
                  <span className="font-vi opacity-65">Khung câu #{activeLine.index + 1}:</span>{' '}
                  <strong>
                    [{formatTimeMs(activeLine.start)} ➔ {formatTimeMs(activeLine.end)}]
                  </strong>
                </span>
                <span className="font-vi font-semibold text-teal-700 dark:text-teal-300">
                  {currentTime >= activeLine.start && currentTime <= activeLine.end
                    ? '✓ Khớp 100% (<20ms)'
                    : '✓ Đã khóa biên'}
                </span>
              </>
            ) : (
              <span className="font-vi opacity-70">♪ Khoảng lặng · Đã ẩn phụ đề cũ</span>
            )}
          </div>
          {onAdjustSyncOffset && (
            <div className="inline-flex items-center gap-1">
              <span className="font-vi opacity-65">Vi chỉnh:</span>
              <button
                type="button"
                onClick={() =>
                  onAdjustSyncOffset(Math.max(-0.5, Number((syncOffsetSec - 0.05).toFixed(2))))
                }
                className="h-6 px-1.5 rounded zen-surface-subtle border hover:border-indigo-400 font-semibold cursor-pointer"
              >
                −0.05s
              </button>
              <button
                type="button"
                onClick={() => onAdjustSyncOffset(0)}
                className="h-6 px-1.5 rounded zen-surface-subtle border font-semibold cursor-pointer"
              >
                {syncOffsetSec > 0
                  ? `+${syncOffsetSec.toFixed(2)}s`
                  : `${syncOffsetSec.toFixed(2)}s`}
              </button>
              <button
                type="button"
                onClick={() =>
                  onAdjustSyncOffset(Math.min(0.5, Number((syncOffsetSec + 0.05).toFixed(2))))
                }
                className="h-6 px-1.5 rounded zen-surface-subtle border hover:border-indigo-400 font-semibold cursor-pointer"
              >
                +0.05s
              </button>
            </div>
          )}
        </div>
      )}

      {/* 1:1 Locked Word Profile (Desktop Card / Mobile Bottom Sheet) */}
      {selectedToken && (
        <WordProfilePopover
          language={language}
          targetLevel={targetLevel}
          videoTitle={videoTitle}
          prevSentence={prevSentence}
          nextSentence={nextSentence}
          activeToken={selectedToken.token}
          activeLine={selectedToken.line}
          profile={wordProfile}
          isLoading={isLookupLoading}
          error={lookupError}
          isSaved={isCurrentWordSaved}
          onClose={onCloseWordPopover}
          onSaveCard={onSaveWordCard}
          onSaveNuanceDualCard={onSaveNuanceDualCard}
          onReplayLine={onReplayCurrentLine}
          isDetectedCollocationSaved={isDetectedCollocationSaved}
          onSaveDetectedCollocation={onSaveDetectedCollocation}
          onOpenCollocationWeb={onOpenCollocationWeb}
          savedTermKeys={savedTermKeys}
          onSaveExtraCollocation={onSaveExtraCollocation}
        />
      )}

      {/* Clean 1-Row Quick Controls + Progressive Disclosure Advanced Drawer */}
      <div className="rounded-2xl zen-surface border p-3.5 space-y-3">
        {/* Primary Row: Transport · Loop · Speed · Advanced Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onPrevLine}
              disabled={totalLines === 0}
              title="Câu trước (←)"
              className="h-8 px-2.5 text-xs font-medium rounded-lg zen-surface-subtle border disabled:opacity-40 flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Trước</span>
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              disabled={!activeLine && totalLines === 0}
              title="Phát / Tạm dừng (Space)"
              className="h-8 px-3.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Dừng' : 'Phát'}</span>
            </button>

            <button
              type="button"
              onClick={onNextLine}
              disabled={totalLines === 0}
              title="Câu tiếp (→)"
              className="h-8 px-2.5 text-xs font-medium rounded-lg zen-surface-subtle border disabled:opacity-40 flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <span className="hidden sm:inline">Sau</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onToggleLoopSingleLine}
              disabled={totalLines === 0}
              title="Lặp câu hiện tại (Phím R)"
              className={`h-8 px-2.5 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap border ${
                loopSingleLine
                  ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-400'
                  : 'zen-surface-subtle'
              }`}
            >
              <Repeat1 className="w-3.5 h-3.5" />
              <span>Lặp câu</span>
            </button>

            <button
              type="button"
              onClick={onCycleABLoop}
              disabled={totalLines === 0}
              title="Đặt mốc vòng lặp A-B (Phím S)"
              className={`h-8 px-2.5 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap border ${
                loopA !== null
                  ? 'bg-teal-500/15 text-teal-800 dark:text-teal-300 border-teal-400'
                  : 'zen-surface-subtle'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
              <span className="font-mono-tabular">
                {loopA === null
                  ? 'A-B'
                  : loopB === null
                    ? `A: ${formatTime(loopA)}`
                    : `${formatTime(loopA)}–${formatTime(loopB)}`}
              </span>
            </button>

            {loopA !== null && (
              <button
                type="button"
                onClick={onClearABLoop}
                className="h-8 px-2 text-xs opacity-65 hover:text-rose-600 cursor-pointer"
              >
                Hủy
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 zen-surface-subtle border p-0.5 rounded-lg">
              {SPEED_OPTIONS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => onChangePlaybackRate(rate)}
                  className={`px-1.5 py-1 text-[11px] font-mono-tabular font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    playbackRate === rate
                      ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                      : 'opacity-65 hover:opacity-100'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowAdvancedTools((v) => !v)}
              aria-expanded={showAdvancedTools}
              className={`h-8 px-2.5 text-xs font-semibold rounded-lg border flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                showAdvancedTools
                  ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border-indigo-400'
                  : 'zen-surface-subtle hover:border-indigo-400'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Luyện sâu</span>
              {showAdvancedTools ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Progressive Disclosure: Advanced Shadowing, Blur, Dictation, Clip Cutter & Quote Card */}
        {showAdvancedTools && (
          <div className="pt-3 border-t border-black/5 dark:border-white/10 space-y-3">
            {/* Active Listening & Scene Power Actions */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleBlurOriginal}
                title="Làm mờ phụ đề — rê chuột hoặc giữ phím H để xem"
                className={`h-8 px-2.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
                  blurOriginal
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-400'
                    : 'zen-surface-subtle'
                }`}
              >
                {blurOriginal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>Mờ gốc (H)</span>
              </button>

              <button
                type="button"
                onClick={onToggleBlurTranslation}
                className={`h-8 px-2.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
                  blurTranslation
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-400'
                    : 'zen-surface-subtle'
                }`}
              >
                {blurTranslation ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
                <span>Mờ Việt</span>
              </button>

              <button
                type="button"
                onClick={onToggleDictationMode}
                disabled={totalLines === 0}
                className={`h-8 px-2.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
                  dictationMode
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'zen-surface-subtle'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>Chép chính tả</span>
              </button>

              <button
                type="button"
                onClick={onToggleAutoPausePerLine}
                disabled={totalLines === 0}
                className={`h-8 px-2.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
                  autoPausePerLine
                    ? 'bg-teal-500/15 text-teal-800 dark:text-teal-300 border-teal-400'
                    : 'zen-surface-subtle'
                }`}
              >
                <Timer className="w-3.5 h-3.5" />
                <span>Tự dừng</span>
              </button>

              {autoPausePerLine && (
                <select
                  value={autoPauseDelaySec}
                  onChange={(e) => onChangeAutoPauseDelaySec(Number(e.target.value))}
                  aria-label="Thời gian nghỉ Shadowing"
                  className="h-8 px-2 text-xs font-mono-tabular rounded-lg zen-surface-subtle border cursor-pointer"
                >
                  <option value={3}>3 giây</option>
                  <option value={4}>4 giây</option>
                  <option value={5}>5 giây</option>
                </select>
              )}

              {activeLine && (
                <>
                  <button
                    type="button"
                    onClick={onOpenRoleplay}
                    className="h-8 px-2.5 text-xs font-medium rounded-lg zen-surface-subtle border hover:border-indigo-500 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Theater className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Nhập vai cảnh này</span>
                  </button>

                  <button
                    type="button"
                    onClick={onSaveSmartClip}
                    className="h-8 px-2.5 text-xs font-medium rounded-lg zen-surface-subtle border hover:border-teal-500 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Scissors className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    <span>{clipSavedFeedback ? 'Đã lưu Clip' : 'Cắt đoạn 12s'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDownloadQuoteCard(activeLine)}
                    className="h-8 px-2.5 text-xs font-medium rounded-lg zen-surface-subtle border hover:border-amber-500 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <ImageDown className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>Thẻ trích dẫn .PNG</span>
                  </button>
                </>
              )}

              <label className="inline-flex items-center gap-1.5 text-xs opacity-75 pl-1 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={autoPauseOnClick}
                  onChange={onToggleAutoPauseOnClick}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Dừng khi tra từ</span>
              </label>

              {/* Sync Verification HUD Toggle [⏱ Kiểm định đồng bộ] + ±0.05s Micro-Trim */}
              {totalLines > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSyncHud((v) => !v)}
                  className={`h-8 px-2.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
                    showSyncHud
                      ? 'bg-teal-500/15 text-teal-800 dark:text-teal-300 border-teal-400'
                      : 'zen-surface-subtle'
                  }`}
                >
                  <Timer className="w-3.5 h-3.5" />
                  <span>Kiểm định đồng bộ</span>
                </button>
              )}

              {onAdjustSyncOffset && totalLines > 0 && (
                <div
                  className="inline-flex items-center gap-0.5 zen-surface-subtle border rounded-lg p-0.5 text-[11px] font-mono-tabular whitespace-nowrap"
                  title="Vi chỉnh độ lệch ±0.05s (tự lưu riêng cho video này)"
                >
                  <span className="px-1.5 font-vi opacity-65">Nhịp:</span>
                  <button
                    type="button"
                    onClick={() =>
                      onAdjustSyncOffset(Math.max(-0.5, Number((syncOffsetSec - 0.05).toFixed(2))))
                    }
                    className="h-6 px-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 font-semibold cursor-pointer"
                    title="Lùi phụ đề -0.05 giây"
                  >
                    −0.05s
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdjustSyncOffset(0)}
                    className={`h-6 px-1.5 rounded font-semibold cursor-pointer ${
                      syncOffsetSec !== 0
                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                        : 'opacity-75'
                    }`}
                    title="Đặt lại 0.00s mặc định"
                  >
                    {syncOffsetSec > 0
                      ? `+${syncOffsetSec.toFixed(2)}s`
                      : `${syncOffsetSec.toFixed(2)}s`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onAdjustSyncOffset(Math.min(0.5, Number((syncOffsetSec + 0.05).toFixed(2))))
                    }
                    className="h-6 px-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 font-semibold cursor-pointer"
                    title="Đẩy phụ đề +0.05 giây"
                  >
                    +0.05s
                  </button>
                </div>
              )}
            </div>

            {/* Shadowing Recorder & Real-Time AI Pronunciation Scorer */}
            <div className="pt-2.5 border-t border-black/5 dark:border-white/10">
              <ShadowingRecorder
                language={language}
                activeLine={activeLine}
                onReplayOriginal={onReplayCurrentLine}
                onShadowScored={onShadowScored}
                disabled={totalLines === 0}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
