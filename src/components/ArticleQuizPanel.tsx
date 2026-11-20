import React, { useState } from 'react';
import {
  BookOpenCheck,
  CheckCircle2,
  Compass,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { Language, ProficiencyLevel, ReadingQuizQuestion } from '../types';

interface ArticleQuizPanelProps {
  language: Language;
  targetLevel: ProficiencyLevel;
  questions: ReadingQuizQuestion[];
  isLoading: boolean;
  onGenerate: () => void;
  onJumpToParagraph: (paragraphId: string) => void;
}

export const ArticleQuizPanel: React.FC<ArticleQuizPanelProps> = ({
  language,
  targetLevel,
  questions,
  isLoading,
  onGenerate,
  onJumpToParagraph,
}) => {
  const [selected, setSelected] = useState<Record<string, number>>({});

  const answeredCount = Object.keys(selected).length;
  const correctCount = questions.reduce(
    (acc, q) => (selected[q.id] === q.correctIndex ? acc + 1 : acc),
    0
  );

  if (questions.length === 0) {
    return (
      <div className="zen-surface border rounded-xl p-5 text-center space-y-3">
        <div className="w-10 h-10 rounded-xl zen-surface-subtle border mx-auto flex items-center justify-center">
          <BookOpenCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-bold">
            Đề Đọc Hiểu Bài Báo ({language === 'ja' ? `JLPT ${targetLevel}` : `IELTS / CEFR ${targetLevel}`})
          </h4>
          <p className="text-xs opacity-75 max-w-sm mx-auto leading-relaxed">
            AI sẽ biên soạn 6 câu hỏi đọc hiểu học thuật (Ý chính, Chi tiết, Từ vựng ngữ cảnh, Suy luận &amp; Giọng điệu tác giả) có gắn nút nhảy thẳng về đoạn dẫn chứng.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isLoading}
          className="h-9 px-4 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 sepia:bg-amber-800 sepia:hover:bg-amber-900 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Đang tạo đề đọc hiểu...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Tạo Đề Đọc Hiểu 6 Câu</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="zen-surface-subtle border rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 font-bold">
          <BookOpenCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span>
            Đọc hiểu {language === 'ja' ? `JLPT ${targetLevel}` : `IELTS / ${targetLevel}`}
          </span>
          <span className="font-mono-tabular text-teal-600 dark:text-teal-400">
            {correctCount}/{questions.length} đúng ({answeredCount}/{questions.length} đã làm)
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelected({})}
            className="h-7 px-2.5 rounded-lg zen-surface border text-[11px] font-semibold flex items-center gap-1 hover:border-indigo-500 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Làm lại</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected({});
              onGenerate();
            }}
            disabled={isLoading}
            className="h-7 px-2.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold flex items-center gap-1 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            <span>Đề mới</span>
          </button>
        </div>
      </div>

      {/* Question Cards */}
      {questions.map((q, idx) => {
        const picked = selected[q.id];
        const hasAnswered = picked !== undefined;
        const isRight = picked === q.correctIndex;

        return (
          <div key={q.id} className="zen-surface border rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                Câu {idx + 1} · {q.skillLabelVi}
              </span>
              {q.evidenceParagraphId && (
                <button
                  type="button"
                  onClick={() => onJumpToParagraph(q.evidenceParagraphId)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold opacity-75 hover:opacity-100 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                >
                  <Compass className="w-3 h-3" />
                  <span>Xem đoạn {q.evidenceParagraphId.toUpperCase()}</span>
                </button>
              )}
            </div>

            <div className={`text-sm font-semibold leading-relaxed ${language === 'ja' ? 'font-jp' : ''}`}>
              {q.question}
            </div>
            <div className="text-xs opacity-65 italic">{q.questionVi}</div>

            <div className="space-y-1.5 pt-1">
              {q.options.map((opt, optIdx) => {
                const isPicked = picked === optIdx;
                const isCorrectOpt = optIdx === q.correctIndex;
                let stateClass =
                  'zen-surface-subtle border hover:border-indigo-500/70';
                if (hasAnswered) {
                  if (isCorrectOpt) {
                    stateClass =
                      'bg-emerald-500/12 border-emerald-500/60 text-emerald-900 dark:text-emerald-100';
                  } else if (isPicked && !isCorrectOpt) {
                    stateClass =
                      'bg-rose-500/12 border-rose-500/60 text-rose-900 dark:text-rose-100';
                  } else {
                    stateClass = 'zen-surface-subtle border opacity-55';
                  }
                }
                const letter = ['A', 'B', 'C', 'D'][optIdx] || String(optIdx + 1);
                return (
                  <button
                    key={optIdx}
                    type="button"
                    disabled={hasAnswered}
                    onClick={() => setSelected((prev) => ({ ...prev, [q.id]: optIdx }))}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-start gap-2 cursor-pointer disabled:cursor-default ${stateClass}`}
                  >
                    <span className="font-mono-tabular font-bold shrink-0">{letter}.</span>
                    <span className={`flex-1 min-w-0 leading-relaxed ${language === 'ja' ? 'font-jp' : ''}`}>
                      {opt}
                    </span>
                    {hasAnswered && isCorrectOpt && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    )}
                    {hasAnswered && isPicked && !isCorrectOpt && (
                      <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>

            {hasAnswered && (
              <div className="rounded-lg zen-surface-subtle border p-2.5 text-xs space-y-1.5">
                <div className={`font-bold ${isRight ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {isRight ? 'Chính xác!' : 'Chưa đúng — xem giải thích & dẫn chứng:'}
                </div>
                <p className="leading-relaxed opacity-85">{q.explanationVi}</p>
                {q.evidenceQuote && (
                  <div className="pt-1 border-t border-black/5 dark:border-white/10 flex items-start justify-between gap-2">
                    <span className={`text-[11px] opacity-75 italic ${language === 'ja' ? 'font-jp' : ''}`}>
                      “{q.evidenceQuote}”
                    </span>
                    {q.evidenceParagraphId && (
                      <button
                        type="button"
                        onClick={() => onJumpToParagraph(q.evidenceParagraphId)}
                        className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 cursor-pointer"
                      >
                        Nhảy tới đoạn →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
