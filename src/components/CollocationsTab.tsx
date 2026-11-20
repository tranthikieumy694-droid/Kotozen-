import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  BookmarkCheck,
  BookmarkPlus,
  CheckCircle2,
  Clock,
  GitBranch,
  Layers,
  Loader2,
  Microscope,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  Collocation3TierItem,
  CollocationTier,
  CollocationWebBranchItem,
  CollocationWebData,
  Language,
  NuanceDualPayload,
  NuanceMatrixGroup,
  ProficiencyLevel,
} from '../types';
import { formatTime, speakNative } from '../lib/youtube';
import { fetchCollocationWeb } from '../lib/api';
import {
  listCollocationHistoryExpressions,
  recordCollocationHistoryExpressions,
} from '../lib/db';
import { CORE_WORD_STARTERS } from '../data/collocationLibrary';
import { NuanceMatrixPanel } from './NuanceMatrixPanel';
import { DualModeNuancePanel } from './DualModeNuancePanel';

interface CollocationsTabProps {
  language: Language;
  targetLevel: ProficiencyLevel;
  collocations: Collocation3TierItem[] | null;
  isLoading: boolean;
  error: string | null;
  hasLines: boolean;
  savedTermKeys: Set<string>;
  onGenerateCollocations: () => void;
  onExpandMoreCollocations?: () => void;
  isExpandingMore?: boolean;
  onSeekTo: (seconds: number) => void;
  onSaveCollocation: (
    item: Collocation3TierItem,
    tierKey: CollocationTier
  ) => void;
  onSaveWebItem?: (item: CollocationWebBranchItem, coreWord: string) => void;
  onOpenEncyclopedia?: () => void;
  onDrillCompleted?: (score: number, total: number) => void;
  // Core-word jump from WordProfilePopover
  initialCoreWord?: string | null;
  onClearInitialCoreWord?: () => void;
  // Sub-tab: Nuance Matrix & Dual-Mode Nuance
  nuanceMatrix: NuanceMatrixGroup[] | null;
  isNuanceLoading: boolean;
  isNuanceExpanding?: boolean;
  nuanceError: string | null;
  onGenerateNuanceMatrix: () => void;
  onExpandThreeNuance?: () => void;
  videoTitle?: string;
  onSaveNuanceDualCard?: (
    payload: NuanceDualPayload,
    context?: { timestamp?: number; sentence?: string; sentenceVi?: string }
  ) => void;
}

const TIER_META: Record<
  CollocationTier,
  { dot: string; label: string; shortLabel: string; textClass: string; activeBg: string }
> = {
  casual: {
    dot: 'bg-emerald-500',
    label: 'Tầng 1 · Đời thường',
    shortLabel: 'Đời thường',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    activeBg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-200',
  },
  natural: {
    dot: 'bg-sky-500',
    label: 'Tầng 2 · Tự nhiên bản xứ',
    shortLabel: 'Tự nhiên',
    textClass: 'text-sky-700 dark:text-sky-300',
    activeBg: 'bg-sky-500/15 border-sky-500/40 text-sky-800 dark:text-sky-200',
  },
  academic: {
    dot: 'bg-violet-500',
    label: 'Tầng 3 · Học thuật / Cao cấp',
    shortLabel: 'Học thuật',
    textClass: 'text-violet-700 dark:text-violet-300',
    activeBg: 'bg-violet-500/15 border-violet-500/40 text-violet-800 dark:text-violet-200',
  },
};

