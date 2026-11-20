import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Play,
  Printer,
  RefreshCw,
  Trash2,
  Upload,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  ActiveProductionPack,
  DailyActivityLog,
  Flashcard,
  FsrsRating,
  InputCompatibilityReport,
  Language,
  ProficiencyLevel,
  StudySheetData,
  WeaknessEntry,
} from '../types';
import {
  exportFlashcardsToAnkiCsv,
  previewFsrsIntervals,
  triggerDownload,
} from '../lib/fsrs';
import { formatTime, speakNative } from '../lib/youtube';
import { exportFullBackup, importFullBackup, type KotoZenBackup } from '../lib/db';
import { AnalyticsPanel } from './AnalyticsPanel';
import { ActiveProductionLab } from './ActiveProductionLab';
import { DualModeNuancePanel } from './DualModeNuancePanel';

interface ReviewAndQuizTabProps {
  language: Language;
  targetLevel: ProficiencyLevel;
  videoTitle: string;
  currentVideoId: string | null;
  hasLines: boolean;
  // FSRS Flashcards
  flashcards: Flashcard[];
  onRateCard: (card: Flashcard, rating: FsrsRating) => void;
  onDeleteCard: (cardId: string) => void;
  onUpdateCardNote: (cardId: string, note: string) => void;
  onJumpToVideoAnchor: (card: Flashcard) => void;
  onDataImported: () => void;
  // Smart Study Sheet & Quiz
  studySheet: StudySheetData | null;
  isStudySheetLoading: boolean;
  studySheetError: string | null;
  onGenerateStudySheet: () => void;
  onSeekCurrentVideo: (seconds: number) => void;
  // Super-System 5: 4-Mode Active Production Lab
  productionPack: ActiveProductionPack | null;
  isProductionLoading: boolean;
  productionError: string | null;
  onGenerateProductionPack: () => void;
  // Super-System 6: Personal Weakness Radar
  weaknesses: WeaknessEntry[];
  onLogWeakness: (params: {
    kind: 'vocab' | 'grammar' | 'particle' | 'tense';
    term: string;
    categoryLabel: string;
    lastExample?: string;
    meaningVi?: string;
  }) => void;
  onDeleteWeakness: (id: string) => void;
  onDrillSuccess?: () => void;
  // Feature 19 Analytics
  activityLogs: DailyActivityLog[];
  iPlusOneReport: InputCompatibilityReport | null;
}

type FsrsStreamFilter = 'all' | 'vocab' | 'grammar';
type FsrsStatusFilter = 'due' | 'lapsed' | 'new' | 'all';
type FsrsQuestionMode = 'auto' | 'recognition' | 'cloze' | 'reverse';

function maskTermInSentence(sentence: string, term: string): string {
  if (!sentence || !term) return sentence;
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return sentence;
  const regex = new RegExp(escaped, 'gi');
  if (regex.test(sentence)) {
    return sentence.replace(regex, '_____');
  }
  return `${sentence} (_____)`;
}

