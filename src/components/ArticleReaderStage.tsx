import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Columns2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Highlighter,
  Layers,
  Loader2,
  MessageCircleQuestion,
  Minus,
  Plus,
  Printer,
  Rows3,
  ScanSearch,
  StickyNote,
  Trash2,
  Volume2,
} from 'lucide-react';
import type {
  ArticleLanguage,
  ArticleNote,
  ArticleSession,
  ArticleViewMode,
  Collocation3TierItem,
  CollocationTier,
  DetectedCollocation,
  InputCompatibilityReport,
  Language,
  NuanceDualPayload,
  ProficiencyLevel,
  RubySegment,
  SubtitleLine,
  SubtitleToken,
  WordExtraCollocation,
  WordProfile,
} from '../types';
import { CEFR_LEVELS, JLPT_LEVELS, speakNative } from '../lib/youtube';
import { ArticleAudioBar } from './ArticleAudioBar';
import { WordProfilePopover } from './WordProfilePopover';

interface ArticleReaderStageProps {
  article: ArticleSession;
  activeLanguage: ArticleLanguage;
  targetLevel: ProficiencyLevel;
  viewMode: ArticleViewMode;
  showTriLingualStack: boolean;
  onViewModeChange: (mode: ArticleViewMode) => void;
  onToggleTriLingualStack: () => void;
  onSwitchLanguage: (lang: ArticleLanguage) => void;
  onTargetLevelChange: (level: ProficiencyLevel) => void;
  /** Mapped SubtitleLine[] for the active target language (1:1 index with article.sentences) */
  mappedLines: SubtitleLine[];
  activeSentenceIndex: number;
  onActiveSentenceIndexChange: (index: number) => void;
  highlightedParagraphId: string | null;
  highlightedSentenceId: string | null;
  isTranslating: boolean;
  translatedCount: number;
  totalSentenceCount: number;
  /** Display controls */
  showReadingAid: boolean;
  onToggleReadingAid: () => void;
  blurTranslation: boolean;
  onToggleBlurTranslation: () => void;
  isHoldingH: boolean;
  /** Lexical highlighting (Collocations 3-tier & Level Highlighter) */
  collocations: Collocation3TierItem[];
  showCollocationUnderlines: boolean;
  onToggleCollocationUnderlines: () => void;
  showLevelHighlights: boolean;
  onToggleLevelHighlights: () => void;
  iPlusOneReport: InputCompatibilityReport | null;
  /** 1-Click Word Profile Popover (100% parity with YouTube Studio) */
  selectedToken: SubtitleToken | null;
  selectedLine: SubtitleLine | null;
  wordProfile: WordProfile | null;
  isWordLoading: boolean;
  wordError: string | null;
  isSelectedWordSaved: boolean;
  savedTermKeys: Set<string>;
  onTokenClick: (token: SubtitleToken, line: SubtitleLine) => void;
  onCloseWordPopover: () => void;
  onSaveWordCard: (profile: WordProfile) => void;
  onSaveDetectedCollocation: (col: DetectedCollocation, line: SubtitleLine) => void;
  onSaveExtraCollocation: (col: WordExtraCollocation, line: SubtitleLine) => void;
  onOpenCollocationWeb: (coreWord: string) => void;
  onSaveNuanceDualCard: (
    payload: NuanceDualPayload,
    context?: { timestamp?: number; sentence?: string; sentenceVi?: string }
  ) => void;
  /** X-Ray, AI Sensei, Notes, Export & Viewport Preemption */
  onOpenSentenceXRay: (line: SubtitleLine) => void;
  onAskAiSenseiSelection: (selectedText: string, surroundingContext: string) => void;
  onViewportVisibleRange: (minSentenceIdx: number, maxSentenceIdx: number) => void;
  notes: ArticleNote[];
  onAddNote: (paragraphId: string, content: string) => void;
  onDeleteNote: (noteId: string) => void;
  onExportMarkdown: () => void;
  onExportAnkiCsv: () => void;
  onShadowScored?: () => void;
}

const LANG_OPTIONS: Array<{ id: ArticleLanguage; flag: string; label: string; short: string }> = [
  { id: 'vi', flag: '🇻🇳', label: 'Tiếng Việt', short: 'Việt' },
  { id: 'en', flag: '🇬🇧', label: 'Tiếng Anh', short: 'Anh' },
  { id: 'ja', flag: '🇯🇵', label: 'Tiếng Nhật', short: 'Nhật' },
];

const LEVEL_RANK: Record<string, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
  N5: 1,
  N4: 2,
  N3: 3,
  N2: 4,
  N1: 5,
};

function renderRubySegments(segments: RubySegment[], showFurigana: boolean) {
  return segments.map((seg, i) => {
    const hasKanji = /[\u4E00-\u9FFF々ヶ]/.test(seg.base);
    if (showFurigana && seg.reading && hasKanji) {
      return (
        <ruby key={i}>
          {seg.base}
          <rt>{seg.reading}</rt>
        </ruby>
      );
    }
    return <React.Fragment key={i}>{seg.base}</React.Fragment>;
  });
}

