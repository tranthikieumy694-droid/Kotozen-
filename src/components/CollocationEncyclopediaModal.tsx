import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  BookmarkCheck,
  BookmarkPlus,
  CheckCircle2,
  GitBranch,
  GraduationCap,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  CollocationTier,
  CollocationTopicBranch,
  Language,
  ThematicCollocationEntry,
} from '../types';
import {
  COLLOCATION_TOPICS,
  CURATED_COLLOCATION_LIBRARY,
} from '../data/collocationLibrary';
import { expandThreeCollocations } from '../lib/api';
import {
  listCollocationHistoryExpressions,
  recordCollocationHistoryExpressions,
} from '../lib/db';
import { speakNative } from '../lib/youtube';

interface CollocationEncyclopediaModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  savedTermKeys: Set<string>;
  onSaveEntryToFsrs: (entry: ThematicCollocationEntry) => void;
}

const TIER_META: Record<
  CollocationTier,
  { dot: string; label: string; shortLabel: string; textClass: string }
> = {
  casual: {
    dot: 'bg-emerald-500',
    label: 'Tầng 1 · Đời thường',
    shortLabel: 'Đời thường',
    textClass: 'text-emerald-700 dark:text-emerald-300',
  },
  natural: {
    dot: 'bg-sky-500',
    label: 'Tầng 2 · Tự nhiên bản xứ',
    shortLabel: 'Tự nhiên',
    textClass: 'text-sky-700 dark:text-sky-300',
  },
  academic: {
    dot: 'bg-violet-500',
    label: 'Tầng 3 · Học thuật / Chuyên nghiệp',
    shortLabel: 'Học thuật',
    textClass: 'text-violet-700 dark:text-violet-300',
  },
};

