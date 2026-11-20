import React, { useEffect, useState } from 'react';
import { GraduationCap, Loader2, Send, X } from 'lucide-react';
import type { Language, ProficiencyLevel, SubtitleLine } from '../types';
import { askAiSensei } from '../lib/api';
import { formatTime } from '../lib/youtube';

interface AiSenseiModalProps {
  isOpen: boolean;
  selectedText: string;
  activeLine: SubtitleLine | null;
  allLines: SubtitleLine[];
  videoTitle: string;
  language: Language;
  targetLevel: ProficiencyLevel;
  onClose: () => void;
}

export const AiSenseiModal: React.FC<AiSenseiModalProps> = ({
  isOpen,
  selectedText,
  activeLine,
  allLines,
  videoTitle,
  language,
  targetLevel,
  onClose,
}) => {
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    directAnswerVi: string;
    culturalOrPragmaticNote: string;
    nativeTakeaway: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setResult(null);
      setError(null);
      setQuestion('');
    }
  }, [isOpen, selectedText, activeLine?.id]);

  if (!isOpen) return null;

  const snippet = selectedText || activeLine?.text || '';
  const timestamp = activeLine?.start ?? 0;

  const presets =
    language === 'ja'
      ? [
          `Tại sao ở giây ${formatTime(timestamp)} nhân vật chọn cách nói này thay vì cách nói thông thường?`,
          'Ẩn ý văn hóa, sắc thái cảm xúc hoặc mức độ kính ngữ trong cảnh này là gì?',
          'Cụm này có nói tắt hay lược bỏ trợ từ kiểu khẩu ngữ đời thực không?',
        ]
      : [
          `Tại sao ở giây ${formatTime(timestamp)} diễn giả lại chọn diễn đạt này trong bối cảnh video?`,
          'Câu này có hàm ý văn hóa, châm biếm hay sắc thái cảm xúc đặc biệt nào không?',
          'Cách dùng tự nhiên cụm này trong giao tiếp thực tế hoặc IELTS Speaking?',
        ];

  const handleAsk = async (qText: string) => {
    if (!qText.trim() && !snippet) return;
    setIsLoading(true);
    setError(null);

    const idx = activeLine?.index ?? 0;
    const surrounding = allLines
      .slice(Math.max(0, idx - 4), Math.min(allLines.length, idx + 5))
      .map((l) => ({ start: l.start, text: l.text }));

    try {
      const resp = await askAiSensei({
        selectedText: snippet,
        question: qText.trim() || presets[0],
        timestamp,
        surroundingLines: surrounding,
        videoTitle,
        language,
        targetLevel,
      });
      setResult(resp.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi kết nối AI Sensei.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl zen-surface border shadow-2xl p-5 space-y-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Hỏi AI Sensei theo ngữ cảnh video"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h3 className="text-sm font-bold">Gia sư AI Sensei (Hiểu trọn mạch video)</h3>
              <p className="text-[11px] opacity-65 font-mono-tabular">
                Mốc cảnh {formatTime(timestamp)} · {language === 'ja' ? '日本語' : 'English'} {targetLevel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {snippet && (
          <div className="p-3 rounded-xl zen-surface-subtle border text-xs">
            <div className="text-[10px] opacity-60 mb-1">Đoạn thoại đang hỏi</div>
            <p className={`font-semibold leading-relaxed ${language === 'ja' ? 'font-jp' : ''}`}>
              “{snippet}”
            </p>
          </div>
        )}

        {/* Quick 1-click contextual presets */}
        <div className="space-y-1.5">
          {presets.map((p, i) => (
            <button
              key={i}
              type="button"
              disabled={isLoading}
              onClick={() => {
                setQuestion(p);
                handleAsk(p);
              }}
              className="w-full text-left px-3 py-2 text-xs rounded-lg zen-surface-subtle border hover:border-indigo-500 transition-colors cursor-pointer"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Custom Question Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk(question);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Hoặc gõ câu hỏi cụ thể về cảnh này..."
            className="flex-1 h-9 px-3 text-xs rounded-lg zen-surface-subtle border focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={isLoading || (!question.trim() && !snippet)}
            className="h-9 px-3.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 flex items-center gap-1 cursor-pointer shrink-0"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span>Hỏi</span>
          </button>
        </form>

        {/* Answer Area */}
        <div className="overflow-y-auto zen-scroll space-y-3">
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

          {result && (
            <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/60 space-y-2.5 text-xs">
              <div>
                <div className="font-bold text-indigo-700 dark:text-indigo-300 mb-0.5">
                  Giải đáp sát bối cảnh cảnh video
                </div>
                <p className="leading-relaxed">{result.directAnswerVi}</p>
              </div>
              <div className="pt-2 border-t border-indigo-200/60 dark:border-indigo-800/60">
                <div className="font-semibold mb-0.5">Sắc thái &amp; Ẩn ý văn hóa</div>
                <p className="opacity-85 leading-relaxed">{result.culturalOrPragmaticNote}</p>
              </div>
              <div className="pt-2 border-t border-indigo-200/60 dark:border-indigo-800/60">
                <div className="font-semibold mb-0.5">Mẫu câu ứng dụng ngay</div>
                <p className={`font-medium text-teal-700 dark:text-teal-300 ${language === 'ja' ? 'font-jp' : ''}`}>
                  {result.nativeTakeaway}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
