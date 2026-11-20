import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  HelpCircle,
  Loader2,
  PenTool,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Volume2,
  XCircle,
} from 'lucide-react';
import type {
  ActiveProductionPack,
  Language,
  ProficiencyLevel,
  SentenceCoachFeedback,
} from '../types';
import { formatTime, speakNative } from '../lib/youtube';
import { coachUserSentence } from '../lib/api';

interface ActiveProductionLabProps {
  language: Language;
  targetLevel: ProficiencyLevel;
  videoTitle: string;
  hasLines: boolean;
  pack: ActiveProductionPack | null;
  isLoading: boolean;
  error: string | null;
  onGeneratePack: () => void;
  onSeekTo: (seconds: number) => void;
  onLogWeakness: (params: {
    kind: 'vocab' | 'grammar' | 'particle' | 'tense';
    term: string;
    categoryLabel: string;
    lastExample?: string;
    meaningVi?: string;
  }) => void;
  onDrillSuccess?: () => void;
}

type LabMode = 'cloze' | 'builder' | 'redpen' | 'coach';

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  particle: 'Sai trợ từ',
  transitivity: 'Sai tự/tha động từ',
  tense: 'Sai thì (Tense)',
  preposition: 'Sai giới từ / Collocation',
  calque: 'Bẫy dịch từng chữ (Vietlish)',
};