export const CollocationsTab: React.FC<CollocationsTabProps> = ({
  language,
  targetLevel,
  collocations,
  isLoading,
  error,
  hasLines,
  savedTermKeys,
  onGenerateCollocations,
  onExpandMoreCollocations,
  isExpandingMore = false,
  onSeekTo,
  onSaveCollocation,
  onSaveWebItem,
  onOpenEncyclopedia,
  onDrillCompleted,
  initialCoreWord,
  onClearInitialCoreWord,
  nuanceMatrix,
  isNuanceLoading,
  isNuanceExpanding = false,
  nuanceError,
  onGenerateNuanceMatrix,
  onExpandThreeNuance,
  videoTitle,
  onSaveNuanceDualCard,
}) => {
  const [subTab, setSubTab] = useState<'3tier' | 'web' | 'drill' | 'nuance'>('3tier');
  const [tierFilter, setTierFilter] = useState<'all' | CollocationTier>('all');
  const [cardTierMap, setCardTierMap] = useState<Record<string, CollocationTier>>({});
  const [compareOpenMap, setCompareOpenMap] = useState<Record<string, boolean>>({});
  const [nuanceOpenMap, setNuanceOpenMap] = useState<Record<string, boolean>>({});

  // --- Core-Word Collocation Map state ---
  const [webInput, setWebInput] = useState('');
  const [webData, setWebData] = useState<CollocationWebData | null>(null);
  const [isWebLoading, setIsWebLoading] = useState(false);
  const [isWebExpanding, setIsWebExpanding] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);

  // --- Dual-Mode 15s Active Drill state ---
  const [drillMode, setDrillMode] = useState<'cloze' | 'upgrade'>('cloze');
  const [drillIdx, setDrillIdx] = useState(0);
  const [selectedChoiceIdx, setSelectedChoiceIdx] = useState<number | null>(null);
  const [drillScore, setDrillScore] = useState(0);
  const [drillFinished, setDrillFinished] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(15);

  const loadCoreWordWeb = useCallback(
    async (rawWord: string, appendMode = false) => {
      const cleaned = rawWord.trim();
      if (!cleaned) return;
      if (appendMode) {
        setIsWebExpanding(true);
      } else {
        setIsWebLoading(true);
        setWebError(null);
      }

      try {
        const historyExprs = await listCollocationHistoryExpressions(language);
        const currentExprs =
          appendMode && webData
            ? [
                ...webData.verbNoun.map((x) => x.expression),
                ...webData.adjNoun.map((x) => x.expression),
                ...webData.advVerbAdj.map((x) => x.expression),
              ]
            : [];
        const excludeExpressions = appendMode
          ? Array.from(new Set([...historyExprs, ...currentExprs]))
          : [];

        const resp = await fetchCollocationWeb({
          coreWord: cleaned,
          language,
          excludeExpressions,
        });

        const returnedExprs = [
          ...resp.web.verbNoun.map((x) => x.expression),
          ...resp.web.adjNoun.map((x) => x.expression),
          ...resp.web.advVerbAdj.map((x) => x.expression),
        ];
        await recordCollocationHistoryExpressions(language, returnedExprs);

        if (appendMode && webData && webData.coreWord.toLowerCase() === cleaned.toLowerCase()) {
          setWebData({
            ...webData,
            verbNoun: [...webData.verbNoun, ...resp.web.verbNoun],
            adjNoun: [...webData.adjNoun, ...resp.web.adjNoun],
            advVerbAdj: [...webData.advVerbAdj, ...resp.web.advVerbAdj],
          });
        } else {
          setWebData(resp.web);
        }
      } catch (err) {
        setWebError(err instanceof Error ? err.message : 'Không thể tạo bản đồ từ gốc.');
      } finally {
        setIsWebLoading(false);
        setIsWebExpanding(false);
      }
    },
    [language, webData]
  );

  // Handle jump from WordProfilePopover ("Mở Bản đồ Từ gốc")
  useEffect(() => {
    if (initialCoreWord && initialCoreWord.trim()) {
      setSubTab('web');
      setWebInput(initialCoreWord.trim());
      loadCoreWordWeb(initialCoreWord.trim(), false);
      onClearInitialCoreWord?.();
    }
  }, [initialCoreWord, loadCoreWordWeb, onClearInitialCoreWord]);

  // Reset web map when switching learning language
  useEffect(() => {
    if (webData && webData.language !== language) {
      setWebData(null);
      setWebInput('');
    }
  }, [language, webData]);

  // Build Dual-Mode 15s Active Drill questions
  const drillQuestions = useMemo(() => {
    if (!collocations || collocations.length === 0) return [];
    return collocations.slice(0, 6).map((item) => {
      if (drillMode === 'upgrade') {
        const hasUpgrade =
          Array.isArray(item.styleUpgradeOptions) &&
          item.styleUpgradeOptions.length >= 2 &&
          typeof item.styleUpgradeCorrectIndex === 'number' &&
          item.styleUpgradeCorrectIndex >= 0 &&
          item.styleUpgradeCorrectIndex < item.styleUpgradeOptions.length;

        if (hasUpgrade) {
          return {
            id: `${item.id}_upg`,
            promptVi:
              item.styleUpgradePromptVi ||
              'Đổi câu nói bình dân sang Collocation Tự nhiên / Học thuật chuẩn nhất:',
            contextSentence: item.styleUpgradeCasualSentence || item.casual.exampleSentence,
            options: item.styleUpgradeOptions as string[],
            correctIndex: item.styleUpgradeCorrectIndex as number,
            explanationHint: `${item.casual.expression} ➔ ${item.academic.expression}`,
          };
        }

        // Clean fallback for sessions generated before Mode 2 schema
        const opts = [
          item.academic.exampleSentence || item.academic.expression,
          item.antiCalqueTrap || `❌ ${item.casual.expression}`,
          item.natural.exampleSentence || item.natural.expression,
        ];
        return {
          id: `${item.id}_upg`,
          promptVi: `Nâng cấp ý “${item.vietnameseConcept}” lên tầng Học thuật / Trang trọng:`,
          contextSentence: item.casual.exampleSentence || item.casual.expression,
          options: opts,
          correctIndex: 0,
          explanationHint: `${item.casual.expression} ➔ ${item.academic.expression}`,
        };
      }

      // Mode 1: Partner Cloze (Tìm Nửa Kia)
      const hasValidCloze =
        Array.isArray(item.quickDrillOptions) &&
        item.quickDrillOptions.length >= 2 &&
        item.quickDrillCorrectIndex >= 0 &&
        item.quickDrillCorrectIndex < item.quickDrillOptions.length;

      if (hasValidCloze) {
        return {
          id: `${item.id}_cloze`,
          promptVi: item.quickDrillQuestion || item.vietnameseConcept,
          contextSentence: item.patternFormula ? `Công thức: ${item.patternFormula}` : '',
          options: item.quickDrillOptions,
          correctIndex: item.quickDrillCorrectIndex,
          explanationHint: item.academic.expression,
        };
      }

      return {
        id: `${item.id}_cloze`,
        promptVi: item.vietnameseConcept,
        contextSentence: '',
        options: [item.natural.expression, item.antiCalqueTrap || item.casual.expression],
        correctIndex: 0,
        explanationHint: item.academic.expression,
      };
    });
  }, [collocations, drillMode]);

  // 15-second per-turn countdown timer when actively answering a drill question
  useEffect(() => {
    if (
      subTab !== 'drill' ||
      drillFinished ||
      selectedChoiceIdx !== null ||
      drillQuestions.length === 0
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          setSelectedChoiceIdx(-1); // Timeout reveal
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [subTab, drillFinished, selectedChoiceIdx, drillQuestions.length, drillIdx, drillMode]);

  const resetDrill = useCallback((nextMode?: 'cloze' | 'upgrade') => {
    if (nextMode) setDrillMode(nextMode);
    setDrillIdx(0);
    setSelectedChoiceIdx(null);
    setDrillScore(0);
    setDrillFinished(false);
    setSecondsLeft(15);
  }, []);

  const handleChooseDrillOption = (optIdx: number) => {
    if (selectedChoiceIdx !== null) return;
    const currentQ = drillQuestions[drillIdx];
    if (!currentQ) return;
    setSelectedChoiceIdx(optIdx);
    if (optIdx === currentQ.correctIndex) {
      setDrillScore((s) => s + 1);
    }
  };

  const handleNextDrill = () => {
    const nextIdx = drillIdx + 1;
    if (nextIdx >= drillQuestions.length) {
      setDrillFinished(true);
      onDrillCompleted?.(drillScore, drillQuestions.length);
    } else {
      setDrillIdx(nextIdx);
      setSelectedChoiceIdx(null);
      setSecondsLeft(15);
    }
  };

  const starters = CORE_WORD_STARTERS[language];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sub-tab header */}
      <div className="px-3 pt-2.5 pb-2 border-b border-black/5 dark:border-white/10 flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto min-w-0">
          <button
            type="button"
            onClick={() => setSubTab('3tier')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === '3tier'
                ? 'bg-indigo-600 text-white'
                : 'zen-surface-subtle opacity-75 hover:opacity-100'
            }`}
          >
            Trong Video
          </button>

          <button
            type="button"
            onClick={() => setSubTab('web')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
              subTab === 'web'
                ? 'bg-indigo-600 text-white'
                : 'zen-surface-subtle opacity-75 hover:opacity-100'
            }`}
          >
            <Network className="w-3 h-3" />
            <span>Bản đồ từ gốc</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSubTab('drill');
              setSecondsLeft(15);
              if (!collocations && hasLines && !isLoading) onGenerateCollocations();
            }}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
              subTab === 'drill'
                ? 'bg-indigo-600 text-white'
                : 'zen-surface-subtle opacity-75 hover:opacity-100'
            }`}
          >
            <Zap className="w-3 h-3" />
            <span>Luyện 15s</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('nuance')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'nuance'
                ? 'bg-indigo-600 text-white'
                : 'zen-surface-subtle opacity-75 hover:opacity-100'
            }`}
          >
            Sắc thái
          </button>
        </div>

        {onOpenEncyclopedia && (
          <button
            type="button"
            onClick={onOpenEncyclopedia}
            title="Mở Thư Viện Collocations Bách Khoa (22 Chủ đề Đời sống & Học thuật)"
            className="h-7 px-2 text-[11px] font-semibold rounded-md bg-teal-500/12 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookOpen className="w-3 h-3" />
            <span className="hidden sm:inline">Bách khoa</span>
          </button>
        )}
      </div>

      {/* SUB-TAB 4: Nuance Matrix */}
      {subTab === 'nuance' && (
        <NuanceMatrixPanel
          language={language}
          targetLevel={targetLevel}
          matrix={nuanceMatrix}
          isLoading={isNuanceLoading}
          isExpanding={isNuanceExpanding}
          error={nuanceError}
          hasLines={hasLines}
          videoTitle={videoTitle}
          onGenerateMatrix={onGenerateNuanceMatrix}
          onExpandThreeMore={onExpandThreeNuance}
          onSeekTo={onSeekTo}
          onSaveNuanceDualCard={onSaveNuanceDualCard}
        />
      )}

      {/* SUB-TAB 2: CORE-WORD COLLOCATION MAP */}
      {subTab === 'web' && (
        <div className="flex-1 min-h-0 overflow-y-auto zen-scroll p-3.5 space-y-3.5">
          {/* Search core word form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadCoreWordWeb(webInput, false);
            }}
            className="flex items-center gap-1.5"
          >
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 opacity-50 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={webInput}
                onChange={(e) => setWebInput(e.target.value)}
                placeholder={
                  language === 'ja'
                    ? 'Nhập từ gốc (vd: 取る, かける, 引く, 講じる, 影響)...'
                    : 'Nhập từ gốc (vd: make, take, draw, pose, challenge)...'
                }
                className={`w-full h-9 pl-8 pr-3 text-xs rounded-lg zen-surface-subtle border focus:outline-none focus:border-indigo-500 ${
                  language === 'ja' ? 'font-jp' : ''
                }`}
              />
            </div>
            <button
              type="submit"
              disabled={isWebLoading || !webInput.trim()}
              className="h-9 px-3 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isWebLoading ? 'Đang vẽ...' : 'Mở bản đồ'}
            </button>
          </form>

          {/* Quick starter chips */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium opacity-65">
              Từ gốc tần suất cao ({language === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}):
            </div>
            <div className="flex flex-wrap gap-1.5">
              {starters.map((word) => (
                <button
                  key={word}
                  type="button"
                  onClick={() => {
                    setWebInput(word);
                    loadCoreWordWeb(word, false);
                  }}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                    language === 'ja' ? 'font-jp' : ''
                  } ${
                    webData?.coreWord === word
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'zen-surface-subtle hover:border-indigo-500'
                  }`}
                >
                  {word}
                </button>
              ))}
            </div>
          </div>

          {webError && <p className="text-xs text-rose-600 dark:text-rose-400">{webError}</p>}

          {isWebLoading && (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs opacity-75">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
              <span>Đang vẽ Bản đồ Collocations chuẩn bản xứ (V+N · Adj+N · Adv+V/Adj)...</span>
            </div>
          )}

          {!isWebLoading && !webData && (
            <div className="py-8 px-4 text-center rounded-xl zen-surface-subtle border space-y-2">
              <Network className="w-8 h-8 text-indigo-600 dark:text-indigo-400 mx-auto opacity-80" />
              <h4 className="text-sm font-bold">Bản Đồ Collocations Từ Gốc</h4>
              <p className="text-xs opacity-70 leading-relaxed max-w-xs mx-auto">
                Chọn 1 từ gốc ở trên hoặc bấm từ bất kỳ trên phụ đề để xem toàn bộ mạng lưới Động từ + Danh từ, Tính từ + Danh từ và Trạng từ chuẩn từ điển.
              </p>
            </div>
          )}

          {!isWebLoading && webData && (
            <div className="space-y-3.5">
              {/* Core-Word Hub Header */}
              <div className="p-3.5 rounded-xl bg-indigo-500/8 border border-indigo-500/25 flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-baseline flex-wrap gap-2">
                    <h4 className={`text-lg font-bold ${language === 'ja' ? 'font-jp' : ''}`}>
                      {webData.coreWord}
                    </h4>
                    {webData.readingOrIpa && (
                      <span
                        className={`text-xs opacity-75 ${
                          language === 'ja' ? 'font-jp' : 'font-ipa'
                        }`}
                      >
                        {webData.readingOrIpa}
                      </span>
                    )}
                    {webData.hanViet && (
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                        · {webData.hanViet}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium opacity-85">{webData.meaningVi}</p>
                </div>
                <button
                  type="button"
                  onClick={() => speakNative(webData.coreWord, language)}
                  className="h-8 px-2.5 text-xs rounded-lg zen-surface border hover:border-indigo-500 flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Nghe</span>
                </button>
              </div>

              {/* 3 Branches: V+N · Adj+N · Adv+V/Adj */}
              {[
                {
                  key: 'vn',
                  title:
                    language === 'ja'
                      ? 'Nhánh 1 · Danh từ + Trợ từ + Động từ (N + 助詞 + V)'
                      : 'Nhánh 1 · Động từ + Danh từ (Verb + Noun)',
                  items: webData.verbNoun,
                },
                {
                  key: 'an',
                  title:
                    language === 'ja'
                      ? 'Nhánh 2 · Tính từ / Định ngữ + Danh từ (Adj + N)'
                      : 'Nhánh 2 · Tính từ + Danh từ (Adj + Noun)',
                  items: webData.adjNoun,
                },
                {
                  key: 'av',
                  title:
                    language === 'ja'
                      ? 'Nhánh 3 · Phó từ + Động từ / Tính từ (Adv + V/Adj)'
                      : 'Nhánh 3 · Trạng từ + Động từ / Tính từ (Adv + V/Adj)',
                  items: webData.advVerbAdj,
                },
              ].map(
                (branch) =>
                  branch.items.length > 0 && (
                    <div key={branch.key} className="space-y-2">
                      <div className="text-xs font-bold opacity-75 px-0.5">{branch.title}</div>
                      <div className="space-y-2">
                        {branch.items.map((item) => {
                          const meta = TIER_META[item.tier] || TIER_META.natural;
                          const isSaved = savedTermKeys.has(
                            `vocab::${item.expression.toLowerCase()}`
                          );
                          return (
                            <div
                              key={item.id}
                              className="p-3 rounded-xl zen-surface-subtle border space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${meta.textClass}`}
                                >
                                  <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                                  {meta.shortLabel} · {item.level}
                                  <span className="opacity-65 font-normal font-mono-tabular">
                                    · {item.patternFormula}
                                  </span>
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => speakNative(item.expression, language)}
                                    className="w-6 h-6 rounded hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer"
                                    title="Nghe cụm từ"
                                  >
                                    <Volume2 className="w-3.5 h-3.5 opacity-70" />
                                  </button>
                                  {onSaveWebItem && (
                                    <button
                                      type="button"
                                      disabled={isSaved}
                                      onClick={() => onSaveWebItem(item, webData.coreWord)}
                                      className={`h-6 px-2 rounded text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                                        isSaved
                                          ? 'text-teal-600 dark:text-teal-400 cursor-default'
                                          : 'hover:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                                      }`}
                                    >
                                      {isSaved ? (
                                        <BookmarkCheck className="w-3.5 h-3.5 animate-star-pop" />
                                      ) : (
                                        <BookmarkPlus className="w-3.5 h-3.5" />
                                      )}
                                      <span>{isSaved ? 'Đã lưu' : 'Lưu'}</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div
                                className={`text-sm font-bold safe-wrap ${
                                  language === 'ja' ? 'font-jp' : ''
                                }`}
                              >
                                {item.expression}
                              </div>

                              {(item.readingOrIpa || item.hanViet) && (
                                <div className="flex flex-wrap items-center gap-x-2 text-xs opacity-70">
                                  {item.readingOrIpa && (
                                    <span className={language === 'ja' ? 'font-jp' : 'font-ipa'}>
                                      {item.readingOrIpa}
                                    </span>
                                  )}
                                  {item.hanViet && (
                                    <span className="font-semibold text-amber-700 dark:text-amber-300">
                                      · {item.hanViet}
                                    </span>
                                  )}
                                </div>
                              )}

                              <p className="text-xs font-medium opacity-90">{item.meaningVi}</p>
                              <p
                                className={`text-xs italic opacity-75 ${
                                  language === 'ja' ? 'font-jp' : ''
                                }`}
                              >
                                “{item.exampleSentence}”
                              </p>

                              {item.antiCalque && (
                                <div className="pt-1.5 border-t border-black/5 dark:border-white/10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                                  <span className="text-teal-700 dark:text-teal-300 font-semibold">
                                    ✅ {item.antiCalque.correctForm}
                                  </span>
                                  <span className="text-rose-600 dark:text-rose-400 line-through">
                                    ❌ {item.antiCalque.wrongTrap}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
              )}

              {/* Infinite Zero-Duplicate Expansion for Core-Word Map */}
              <button
                type="button"
                disabled={isWebExpanding}
                onClick={() => loadCoreWordWeb(webData.coreWord, true)}
                className="w-full h-9 text-xs font-semibold rounded-xl zen-surface-subtle border hover:border-indigo-500 flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isWebExpanding ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                ) : (
                  <Plus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                )}
                <span>
                  {isWebExpanding
                    ? 'Đang mở rộng nhánh mới không trùng lặp...'
                    : `Mở rộng thêm Collocations mới cho “${webData.coreWord}” (0% trùng)`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 1 & 3: VIDEO 3-TIER COLLOCATIONS & DUAL-MODE 15S DRILL */}
      {(subTab === '3tier' || subTab === 'drill') && (
        <div className="flex-1 min-h-0 overflow-y-auto zen-scroll p-3.5 space-y-3.5">
          {/* Empty / Trigger State */}
          {!collocations && !isLoading && (
            <div className="py-10 px-4 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <div className="space-y-1 max-w-sm mx-auto">
                <h3 className="text-sm font-bold">
                  Collocations 3 Tầng (Đời thường ➔ Tự nhiên ➔ Học thuật)
                </h3>
                <p className="text-xs opacity-70 leading-relaxed">
                  Trích xuất toàn bộ cụm kết hợp chuẩn bản xứ trong video, kèm Thang nâng cấp 3 tầng, Radar chống Vietlish và bài luyện phản xạ 15 giây.
                </p>
              </div>
              <button
                type="button"
                disabled={!hasLines}
                onClick={onGenerateCollocations}
                className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-45 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Trích xuất Collocations từ Video ({targetLevel})</span>
              </button>
              {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-xs opacity-75">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
              <span>Đang trích xuất Collocations 3 tầng, Radar Anti-Calque &amp; bài luyện 15s...</span>
            </div>
          )}

          {/* SUB-TAB 1: 3-TIER COLLOCATION CARDS WITH UPGRADE LADDER & TIER FILTER */}
          {subTab === '3tier' && collocations && collocations.length > 0 && !isLoading && (
            <>
              {/* Top Filter & Refresh Row */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold opacity-70">
                    {collocations.length} cụm diễn đạt · Mục tiêu {targetLevel}
                  </div>
                  <button
                    type="button"
                    onClick={onGenerateCollocations}
                    className="h-7 px-2 text-[11px] font-medium rounded-md zen-surface-subtle border hover:border-indigo-500 flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Làm mới</span>
                  </button>
                </div>

                {/* 3-Tier Filter Chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'all', label: 'Thang 3 tầng', dot: '' },
                      { id: 'casual', label: 'Đời thường', dot: 'bg-emerald-500' },
                      { id: 'natural', label: 'Tự nhiên', dot: 'bg-sky-500' },
                      { id: 'academic', label: 'Học thuật', dot: 'bg-violet-500' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setTierFilter(f.id)}
                      className={`h-7 px-2.5 text-[11px] font-semibold rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        tierFilter === f.id
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'zen-surface-subtle opacity-80 hover:opacity-100'
                      }`}
                    >
                      {f.dot && (
                        <span
                          className={`w-2 h-2 rounded-full ${
                            tierFilter === f.id ? 'bg-white' : f.dot
                          }`}
                        />
                      )}
                      <span>{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {collocations.map((item) => {
                const activeTier: CollocationTier =
                  tierFilter !== 'all' ? tierFilter : cardTierMap[item.id] || 'natural';
                const activeVariant = item[activeTier] || item.natural || item.casual;
                const meta = TIER_META[activeTier];
                const isCompareOpen = Boolean(compareOpenMap[item.id]);
                const isSaved = activeVariant
                  ? savedTermKeys.has(`vocab::${activeVariant.expression.toLowerCase()}`)
                  : false;

                return (
                  <article
                    key={item.id}
                    className="rounded-xl zen-surface-subtle border p-3.5 space-y-3"
                  >
                    {/* Header: Vietnamese concept + Formula + Jump-to-timestamp */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center flex-wrap gap-x-2 text-[11px] opacity-65">
                          <span className="font-medium">Ý diễn đạt cốt lõi</span>
                          {item.patternFormula && (
                            <span className="font-mono-tabular">· {item.patternFormula}</span>
                          )}
                        </div>
                        <h4 className="text-sm font-bold leading-snug safe-wrap">
                          {item.vietnameseConcept}
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSeekTo(item.timestamp)}
                        className="h-7 px-2 rounded-md zen-surface border hover:border-indigo-500 text-[11px] font-mono-tabular flex items-center gap-1 shrink-0 cursor-pointer"
                        title="Nhảy tới đoạn video chứa ý này"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" />
                        <span>{formatTime(item.timestamp)}</span>
                      </button>
                    </div>

                    {/* Interactive 3-Step Upgrade Ladder Slider (shown in 'all' mode) */}
                    {tierFilter === 'all' && (
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['casual', 'natural', 'academic'] as CollocationTier[]).map((tKey) => {
                          const tMeta = TIER_META[tKey];
                          const v = item[tKey];
                          const isCurrent = activeTier === tKey;
                          return (
                            <button
                              key={tKey}
                              type="button"
                              onClick={() =>
                                setCardTierMap((prev) => ({ ...prev, [item.id]: tKey }))
                              }
                              className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                                isCurrent
                                  ? tMeta.activeBg
                                  : 'zen-surface opacity-75 hover:opacity-100'
                              }`}
                            >
                              <div className="flex items-center gap-1 text-[10px] font-bold">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tMeta.dot}`} />
                                <span className="truncate">{tMeta.shortLabel}</span>
                              </div>
                              <div
                                className={`text-xs font-semibold truncate mt-0.5 ${
                                  language === 'ja' ? 'font-jp' : ''
                                }`}
                              >
                                {v?.expression}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Focused Active Variant Split-Card */}
                    {activeVariant && (
                      <div className="p-3 rounded-lg zen-surface border space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${meta.textClass}`}>
                            <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                            {meta.label} · {activeVariant.level}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => speakNative(activeVariant.expression, language)}
                              title="Nghe phát âm cụm từ"
                              className="w-6 h-6 rounded hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer"
                            >
                              <Volume2 className="w-3.5 h-3.5 opacity-70" />
                            </button>
                            <button
                              type="button"
                              disabled={isSaved}
                              onClick={() => onSaveCollocation(item, activeTier)}
                              title={isSaved ? 'Đã lưu vào kho FSRS' : 'Lưu vào kho FSRS'}
                              className={`h-6 px-2 rounded text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                                isSaved
                                  ? 'text-teal-600 dark:text-teal-400 cursor-default'
                                  : 'hover:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                              }`}
                            >
                              {isSaved ? (
                                <BookmarkCheck className="w-3.5 h-3.5 animate-star-pop" />
                              ) : (
                                <BookmarkPlus className="w-3.5 h-3.5" />
                              )}
                              <span>{isSaved ? 'Đã lưu' : 'Lưu FSRS'}</span>
                            </button>
                          </div>
                        </div>

                        <div
                          className={`text-[15px] font-bold leading-snug safe-wrap ${
                            language === 'ja' ? 'font-jp' : ''
                          }`}
                        >
                          {activeVariant.expression}
                        </div>

                        {(activeVariant.readingOrIpa || activeVariant.hanViet) && (
                          <div className="flex flex-wrap items-center gap-x-2 text-xs opacity-70">
                            {activeVariant.readingOrIpa && (
                              <span className={language === 'ja' ? 'font-jp' : 'font-ipa'}>
                                {activeVariant.readingOrIpa}
                              </span>
                            )}
                            {activeVariant.hanViet && (
                              <span className="font-semibold text-amber-700 dark:text-amber-300">
                                · Hán Việt: {activeVariant.hanViet}
                              </span>
                            )}
                          </div>
                        )}

                        {activeVariant.exampleSentence && (
                          <p
                            className={`text-xs opacity-85 italic ${
                              language === 'ja' ? 'font-jp' : ''
                            }`}
                          >
                            “{activeVariant.exampleSentence}”
                          </p>
                        )}

                        {activeVariant.nuanceVi && (
                          <p className="text-xs opacity-80 leading-relaxed">
                            {activeVariant.nuanceVi}
                          </p>
                        )}

                        {/* [So sánh ngữ cảnh dùng] + [⚡/🔬 Sắc thái 2 tầng] Toggle */}
                        <div className="pt-1.5 border-t border-black/5 dark:border-white/10 flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setCompareOpenMap((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <GitBranch className="w-3 h-3" />
                            <span>
                              {isCompareOpen ? 'Thu gọn so sánh 3 tầng' : 'So sánh ngữ cảnh dùng'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setNuanceOpenMap((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            className={`h-6 px-2 text-[11px] font-semibold rounded-md border flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors ${
                              nuanceOpenMap[item.id]
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'zen-surface-subtle hover:border-indigo-500 text-indigo-700 dark:text-indigo-300'
                            }`}
                          >
                            <Microscope className="w-3 h-3" />
                            <span>
                              {nuanceOpenMap[item.id] ? 'Ẩn sắc thái' : '⚡/🔬 Sắc thái'}
                            </span>
                          </button>
                        </div>

                        {isCompareOpen && (
                          <div className="p-2.5 rounded-lg bg-indigo-500/7 border border-indigo-500/20 text-xs space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                              <span className={language === 'ja' ? 'font-jp' : ''}>
                                {item.casual.expression}
                              </span>
                              <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                              <span className={language === 'ja' ? 'font-jp' : ''}>
                                {item.natural.expression}
                              </span>
                              <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                              <span className={language === 'ja' ? 'font-jp' : ''}>
                                {item.academic.expression}
                              </span>
                            </div>
                            {item.contextCompareVi && (
                              <p className="opacity-85 leading-relaxed">{item.contextCompareVi}</p>
                            )}
                          </div>
                        )}

                        {nuanceOpenMap[item.id] && (
                          <div className="pt-1 min-w-0">
                            <DualModeNuancePanel
                              requestParams={{
                                term: activeVariant.expression,
                                lemma: activeVariant.expression,
                                language,
                                targetLevel,
                                kind: 'collocation',
                                sentence: activeVariant.exampleSentence || item.vietnameseConcept,
                                compareTerms: [
                                  item.casual.expression,
                                  item.natural.expression,
                                  item.academic.expression,
                                ].filter(Boolean),
                                videoTitle,
                                timestamp: item.timestamp,
                              }}
                              defaultMode="summary"
                              compact={true}
                              isSaved={isSaved}
                              onSaveNuanceCard={
                                onSaveNuanceDualCard
                                  ? (payload) =>
                                      onSaveNuanceDualCard(payload, {
                                        timestamp: item.timestamp,
                                        sentence:
                                          activeVariant.exampleSentence || activeVariant.expression,
                                        sentenceVi: item.vietnameseConcept,
                                      })
                                  : undefined
                              }
                              titleLabel={`Sắc thái Collocation · ${activeVariant.expression}`}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Anti-Calque Visual ✅ vs ❌ Contrast Radar */}
                    {item.antiCalqueTrap && (
                      <div className="p-2.5 rounded-lg zen-surface border space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-700 dark:text-rose-300">
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                          <span>Radar Bẫy Dịch Từng Chữ (Anti-Calque)</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                          <div className="px-2 py-1.5 rounded bg-teal-500/10 text-teal-800 dark:text-teal-200 flex items-start gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-teal-600 dark:text-teal-400" />
                            <span className={`font-semibold safe-wrap ${language === 'ja' ? 'font-jp' : ''}`}>
                              {item.antiCalqueCorrect || item.natural.expression}
                            </span>
                          </div>
                          <div className="px-2 py-1.5 rounded bg-rose-500/10 text-rose-800 dark:text-rose-200 flex items-start gap-1.5">
                            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                            <span className={`line-through opacity-90 safe-wrap ${language === 'ja' ? 'font-jp' : ''}`}>
                              {item.antiCalqueTrap.replace(/^❌\s*/, '')}
                            </span>
                          </div>
                        </div>
                        {item.antiCalqueParticleNote && (
                          <p className="text-[11px] opacity-75 leading-relaxed">
                            {item.antiCalqueParticleNote}
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}

              {/* Infinite Zero-Duplicate [+3 Collocations Mới] Button */}
              {onExpandMoreCollocations && (
                <button
                  type="button"
                  disabled={isExpandingMore}
                  onClick={onExpandMoreCollocations}
                  className="w-full h-10 text-xs font-semibold rounded-xl zen-surface-subtle border hover:border-indigo-500 flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isExpandingMore ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  )}
                  <span>
                    {isExpandingMore
                      ? 'Đang trích xuất thêm +3 Collocations mới (0% trùng lặp)...'
                      : '+3 Collocations Mới từ Video (Không trùng lặp)'}
                  </span>
                </button>
              )}
            </>
          )}

          {/* SUB-TAB 3: DUAL-MODE 15-SECOND ACTIVE COLLOCATION DRILL */}
          {subTab === 'drill' && drillQuestions.length > 0 && !isLoading && (
            <div className="space-y-3">
              {/* 2-Mode Switcher */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl zen-surface-subtle border">
                <button
                  type="button"
                  onClick={() => resetDrill('cloze')}
                  className={`py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    drillMode === 'cloze'
                      ? 'bg-indigo-600 text-white'
                      : 'opacity-75 hover:opacity-100'
                  }`}
                >
                  1. Tìm Nửa Kia (Cloze)
                </button>
                <button
                  type="button"
                  onClick={() => resetDrill('upgrade')}
                  className={`py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    drillMode === 'upgrade'
                      ? 'bg-indigo-600 text-white'
                      : 'opacity-75 hover:opacity-100'
                  }`}
                >
                  2. Đổi Tầng Văn Phong
                </button>
              </div>

              <div className="rounded-xl zen-surface-subtle border p-4 space-y-4">
                {drillFinished ? (
                  <div className="py-6 text-center space-y-3">
                    <CheckCircle2 className="w-10 h-10 text-teal-600 dark:text-teal-400 mx-auto animate-star-pop" />
                    <h4 className="text-base font-bold">
                      Hoàn thành vòng {drillMode === 'cloze' ? 'Tìm Nửa Kia' : 'Đổi Tầng Văn Phong'}:{' '}
                      {drillScore}/{drillQuestions.length} câu chuẩn bản xứ!
                    </h4>
                    <p className="text-xs opacity-75">
                      Phản xạ chọn đúng cụm Collocation trong 15 giây giúp khắc sâu quán tính bản xứ lâu gấp 3 lần học từ rời.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => resetDrill()}
                        className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                      >
                        Luyện lại chế độ này
                      </button>
                      <button
                        type="button"
                        onClick={() => resetDrill(drillMode === 'cloze' ? 'upgrade' : 'cloze')}
                        className="h-9 px-4 text-xs font-semibold rounded-lg zen-surface border hover:border-indigo-500 cursor-pointer"
                      >
                        Chuyển sang chế độ {drillMode === 'cloze' ? '2 · Đổi Tầng' : '1 · Tìm Nửa Kia'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Progress & 15s Timer Bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold opacity-75">
                          Câu {drillIdx + 1}/{drillQuestions.length}
                        </span>
                        <div className="flex items-center gap-3">
                          <span
                            className={`inline-flex items-center gap-1 font-mono-tabular font-bold ${
                              secondsLeft <= 5
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-indigo-600 dark:text-indigo-400'
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>{secondsLeft}s</span>
                          </span>
                          <span className="font-mono-tabular font-semibold text-teal-600 dark:text-teal-400">
                            Đúng: {drillScore}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-black/8 dark:bg-white/10 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-1000 ${
                            secondsLeft <= 5 ? 'bg-rose-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${(secondsLeft / 15) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium opacity-65">
                        {drillMode === 'cloze'
                          ? 'Chọn nửa kia tạo thành Collocation chuẩn bản xứ:'
                          : 'Nâng cấp câu đời thường dưới đây lên tầng Tự nhiên / Học thuật:'}
                      </div>
                      <p className="text-sm font-bold leading-snug safe-wrap">
                        {drillQuestions[drillIdx].promptVi}
                      </p>
                      {drillQuestions[drillIdx].contextSentence && (
                        <div
                          className={`p-2.5 rounded-lg zen-surface border text-xs font-medium ${
                            language === 'ja' ? 'font-jp' : ''
                          }`}
                        >
                          {drillQuestions[drillIdx].contextSentence}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      {drillQuestions[drillIdx].options.map((opt, optIdx) => {
                        const isChosen = selectedChoiceIdx === optIdx;
                        const isCorrect = optIdx === drillQuestions[drillIdx].correctIndex;
                        let stateClass = 'zen-surface border hover:border-indigo-500';
                        if (selectedChoiceIdx !== null) {
                          if (isCorrect) {
                            stateClass =
                              'bg-teal-500/15 border-teal-500 text-teal-800 dark:text-teal-200';
                          } else if (isChosen) {
                            stateClass =
                              'bg-rose-500/15 border-rose-500 text-rose-800 dark:text-rose-200';
                          } else {
                            stateClass = 'zen-surface border opacity-55';
                          }
                        }

                        return (
                          <button
                            key={`${optIdx}_${opt}`}
                            type="button"
                            onClick={() => handleChooseDrillOption(optIdx)}
                            className={`w-full text-left p-3 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                              language === 'ja' ? 'font-jp' : ''
                            } ${stateClass}`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>

                    {selectedChoiceIdx !== null && (
                      <div className="pt-2 border-t border-black/5 dark:border-white/10 flex items-center justify-between gap-2">
                        <div className="text-xs opacity-85 min-w-0">
                          {selectedChoiceIdx === -1 && (
                            <span className="font-bold text-rose-600 dark:text-rose-400 mr-1.5">
                              Hết 15s!
                            </span>
                          )}
                          <span className="font-semibold">Gợi ý nâng cấp: </span>
                          <span
                            className={
                              language === 'ja' ? 'font-jp font-semibold' : 'font-semibold'
                            }
                          >
                            {drillQuestions[drillIdx].explanationHint}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleNextDrill}
                          className="h-8 px-3.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 cursor-pointer"
                        >
                          {drillIdx + 1 >= drillQuestions.length ? 'Xem kết quả' : 'Câu tiếp →'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