export const CollocationEncyclopediaModal: React.FC<CollocationEncyclopediaModalProps> = ({
  isOpen,
  onClose,
  language,
  onChangeLanguage,
  savedTermKeys,
  onSaveEntryToFsrs,
}) => {
  const [branch, setBranch] = useState<CollocationTopicBranch>('everyday');
  const [selectedTopicId, setSelectedTopicId] = useState<string>('all');
  const [tierFilter, setTierFilter] = useState<'all' | CollocationTier>('all');
  const [showPhonetics, setShowPhonetics] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [compareOpenMap, setCompareOpenMap] = useState<Record<string, boolean>>({});
  const [expandedEntries, setExpandedEntries] = useState<ThematicCollocationEntry[]>([]);
  const [isExpanding, setIsExpanding] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);

  const topicsInBranch = useMemo(
    () => COLLOCATION_TOPICS.filter((t) => t.branch === branch),
    [branch]
  );

  const allEntries = useMemo(
    () => [...expandedEntries, ...CURATED_COLLOCATION_LIBRARY],
    [expandedEntries]
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allEntries.filter((entry) => {
      if (entry.language !== language) return false;
      if (entry.branch !== branch) return false;
      if (selectedTopicId !== 'all' && entry.topicId !== selectedTopicId) return false;
      if (tierFilter !== 'all' && entry.tier !== tierFilter) return false;
      if (q) {
        const hay = `${entry.expression} ${entry.meaningVi} ${entry.readingOrIpa} ${entry.exampleSentence}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allEntries, language, branch, selectedTopicId, tierFilter, searchQuery]);

  const activeTopicMeta = useMemo(
    () => topicsInBranch.find((t) => t.id === selectedTopicId) || topicsInBranch[0],
    [topicsInBranch, selectedTopicId]
  );

  const handleBranchSwitch = (nextBranch: CollocationTopicBranch) => {
    setBranch(nextBranch);
    setSelectedTopicId('all');
    setExpandError(null);
  };

  const handleExpandThree = async () => {
    if (isExpanding) return;
    setIsExpanding(true);
    setExpandError(null);
    try {
      const historyExprs = await listCollocationHistoryExpressions(language);
      const visibleExprs = allEntries
        .filter((e) => e.language === language)
        .map((e) => e.expression);
      const excludeExpressions = Array.from(new Set([...historyExprs, ...visibleExprs]));

      const targetTopic =
        selectedTopicId === 'all'
          ? topicsInBranch[0]
          : topicsInBranch.find((t) => t.id === selectedTopicId) || topicsInBranch[0];

      const resp = await expandThreeCollocations({
        language,
        topicId: targetTopic.id,
        topicTitleVi: targetTopic.titleVi,
        branch,
        tierFilter,
        excludeExpressions,
      });

      if (resp.entries.length > 0) {
        await recordCollocationHistoryExpressions(
          language,
          resp.entries.map((e) => e.expression)
        );
        setExpandedEntries((prev) => [...resp.entries, ...prev]);
      } else {
        setExpandError('Đã lọc hết các cụm trùng lặp — hãy bấm lại để sinh thêm cụm mới.');
      }
    } catch (err) {
      setExpandError(err instanceof Error ? err.message : 'Không thể tải thêm +3 cụm mới.');
    } finally {
      setIsExpanding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Thư Viện Collocations Bách Khoa"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl max-h-[92vh] rounded-2xl zen-surface border shadow-2xl flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-black/5 dark:border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <h2 className="text-base sm:text-lg font-bold tracking-tight">
                Thư Viện Collocations Bách Khoa
              </h2>
            </div>
            <p className="text-xs opacity-70">
              22 chủ đề thực chiến (Đời sống ➔ Tự nhiên ➔ Học thuật) · Chuẩn Oxford/Cambridge &amp; Đại Từ Lâm/NHK · 0% trùng lặp
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Language Switcher */}
            <div className="inline-flex items-center p-0.5 rounded-lg zen-surface-subtle border">
              <button
                type="button"
                onClick={() => onChangeLanguage('en')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  language === 'en'
                    ? 'bg-indigo-600 text-white'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => onChangeLanguage('ja')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md font-jp transition-colors cursor-pointer ${
                  language === 'ja'
                    ? 'bg-indigo-600 text-white'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                日本語
              </button>
            </div>

            {/* 0ms Furigana / IPA Toggle */}
            <button
              type="button"
              onClick={() => setShowPhonetics((v) => !v)}
              className={`h-8 px-2.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                showPhonetics
                  ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border-indigo-400/50'
                  : 'zen-surface-subtle opacity-75'
              }`}
            >
              {language === 'ja' ? 'Furigana' : 'IPA'}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng Thư viện Collocations"
              className="w-8 h-8 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Branch Selector + Search + Tier Filter */}
        <div className="px-4 sm:px-6 py-3 border-b border-black/5 dark:border-white/10 space-y-2.5 shrink-0 zen-surface-subtle">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* 2 Major Branches: Everyday (12) vs Academic (10) */}
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleBranchSwitch('everyday')}
                className={`h-8 px-3 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  branch === 'everyday'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'zen-surface hover:border-indigo-400'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Đời Sống Hằng Ngày (12)</span>
              </button>

              <button
                type="button"
                onClick={() => handleBranchSwitch('academic')}
                className={`h-8 px-3 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  branch === 'academic'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'zen-surface hover:border-indigo-400'
                }`}
              >
                <GraduationCap className="w-3.5 h-3.5" />
                <span>Học Thuật &amp; Chuyên Nghiệp (10)</span>
              </button>
            </div>

            {/* Search & 3-Tier Filter */}
            <div className="flex flex-wrap items-center gap-2 flex-1 sm:flex-initial justify-end">
              <div className="relative flex-1 sm:w-52 min-w-[160px]">
                <Search className="w-3.5 h-3.5 opacity-50 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm cụm từ hoặc nghĩa Việt..."
                  className="w-full h-8 pl-8 pr-2.5 text-xs rounded-lg zen-surface border focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'all', label: 'Tất cả', dot: '' },
                    { id: 'casual', label: 'Đời thường', dot: 'bg-emerald-500' },
                    { id: 'natural', label: 'Tự nhiên', dot: 'bg-sky-500' },
                    { id: 'academic', label: 'Học thuật', dot: 'bg-violet-500' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setTierFilter(f.id)}
                    className={`h-8 px-2 text-[11px] font-semibold rounded-lg border flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                      tierFilter === f.id
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-transparent'
                        : 'zen-surface opacity-80 hover:opacity-100'
                    }`}
                  >
                    {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Horizontal Scrollable Topic Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedTopicId('all')}
              className={`h-7 px-2.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedTopicId === 'all'
                  ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-400/50'
                  : 'zen-surface opacity-75 hover:opacity-100'
              }`}
            >
              Tất cả chủ đề ({topicsInBranch.length})
            </button>

            {topicsInBranch.map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => setSelectedTopicId(topic.id)}
                title={topic.subtitleVi}
                className={`h-7 px-2.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedTopicId === topic.id
                    ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-400/50 font-semibold'
                    : 'zen-surface opacity-75 hover:opacity-100'
                }`}
              >
                {topic.titleVi}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Area: Split-Card Zen Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto zen-scroll p-4 sm:p-6 space-y-4">
          {/* Active Topic Banner + Infinite [+3 Collocations Mới] Action */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-black/5 dark:border-white/10">
            <div className="min-w-0">
              <div className="text-sm font-bold">
                {selectedTopicId === 'all'
                  ? branch === 'everyday'
                    ? 'Toàn bộ cụm Collocations Đời Sống Hằng Ngày'
                    : 'Toàn bộ cụm Collocations Học Thuật & Chuyên Nghiệp'
                  : activeTopicMeta?.titleVi}
              </div>
              <p className="text-xs opacity-70">
                {selectedTopicId === 'all'
                  ? `Đang hiển thị ${filteredEntries.length} cụm đã kiểm chuẩn · Chọn 1 chủ đề cụ thể hoặc bấm Mở rộng vô hạn.`
                  : activeTopicMeta?.subtitleVi}
              </p>
            </div>

            <button
              type="button"
              disabled={isExpanding}
              onClick={handleExpandThree}
              className="h-9 px-3.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isExpanding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>
                {isExpanding
                  ? 'Đang sinh +3 cụm chuẩn từ điển...'
                  : `+3 Collocations Mới (${
                      selectedTopicId === 'all'
                        ? activeTopicMeta?.titleVi
                        : activeTopicMeta?.titleVi
                    })`}
              </span>
            </button>
          </div>

          {expandError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300">
              {expandError}
            </div>
          )}

          {filteredEntries.length === 0 ? (
            <div className="py-12 px-4 text-center rounded-2xl zen-surface-subtle border space-y-3">
              <Sparkles className="w-8 h-8 text-indigo-600 dark:text-indigo-400 mx-auto opacity-80" />
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-sm font-bold">
                  Chủ đề “{activeTopicMeta?.titleVi}” sẵn sàng mở rộng ngay
                </h3>
                <p className="text-xs opacity-70 leading-relaxed">
                  Bấm nút bên dưới để AI sinh ngay 3 cụm Collocations chuẩn Oxford/Cambridge &amp; Đại Từ Lâm/NHK phủ đủ 3 tầng (🟢 Đời thường · 🔵 Tự nhiên · 🟣 Học thuật) kèm Radar chống bẫy dịch sai.
                </p>
              </div>
              <button
                type="button"
                disabled={isExpanding}
                onClick={handleExpandThree}
                className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                {isExpanding ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                <span>Sinh +3 Collocations cho chủ đề này</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredEntries.map((entry) => {
                const meta = TIER_META[entry.tier] || TIER_META.natural;
                const isSaved = savedTermKeys.has(`vocab::${entry.expression.toLowerCase()}`);
                const isCompareOpen = Boolean(compareOpenMap[entry.id]);

                return (
                  <article
                    key={entry.id}
                    className="rounded-xl zen-surface-subtle border p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2.5">
                      {/* Card Meta + Audio + Save FSRS */}
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${meta.textClass}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                          <span>
                            {meta.shortLabel} · {entry.level}
                          </span>
                          <span className="opacity-65 font-normal font-mono-tabular">
                            · {entry.patternFormula}
                          </span>
                        </span>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => speakNative(entry.expression, language)}
                            title="Nghe phát âm cụm từ"
                            className="w-7 h-7 rounded-md zen-surface border hover:border-indigo-500 flex items-center justify-center cursor-pointer"
                          >
                            <Volume2 className="w-3.5 h-3.5 opacity-80" />
                          </button>

                          <button
                            type="button"
                            disabled={isSaved}
                            onClick={() => onSaveEntryToFsrs(entry)}
                            className={`h-7 px-2.5 text-[11px] font-semibold rounded-md flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                              isSaved
                                ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300 cursor-default'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}
                          >
                            {isSaved ? (
                              <>
                                <BookmarkCheck className="w-3.5 h-3.5 animate-star-pop" />
                                <span>Đã lưu</span>
                              </>
                            ) : (
                              <>
                                <BookmarkPlus className="w-3.5 h-3.5" />
                                <span>Lưu FSRS</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Main Phrase + Phonetics */}
                      <div className="space-y-0.5">
                        <h3
                          className={`text-lg font-bold leading-snug safe-wrap ${
                            language === 'ja' ? 'font-jp' : ''
                          }`}
                        >
                          {entry.expression}
                        </h3>

                        {showPhonetics && (entry.readingOrIpa || entry.hanViet) && (
                          <div className="flex flex-wrap items-center gap-x-2 text-xs opacity-75">
                            {entry.readingOrIpa && (
                              <span className={language === 'ja' ? 'font-jp' : 'font-ipa'}>
                                {entry.readingOrIpa}
                              </span>
                            )}
                            {entry.hanViet && (
                              <span className="font-semibold text-amber-700 dark:text-amber-300">
                                · Hán Việt: {entry.hanViet}
                              </span>
                            )}
                          </div>
                        )}

                        <p className="text-sm font-semibold opacity-95 pt-0.5">{entry.meaningVi}</p>
                      </div>

                      {/* Contextual Example Split-Card */}
                      <div className="p-2.5 rounded-lg zen-surface border space-y-1 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`font-medium leading-relaxed safe-wrap ${
                              language === 'ja' ? 'font-jp' : ''
                            }`}
                          >
                            “{entry.exampleSentence}”
                          </p>
                          <button
                            type="button"
                            onClick={() => speakNative(entry.exampleSentence, language)}
                            title="Nghe cả câu ví dụ"
                            className="w-6 h-6 rounded hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center shrink-0 cursor-pointer"
                          >
                            <Volume2 className="w-3 h-3 opacity-65" />
                          </button>
                        </div>
                        <p className="opacity-75 leading-relaxed">{entry.exampleTranslationVi}</p>
                      </div>

                      {/* Anti-Calque Contrast Card */}
                      <div className="p-2.5 rounded-lg zen-surface border space-y-1.5">
                        <div className="flex items-center gap-1 text-[11px] font-bold text-rose-700 dark:text-rose-300">
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                          <span>Anti-Calque Radar</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                          <div className="px-2 py-1 rounded bg-teal-500/10 text-teal-800 dark:text-teal-200 flex items-start gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-teal-600 dark:text-teal-400" />
                            <span className={`font-semibold ${language === 'ja' ? 'font-jp' : ''}`}>
                              {entry.antiCalque.correctForm}
                            </span>
                          </div>
                          <div className="px-2 py-1 rounded bg-rose-500/10 text-rose-800 dark:text-rose-200 flex items-start gap-1">
                            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                            <span className={`line-through ${language === 'ja' ? 'font-jp' : ''}`}>
                              {entry.antiCalque.wrongTrap}
                            </span>
                          </div>
                        </div>
                        <p className="text-[11px] opacity-75 leading-relaxed">
                          {entry.antiCalque.particleOrPrepHighlight && (
                            <span className="font-bold text-indigo-700 dark:text-indigo-300 mr-1">
                              [{entry.antiCalque.particleOrPrepHighlight}]
                            </span>
                          )}
                          {entry.antiCalque.explanationVi}
                        </p>
                      </div>
                    </div>

                    {/* Optional 3-Step Upgrade Ladder Footer */}
                    {entry.upgradeLadder && (
                      <div className="pt-2 border-t border-black/5 dark:border-white/10 space-y-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setCompareOpenMap((prev) => ({
                              ...prev,
                              [entry.id]: !prev[entry.id],
                            }))
                          }
                          className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <GitBranch className="w-3 h-3" />
                          <span>
                            {isCompareOpen
                              ? 'Ẩn thang nâng cấp 3 tầng'
                              : 'Thang nâng cấp 3 tầng & So sánh ngữ cảnh'}
                          </span>
                        </button>

                        {isCompareOpen && (
                          <div className="p-2.5 rounded-lg bg-indigo-500/7 border border-indigo-500/20 text-xs space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                              <span className="text-emerald-700 dark:text-emerald-300">
                                {entry.upgradeLadder.casual}
                              </span>
                              <ArrowRight className="w-3 h-3 opacity-50 shrink-0" />
                              <span className="text-sky-700 dark:text-sky-300">
                                {entry.upgradeLadder.natural}
                              </span>
                              <ArrowRight className="w-3 h-3 opacity-50 shrink-0" />
                              <span className="text-violet-700 dark:text-violet-300">
                                {entry.upgradeLadder.academic}
                              </span>
                            </div>
                            <p className="opacity-85 leading-relaxed">
                              {entry.upgradeLadder.contextCompareVi}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