export const ActiveProductionLab: React.FC<ActiveProductionLabProps> = ({
  language,
  targetLevel,
  videoTitle,
  hasLines,
  pack,
  isLoading,
  error,
  onGeneratePack,
  onSeekTo,
  onLogWeakness,
  onDrillSuccess,
}) => {
  const [mode, setMode] = useState<LabMode>('cloze');

  // Mode 1: Context Cloze state
  const [clozeInputs, setClozeInputs] = useState<Record<string, string>>({});
  const [clozeStatus, setClozeStatus] = useState<Record<string, 'correct' | 'wrong'>>({});
  const [clozeHints, setClozeHints] = useState<Record<string, boolean>>({});

  // Mode 2: Sentence Architecture Builder state
  const [builderSelected, setBuilderSelected] = useState<Record<string, number[]>>({});
  const [builderChecked, setBuilderChecked] = useState<Record<string, 'correct' | 'wrong'>>({});

  // Mode 3: Red-Pen Error Spotting state
  const [redPenPicked, setRedPenPicked] = useState<Record<string, number>>({});

  // Mode 4: Instant Output Coach state
  const [selectedPromptTerm, setSelectedPromptTerm] = useState<string>('');
  const [userSentence, setUserSentence] = useState<string>('');
  const [isCoaching, setIsCoaching] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachFeedback, setCoachFeedback] = useState<SentenceCoachFeedback | null>(null);
  const coachAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setClozeInputs({});
    setClozeStatus({});
    setClozeHints({});
    setBuilderSelected({});
    setBuilderChecked({});
    setRedPenPicked({});
  }, [pack?.generatedAt]);

  useEffect(() => {
    return () => {
      coachAbortRef.current?.abort();
    };
  }, []);

  const handleCheckCloze = (
    drillId: string,
    missingAnswer: string,
    acceptedAnswers: string[],
    category: 'vocab' | 'collocation' | 'particle' | 'tense' | 'grammar',
    sentenceContext: string,
    translationVi: string
  ) => {
    const raw = (clozeInputs[drillId] || '').trim().toLowerCase();
    if (!raw) return;
    const validSet = new Set(
      [missingAnswer, ...(acceptedAnswers || [])].map((s) => s.trim().toLowerCase())
    );
    if (validSet.has(raw)) {
      setClozeStatus((prev) => ({ ...prev, [drillId]: 'correct' }));
      onDrillSuccess?.();
    } else {
      setClozeStatus((prev) => ({ ...prev, [drillId]: 'wrong' }));
      const mappedKind: 'vocab' | 'grammar' | 'particle' | 'tense' =
        category === 'particle'
          ? 'particle'
          : category === 'tense'
            ? 'tense'
            : category === 'grammar'
              ? 'grammar'
              : 'vocab';
      onLogWeakness({
        kind: mappedKind,
        term: missingAnswer,
        categoryLabel:
          category === 'particle'
            ? 'Trợ từ hay nhầm'
            : category === 'tense'
              ? 'Chia thì (Tense)'
              : category === 'collocation'
                ? 'Collocation'
                : 'Điền khuyết ngữ cảnh',
        lastExample: sentenceContext.replace('_____', missingAnswer),
        meaningVi: translationVi,
      });
    }
  };

  const handlePickBuilderTile = (drillId: string, shuffledIndex: number) => {
    setBuilderSelected((prev) => {
      const current = prev[drillId] || [];
      if (current.includes(shuffledIndex)) {
        return { ...prev, [drillId]: current.filter((i) => i !== shuffledIndex) };
      }
      return { ...prev, [drillId]: [...current, shuffledIndex] };
    });
    setBuilderChecked((prev) => {
      if (!prev[drillId]) return prev;
      const next = { ...prev };
      delete next[drillId];
      return next;
    });
  };

  const handleCheckBuilder = (
    drillId: string,
    shuffledChunks: string[],
    correctChunks: string[],
    translationVi: string
  ) => {
    const pickedIndices = builderSelected[drillId] || [];
    const built = pickedIndices.map((idx) => shuffledChunks[idx]);
    const isExact =
      built.length === correctChunks.length &&
      built.every((chunk, idx) => chunk.trim() === correctChunks[idx].trim());
    if (isExact) {
      setBuilderChecked((prev) => ({ ...prev, [drillId]: 'correct' }));
      onDrillSuccess?.();
    } else {
      setBuilderChecked((prev) => ({ ...prev, [drillId]: 'wrong' }));
      onLogWeakness({
        kind: 'grammar',
        term: correctChunks.slice(0, 2).join(language === 'ja' ? '' : ' '),
        categoryLabel: 'Trật tự cú pháp câu',
        lastExample: correctChunks.join(language === 'ja' ? '' : ' '),
        meaningVi: translationVi,
      });
    }
  };

  const handlePickRedPenToken = (
    drillId: string,
    pickedIdx: number,
    errorTokenIndex: number,
    fixedFragment: string,
    errorCategory: 'particle' | 'transitivity' | 'tense' | 'preposition' | 'calque',
    fixedSentence: string
  ) => {
    if (redPenPicked[drillId] !== undefined) return;
    setRedPenPicked((prev) => ({ ...prev, [drillId]: pickedIdx }));
    if (pickedIdx === errorTokenIndex) {
      onDrillSuccess?.();
    } else {
      const mappedKind: 'vocab' | 'grammar' | 'particle' | 'tense' =
        errorCategory === 'particle'
          ? 'particle'
          : errorCategory === 'tense'
            ? 'tense'
            : errorCategory === 'calque'
              ? 'vocab'
              : 'grammar';
      onLogWeakness({
        kind: mappedKind,
        term: fixedFragment,
        categoryLabel: ERROR_CATEGORY_LABELS[errorCategory] || 'Săn lỗi Bút Đỏ',
        lastExample: fixedSentence,
      });
    }
  };

  const handleSubmitCoach = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = userSentence.trim();
    if (!cleaned || isCoaching) return;
    coachAbortRef.current?.abort();
    const ctrl = new AbortController();
    coachAbortRef.current = ctrl;
    setIsCoaching(true);
    setCoachError(null);

    try {
      const { feedback } = await coachUserSentence(
        {
          userSentence: cleaned,
          targetTerm: selectedPromptTerm || undefined,
          language,
          targetLevel,
          videoTitle,
        },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      setCoachFeedback(feedback);
      if (feedback.naturalnessTier === 'native_natural') {
        onDrillSuccess?.();
      } else if (feedback.redPenCorrections.length > 0) {
        const firstFix = feedback.redPenCorrections[0];
        onLogWeakness({
          kind: 'grammar',
          term: firstFix.fixedSegment || selectedPromptTerm || cleaned.slice(0, 24),
          categoryLabel: 'Đặt câu tự do (AI Sensei)',
          lastExample: feedback.nativeUpgrade,
          meaningVi: firstFix.reasonVi,
        });
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setCoachError(
        err instanceof Error ? err.message : 'Chưa thể chấm câu lúc này. Vui lòng thử gửi lại.'
      );
    } finally {
      if (!ctrl.signal.aborted) {
        setIsCoaching(false);
      }
    }
  };

  return (
    <div className="space-y-3.5 min-w-0">
      {/* Header & Generate Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-black/5 dark:border-white/10">
        <div className="min-w-0">
          <div className="text-xs font-bold">Phòng Luyện Phản Xạ Chủ Động 4 Chế Độ</div>
          <div className="text-[11px] opacity-65">
            Chuyển hóa từ vựng &amp; ngữ pháp thành kỹ năng tự nói/viết tức thì
          </div>
        </div>
        {hasLines && (
          <button
            type="button"
            onClick={onGeneratePack}
            disabled={isLoading}
            className="h-7 px-2.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{pack ? 'Sinh bộ bài mới' : 'Tạo bài luyện từ video'}</span>
          </button>
        )}
      </div>

      {/* 4-Mode Segmented Selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl zen-surface-subtle border">
        {(
          [
            { id: 'cloze', label: 'Điền khuyết' },
            { id: 'builder', label: 'Xếp gạch câu' },
            { id: 'redpen', label: 'Săn lỗi Bút Đỏ' },
            { id: 'coach', label: 'Đặt câu AI' },
          ] as Array<{ id: LabMode; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              mode === tab.id
                ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && mode !== 'coach' && (
        <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs opacity-70">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span>Đang thiết kế bài tập Điền khuyết · Xếp gạch cú pháp · Săn lỗi Bút Đỏ...</span>
        </div>
      )}

      {error && !isLoading && mode !== 'coach' && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {!pack && !isLoading && mode !== 'coach' && (
        <div className="py-8 px-4 text-center rounded-xl zen-surface-subtle border space-y-3">
          <Puzzle className="w-7 h-7 opacity-45 mx-auto" strokeWidth={1.5} />
          <p className="text-xs opacity-80 max-w-sm mx-auto leading-relaxed">
            Sinh ngay 3 bộ bài luyện phản xạ trích từ chính video này (Điền khuyết ngữ cảnh · Xếp gạch trật tự câu · Thợ săn lỗi Bút Đỏ). Hoặc chuyển sang tab “Đặt câu AI” để viết câu ngay!
          </p>
          <button
            type="button"
            disabled={!hasLines}
            onClick={onGeneratePack}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 cursor-pointer"
          >
            Khởi tạo Phòng Luyện Phản Xạ
          </button>
        </div>
      )}

      {/* ================= MODE 1: VIDEO-ANCHORED CONTEXT CLOZE ================= */}
      {mode === 'cloze' && pack && !isLoading && (
        <div className="space-y-3">
          {pack.clozeDrills.map((drill, idx) => {
            const status = clozeStatus[drill.id];
            const val = clozeInputs[drill.id] || '';
            const showHint = Boolean(clozeHints[drill.id]);
            return (
              <div
                key={drill.id}
                className="p-3.5 rounded-xl zen-surface-subtle border space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] opacity-70">
                  <span className="font-semibold">
                    Bài {idx + 1} · Điền khuyết ngữ cảnh gốc
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        speakNative(
                          drill.sentenceWithBlank.replace('_____', drill.missingAnswer),
                          language
                        )
                      }
                      className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>Nghe mẫu</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSeekTo(drill.timestamp)}
                      className="font-mono-tabular text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      <span>{formatTime(drill.timestamp)}</span>
                    </button>
                  </div>
                </div>

                <p
                  className={`text-sm font-semibold leading-relaxed safe-wrap ${
                    language === 'ja' ? 'font-jp-compact' : ''
                  }`}
                >
                  {drill.sentenceWithBlank}
                </p>
                <p className="opacity-70">{drill.translationVi}</p>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={val}
                    onChange={(e) =>
                      setClozeInputs((prev) => ({ ...prev, [drill.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleCheckCloze(
                          drill.id,
                          drill.missingAnswer,
                          drill.acceptedAnswers,
                          drill.targetCategory,
                          drill.sentenceWithBlank,
                          drill.translationVi
                        );
                      }
                    }}
                    placeholder="Gõ từ / trợ từ / dạng chia còn thiếu..."
                    className={`flex-1 min-w-0 h-8 px-2.5 text-xs rounded-lg zen-surface border focus:outline-none focus:border-indigo-500 ${
                      language === 'ja' ? 'font-jp-compact' : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setClozeHints((prev) => ({ ...prev, [drill.id]: !prev[drill.id] }))
                    }
                    title="Xem gợi ý"
                    className="h-8 px-2 rounded-lg zen-surface border opacity-75 hover:opacity-100 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCheckCloze(
                        drill.id,
                        drill.missingAnswer,
                        drill.acceptedAnswers,
                        drill.targetCategory,
                        drill.sentenceWithBlank,
                        drill.translationVi
                      )
                    }
                    className="h-8 px-3 font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer whitespace-nowrap"
                  >
                    Kiểm tra
                  </button>
                </div>

                {showHint && !status && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Gợi ý: {drill.hintVi}
                  </p>
                )}

                {status === 'correct' && (
                  <div className="p-2.5 rounded-lg bg-teal-500/10 border border-teal-500/25 text-teal-800 dark:text-teal-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Chính xác! Đáp án: {drill.missingAnswer}</span>
                    </div>
                    <p className="opacity-90 leading-relaxed">{drill.explanationVi}</p>
                  </div>
                )}

                {status === 'wrong' && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Chưa khớp · Đáp án đúng:{' '}
                        <span className={language === 'ja' ? 'font-jp-compact' : ''}>
                          {drill.missingAnswer}
                        </span>
                      </span>
                    </div>
                    <p className="opacity-90 leading-relaxed">{drill.explanationVi}</p>
                    <p className="text-[11px] opacity-75">
                      Đã ghi nhận vào Radar Lỗ Hổng để nhắc lại khi gặp ở video sau.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ================= MODE 2: SENTENCE ARCHITECTURE BUILDER ================= */}
      {mode === 'builder' && pack && !isLoading && (
        <div className="space-y-3">
          {pack.builderDrills.map((drill, idx) => {
            const picked = builderSelected[drill.id] || [];
            const status = builderChecked[drill.id];
            const remaining = drill.shuffledChunks
              .map((text, sIdx) => ({ text, sIdx }))
              .filter((item) => !picked.includes(item.sIdx));

            return (
              <div
                key={drill.id}
                className="p-3.5 rounded-xl zen-surface-subtle border space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] opacity-70">
                  <span className="font-semibold">
                    Câu {idx + 1} · Xếp gạch trật tự cú pháp
                  </span>
                  <button
                    type="button"
                    onClick={() => onSeekTo(drill.timestamp)}
                    className="font-mono-tabular text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>{formatTime(drill.timestamp)}</span>
                  </button>
                </div>

                <p className="font-semibold opacity-90">Nghĩa cần dựng: “{drill.translationVi}”</p>

                {/* Built Sentence Drop Zone */}
                <div className="min-h-[46px] p-2 rounded-lg zen-surface border border-dashed flex flex-wrap gap-1.5 items-center">
                  {picked.length === 0 ? (
                    <span className="text-[11px] opacity-50">
                      Bấm lần lượt các mảnh bên dưới để lắp thành câu đúng trật tự...
                    </span>
                  ) : (
                    picked.map((sIdx) => (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => handlePickBuilderTile(drill.id, sIdx)}
                        className={`px-2.5 py-1 rounded-md bg-indigo-600 text-white font-semibold cursor-pointer hover:opacity-90 ${
                          language === 'ja' ? 'font-jp-compact' : ''
                        }`}
                      >
                        {drill.shuffledChunks[sIdx]}
                      </button>
                    ))
                  )}
                </div>

                {/* Available Shuffled Tiles */}
                <div className="flex flex-wrap gap-1.5">
                  {remaining.map((tile) => (
                    <button
                      key={tile.sIdx}
                      type="button"
                      onClick={() => handlePickBuilderTile(drill.id, tile.sIdx)}
                      className={`px-2.5 py-1 rounded-md zen-surface border hover:border-indigo-500 font-medium cursor-pointer transition-colors ${
                        language === 'ja' ? 'font-jp-compact' : ''
                      }`}
                    >
                      {tile.text}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setBuilderSelected((prev) => ({ ...prev, [drill.id]: [] }));
                      setBuilderChecked((prev) => {
                        const n = { ...prev };
                        delete n[drill.id];
                        return n;
                      });
                    }}
                    className="h-7 px-2.5 text-[11px] font-medium rounded-md zen-surface border flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Xếp lại</span>
                  </button>

                  <button
                    type="button"
                    disabled={picked.length !== drill.shuffledChunks.length}
                    onClick={() =>
                      handleCheckBuilder(
                        drill.id,
                        drill.shuffledChunks,
                        drill.correctChunks,
                        drill.translationVi
                      )
                    }
                    className="h-7 px-3 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 cursor-pointer"
                  >
                    Kiểm tra trật tự
                  </button>
                </div>

                {status === 'correct' && (
                  <div className="p-2.5 rounded-lg bg-teal-500/10 border border-teal-500/25 text-teal-800 dark:text-teal-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Trật tự cú pháp hoàn hảo!</span>
                    </div>
                    <p className="opacity-90 leading-relaxed">{drill.orderRuleVi}</p>
                  </div>
                )}

                {status === 'wrong' && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Chưa khớp trật tự chuẩn</span>
                    </div>
                    <p className={language === 'ja' ? 'font-jp-compact font-semibold' : 'font-semibold'}>
                      Đúng: {drill.correctChunks.join(language === 'ja' ? '' : ' ')}
                    </p>
                    <p className="opacity-90 leading-relaxed">{drill.orderRuleVi}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ================= MODE 3: RED-PEN ERROR SPOTTING ================= */}
      {mode === 'redpen' && pack && !isLoading && (
        <div className="space-y-3">
          {pack.redPenDrills.map((drill, idx) => {
            const pickedIdx = redPenPicked[drill.id];
            const answered = pickedIdx !== undefined;
            const isCorrect = pickedIdx === drill.errorTokenIndex;

            return (
              <div
                key={drill.id}
                className="p-3.5 rounded-xl zen-surface-subtle border space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] opacity-70">
                  <span className="font-semibold flex items-center gap-1">
                    <PenTool className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                    <span>
                      Câu {idx + 1} · Chạm đúng 1 mảnh bị cài lỗi ({ERROR_CATEGORY_LABELS[drill.errorCategory] || 'Lỗi ngữ pháp'})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onSeekTo(drill.timestamp)}
                    className="font-mono-tabular text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>{formatTime(drill.timestamp)}</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {drill.tokens.map((tok, tIdx) => {
                    const isErrorSlot = tIdx === drill.errorTokenIndex;
                    const isUserPick = tIdx === pickedIdx;
                    let cls =
                      'zen-surface border hover:border-rose-400 hover:bg-rose-500/5 cursor-pointer';
                    if (answered) {
                      if (isErrorSlot) {
                        cls =
                          'bg-teal-500/15 border-teal-500 text-teal-900 dark:text-teal-100 font-bold cursor-default';
                      } else if (isUserPick) {
                        cls =
                          'bg-rose-500/15 border-rose-500 text-rose-800 dark:text-rose-200 cursor-default';
                      } else {
                        cls = 'zen-surface border opacity-60 cursor-default';
                      }
                    }

                    return (
                      <button
                        key={tIdx}
                        type="button"
                        disabled={answered}
                        onClick={() =>
                          handlePickRedPenToken(
                            drill.id,
                            tIdx,
                            drill.errorTokenIndex,
                            drill.fixedFragment,
                            drill.errorCategory,
                            drill.fixedSentence
                          )
                        }
                        className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          language === 'ja' ? 'font-jp-compact' : ''
                        } ${cls}`}
                      >
                        {tok}
                      </button>
                    );
                  })}
                </div>

                {answered && (
                  <div
                    className={`p-2.5 rounded-lg border space-y-1 ${
                      isCorrect
                        ? 'bg-teal-500/10 border-teal-500/25 text-teal-900 dark:text-teal-100'
                        : 'bg-rose-500/10 border-rose-500/25 text-rose-900 dark:text-rose-100'
                    }`}
                  >
                    <div className="font-bold flex items-center gap-1.5">
                      {isCorrect ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>
                        {isCorrect ? 'Bắt trúng lỗi Bút Đỏ!' : 'Chưa đúng chỗ sai'} ·{' '}
                        <span className="line-through opacity-75">{drill.wrongFragment}</span> →{' '}
                        <span className="underline">{drill.fixedFragment}</span>
                      </span>
                    </div>
                    <p className={`font-semibold ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                      Câu chuẩn: {drill.fixedSentence}
                    </p>
                    <p className="opacity-85 leading-relaxed">{drill.explanationVi}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ================= MODE 4: INSTANT OUTPUT COACH (<1.5s AI SENSEI) ================= */}
      {mode === 'coach' && (
        <div className="space-y-3">
          {/* Suggested Target Words/Grammar from Video */}
          {pack && pack.suggestedPrompts.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold opacity-65">
                Chọn nhanh từ vựng / mẫu ngữ pháp trong video để thử đặt câu:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pack.suggestedPrompts.map((p, idx) => {
                  const active = selectedPromptTerm === p.targetTerm;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        setSelectedPromptTerm((cur) => (cur === p.targetTerm ? '' : p.targetTerm))
                      }
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer ${
                        active
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'zen-surface-subtle hover:border-indigo-400'
                      }`}
                    >
                      <span className={`font-semibold ${language === 'ja' ? 'font-jp-compact' : ''}`}>
                        {p.targetTerm}
                      </span>
                      <span className="ml-1.5 text-[11px] opacity-80">({p.meaningVi})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmitCoach} className="space-y-2">
            {selectedPromptTerm && (
              <div className="text-xs text-indigo-700 dark:text-indigo-300 font-semibold">
                Mục tiêu áp dụng: “{selectedPromptTerm}”
              </div>
            )}
            <textarea
              value={userSentence}
              onChange={(e) => setUserSentence(e.target.value)}
              rows={3}
              placeholder={
                language === 'ja'
                  ? 'Tự gõ 1 câu Tiếng Nhật áp dụng từ vựng hoặc ngữ pháp bạn vừa học...'
                  : 'Write an English sentence applying a word, collocation, or grammar pattern from this video...'
              }
              className={`w-full p-3 text-sm rounded-xl zen-surface border focus:outline-none focus:border-indigo-500 resize-none ${
                language === 'ja' ? 'font-jp-compact' : ''
              }`}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] opacity-60">
                AI Sensei chấm tự nhiên, sửa Bút Đỏ &amp; nâng cấp bản xứ
              </span>
              <button
                type="submit"
                disabled={isCoaching || !userSentence.trim()}
                className="h-8 px-3.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-45 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                {isCoaching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{isCoaching ? 'Đang chấm câu...' : 'Chấm & Sửa Bút Đỏ'}</span>
              </button>
            </div>
          </form>

          {coachError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300">
              {coachError}
            </div>
          )}

          {coachFeedback && (
            <div className="p-3.5 rounded-xl zen-surface-subtle border space-y-3 text-xs">
              {/* Naturalness Verdict */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-bold text-sm ${
                    coachFeedback.naturalnessTier === 'native_natural'
                      ? 'text-teal-700 dark:text-teal-300'
                      : coachFeedback.naturalnessTier === 'correct_but_stiff'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {coachFeedback.naturalnessLabelVi}
                </span>
                <span className="text-[11px] opacity-65">AI Sensei Feedback</span>
              </div>

              {/* Red-Pen Corrections */}
              {coachFeedback.redPenCorrections.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                    Bút Đỏ sửa lỗi tinh tế
                  </div>
                  {coachFeedback.redPenCorrections.map((c, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg zen-surface border space-y-1"
                    >
                      <div className={language === 'ja' ? 'font-jp-compact' : ''}>
                        <span className="line-through text-rose-600 dark:text-rose-400 font-semibold">
                          {c.wrongSegment}
                        </span>
                        <span className="mx-1.5 opacity-50">→</span>
                        <span className="text-teal-700 dark:text-teal-300 font-bold underline">
                          {c.fixedSegment}
                        </span>
                      </div>
                      <p className="opacity-80 leading-relaxed">{c.reasonVi}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Native Upgrade */}
              <div className="p-3 rounded-lg bg-indigo-500/8 border border-indigo-500/25 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Phiên bản nâng cấp chuẩn bản xứ</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => speakNative(coachFeedback.nativeUpgrade, language)}
                    className="h-6 px-2 text-[11px] font-medium rounded zen-surface border flex items-center gap-1 cursor-pointer"
                  >
                    <Volume2 className="w-3 h-3" />
                    <span>Nghe</span>
                  </button>
                </div>
                <p
                  className={`text-sm font-bold leading-relaxed safe-wrap ${
                    language === 'ja' ? 'font-jp-compact' : ''
                  }`}
                >
                  {coachFeedback.nativeUpgrade}
                </p>
                {coachFeedback.nativeUpgradeReadingOrIpa && (
                  <p
                    className={`opacity-70 ${
                      language === 'ja' ? 'font-jp-compact' : 'font-ipa'
                    }`}
                  >
                    {coachFeedback.nativeUpgradeReadingOrIpa}
                  </p>
                )}
                <p className="opacity-85 leading-relaxed">{coachFeedback.upgradeNoteVi}</p>
              </div>

              <p className="opacity-75 italic">{coachFeedback.encouragementVi}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
