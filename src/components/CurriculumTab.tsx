import React, { useMemo, useState } from 'react';
import {
  BookmarkCheck,
  BookmarkPlus,
  Loader2,
  Microscope,
  Play,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import type {
  CurriculumData,
  CurriculumGrammarItem,
  CurriculumVocabItem,
  Language,
  NuanceDualPayload,
  ProficiencyLevel,
} from '../types';
import { formatTime, speakNative } from '../lib/youtube';
import { DualModeNuancePanel } from './DualModeNuancePanel';

interface CurriculumTabProps {
  language: Language;
  targetLevel: ProficiencyLevel;
  curriculum: CurriculumData | null;
  isLoading: boolean;
  error: string | null;
  hasLines: boolean;
  savedTermKeys: Set<string>;
  videoTitle?: string;
  onGenerateCurriculum: () => void;
  onSeekTo: (seconds: number) => void;
  onSaveVocabItem: (item: CurriculumVocabItem) => void;
  onSaveGrammarItem: (item: CurriculumGrammarItem) => void;
  onSaveNuanceDualCard?: (
    payload: NuanceDualPayload,
    context?: { timestamp?: number; sentence?: string; sentenceVi?: string }
  ) => void;
}

export const CurriculumTab: React.FC<CurriculumTabProps> = ({
  language,
  targetLevel,
  curriculum,
  isLoading,
  error,
  hasLines,
  savedTermKeys,
  videoTitle,
  onGenerateCurriculum,
  onSeekTo,
  onSaveVocabItem,
  onSaveGrammarItem,
  onSaveNuanceDualCard,
}) => {
  const [subTab, setSubTab] = useState<'vocab' | 'grammar'>('vocab');
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [openNuanceIds, setOpenNuanceIds] = useState<Record<string, boolean>>({});

  const availableLevels = useMemo(() => {
    if (!curriculum) return [];
    const set = new Set<string>();
    const list = subTab === 'vocab' ? curriculum.vocabulary : curriculum.grammar;
    list.forEach((item) => set.add(item.level));
    return Array.from(set);
  }, [curriculum, subTab]);

  const filteredVocab = useMemo(() => {
    if (!curriculum) return [];
    if (levelFilter === 'ALL') return curriculum.vocabulary;
    return curriculum.vocabulary.filter((v) => v.level === levelFilter);
  }, [curriculum, levelFilter]);

  const filteredGrammar = useMemo(() => {
    if (!curriculum) return [];
    if (levelFilter === 'ALL') return curriculum.grammar;
    return curriculum.grammar.filter((g) => g.level === levelFilter);
  }, [curriculum, levelFilter]);

  if (!hasLines) {
    return (
      <div className="py-16 px-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Nạp video để hệ thống tự động phân tầng Từ vựng &amp; Ngữ pháp trọng tâm theo trình độ {targetLevel}.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sub-navigation bar */}
      <div className="p-3 border-b border-slate-100 dark:border-slate-800 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setSubTab('vocab');
                setLevelFilter('ALL');
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === 'vocab'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Từ vựng trọng tâm {curriculum ? `(${curriculum.vocabulary.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => {
                setSubTab('grammar');
                setLevelFilter('ALL');
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === 'grammar'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Ngữ pháp trọng tâm {curriculum ? `(${curriculum.grammar.length})` : ''}
            </button>
          </div>

          <button
            type="button"
            onClick={onGenerateCurriculum}
            disabled={isLoading}
            title={`Phân tích lại theo cấp độ ${targetLevel}`}
            className="h-8 px-2.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{curriculum ? `Lọc ${targetLevel}` : `Trích xuất ${targetLevel}`}</span>
          </button>
        </div>

        {/* Interactive Level Filter Bar */}
        {curriculum && availableLevels.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setLevelFilter('ALL')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                levelFilter === 'ALL'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Tất cả
            </button>
            {availableLevels.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                  levelFilter === lvl
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto zen-scroll p-3.5 space-y-3">
        {isLoading && (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span>Đang quét toàn bộ phụ đề theo chuẩn {targetLevel}...</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {!curriculum && !isLoading && !error && (
          <div className="py-12 px-4 text-center space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Hệ thống sẽ quét toàn bộ phụ đề để gom Từ vựng &amp; Ngữ pháp phù hợp trình độ{' '}
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">{targetLevel}</span>.
            </p>
            <button
              type="button"
              onClick={onGenerateCurriculum}
              className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
            >
              Trích xuất Từ vựng &amp; Ngữ pháp ngay
            </button>
          </div>
        )}

        {/* Sub-tab 1: Focus Vocabulary */}
        {curriculum && !isLoading && subTab === 'vocab' && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredVocab.map((item) => {
              const saved = savedTermKeys.has(`vocab::${item.lemma.toLowerCase()}`);
              return (
                <div key={item.id} className="py-3 first:pt-0 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-baseline flex-wrap gap-x-2">
                        <span className="text-base font-bold text-slate-900 dark:text-slate-100 font-jp">
                          {item.word}
                        </span>
                        <span className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
                          {item.readingOrIpa}
                        </span>
                      </div>

                      {/* Quiet unboxed metadata line */}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {item.level}
                        </span>
                        {item.isIeltsAcademic && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-teal-600 dark:text-teal-400">
                              IELTS
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{item.partOfSpeech}</span>
                        {item.hanViet && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 dark:text-amber-300 font-medium">
                              {item.hanViet}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          Xuất hiện {item.occurrences.length} lần
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => speakNative(item.lemma || item.word, language)}
                        title="Nghe phát âm"
                        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSaveVocabItem(item)}
                        disabled={saved}
                        title={saved ? 'Đã lưu trong Kho Ôn Tập' : 'Lưu vào Kho Ôn Tập FSRS'}
                        className={`w-7 h-7 flex items-center justify-center rounded-md cursor-pointer ${
                          saved
                            ? 'text-teal-600 dark:text-teal-400 cursor-default'
                            : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {saved ? (
                          <BookmarkCheck className="w-3.5 h-3.5" />
                        ) : (
                          <BookmarkPlus className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-relaxed">
                    {item.meaningVi}
                  </p>

                  {/* Clickable video timestamps + Dual-Mode Nuance toggle */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.occurrences.slice(0, 4).map((occ, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onSeekTo(occ.start)}
                          title={occ.sentence}
                          className="px-2 py-0.5 text-[11px] font-mono-tabular rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-950/60 text-slate-600 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" />
                          <span>{formatTime(occ.start)}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenNuanceIds((prev) => ({
                          ...prev,
                          [`v_${item.id}`]: !prev[`v_${item.id}`],
                        }))
                      }
                      className={`h-6 px-2 text-[11px] font-semibold rounded-md border flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors ${
                        openNuanceIds[`v_${item.id}`]
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'zen-surface-subtle hover:border-indigo-500 text-indigo-700 dark:text-indigo-300'
                      }`}
                    >
                      <Microscope className="w-3 h-3" />
                      <span>{openNuanceIds[`v_${item.id}`] ? 'Ẩn sắc thái' : '⚡/🔬 Sắc thái'}</span>
                    </button>
                  </div>

                  {openNuanceIds[`v_${item.id}`] && (
                    <div className="pt-1.5 min-w-0">
                      <DualModeNuancePanel
                        requestParams={{
                          term: item.word,
                          lemma: item.lemma || item.word,
                          language,
                          targetLevel,
                          kind: 'word',
                          sentence: item.occurrences[0]?.sentence || item.word,
                          videoTitle,
                          timestamp: item.occurrences[0]?.start || 0,
                        }}
                        defaultMode="summary"
                        compact={true}
                        isSaved={saved}
                        onSaveNuanceCard={
                          onSaveNuanceDualCard
                            ? (payload) =>
                                onSaveNuanceDualCard(payload, {
                                  timestamp: item.occurrences[0]?.start || 0,
                                  sentence: item.occurrences[0]?.sentence || item.word,
                                })
                            : undefined
                        }
                        titleLabel={`Sắc thái · ${item.word}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Sub-tab 2: Focus Grammar */}
        {curriculum && !isLoading && subTab === 'grammar' && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredGrammar.map((g) => {
              const saved = savedTermKeys.has(`grammar::${g.pattern.toLowerCase()}`);
              return (
                <div key={g.id} className="py-3.5 first:pt-0 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-jp">
                        {g.pattern}
                      </h4>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {language === 'ja' ? `JLPT ${g.level}` : `CEFR ${g.level}`}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                          {g.formula}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSaveGrammarItem(g)}
                      disabled={saved}
                      className={`h-7 px-2.5 text-[11px] font-semibold rounded-md flex items-center gap-1 shrink-0 cursor-pointer ${
                        saved
                          ? 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/50 cursor-default'
                          : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                      }`}
                    >
                      {saved ? (
                        <>
                          <BookmarkCheck className="w-3.5 h-3.5" />
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

                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">Sắc thái: </span>
                    {g.nuance}
                  </p>

                  {g.conjugation && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Cách chia / kết hợp: </span>
                      {g.conjugation}
                    </p>
                  )}

                  {/* Verbatim example extracted from the video */}
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">Trích nguyên văn từ video</span>
                      <button
                        type="button"
                        onClick={() => onSeekTo(g.exampleStart)}
                        className="text-[11px] font-mono-tabular font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" />
                        <span>{formatTime(g.exampleStart)}</span>
                      </button>
                    </div>
                    <p className="text-xs font-medium text-slate-900 dark:text-slate-100 font-jp">
                      “{g.exampleSentence}”
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {g.exampleTranslationVi}
                    </p>
                  </div>

                  {/* Dual-Mode Nuance Comparison Toggle for Grammar */}
                  <div className="pt-0.5 min-w-0 space-y-2">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenNuanceIds((prev) => ({
                          ...prev,
                          [`g_${g.id}`]: !prev[`g_${g.id}`],
                        }))
                      }
                      className={`h-7 px-2.5 text-[11px] font-semibold rounded-md border inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                        openNuanceIds[`g_${g.id}`]
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'zen-surface-subtle hover:border-indigo-500 text-indigo-700 dark:text-indigo-300'
                      }`}
                    >
                      <Microscope className="w-3.5 h-3.5" />
                      <span>
                        {openNuanceIds[`g_${g.id}`]
                          ? 'Ẩn phân tích sắc thái ngữ pháp'
                          : '⚡/🔬 So sánh sắc thái & ngữ cảnh 2 tầng'}
                      </span>
                    </button>

                    {openNuanceIds[`g_${g.id}`] && (
                      <DualModeNuancePanel
                        requestParams={{
                          term: g.pattern,
                          lemma: g.pattern,
                          language,
                          targetLevel,
                          kind: 'grammar',
                          sentence: g.exampleSentence || g.pattern,
                          videoTitle,
                          timestamp: g.exampleStart,
                        }}
                        defaultMode="summary"
                        compact={true}
                        isSaved={saved}
                        onSaveNuanceCard={
                          onSaveNuanceDualCard
                            ? (payload) =>
                                onSaveNuanceDualCard(payload, {
                                  timestamp: g.exampleStart,
                                  sentence: g.exampleSentence,
                                  sentenceVi: g.exampleTranslationVi,
                                })
                            : undefined
                        }
                        titleLabel={`Sắc thái Ngữ pháp · ${g.pattern}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
