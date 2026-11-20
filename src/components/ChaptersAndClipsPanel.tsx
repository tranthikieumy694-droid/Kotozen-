import React, { useState } from 'react';
import {
  Clock,
  GitBranch,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Scissors,
  Trash2,
} from 'lucide-react';
import type { Language, SmartChapter, SmartClip, TimestampedNote } from '../types';
import { formatTime } from '../lib/youtube';

interface SmartChaptersPanelProps {
  language: Language;
  chapters: SmartChapter[] | null;
  currentTime: number;
  isLoading: boolean;
  error: string | null;
  hasLines: boolean;
  onGenerateChapters: () => void;
  onSeekTo: (seconds: number) => void;
}

export const SmartChaptersPanel: React.FC<SmartChaptersPanelProps> = ({
  language,
  chapters,
  currentTime,
  isLoading,
  error,
  hasLines,
  onGenerateChapters,
  onSeekTo,
}) => {
  if (!hasLines) {
    return (
      <div className="py-14 px-6 text-center text-xs opacity-65">
        Nạp video để tự động chia chương ngắn 2–3 phút kèm Bản đồ ý chính (Mind-Map) và đánh giá độ khó từng đoạn.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-black/5 dark:border-white/10 flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs font-semibold">Chương học &amp; Bản đồ ý chính (Mind-Map)</span>
        <button
          type="button"
          onClick={onGenerateChapters}
          disabled={isLoading}
          className="h-7 px-2.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1 cursor-pointer"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>{chapters ? 'Chia lại' : 'Chia chương ngay'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto zen-scroll p-3.5 space-y-3">
        {isLoading && (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs opacity-70">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span>Đang phân tích cấu trúc mạch truyện &amp; vẽ bản đồ ý chính...</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {!chapters && !isLoading && !error && (
          <div className="py-10 text-center space-y-3">
            <GitBranch className="w-8 h-8 opacity-40 mx-auto" strokeWidth={1.5} />
            <p className="text-xs opacity-75 max-w-xs mx-auto leading-relaxed">
              Đặc trị video dài 20–60 phút: chia nhỏ thành các chặng 2–3 phút có tiêu đề song ngữ, nhãn độ khó thực tế và bản đồ tư duy.
            </p>
            <button
              type="button"
              onClick={onGenerateChapters}
              className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
            >
              Tự động chia chương học
            </button>
          </div>
        )}

        {chapters && !isLoading && (
          <div className="space-y-3">
            {chapters.map((ch) => {
              const isCurrent = currentTime >= ch.start && currentTime <= ch.end;
              return (
                <div
                  key={ch.id}
                  onClick={() => onSeekTo(ch.start)}
                  className={`p-3.5 rounded-xl border transition-colors cursor-pointer space-y-2 ${
                    isCurrent
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-400 dark:border-indigo-600'
                      : 'zen-surface-subtle hover:border-indigo-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono-tabular font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                      <Play className="w-2.5 h-2.5 fill-current" />
                      {formatTime(ch.start)} – {formatTime(ch.end)}
                    </span>
                    <span className="font-semibold opacity-80">
                      Độ khó thực tế: {ch.difficultyLevel}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold leading-snug">
                      {ch.index + 1}. {ch.titleVi}
                    </h4>
                    <div className={`text-[11px] opacity-65 mt-0.5 ${language === 'ja' ? 'font-jp' : ''}`}>
                      {ch.titleSource}
                    </div>
                  </div>

                  <p className="text-xs opacity-80 leading-relaxed">{ch.summaryVi}</p>

                  {/* Visual Mind-Map Branch Nodes */}
                  {ch.mindMapNodes && ch.mindMapNodes.length > 0 && (
                    <div className="pt-1.5 border-t border-black/5 dark:border-white/10 space-y-1">
                      {ch.mindMapNodes.map((node, i) => (
                        <div key={i} className="flex items-start gap-2 text-[11px] opacity-80">
                          <span className="font-mono-tabular text-indigo-500 shrink-0">├─</span>
                          <span>{node}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

interface ClipsAndNotesPanelProps {
  videoId: string | null;
  currentTime: number;
  clips: SmartClip[];
  notes: TimestampedNote[];
  activeClipId: string | null;
  onPlayClip: (clip: SmartClip) => void;
  onStopClipLoop: () => void;
  onDeleteClip: (id: string) => void;
  onAddNote: (content: string, timestamp: number) => void;
  onDeleteNote: (id: string) => void;
  onSeekTo: (seconds: number) => void;
}

export const ClipsAndNotesPanel: React.FC<ClipsAndNotesPanelProps> = ({
  videoId,
  currentTime,
  clips,
  notes,
  activeClipId,
  onPlayClip,
  onStopClipLoop,
  onDeleteClip,
  onAddNote,
  onDeleteNote,
  onSeekTo,
}) => {
  const [noteInput, setNoteInput] = useState('');

  const handleCreateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim() || !videoId) return;
    onAddNote(noteInput.trim(), currentTime);
    setNoteInput('');
  };

  return (
    <div className="flex-1 overflow-y-auto zen-scroll p-3.5 space-y-5">
      {/* Section 1: Feature 18 Timestamped Notes */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold">01. Sổ Ghi Chú Neo Giây</h4>
          <span className="text-[11px] font-mono-tabular opacity-65 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Mốc hiện tại: [{formatTime(currentTime)}]
          </span>
        </div>

        <form onSubmit={handleCreateNote} className="flex items-center gap-1.5">
          <input
            type="text"
            value={noteInput}
            disabled={!videoId}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder={
              videoId
                ? `Ghi chú tại [${formatTime(currentTime)}] — bấm Enter để ghim...`
                : 'Nạp video để ghi chú neo mốc giây...'
            }
            className="flex-1 h-8 px-2.5 text-xs rounded-lg zen-surface-subtle border focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!videoId || !noteInput.trim()}
            className="h-8 px-2.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ghim</span>
          </button>
        </form>

        {notes.length === 0 ? (
          <p className="text-[11px] opacity-60">
            Chưa có ghi chú nào cho video này. Mỗi ghi chú sẽ tự động đóng dấu mốc giây để bấm là tua đúng cảnh đó.
          </p>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {notes.map((n) => (
              <div key={n.id} className="py-2 flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => onSeekTo(n.timestamp)}
                    className="font-mono-tabular font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    [{formatTime(n.timestamp)}]
                  </button>
                  <p className="leading-relaxed">{n.content}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteNote(n.id)}
                  aria-label="Xóa ghi chú"
                  className="p-1 opacity-50 hover:text-rose-600 hover:opacity-100 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Feature 16 Smart Clip Bookmarks ("Câu Thoại Vàng") */}
      <section className="pt-4 border-t border-black/5 dark:border-white/10 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-bold flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>02. Bộ Sưu Tập “Câu Thoại Vàng” ({clips.length})</span>
          </h4>
          {activeClipId && (
            <button
              type="button"
              onClick={onStopClipLoop}
              className="text-[11px] font-semibold text-rose-600 hover:underline cursor-pointer"
            >
              Dừng lặp Clip
            </button>
          )}
        </div>

        {clips.length === 0 ? (
          <p className="text-[11px] opacity-60 leading-relaxed">
            Bấm nút “Cắt đoạn 12s” dưới khung video khi gặp câu thoại hay để lưu vào playlist luyện nghe lặp lại mỗi tối.
          </p>
        ) : (
          <div className="space-y-2">
            {clips.map((clip) => {
              const isLooping = activeClipId === clip.id;
              return (
                <div
                  key={clip.id}
                  className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                    isLooping
                      ? 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-500'
                      : 'zen-surface-subtle'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onPlayClip(clip)}
                      className="font-mono-tabular font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Repeat className="w-3 h-3" />
                      <span>
                        {isLooping ? 'Đang lặp: ' : 'Phát lặp: '}
                        {formatTime(clip.start)} – {formatTime(clip.end)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteClip(clip.id)}
                      aria-label="Xóa clip"
                      className="opacity-50 hover:text-rose-600 hover:opacity-100 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className={`font-medium leading-snug ${clip.language === 'ja' ? 'font-jp' : ''}`}>
                    “{clip.text}”
                  </p>
                  {clip.translationVi && <p className="text-[11px] opacity-70">{clip.translationVi}</p>}
                  <div className="text-[10px] opacity-55 truncate">{clip.videoTitle}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