export const ReviewAndQuizTab: React.FC<ReviewAndQuizTabProps> = ({
  language,
  targetLevel,
  videoTitle,
  hasLines,
  flashcards,
  onRateCard,
  onDeleteCard,
  onUpdateCardNote,
  onJumpToVideoAnchor,
  onDataImported,
  studySheet,
  isStudySheetLoading,
  studySheetError,
  onGenerateStudySheet,
  onSeekCurrentVideo,
  productionPack,
  isProductionLoading,
  productionError,
  onGenerateProductionPack,
  weaknesses,
  onLogWeakness,
  onDeleteWeakness,
  onDrillSuccess,
  activityLogs,
  iPlusOneReport,
}) => {
  const [subMode, setSubMode] = useState<'fsrs' | 'lab' | 'sheet' | 'quiz' | 'analytics'>('fsrs');
  const [isFlipped, setIsFlipped] = useState(false);
  const [showAllDeck, setShowAllDeck] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // Dual-Stream FSRS filters & 3-Mode Active Recall rotation
  const [streamFilter, setStreamFilter] = useState<FsrsStreamFilter>('all');
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<FsrsStatusFilter>('due');
  const [questionModePref, setQuestionModePref] = useState<FsrsQuestionMode>('auto');
  const [clozeRecallInput, setClozeRecallInput] = useState('');
  const [showFrontNuanceHint, setShowFrontNuanceHint] = useState(false);

  // Quiz answer tracking
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});

  const now = Date.now();
  const vocabCount = useMemo(
    () => flashcards.filter((c) => c.kind === 'vocab').length,
    [flashcards]
  );
  const grammarCount = useMemo(
    () => flashcards.filter((c) => c.kind === 'grammar').length,
    [flashcards]
  );

  const availableLevels = useMemo(() => {
    const s = new Set<string>();
    flashcards.forEach((c) => s.add(c.level));
    return Array.from(s);
  }, [flashcards]);

  const filteredCards = useMemo(() => {
    return flashcards
      .filter((c) => {
        if (streamFilter !== 'all' && c.kind !== streamFilter) return false;
        if (levelFilter !== 'ALL' && c.level !== levelFilter) return false;
        if (statusFilter === 'due') return c.due <= now;
        if (statusFilter === 'lapsed') return c.lapses > 0;
        if (statusFilter === 'new') return c.reps === 0;
        return true;
      })
      .sort((a, b) => {
        if (statusFilter === 'lapsed') return b.lapses - a.lapses || a.due - b.due;
        if (statusFilter === 'new') return b.createdAt - a.createdAt;
        return a.due - b.due;
      });
  }, [flashcards, streamFilter, levelFilter, statusFilter, now]);

  const totalDueCount = useMemo(
    () => flashcards.filter((c) => c.due <= now).length,
    [flashcards, now]
  );

  const activeCard = filteredCards[0] || null;
  const intervalPreview = useMemo(
    () => (activeCard ? previewFsrsIntervals(activeCard) : null),
    [activeCard]
  );

  // Reset front nuance hint whenever active card changes
  useEffect(() => {
    setShowFrontNuanceHint(false);
  }, [activeCard?.id]);

  // Auto-rotate 3 recall modes per card repetition: Recognition -> Cloze -> Reverse Production
  const activeRecallMode: 'recognition' | 'cloze' | 'reverse' = useMemo(() => {
    if (questionModePref !== 'auto') return questionModePref;
    if (!activeCard) return 'recognition';
    const mod = activeCard.reps % 3;
    if (mod === 1) return 'cloze';
    if (mod === 2) return 'reverse';
    return 'recognition';
  }, [questionModePref, activeCard]);

  const handleRate = (rating: FsrsRating) => {
    if (!activeCard) return;
    onRateCard(activeCard, rating);
    setIsFlipped(false);
    setClozeRecallInput('');
  };

  const handleExportAnki = () => {
    const targetDeck = filteredCards.length > 0 ? filteredCards : flashcards;
    if (targetDeck.length === 0) return;
    const csv = exportFlashcardsToAnkiCsv(targetDeck);
    triggerDownload(
      `kotozen-anki-${streamFilter}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8'
    );
  };

  const handleExportJson = async () => {
    const backup = await exportFullBackup();
    triggerDownload(
      `kotozen-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      'application/json'
    );
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as KotoZenBackup;
      const res = await importFullBackup(parsed);
      setImportStatus(`Đã khôi phục ${res.sessionsCount} bài học và ${res.cardsCount} thẻ FSRS.`);
      onDataImported();
    } catch {
      setImportStatus('File sao lưu .json không đúng định dạng KotoZen.');
    } finally {
      e.target.value = '';
    }
  };

  const handleExportStudySheetMarkdown = () => {
    if (!studySheet) return;
    const lines: string[] = [
      `# Phiếu Học Tập KotoZen: ${videoTitle}`,
      `> Trình độ: ${targetLevel} · Ngôn ngữ: ${language === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}`,
      '',
      '## 1. Tóm tắt nội dung video',
      studySheet.summaryVi,
      '',
      '### Điểm mấu chốt',
      ...studySheet.keyTakeaways.map((t) => `- ${t}`),
      '',
      '## 2. Từ vựng & Collocations trọng tâm',
      ...studySheet.topVocabulary.map(
        (v) =>
          `- **${v.term}** (${v.readingOrIpa})${v.hanViet ? ` [${v.hanViet}]` : ''} · \`${v.level}\`: ${v.meaningVi}\n  - Ví dụ (${formatTime(v.timestamp)}): _"${v.exampleFromVideo}"_`
      ),
      '',
      '## 3. Cấu trúc ngữ pháp cốt lõi',
      ...studySheet.coreGrammar.map(
        (g) =>
          `- **${g.pattern}** (\`${g.level}\`) — \`${g.formula}\`\n  - ${g.explanation}\n  - Ví dụ (${formatTime(g.timestamp)}): _"${g.exampleFromVideo}"_`
      ),
    ];
    triggerDownload(
      `kotozen-study-sheet-${new Date().toISOString().slice(0, 10)}.md`,
      lines.join('\n'),
      'text/markdown;charset=utf-8'
    );
  };

  const quizStats = useMemo(() => {
    if (!studySheet) return { answered: 0, correct: 0, total: 0 };
    const total = studySheet.quiz.length;
    let answered = 0;
    let correct = 0;
    for (const q of studySheet.quiz) {
      if (selectedAnswers[q.id] !== undefined) {
        answered++;
        if (selectedAnswers[q.id] === q.correctIndex) correct++;
      }
    }
    return { answered, correct, total };
  }, [studySheet, selectedAnswers]);

  const langWeaknesses = useMemo(
    () => weaknesses.filter((w) => w.language === language),
    [weaknesses, language]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sub-mode switcher */}
      <div className="p-2.5 border-b border-black/5 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center flex-wrap gap-0.5 p-0.5 zen-surface-subtle border rounded-lg">
          <button
            type="button"
            onClick={() => setSubMode('fsrs')}
            className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subMode === 'fsrs'
                ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            FSRS ({totalDueCount}/{flashcards.length})
          </button>
          <button
            type="button"
            onClick={() => setSubMode('lab')}
            className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subMode === 'lab'
                ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            Phản xạ 4 Chế độ
          </button>
          <button
            type="button"
            onClick={() => setSubMode('sheet')}
            className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subMode === 'sheet'
                ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            Phiếu học
          </button>
          <button
            type="button"
            onClick={() => setSubMode('quiz')}
            className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subMode === 'quiz'
                ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            Quiz
          </button>
          <button
            type="button"
            onClick={() => setSubMode('analytics')}
            className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subMode === 'analytics'
                ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            Radar &amp; Tiến độ
          </button>
        </div>

        {(subMode === 'sheet' || subMode === 'quiz') && hasLines && (
          <button
            type="button"
            onClick={() => {
              setSelectedAnswers({});
              onGenerateStudySheet();
            }}
            disabled={isStudySheetLoading}
            className="h-7 px-2.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            {isStudySheetLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{studySheet ? 'Tạo lại' : 'Tạo từ video'}</span>
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto zen-scroll p-3.5 space-y-4">
        {/* ================= MODE 1: DUAL-STREAM DEEP FSRS ================= */}
        {subMode === 'fsrs' && (
          <div className="space-y-3.5">
            {/* Dual-Stream Selector: Vocab/Collocations vs Grammar/Structures */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl zen-surface-subtle border">
              <button
                type="button"
                onClick={() => {
                  setStreamFilter('all');
                  setIsFlipped(false);
                }}
                className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer truncate ${
                  streamFilter === 'all'
                    ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                Tất cả ({flashcards.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStreamFilter('vocab');
                  setIsFlipped(false);
                }}
                className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer truncate ${
                  streamFilter === 'vocab'
                    ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                Từ vựng &amp; Cụm ({vocabCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStreamFilter('grammar');
                  setIsFlipped(false);
                }}
                className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer truncate ${
                  streamFilter === 'grammar'
                    ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                Mẫu Ngữ pháp ({grammarCount})
              </button>
            </div>

            {/* Status + Level Filter & Export Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-black/5 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as FsrsStatusFilter);
                    setIsFlipped(false);
                  }}
                  aria-label="Lọc theo trạng thái thẻ"
                  className="h-7 px-2 text-[11px] font-semibold rounded-md zen-surface-subtle border cursor-pointer"
                >
                  <option value="due">Cần ôn hôm nay</option>
                  <option value="lapsed">Hay quên nhất</option>
                  <option value="new">Mới lưu</option>
                  <option value="all">Toàn bộ kho</option>
                </select>

                {availableLevels.length > 0 && (
                  <select
                    value={levelFilter}
                    onChange={(e) => {
                      setLevelFilter(e.target.value);
                      setIsFlipped(false);
                    }}
                    aria-label="Lọc theo cấp độ"
                    className="h-7 px-2 text-[11px] font-semibold rounded-md zen-surface-subtle border cursor-pointer"
                  >
                    <option value="ALL">Mọi cấp độ</option>
                    {availableLevels.map((lv) => (
                      <option key={lv} value={lv}>
                        {lv}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={questionModePref}
                  onChange={(e) => setQuestionModePref(e.target.value as FsrsQuestionMode)}
                  aria-label="Chế độ câu hỏi FSRS"
                  className="h-7 px-2 text-[11px] font-semibold rounded-md zen-surface-subtle border cursor-pointer"
                >
                  <option value="auto">Xoay vòng 3 dạng</option>
                  <option value="recognition">1. Nhìn câu đoán nghĩa</option>
                  <option value="cloze">2. Điền khuyết ngữ cảnh</option>
                  <option value="reverse">3. Dịch ngược Việt → Đích</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={handleExportAnki}
                  disabled={flashcards.length === 0}
                  className="h-7 px-2 text-[11px] font-medium rounded-md zen-surface-subtle border hover:border-indigo-500 disabled:opacity-40 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3 h-3" />
                  <span>Anki .CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="h-7 px-2 text-[11px] font-medium rounded-md zen-surface-subtle border hover:border-indigo-500 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3 h-3" />
                  <span>.JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  className="h-7 px-2 text-[11px] font-medium rounded-md zen-surface-subtle border hover:border-indigo-500 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-3 h-3" />
                  <span>Nhập</span>
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportJsonFile}
                  className="hidden"
                />
              </div>
            </div>

            {importStatus && (
              <div className="p-2.5 rounded-lg bg-teal-500/10 border border-teal-500/25 text-xs text-teal-800 dark:text-teal-200">
                {importStatus}
              </div>
            )}

            {/* Active Rotating 3-Mode FSRS Card */}
            {activeCard ? (
              <div className="rounded-xl zen-surface-subtle border p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] opacity-70">
                  <span>
                    {activeCard.kind === 'grammar' ? 'Mẫu Ngữ Pháp' : 'Từ Vựng & Cụm'} ·{' '}
                    {activeCard.level} ·{' '}
                    {activeRecallMode === 'recognition'
                      ? 'Dạng 1: Nhận diện'
                      : activeRecallMode === 'cloze'
                        ? 'Dạng 2: Điền khuyết'
                        : 'Dạng 3: Dịch ngược'}
                    {activeCard.lapses > 0 && ` · Quên ${activeCard.lapses} lần`}
                  </span>
                  <button
                    type="button"
                    onClick={() => speakNative(activeCard.sentence || activeCard.term, activeCard.language)}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Nghe mẫu</span>
                  </button>
                </div>

                {/* Front Side adapts to Auto-Rotating 3 Modes */}
                <div className="text-center py-2 space-y-2.5">
                  {activeRecallMode === 'recognition' && (
                    <>
                      <div
                        className={`text-2xl font-bold safe-wrap ${
                          activeCard.language === 'ja' ? 'font-jp-compact' : ''
                        }`}
                      >
                        {activeCard.term}
                      </div>
                      <p
                        className={`text-xs opacity-80 italic safe-wrap ${
                          activeCard.language === 'ja' ? 'font-jp-compact' : ''
                        }`}
                      >
                        “{activeCard.sentence}”
                      </p>
                    </>
                  )}

                  {activeRecallMode === 'cloze' && (
                    <>
                      <div className="text-xs opacity-65">Điền từ khóa / cấu trúc bị ẩn trong câu gốc:</div>
                      <p
                        className={`text-base font-bold leading-relaxed safe-wrap ${
                          activeCard.language === 'ja' ? 'font-jp-compact' : ''
                        }`}
                      >
                        “{maskTermInSentence(activeCard.sentence, activeCard.term)}”
                      </p>
                      {activeCard.sentenceVi && (
                        <p className="text-xs opacity-70">Gợi ý nghĩa: {activeCard.sentenceVi}</p>
                      )}
                      {!isFlipped && (
                        <input
                          type="text"
                          value={clozeRecallInput}
                          onChange={(e) => setClozeRecallInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setIsFlipped(true);
                          }}
                          placeholder="Gõ từ bị ẩn rồi nhấn Enter để đối chiếu..."
                          className="w-full max-w-xs mx-auto h-8 px-3 text-xs rounded-lg zen-surface border focus:outline-none focus:border-indigo-500 text-center"
                        />
                      )}
                    </>
                  )}

                  {activeRecallMode === 'reverse' && (
                    <>
                      <div className="text-xs opacity-65">
                        Phản xạ dịch ngược sang{' '}
                        {activeCard.language === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}:
                      </div>
                      <div className="text-lg font-bold safe-wrap">{activeCard.meaningVi}</div>
                      {activeCard.sentenceVi && (
                        <p className="text-xs opacity-75 italic">“{activeCard.sentenceVi}”</p>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => onJumpToVideoAnchor(activeCard)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Mở đúng giây {formatTime(activeCard.timestamp)} trên YouTube</span>
                  </button>

                  {/* Front-side optional 3-second Nuance Hint for 2-sided Nuance FSRS Cards */}
                  {!isFlipped && activeCard.nuanceDual && (
                    <div className="pt-1 space-y-2">
                      <button
                        type="button"
                        onClick={() => setShowFrontNuanceHint((v) => !v)}
                        className="h-7 px-2.5 text-[11px] font-semibold rounded-md zen-surface border hover:border-indigo-500 text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Zap className="w-3 h-3" />
                        <span>
                          {showFrontNuanceHint ? 'Ẩn gợi ý sắc thái 3 giây' : '⚡ Gợi ý sắc thái 3 giây'}
                        </span>
                      </button>

                      {showFrontNuanceHint && (
                        <div className="text-left p-2.5 rounded-lg zen-surface border space-y-1.5 max-w-md mx-auto">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] opacity-75">
                            <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                              {activeCard.nuanceDual.summary.badges.formality}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{activeCard.nuanceDual.summary.badges.attitude}</span>
                            <span aria-hidden="true">·</span>
                            <span>{activeCard.nuanceDual.summary.badges.channel}</span>
                          </div>
                          <p className="text-xs font-medium leading-relaxed safe-wrap">
                            {activeCard.nuanceDual.summary.coreRule}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!isFlipped ? (
                  <button
                    type="button"
                    onClick={() => setIsFlipped(true)}
                    className="w-full h-10 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Lật xem đáp án &amp; ngữ cảnh
                  </button>
                ) : (
                  <div className="pt-3 border-t border-black/8 dark:border-white/10 space-y-3">
                    <div className="space-y-1">
                      <div
                        className={`text-lg font-bold ${
                          activeCard.language === 'ja' ? 'font-jp-compact' : ''
                        }`}
                      >
                        {activeCard.term}
                      </div>
                      {(activeCard.readingOrIpa || activeCard.hanViet) && (
                        <div className="text-xs opacity-75">
                          <span className={activeCard.language === 'ja' ? 'font-jp-compact' : 'font-ipa'}>
                            {activeCard.readingOrIpa}
                          </span>
                          {activeCard.hanViet && (
                            <span className="ml-2 font-semibold text-amber-700 dark:text-amber-300">
                              · {activeCard.hanViet}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-sm font-bold">{activeCard.meaningVi}</p>
                      <p
                        className={`text-xs opacity-85 ${
                          activeCard.language === 'ja' ? 'font-jp-compact' : ''
                        }`}
                      >
                        “{activeCard.sentence}”
                      </p>
                      {activeCard.sentenceVi && (
                        <p className="text-xs opacity-65">Dịch câu: {activeCard.sentenceVi}</p>
                      )}
                      {activeCard.extraNotes && (
                        <p className="text-xs opacity-70">{activeCard.extraNotes}</p>
                      )}
                      {activeCard.language === 'ja' &&
                        activeCard.kanjiBreakdown &&
                        activeCard.kanjiBreakdown.length > 0 && (
                          <div className="pt-2 space-y-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                              Cội nguồn Hán tự &amp; Bộ thủ Khang Hy
                            </div>
                            <div className="space-y-1.5">
                              {activeCard.kanjiBreakdown.map((kb, idx) => (
                                <div
                                  key={`${kb.kanji}-${idx}`}
                                  className="p-2 rounded-lg zen-surface border text-[11px] space-y-1"
                                >
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-jp-compact text-sm font-bold">{kb.kanji}</span>
                                    <span className="font-bold text-amber-700 dark:text-amber-300">
                                      {kb.hanViet}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold">
                                      {kb.structureType}
                                    </span>
                                    {kb.kyujitai && (
                                      <span className="font-jp-compact text-[10px] opacity-75">
                                        (旧: {kb.kyujitai})
                                      </span>
                                    )}
                                    <span className="opacity-75 font-jp-compact">
                                      · Bộ {kb.radical.symbol} ({kb.radical.nameVi})
                                    </span>
                                  </div>
                                  <p className="opacity-80 leading-snug safe-wrap">
                                    {kb.etymologyFact}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>

                    {/* Back-side 0ms Dual-Mode Nuance Dossier (Summary 3s <-> Deep 6-Dimension) */}
                    {activeCard.nuanceDual && (
                      <div className="pt-2 border-t border-black/5 dark:border-white/10 min-w-0">
                        <DualModeNuancePanel
                          initialData={activeCard.nuanceDual}
                          defaultMode="summary"
                          enableHotkeyD={true}
                          compact={true}
                          isSaved={true}
                          titleLabel="Hồ sơ Sắc thái đã lưu (0ms)"
                        />
                      </div>
                    )}

                    <input
                      type="text"
                      value={activeCard.userNote || ''}
                      onChange={(e) => onUpdateCardNote(activeCard.id, e.target.value)}
                      placeholder="Thêm ghi chú cá nhân cho thẻ này..."
                      className="w-full h-8 px-2.5 text-xs rounded-lg zen-surface border focus:outline-none focus:border-indigo-500"
                    />

                    {intervalPreview && (
                      <div className="grid grid-cols-4 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRate(1)}
                          className="py-2 px-1 rounded-lg bg-rose-500/12 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 text-center cursor-pointer transition-colors"
                        >
                          <div className="text-xs font-bold">Quên</div>
                          <div className="text-[10px] font-mono-tabular opacity-80">
                            {intervalPreview[1]}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRate(2)}
                          className="py-2 px-1 rounded-lg bg-amber-500/12 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-center cursor-pointer transition-colors"
                        >
                          <div className="text-xs font-bold">Khó</div>
                          <div className="text-[10px] font-mono-tabular opacity-80">
                            {intervalPreview[2]}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRate(3)}
                          className="py-2 px-1 rounded-lg bg-indigo-500/12 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-center cursor-pointer transition-colors"
                        >
                          <div className="text-xs font-bold">Tốt</div>
                          <div className="text-[10px] font-mono-tabular opacity-80">
                            {intervalPreview[3]}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRate(4)}
                          className="py-2 px-1 rounded-lg bg-teal-500/12 hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 text-center cursor-pointer transition-colors"
                        >
                          <div className="text-xs font-bold">Dễ</div>
                          <div className="text-[10px] font-mono-tabular opacity-80">
                            {intervalPreview[4]}
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 px-4 text-center rounded-xl zen-surface-subtle border space-y-1.5">
                <p className="text-sm font-semibold">
                  {flashcards.length === 0
                    ? 'Kho ôn tập FSRS đang trống'
                    : statusFilter === 'due'
                      ? 'Xuất sắc! Không còn thẻ nào đến hạn trong bộ lọc hiện tại.'
                      : 'Không tìm thấy thẻ nào khớp bộ lọc đang chọn.'}
                </p>
                <p className="text-xs opacity-65">
                  Chạm vào từ vựng, cụm Collocation hoặc mẫu ngữ pháp trong video để lưu thẻ neo giây YouTube.
                </p>
              </div>
            )}

            {/* Toggle Full Saved Deck List */}
            {flashcards.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowAllDeck((v) => !v)}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  {showAllDeck
                    ? 'Ẩn danh sách thẻ đã lưu'
                    : `Xem toàn bộ ${filteredCards.length} thẻ theo bộ lọc (lưu ngoại tuyến IndexedDB)`}
                </button>

                {showAllDeck && (
                  <div className="divide-y divide-black/5 dark:divide-white/10">
                    {filteredCards.map((c) => (
                      <div key={c.id} className="py-2.5 flex items-start justify-between gap-2 text-xs">
                        <div className="min-w-0 space-y-0.5">
                          <div className="font-semibold font-jp-compact">
                            {c.term}{' '}
                            <span className="font-normal opacity-60 font-mono-tabular text-[11px]">
                              {c.kind === 'grammar' ? 'Ngữ pháp' : 'Từ/Cụm'} · {c.level}
                            </span>
                          </div>
                          <div className="opacity-80">{c.meaningVi}</div>
                          <button
                            type="button"
                            onClick={() => onJumpToVideoAnchor(c)}
                            className="text-[11px] font-mono-tabular text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span className="truncate max-w-[220px]">
                              {c.videoTitle} ({formatTime(c.timestamp)})
                            </span>
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteCard(c.id)}
                          aria-label="Xóa thẻ"
                          className="p-1 opacity-50 hover:text-rose-600 hover:opacity-100 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= MODE 2: 4-MODE ACTIVE PRODUCTION LAB ================= */}
        {subMode === 'lab' && (
          <ActiveProductionLab
            language={language}
            targetLevel={targetLevel}
            videoTitle={videoTitle}
            hasLines={hasLines}
            pack={productionPack}
            isLoading={isProductionLoading}
            error={productionError}
            onGeneratePack={onGenerateProductionPack}
            onSeekTo={onSeekCurrentVideo}
            onLogWeakness={onLogWeakness}
            onDrillSuccess={onDrillSuccess}
          />
        )}

        {/* ================= MODE 3: SMART STUDY SHEET ================= */}
        {subMode === 'sheet' && (
          <div className="space-y-4">
            {isStudySheetLoading && (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs opacity-70">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                <span>Đang tổng hợp Phiếu Học Tập &amp; Bộ Đề Kiểm Tra thực chiến...</span>
              </div>
            )}

            {studySheetError && !isStudySheetLoading && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300">
                {studySheetError}
              </div>
            )}

            {!studySheet && !isStudySheetLoading && !studySheetError && (
              <div className="py-10 px-4 text-center space-y-3">
                <FileText className="w-8 h-8 opacity-40 mx-auto" strokeWidth={1.5} />
                <p className="text-xs opacity-75 max-w-xs mx-auto leading-relaxed">
                  Tạo Phiếu Học Tập Thông Minh (Tóm tắt + Top từ vựng {targetLevel} + Ngữ pháp cốt lõi) &amp; Đề kiểm tra 7 câu chỉ với 1 cú bấm.
                </p>
                <button
                  type="button"
                  disabled={!hasLines}
                  onClick={onGenerateStudySheet}
                  className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 cursor-pointer"
                >
                  Sinh Phiếu Học Tập &amp; Quiz ngay
                </button>
              </div>
            )}

            {studySheet && !isStudySheetLoading && (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/5 dark:border-white/10">
                  <span className="text-xs font-semibold">Phiếu Học Tập · {targetLevel}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleExportStudySheetMarkdown}
                      className="h-7 px-2.5 text-[11px] font-medium rounded-md zen-surface-subtle border flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      <span>Markdown</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="h-7 px-2.5 text-[11px] font-medium rounded-md zen-surface-subtle border flex items-center gap-1 cursor-pointer"
                    >
                      <Printer className="w-3 h-3" />
                      <span>In / PDF</span>
                    </button>
                  </div>
                </div>

                <section className="space-y-2">
                  <h4 className="text-xs font-bold">01. Tóm tắt nội dung video</h4>
                  <p className="text-xs opacity-85 leading-relaxed">{studySheet.summaryVi}</p>
                  <ul className="space-y-1 text-xs opacity-75 list-disc pl-4">
                    {studySheet.keyTakeaways.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </section>

                <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2.5">
                  <h4 className="text-xs font-bold">
                    02. Top {studySheet.topVocabulary.length} từ vựng &amp; Collocations đắt giá
                  </h4>
                  <div className="divide-y divide-black/5 dark:divide-white/10">
                    {studySheet.topVocabulary.map((v, idx) => (
                      <div key={idx} className="py-2.5 space-y-1 text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="font-jp-compact">
                            <span className="font-bold">{v.term}</span>{' '}
                            <span className="font-ipa opacity-65">{v.readingOrIpa}</span>
                            {v.hanViet && (
                              <span className="ml-1.5 text-amber-700 dark:text-amber-300 font-semibold">
                                · {v.hanViet}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onSeekCurrentVideo(v.timestamp)}
                            className="font-mono-tabular text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 cursor-pointer"
                          >
                            {v.level} · {formatTime(v.timestamp)}
                          </button>
                        </div>
                        <p className="font-medium opacity-90">{v.meaningVi}</p>
                        <p className="opacity-65 italic font-jp-compact">“{v.exampleFromVideo}”</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2.5">
                  <h4 className="text-xs font-bold">03. Cấu trúc ngữ pháp cốt lõi</h4>
                  <div className="space-y-2.5">
                    {studySheet.coreGrammar.map((g, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg zen-surface-subtle border text-xs space-y-1"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-bold font-jp-compact">{g.pattern}</span>
                          <button
                            type="button"
                            onClick={() => onSeekCurrentVideo(g.timestamp)}
                            className="font-mono-tabular text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                          >
                            {g.level} · {formatTime(g.timestamp)}
                          </button>
                        </div>
                        <div className="font-mono-tabular text-[11px] opacity-65">{g.formula}</div>
                        <p className="opacity-85 leading-relaxed">{g.explanation}</p>
                        <p className="opacity-65 italic font-jp-compact">“{g.exampleFromVideo}”</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}

        {/* ================= MODE 4: INTERACTIVE QUIZ ================= */}
        {subMode === 'quiz' && (
          <div className="space-y-4">
            {isStudySheetLoading && (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs opacity-70">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                <span>Đang tạo bộ đề kiểm tra bám sát từng câu trong video...</span>
              </div>
            )}

            {!studySheet && !isStudySheetLoading && (
              <div className="py-10 px-4 text-center space-y-3">
                <p className="text-xs opacity-75">
                  Sinh bộ đề kiểm tra thực chiến (Nghe hiểu · Điền từ · Sửa ngữ pháp) trích trực tiếp từ video này.
                </p>
                <button
                  type="button"
                  disabled={!hasLines}
                  onClick={onGenerateStudySheet}
                  className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 cursor-pointer"
                >
                  Tạo đề kiểm tra ngay
                </button>
              </div>
            )}

            {studySheet && !isStudySheetLoading && (
              <>
                <div className="flex items-center justify-between pb-2.5 border-b border-black/5 dark:border-white/10 text-xs">
                  <span className="font-semibold">
                    Đề kiểm tra thực chiến ({studySheet.quiz.length} câu)
                  </span>
                  <span className="font-mono-tabular font-semibold text-indigo-600 dark:text-indigo-400">
                    Đúng: {quizStats.correct}/{quizStats.answered} đã làm
                  </span>
                </div>

                <div className="space-y-4">
                  {studySheet.quiz.map((q, idx) => {
                    const picked = selectedAnswers[q.id];
                    const isAnswered = picked !== undefined;
                    const typeLabel =
                      q.type === 'listening_comprehension'
                        ? 'Nghe hiểu'
                        : q.type === 'cloze_fill'
                          ? 'Điền khuyết'
                          : 'Ngữ pháp';

                    return (
                      <div
                        key={q.id}
                        className="p-3.5 rounded-xl zen-surface-subtle border space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] opacity-70">
                          <span className="font-semibold">
                            Câu {idx + 1} · {typeLabel}
                          </span>
                          <button
                            type="button"
                            onClick={() => onSeekCurrentVideo(q.timestamp)}
                            className="font-mono-tabular font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>Nghe lại ({formatTime(q.timestamp)})</span>
                          </button>
                        </div>

                        <p className="text-xs font-semibold leading-relaxed">{q.prompt}</p>

                        {q.sentenceContext && (
                          <p className="text-xs opacity-85 zen-surface px-2.5 py-2 rounded-lg border font-jp-compact">
                            {q.sentenceContext}
                          </p>
                        )}

                        <div className="space-y-1.5">
                          {q.options.map((opt, optIdx) => {
                            const isSelected = picked === optIdx;
                            const isCorrect = optIdx === q.correctIndex;
                            let btnClass = 'zen-surface border hover:border-indigo-400';

                            if (isAnswered) {
                              if (isCorrect) {
                                btnClass =
                                  'bg-teal-500/12 border-teal-500 text-teal-900 dark:text-teal-100 font-semibold';
                              } else if (isSelected && !isCorrect) {
                                btnClass =
                                  'bg-rose-500/12 border-rose-500 text-rose-900 dark:text-rose-100';
                              } else {
                                btnClass = 'zen-surface border opacity-45';
                              }
                            }

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                disabled={isAnswered}
                                onClick={() => {
                                  setSelectedAnswers((prev) => ({ ...prev, [q.id]: optIdx }));
                                  if (optIdx !== q.correctIndex) {
                                    onLogWeakness({
                                      kind: q.type === 'grammar_fix' ? 'grammar' : 'vocab',
                                      term: q.options[q.correctIndex] || q.prompt.slice(0, 20),
                                      categoryLabel: `Sai đề Quiz (${typeLabel})`,
                                      lastExample: q.sentenceContext || q.prompt,
                                      meaningVi: q.explanationVi,
                                    });
                                  }
                                }}
                                className={`w-full text-left px-3 py-2 text-xs rounded-lg border transition-colors flex items-center justify-between gap-2 font-jp-compact ${btnClass} ${
                                  isAnswered ? 'cursor-default' : 'cursor-pointer'
                                }`}
                              >
                                <span>
                                  <span className="font-mono-tabular font-semibold mr-2">
                                    {String.fromCharCode(65 + optIdx)}.
                                  </span>
                                  {opt}
                                </span>
                                {isAnswered && isCorrect && (
                                  <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                                )}
                                {isAnswered && isSelected && !isCorrect && (
                                  <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {isAnswered && (
                          <div className="pt-2 border-t border-black/5 dark:border-white/10 text-xs opacity-85 leading-relaxed">
                            <span className="font-semibold">Giải thích: </span>
                            {q.explanationVi}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ================= MODE 5: PERSONAL WEAKNESS RADAR & PROGRESS ================= */}
        {subMode === 'analytics' && (
          <div className="space-y-4">
            {/* Personal Weakness Radar Card */}
            <div className="p-3.5 rounded-xl zen-surface-subtle border space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Radar Lỗ Hổng Kiến Thức Cá Nhân ({langWeaknesses.length})</span>
                </div>
                <span className="text-[11px] opacity-60">Tự nhắc xuyên video</span>
              </div>

              {langWeaknesses.length === 0 ? (
                <p className="text-xs opacity-70 leading-relaxed">
                  Chưa ghi nhận lỗ hổng nào. Khi bạn bấm “Quên / Khó” ở FSRS hoặc làm sai bài luyện Phản xạ, hệ thống sẽ tự lưu ngầm vào IndexedDB và đánh dấu nhắc lại mỗi khi gặp đúng điểm đó ở video YouTube mới.
                </p>
              ) : (
                <div className="divide-y divide-black/5 dark:divide-white/10">
                  {langWeaknesses.slice(0, 10).map((w) => (
                    <div
                      key={w.id}
                      className="py-2 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-baseline flex-wrap gap-x-2">
                          <span
                            className={`font-bold ${language === 'ja' ? 'font-jp-compact' : ''}`}
                          >
                            {w.term}
                          </span>
                          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            Sai {w.errorCount} lần · {w.categoryLabel}
                          </span>
                        </div>
                        {w.meaningVi && <div className="opacity-75">{w.meaningVi}</div>}
                        {w.lastExample && (
                          <div className="text-[11px] opacity-60 italic truncate">
                            “{w.lastExample}”
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteWeakness(w.id)}
                        title="Đánh dấu đã nắm vững và xóa khỏi Radar"
                        className="p-1 opacity-50 hover:text-teal-600 hover:opacity-100 cursor-pointer shrink-0"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <AnalyticsPanel
              activityLogs={activityLogs}
              flashcards={flashcards}
              iPlusOneReport={iPlusOneReport}
            />
          </div>
        )}
      </div>
    </div>
  );
};