export const ArticleReaderStage: React.FC<ArticleReaderStageProps> = ({
  article,
  activeLanguage,
  targetLevel,
  viewMode,
  showTriLingualStack,
  onViewModeChange,
  onToggleTriLingualStack,
  onSwitchLanguage,
  onTargetLevelChange,
  mappedLines,
  activeSentenceIndex,
  onActiveSentenceIndexChange,
  highlightedParagraphId,
  highlightedSentenceId,
  isTranslating,
  translatedCount,
  totalSentenceCount,
  showReadingAid,
  onToggleReadingAid,
  blurTranslation,
  onToggleBlurTranslation,
  isHoldingH,
  collocations,
  showCollocationUnderlines,
  onToggleCollocationUnderlines,
  showLevelHighlights,
  onToggleLevelHighlights,
  iPlusOneReport,
  selectedToken,
  selectedLine,
  wordProfile,
  isWordLoading,
  wordError,
  isSelectedWordSaved,
  savedTermKeys,
  onTokenClick,
  onCloseWordPopover,
  onSaveWordCard,
  onSaveDetectedCollocation,
  onSaveExtraCollocation,
  onOpenCollocationWeb,
  onSaveNuanceDualCard,
  onOpenSentenceXRay,
  onAskAiSenseiSelection,
  onViewportVisibleRange,
  notes,
  onAddNote,
  onDeleteNote,
  onExportMarkdown,
  onExportAnkiCsv,
  onShadowScored,
}) => {
  const [fontSizePx, setFontSizePx] = useState(17);
  const [hoveredSentenceId, setHoveredSentenceId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [activeNoteParagraphId, setActiveNoteParagraphId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [selectionPopup, setSelectionPopup] = useState<{
    text: string;
    context: string;
    x: number;
    y: number;
  } | null>(null);
  const [readingProgressPct, setReadingProgressPct] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const paragraphNodesRef = useRef<Map<string, HTMLElement>>(new Map());
  const visibleSentencesRef = useRef<Set<number>>(new Set());
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  const levels = activeLanguage === 'ja' ? JLPT_LEVELS : CEFR_LEVELS;
  const studyLangForTools: Language = activeLanguage === 'ja' ? 'ja' : 'en';

  // Map sentenceId -> { articleSentence, subtitleLine }
  const sentenceLookup = useMemo(() => {
    const map = new Map<string, { raw: ArticleSession['sentences'][number]; line: SubtitleLine }>();
    article.sentences.forEach((s, idx) => {
      const line = mappedLines[idx];
      if (line) map.set(s.id, { raw: s, line });
    });
    return map;
  }, [article.sentences, mappedLines]);

  // Build fast Collocation phrase matcher for 3-tier color underlines (🟢 casual / 🔵 natural / 🟣 academic)
  const collocationPhraseTiers = useMemo(() => {
    const list: Array<{ phrase: string; tier: CollocationTier }> = [];
    for (const c of collocations || []) {
      if (c.casual?.expression) list.push({ phrase: c.casual.expression.toLowerCase(), tier: 'casual' });
      if (c.natural?.expression) list.push({ phrase: c.natural.expression.toLowerCase(), tier: 'natural' });
      if (c.academic?.expression) list.push({ phrase: c.academic.expression.toLowerCase(), tier: 'academic' });
    }
    return list;
  }, [collocations]);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportMenuOpen]);

  // Scroll-Viewport IntersectionObserver for instant Viewport Preemption (< 1.5s) + Reading Progress %
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const minIdx = Number(el.dataset.minSentence ?? -1);
          const maxIdx = Number(el.dataset.maxSentence ?? -1);
          if (minIdx < 0 || maxIdx < 0) continue;
          if (entry.isIntersecting) {
            for (let i = minIdx; i <= maxIdx; i += 1) visibleSentencesRef.current.add(i);
          } else {
            for (let i = minIdx; i <= maxIdx; i += 1) visibleSentencesRef.current.delete(i);
          }
        }
        if (visibleSentencesRef.current.size > 0) {
          const arr = Array.from(visibleSentencesRef.current);
          const minV = Math.min(...arr);
          const maxV = Math.max(...arr);
          onViewportVisibleRange(minV, maxV);
          if (article.sentences.length > 0) {
            setReadingProgressPct(Math.min(100, Math.round(((maxV + 1) / article.sentences.length) * 100)));
          }
        }
      },
      { rootMargin: '180px 0px 260px 0px', threshold: 0.05 }
    );

    paragraphNodesRef.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [article.id, article.paragraphs.length, article.sentences.length, onViewportVisibleRange]);

  // Scroll smoothly into view when jumping from FSRS flashcard, Quiz evidence, or Collocations
  useEffect(() => {
    const targetId = highlightedParagraphId;
    if (!targetId) return;
    const node = paragraphNodesRef.current.get(targetId);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedParagraphId, highlightedSentenceId]);

  // Text selection listener -> floating [Hỏi AI Sensei] button
  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelectionPopup(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 4 || text.length > 500) {
      setSelectionPopup(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setSelectionPopup(null);
      return;
    }
    // Extract surrounding paragraph text
    const anchorEl = (range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement) as HTMLElement | null;
    const paraEl = anchorEl?.closest('[data-paragraph-id]');
    const surrounding = paraEl?.textContent?.trim().slice(0, 800) || text;
    setSelectionPopup({
      text,
      context: surrounding,
      x: Math.min(window.innerWidth - 160, Math.max(16, rect.left + rect.width / 2 - 75)),
      y: Math.max(70, rect.top - 44),
    });
  };

  // Preserve exact scroll reading anchor when switching language
  const handleLanguageSwitchPreserveScroll = (nextLang: ArticleLanguage) => {
    if (nextLang === activeLanguage) return;
    const visibleArr = Array.from(visibleSentencesRef.current);
    const anchorIdx = visibleArr.length > 0 ? Math.min(...visibleArr) : activeSentenceIndex;
    const anchorSentence = article.sentences[anchorIdx];
    const anchorParaId = anchorSentence?.paragraphId;
    const beforeTop = anchorParaId
      ? paragraphNodesRef.current.get(anchorParaId)?.getBoundingClientRect().top
      : undefined;

    onSwitchLanguage(nextLang);

    if (anchorParaId && typeof beforeTop === 'number') {
      requestAnimationFrame(() => {
        const node = paragraphNodesRef.current.get(anchorParaId);
        if (node) {
          const afterTop = node.getBoundingClientRect().top;
          const delta = afterTop - beforeTop;
          if (Math.abs(delta) > 8) {
            window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
          }
        }
      });
    }
  };

  const getTokenCollocationTier = (
    token: SubtitleToken,
    lineText: string
  ): CollocationTier | null => {
    if (!showCollocationUnderlines || token.isPunctuation) return null;
    const surf = token.surface.toLowerCase();
    const lem = token.lemma.toLowerCase();
    if (token.phraseType === 'collocation' || token.phraseType === 'phrasal_verb' || token.phraseType === 'idiom') {
      const rank = LEVEL_RANK[token.level || ''] || 0;
      if (rank >= 5 || token.isIeltsAcademic) return 'academic';
      if (rank >= 3) return 'natural';
      return 'casual';
    }
    if (collocationPhraseTiers.length === 0 || surf.length < 2) return null;
    const lowerLine = lineText.toLowerCase();
    for (const c of collocationPhraseTiers) {
      if (
        (c.phrase.includes(surf) || (lem.length >= 2 && c.phrase.includes(lem))) &&
        lowerLine.includes(c.phrase)
      ) {
        return c.tier;
      }
    }
    return null;
  };

  const isTokenAboveTargetLevel = (token: SubtitleToken): boolean => {
    if (!showLevelHighlights || token.isPunctuation || !token.level) return false;
    const tokenRank = LEVEL_RANK[token.level];
    const targetRank = LEVEL_RANK[targetLevel];
    if (!tokenRank || !targetRank) return false;
    return tokenRank >= targetRank;
  };

  const renderInteractiveSentenceTokens = (
    line: SubtitleLine,
    rawSentence: ArticleSession['sentences'][number],
    langForRender: ArticleLanguage
  ) => {
    const tokens = line.tokens || [];
    const isJa = langForRender === 'ja';
    const isEn = langForRender === 'en';
    const isTargetEnriched = Boolean(line.enriched);
    const useNativeRubyFallback =
      isJa &&
      !isTargetEnriched &&
      article.sourceLanguage === 'ja' &&
      rawSentence.nativeRuby &&
      rawSentence.nativeRuby.length > 0;

    if (useNativeRubyFallback && rawSentence.nativeRuby) {
      return (
        <span className="font-jp">
          {renderRubySegments(rawSentence.nativeRuby, showReadingAid)}
        </span>
      );
    }

    if (tokens.length === 0) {
      return <span className={isJa ? 'font-jp' : ''}>{line.text}</span>;
    }

    return tokens.map((tk, idx) => {
      const nextTk = tokens[idx + 1];
      const needSpaceAfter =
        !isJa &&
        nextTk &&
        !nextTk.isPunctuation &&
        !/^['’(\[“‘]$/.test(tk.surface);

      if (tk.isPunctuation) {
        return (
          <React.Fragment key={tk.id || idx}>
            <span>{tk.surface}</span>
            {!isJa && /^[,.;:!?)\]"”’]$/.test(tk.surface) && nextTk && !nextTk.isPunctuation ? ' ' : ''}
          </React.Fragment>
        );
      }

      const isSelected =
        selectedToken?.id === tk.id && selectedLine?.id === line.id;
      const colTier = getTokenCollocationTier(tk, line.text);
      const levelHit = isTokenAboveTargetLevel(tk);

      const underlineClass = colTier
        ? colTier === 'academic'
          ? 'underline decoration-violet-500 decoration-2 underline-offset-4'
          : colTier === 'natural'
            ? 'underline decoration-sky-500 decoration-2 underline-offset-4'
            : 'underline decoration-emerald-500 decoration-2 underline-offset-4'
        : levelHit
          ? 'underline decoration-amber-500/85 decoration-wavy underline-offset-4'
          : '';

      const clickable = langForRender !== 'vi';

      const renderInner = () => {
        if (isJa && showReadingAid) {
          if (tk.ruby && tk.ruby.length > 0) {
            return renderRubySegments(tk.ruby, true);
          }
          if (tk.furigana && /[\u4E00-\u9FFF々ヶ]/.test(tk.surface)) {
            return (
              <ruby>
                {tk.surface}
                <rt>{tk.furigana}</rt>
              </ruby>
            );
          }
        }
        return tk.surface;
      };

      return (
        <React.Fragment key={tk.id || idx}>
          <span
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={(e) => {
              if (!clickable) return;
              e.stopPropagation();
              onActiveSentenceIndexChange(line.index);
              onTokenClick(tk, line);
            }}
            onKeyDown={(e) => {
              if (!clickable) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActiveSentenceIndexChange(line.index);
                onTokenClick(tk, line);
              }
            }}
            className={`inline rounded px-0.5 transition-colors ${isJa ? 'font-jp' : ''} ${underlineClass} ${
              clickable
                ? isSelected
                  ? 'bg-indigo-600 text-white'
                  : 'cursor-pointer hover:bg-indigo-500/15'
                : ''
            }`}
          >
            {renderInner()}
            {isEn && showReadingAid && tk.ipa && tk.surface.length >= 4 && (
              <span className="font-ipa text-[10px] opacity-55 ml-0.5 select-none">
                {tk.ipa}
              </span>
            )}
          </span>
          {needSpaceAfter ? ' ' : ''}
        </React.Fragment>
      );
    });
  };

  const notesByParagraph = useMemo(() => {
    const map = new Map<string, ArticleNote[]>();
    for (const n of notes) {
      const arr = map.get(n.paragraphId) || [];
      arr.push(n);
      map.set(n.paragraphId, arr);
    }
    return map;
  }, [notes]);

  const progressPct =
    totalSentenceCount > 0 ? Math.round((translatedCount / totalSentenceCount) * 100) : 100;

  const prevSentenceText =
    selectedLine && selectedLine.index > 0
      ? mappedLines[selectedLine.index - 1]?.text
      : undefined;
  const nextSentenceText =
    selectedLine && selectedLine.index + 1 < mappedLines.length
      ? mappedLines[selectedLine.index + 1]?.text
      : undefined;

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      className="min-w-0 space-y-3"
    >
      {/* Floating [Hỏi AI Sensei] Selection Toolbar */}
      {selectionPopup && (
        <div
          style={{ left: `${selectionPopup.x}px`, top: `${selectionPopup.y}px` }}
          className="fixed z-40 no-print animate-in fade-in duration-100"
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onAskAiSenseiSelection(selectionPopup.text, selectionPopup.context);
              setSelectionPopup(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg flex items-center gap-1.5 cursor-pointer"
          >
            <MessageCircleQuestion className="w-3.5 h-3.5" />
            <span>Hỏi AI Sensei đoạn này</span>
          </button>
        </div>
      )}

      {/* 1. STICKY ZEN ARTICLE TOOLBAR (Tri-Lingual Switcher · 3 View Modes · Typography · Export) */}
      <div className="sticky top-14 z-20 zen-surface/95 backdrop-blur-md border rounded-2xl p-3 space-y-2.5 shadow-xs no-print">
        {/* Row 1: Tri-Lingual Switcher + Target Level + View Modes */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Tri-Lingual Switcher */}
            <div
              className="inline-flex items-center p-0.5 zen-surface-subtle rounded-lg border"
              role="group"
              aria-label="Chuyển đổi 3 ngôn ngữ bài viết"
            >
              {LANG_OPTIONS.map((opt) => {
                const isActive = activeLanguage === opt.id;
                const isOrig = article.sourceLanguage === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleLanguageSwitchPreserveScroll(opt.id)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                      isActive
                        ? 'zen-surface text-indigo-700 dark:text-indigo-300 sepia:text-amber-900 shadow-xs'
                        : 'opacity-65 hover:opacity-100'
                    }`}
                    title={isOrig ? `${opt.label} (Ngôn ngữ gốc của bài viết)` : `Chuyển toàn bộ bài viết sang ${opt.label}`}
                  >
                    <span>{opt.flag}</span>
                    <span className="hidden sm:inline">{opt.label}</span>
                    <span className="sm:hidden">{opt.short}</span>
                    {isOrig && <span className="text-[10px] opacity-60 font-normal">(Gốc)</span>}
                  </button>
                );
              })}
            </div>

            {activeLanguage !== 'vi' && (
              <select
                value={targetLevel}
                onChange={(e) => onTargetLevelChange(e.target.value as ProficiencyLevel)}
                aria-label="Chọn trình độ đọc bài"
                className="h-8 px-2 text-xs font-semibold rounded-lg zen-surface-subtle border cursor-pointer"
              >
                {levels.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {activeLanguage === 'ja' ? `JLPT ${lvl}` : `CEFR ${lvl}`}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 3 Reading View Modes */}
          <div className="inline-flex items-center p-0.5 zen-surface-subtle rounded-lg border">
            <button
              type="button"
              onClick={() => onViewModeChange('focus')}
              className={`px-2 py-1 text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer ${
                viewMode === 'focus'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
              title="Chế độ Tập trung (100% ngôn ngữ đích, làm mờ tiếng Việt)"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Tập trung</span>
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('interlinear')}
              className={`px-2 py-1 text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer ${
                viewMode === 'interlinear'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
              title="Chế độ Song ngữ / Đa ngữ xen kẽ từng câu"
            >
              <Rows3 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Xen kẽ</span>
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('split')}
              className={`px-2 py-1 text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer ${
                viewMode === 'split'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
              title="Chế độ Chia đôi 2 cột (Gốc bên trái · Đích bên phải, rê chuột sáng đồng bộ)"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">2 Cột</span>
            </button>
          </div>
        </div>

        {/* Row 2: Typography, Furigana/IPA, Blur, Level Highlighter, Collocations, Export */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-black/5 dark:border-white/10 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Font size stepper */}
            <div className="inline-flex items-center zen-surface-subtle border rounded-lg h-7">
              <button
                type="button"
                onClick={() => setFontSizePx((v) => Math.max(14, v - 1))}
                title="Thu nhỏ cỡ chữ"
                className="px-2 h-full hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="px-1.5 font-mono-tabular text-[11px] font-semibold">
                {fontSizePx}px
              </span>
              <button
                type="button"
                onClick={() => setFontSizePx((v) => Math.min(23, v + 1))}
                title="Phóng to cỡ chữ"
                className="px-2 h-full hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {activeLanguage !== 'vi' && (
              <button
                type="button"
                onClick={onToggleReadingAid}
                className={`h-7 px-2 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                  showReadingAid
                    ? 'bg-indigo-600/12 border-indigo-500/50 text-indigo-700 dark:text-indigo-300'
                    : 'zen-surface-subtle opacity-70 hover:opacity-100'
                }`}
              >
                {activeLanguage === 'ja' ? 'Furigana' : 'IPA'}
              </button>
            )}

            {viewMode !== 'split' && activeLanguage !== 'vi' && (
              <button
                type="button"
                onClick={onToggleBlurTranslation}
                title="Làm mờ dòng tiếng Việt (rê chuột hoặc giữ phím H để xem)"
                className={`h-7 px-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                  blurTranslation
                    ? 'bg-amber-500/12 border-amber-500/50 text-amber-800 dark:text-amber-300'
                    : 'zen-surface-subtle opacity-70 hover:opacity-100'
                }`}
              >
                {blurTranslation ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                <span>Mờ Việt</span>
              </button>
            )}

            {viewMode === 'interlinear' && (
              <button
                type="button"
                onClick={onToggleTriLingualStack}
                title="Hiển thị chồng cả 3 ngôn ngữ (Anh + Nhật + Việt) nếu đã nạp"
                className={`h-7 px-2 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                  showTriLingualStack
                    ? 'bg-teal-500/12 border-teal-500/50 text-teal-800 dark:text-teal-300'
                    : 'zen-surface-subtle opacity-70 hover:opacity-100'
                }`}
              >
                3 Ngôn ngữ
              </button>
            )}

            {activeLanguage !== 'vi' && (
              <>
                <button
                  type="button"
                  onClick={onToggleLevelHighlights}
                  title={`Gạch chân các từ ở trình độ ${targetLevel} trở lên`}
                  className={`h-7 px-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                    showLevelHighlights
                      ? 'bg-amber-500/12 border-amber-500/50 text-amber-800 dark:text-amber-300'
                      : 'zen-surface-subtle opacity-70 hover:opacity-100'
                  }`}
                >
                  <Highlighter className="w-3 h-3" />
                  <span className="hidden sm:inline">Lọc {targetLevel}+</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleCollocationUnderlines}
                  title="Gạch chân màu Collocations 3 tầng (Xanh lá · Xanh dương · Tím)"
                  className={`h-7 px-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                    showCollocationUnderlines
                      ? 'bg-violet-500/12 border-violet-500/50 text-violet-800 dark:text-violet-300'
                      : 'zen-surface-subtle opacity-70 hover:opacity-100'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span className="hidden sm:inline">Collocations</span>
                </button>
              </>
            )}
          </div>

          {/* Right: Progress + Multi-Format Export */}
          <div className="flex items-center gap-2">
            {isTranslating && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 font-mono-tabular">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>
                  {translatedCount}/{totalSentenceCount} ({progressPct}%)
                </span>
              </span>
            )}

            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setExportMenuOpen((v) => !v)}
                className="h-7 px-2.5 rounded-lg zen-surface-subtle border text-[11px] font-semibold flex items-center gap-1 hover:border-indigo-500 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Xuất bài</span>
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-xl zen-surface border shadow-xl p-1.5 z-40 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setExportMenuOpen(false);
                      window.print();
                    }}
                    className="w-full px-2.5 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-left text-xs font-medium flex items-center gap-2 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5 opacity-70" />
                    <span>In / Lưu PDF chuẩn đọc</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportMenuOpen(false);
                      onExportMarkdown();
                    }}
                    className="w-full px-2.5 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-left text-xs font-medium flex items-center gap-2 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 opacity-70" />
                    <span>Xuất Notion Markdown (.md)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportMenuOpen(false);
                      onExportAnkiCsv();
                    }}
                    className="w-full px-2.5 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-left text-xs font-medium flex items-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 opacity-70" />
                    <span>Xuất thẻ Anki (.csv UTF-8)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Thin reading progress bar */}
        <div className="h-1 w-full rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
          <div
            className="h-full bg-indigo-600 dark:bg-indigo-400 sepia:bg-amber-800 transition-all duration-300"
            style={{ width: `${Math.max(4, readingProgressPct)}%` }}
          />
        </div>
      </div>

      {/* 2. SYNCHRONIZED AUDIO READ-ALOUD & SHADOWING BAR */}
      <ArticleAudioBar
        activeLanguage={activeLanguage}
        lines={mappedLines}
        activeIndex={activeSentenceIndex}
        onActiveIndexChange={onActiveSentenceIndexChange}
        onShadowScored={onShadowScored}
      />

      {/* 3. ZEN READING ROOM CANVAS (max-width 72ch single-column, or synchronized 2-column split) */}
      <article className="zen-surface border rounded-2xl p-5 sm:p-7 md:p-8 shadow-xs min-w-0">
        {/* Article Metadata Header */}
        <header className="max-w-[72ch] mx-auto pb-5 mb-6 border-b border-black/10 dark:border-white/10 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs opacity-70">
            <span className="font-bold text-indigo-600 dark:text-indigo-400">
              {article.siteName || article.domain}
            </span>
            {article.author && (
              <>
                <span aria-hidden="true">·</span>
                <span>{article.author}</span>
              </>
            )}
            {article.publishedDate && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{article.publishedDate}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">
              ~{article.estimatedReadMinutes} phút đọc ({article.paragraphs.length} đoạn)
            </span>
            {iPlusOneReport && activeLanguage !== 'vi' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-teal-600 dark:text-teal-400">
                  Độ tương thích i+1: {iPlusOneReport.knownPercent}% ({iPlusOneReport.verdictLabel})
                </span>
              </>
            )}
            {/^https?:\/\//i.test(article.url) && (
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 ml-auto no-print"
              >
                <span>Mở bài gốc</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <h1
            className={`text-xl sm:text-2xl md:text-[26px] font-extrabold tracking-tight leading-snug ${
              article.sourceLanguage === 'ja' ? 'font-jp' : ''
            }`}
          >
            {article.title}
          </h1>

          {activeLanguage !== 'vi' && (
            <p className="text-[11px] opacity-60 no-print">
              Bấm vào bất kỳ từ nào để tra 5 tầng kiến thức · Bôi đen một đoạn để hỏi AI Sensei · Bấm{' '}
              <span className="font-semibold">🔍</span> cuối mỗi câu để Giải phẫu Cú pháp X-Ray.
            </p>
          )}
        </header>

        {/* Paragraphs List */}
        <div
          className={
            viewMode === 'split'
              ? 'space-y-4 max-w-full'
              : 'space-y-5 max-w-[72ch] mx-auto'
          }
          style={{
            fontSize: `${fontSizePx}px`,
            lineHeight: activeLanguage === 'ja' ? 2.15 : 1.75,
          }}
        >
          {article.paragraphs.map((para) => {
            const paraSentences = para.sentenceIds
              .map((sid) => sentenceLookup.get(sid))
              .filter((x): x is NonNullable<typeof x> => Boolean(x));
            if (paraSentences.length === 0) return null;

            const minSentIdx = paraSentences[0].raw.index;
            const maxSentIdx = paraSentences[paraSentences.length - 1].raw.index;
            const isHighlightedPara = highlightedParagraphId === para.id;
            const paraNotes = notesByParagraph.get(para.id) || [];

            const blockHeadingClass =
              para.blockType === 'h2'
                ? 'text-lg sm:text-xl font-extrabold tracking-tight pt-3'
                : para.blockType === 'h3'
                  ? 'text-base sm:text-lg font-bold pt-2'
                  : para.blockType === 'lead'
                    ? 'font-medium opacity-90 pb-1'
                    : para.blockType === 'blockquote'
                      ? 'pl-4 py-1 italic opacity-90 zen-surface-subtle rounded-r-xl border border-black/10 dark:border-white/10'
                      : para.blockType === 'li'
                        ? 'pl-4'
                        : '';

            const renderSentenceActionButtons = (line: SubtitleLine) => (
              <span className="inline-flex items-center gap-0.5 ml-1.5 align-middle opacity-0 group-hover/sent:opacity-100 focus-within:opacity-100 transition-opacity no-print">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onActiveSentenceIndexChange(line.index);
                    if (activeLanguage !== 'vi') {
                      speakNative(line.text, studyLangForTools, 0.95);
                    }
                  }}
                  title="Nghe đọc câu này"
                  className="p-1 rounded hover:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
                {activeLanguage !== 'vi' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onActiveSentenceIndexChange(line.index);
                      onOpenSentenceXRay(line);
                    }}
                    title="Giải phẫu Cú pháp X-Ray câu này"
                    className="p-1 rounded hover:bg-amber-500/15 text-amber-600 dark:text-amber-400 cursor-pointer"
                  >
                    <ScanSearch className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            );

            return (
              <section
                key={para.id}
                data-paragraph-id={para.id}
                data-min-sentence={minSentIdx}
                data-max-sentence={maxSentIdx}
                ref={(el) => {
                  if (el) paragraphNodesRef.current.set(para.id, el);
                  else paragraphNodesRef.current.delete(para.id);
                }}
                className={`group/para relative rounded-xl transition-colors ${
                  isHighlightedPara
                    ? 'bg-indigo-500/10 ring-1 ring-indigo-500/40 p-3 -mx-3'
                    : ''
                }`}
              >
                {/* Paragraph Note Trigger Button */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* VIEW MODE 3: SPLIT-COLUMN SYNCHRONIZED READER */}
                    {viewMode === 'split' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 items-start">
                        {/* Left Column: Original Source */}
                        <div
                          className={`min-w-0 ${blockHeadingClass} ${
                            article.sourceLanguage === 'ja' ? 'font-jp' : ''
                          }`}
                        >
                          {para.blockType === 'li' && <span className="mr-1.5 opacity-55">•</span>}
                          {paraSentences.map(({ raw }) => {
                            const isHover = hoveredSentenceId === raw.id;
                            const isActive =
                              activeSentenceIndex === raw.index || highlightedSentenceId === raw.id;
                            return (
                              <span
                                key={raw.id}
                                onMouseEnter={() => setHoveredSentenceId(raw.id)}
                                onMouseLeave={() => setHoveredSentenceId(null)}
                                onClick={() => onActiveSentenceIndexChange(raw.index)}
                                className={`rounded px-0.5 transition-colors cursor-pointer ${
                                  isHover || isActive
                                    ? 'bg-indigo-500/15'
                                    : ''
                                }`}
                              >
                                {article.sourceLanguage === 'ja' && raw.nativeRuby
                                  ? renderRubySegments(raw.nativeRuby, showReadingAid)
                                  : raw.originalText}
                                {article.sourceLanguage === 'ja' ? '' : ' '}
                              </span>
                            );
                          })}
                        </div>

                        {/* Right Column: Target Language Interactive */}
                        <div className={`min-w-0 ${blockHeadingClass}`}>
                          {para.blockType === 'li' && <span className="mr-1.5 opacity-55">•</span>}
                          {paraSentences.map(({ raw, line }) => {
                            const isHover = hoveredSentenceId === raw.id;
                            const isActive =
                              activeSentenceIndex === raw.index || highlightedSentenceId === raw.id;
                            const isPending =
                              activeLanguage !== article.sourceLanguage && !line.enriched;
                            return (
                              <span
                                key={raw.id}
                                onMouseEnter={() => setHoveredSentenceId(raw.id)}
                                onMouseLeave={() => setHoveredSentenceId(null)}
                                className={`group/sent rounded px-0.5 transition-colors ${
                                  isHover || isActive
                                    ? 'bg-indigo-500/15'
                                    : ''
                                }`}
                              >
                                {isPending ? (
                                  <span className="inline-block w-36 h-4 rounded bg-black/8 dark:bg-white/10 align-middle animate-pulse mr-1" />
                                ) : (
                                  renderInteractiveSentenceTokens(line, raw, activeLanguage)
                                )}
                                {renderSentenceActionButtons(line)}
                                {activeLanguage === 'ja' ? '' : ' '}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ) : viewMode === 'interlinear' ? (
                      /* VIEW MODE 2: INTERLINEAR PARALLEL (Bilingual or Tri-Lingual EN + JA + VI) */
                      <div className="space-y-3">
                        {paraSentences.map(({ raw, line }) => {
                          const isActive =
                            activeSentenceIndex === raw.index || highlightedSentenceId === raw.id;
                          const isPending =
                            activeLanguage !== article.sourceLanguage && !line.enriched;
                          const otherForeignLang: ArticleLanguage =
                            activeLanguage === 'ja' ? 'en' : 'ja';
                          const otherVariant = raw.variants[otherForeignLang];
                          const viText =
                            line.translationVi ||
                            raw.variants.vi?.text ||
                            (article.sourceLanguage === 'vi' ? raw.originalText : '');

                          return (
                            <div
                              key={raw.id}
                              onClick={() => onActiveSentenceIndexChange(raw.index)}
                              className={`group/sent rounded-xl px-2.5 py-2 -mx-2.5 transition-colors ${
                                isActive ? 'bg-indigo-500/10' : 'hover:bg-black/[0.025] dark:hover:bg-white/[0.03]'
                              }`}
                            >
                              <div className={blockHeadingClass}>
                                {isPending ? (
                                  <span className="inline-block w-3/4 h-4 rounded bg-black/8 dark:bg-white/10 animate-pulse" />
                                ) : (
                                  <>
                                    {renderInteractiveSentenceTokens(line, raw, activeLanguage)}
                                    {renderSentenceActionButtons(line)}
                                  </>
                                )}
                              </div>

                              {/* Optional 3rd language line when Tri-Lingual stack is enabled */}
                              {showTriLingualStack && otherVariant?.enriched && (
                                <div
                                  className={`text-[0.82em] opacity-75 mt-1 leading-relaxed ${
                                    otherForeignLang === 'ja' ? 'font-jp' : ''
                                  }`}
                                >
                                  <span className="text-[10px] font-bold uppercase opacity-60 mr-1.5">
                                    {otherForeignLang === 'ja' ? 'JP' : 'EN'}
                                  </span>
                                  {otherVariant.text}
                                </div>
                              )}

                              {/* Vietnamese parallel gloss (or Original if viewing in Vietnamese) */}
                              {activeLanguage !== 'vi' && viText && (
                                <div
                                  className={`text-[0.82em] opacity-70 mt-1 leading-relaxed transition-all ${
                                    blurTranslation && !isHoldingH
                                      ? 'blur-[5px] hover:blur-0 select-none'
                                      : ''
                                  }`}
                                >
                                  {viText}
                                </div>
                              )}
                              {activeLanguage === 'vi' && article.sourceLanguage !== 'vi' && (
                                <div
                                  className={`text-[0.8em] opacity-65 mt-1 leading-relaxed ${
                                    article.sourceLanguage === 'ja' ? 'font-jp' : ''
                                  }`}
                                >
                                  {raw.originalText}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* VIEW MODE 1: TARGET-ONLY FOCUS (Pure native newspaper feel, blur-to-reveal VI) */
                      <div className="space-y-1.5">
                        <div className={blockHeadingClass}>
                          {para.blockType === 'li' && <span className="mr-1.5 opacity-55">•</span>}
                          {paraSentences.map(({ raw, line }) => {
                            const isActive =
                              activeSentenceIndex === raw.index || highlightedSentenceId === raw.id;
                            const isPending =
                              activeLanguage !== article.sourceLanguage && !line.enriched;
                            return (
                              <span
                                key={raw.id}
                                onClick={() => onActiveSentenceIndexChange(raw.index)}
                                className={`group/sent rounded px-0.5 transition-colors ${
                                  isActive ? 'bg-indigo-500/12' : ''
                                }`}
                              >
                                {isPending ? (
                                  <span className="inline-block w-40 h-4 rounded bg-black/8 dark:bg-white/10 align-middle animate-pulse mr-1" />
                                ) : (
                                  renderInteractiveSentenceTokens(line, raw, activeLanguage)
                                )}
                                {renderSentenceActionButtons(line)}
                                {activeLanguage === 'ja' ? '' : ' '}
                              </span>
                            );
                          })}
                        </div>

                        {/* Subtle collapsible/blurred Vietnamese gloss below paragraph when blur is toggled or H held */}
                        {activeLanguage !== 'vi' && (!blurTranslation || isHoldingH) && (
                          <div className="text-[0.8em] opacity-65 leading-relaxed pt-0.5">
                            {paraSentences
                              .map(
                                ({ raw, line }) =>
                                  line.translationVi ||
                                  raw.variants.vi?.text ||
                                  (article.sourceLanguage === 'vi' ? raw.originalText : '')
                              )
                              .filter(Boolean)
                              .join(' ')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Subtle Paragraph Note Button */}
                  <button
                    type="button"
                    onClick={() =>
                      setActiveNoteParagraphId((prev) => (prev === para.id ? null : para.id))
                    }
                    title="Ghi chú riêng cho đoạn này"
                    className={`mt-1 p-1.5 rounded-lg transition-opacity shrink-0 no-print cursor-pointer ${
                      paraNotes.length > 0 || activeNoteParagraphId === para.id
                        ? 'opacity-100 text-amber-600 dark:text-amber-400 bg-amber-500/10'
                        : 'opacity-0 group-hover/para:opacity-70 hover:!opacity-100'
                    }`}
                  >
                    <StickyNote className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Paragraph-Anchored Notes Display & Composer */}
                {(paraNotes.length > 0 || activeNoteParagraphId === para.id) && (
                  <div className="mt-2 rounded-xl zen-surface-subtle border p-2.5 space-y-2 text-xs no-print">
                    {paraNotes.map((n) => (
                      <div key={n.id} className="flex items-start justify-between gap-2">
                        <p className="leading-relaxed opacity-85">{n.content}</p>
                        <button
                          type="button"
                          onClick={() => onDeleteNote(n.id)}
                          aria-label="Xóa ghi chú"
                          className="p-1 opacity-50 hover:opacity-100 hover:text-rose-500 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {activeNoteParagraphId === para.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!noteDraft.trim()) return;
                          onAddNote(para.id, noteDraft.trim());
                          setNoteDraft('');
                          setActiveNoteParagraphId(null);
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder={`Thêm ghi chú cho đoạn ${para.id.toUpperCase()}...`}
                          className="flex-1 h-8 px-2.5 rounded-lg zen-surface border text-xs focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          type="submit"
                          disabled={!noteDraft.trim()}
                          className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-45 cursor-pointer"
                        >
                          Lưu
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </article>

      {/* 4. 1-CLICK WORD PROFILE POPOVER (100% Parity: 5 Layers + 214 Kangxi + Dual-Mode Nuance) */}
      {selectedToken && selectedLine && activeLanguage !== 'vi' && (
        <WordProfilePopover
          language={studyLangForTools}
          activeToken={selectedToken}
          activeLine={selectedLine}
          profile={wordProfile}
          isLoading={isWordLoading}
          error={wordError}
          isSaved={isSelectedWordSaved}
          onClose={onCloseWordPopover}
          onSaveCard={onSaveWordCard}
          onReplayLine={() => speakNative(selectedLine.text, studyLangForTools, 0.95)}
          onSaveDetectedCollocation={onSaveDetectedCollocation}
          onOpenCollocationWeb={onOpenCollocationWeb}
          savedTermKeys={savedTermKeys}
          onSaveExtraCollocation={onSaveExtraCollocation}
          targetLevel={targetLevel}
          videoTitle={article.title}
          prevSentence={prevSentenceText}
          nextSentence={nextSentenceText}
          onSaveNuanceDualCard={onSaveNuanceDualCard}
        />
      )}
    </div>
  );
};
