import React, { useState } from 'react';
import { Clock, Newspaper, Play, Trash2, X } from 'lucide-react';
import type { ArticleSession, VideoSession } from '../types';
import { formatTime } from '../lib/youtube';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_LIST = [
  { key: 'Space', desc: 'Phát / Tạm dừng video YouTube' },
  { key: '← / →', desc: 'Nhảy về câu phụ đề trước / câu tiếp theo' },
  { key: 'R', desc: 'Bật / Tắt lặp lại câu phụ đề hoặc câu bài viết hiện tại' },
  { key: 'S', desc: 'Đặt mốc A → đặt mốc B → tắt vòng lặp A-B' },
  { key: 'F', desc: 'Bật / Tắt lớp phủ Furigana (Nhật) hoặc IPA & Nối âm (Anh)' },
  { key: 'V', desc: 'Ẩn / Hiện dòng dịch nghĩa tiếng Việt' },
  { key: 'Giữ H', desc: 'Tạm thời làm rõ dòng đang bật chế độ Làm Mờ (Blur)' },
  { key: 'Esc', desc: 'Đóng thẻ tra từ vựng đang mở và tiếp tục phát video' },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Hệ thống phím tắt bàn phím"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Phím tắt điều khiển nhanh
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {SHORTCUT_LIST.map((item) => (
            <div key={item.key} className="py-2.5 flex items-center justify-between gap-4 text-xs">
              <span className="text-slate-600 dark:text-slate-300">{item.desc}</span>
              <kbd className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono-tabular font-semibold text-slate-800 dark:text-slate-200 shrink-0">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface HistoryDrawerProps {
  isOpen: boolean;
  sessions: VideoSession[];
  articleSessions?: ArticleSession[];
  activeSessionId: string | null;
  activeArticleId?: string | null;
  onClose: () => void;
  onSelectSession: (session: VideoSession) => void;
  onDeleteSession: (id: string) => void;
  onSelectArticle?: (article: ArticleSession) => void;
  onDeleteArticle?: (id: string) => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  sessions,
  articleSessions = [],
  activeSessionId,
  activeArticleId,
  onClose,
  onSelectSession,
  onDeleteSession,
  onSelectArticle,
  onDeleteArticle,
}) => {
  const [tab, setTab] = useState<'video' | 'article'>('video');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-white dark:bg-[#0F172A] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Thư viện bài học ngoại tuyến"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
                Thư viện đã học (IndexedDB)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Mở lại tức thì 0ms toàn bộ Video &amp; Bài viết ngoại tuyến
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTab('video')}
              className={`py-1.5 rounded-md flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'video'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Video ({sessions.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('article')}
              className={`py-1.5 rounded-md flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'article'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Newspaper className="w-3.5 h-3.5" />
              <span>Bài viết ({articleSessions.length})</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto zen-scroll divide-y divide-slate-100 dark:divide-slate-800">
          {tab === 'video' ? (
            sessions.length === 0 ? (
              <div className="py-16 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có video nào được lưu. Mọi video YouTube bạn nạp sẽ tự động lưu ngoại tuyến tại đây.
              </div>
            ) : (
              sessions.map((s) => {
                const isCurrent = s.id === activeSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      onSelectSession(s);
                      onClose();
                    }}
                    className={`p-4 flex items-start justify-between gap-3 cursor-pointer transition-colors ${
                      isCurrent
                        ? 'bg-indigo-50/70 dark:bg-indigo-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                        {s.title}
                      </h4>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {s.language === 'ja' ? '日本語' : 'English'} · {s.targetLevel}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{s.lines.length} câu</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-mono-tabular">
                          <Clock className="w-3 h-3" />
                          {formatTime(s.lastPosition)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(s.id);
                      }}
                      aria-label="Xóa video đã lưu"
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-white dark:hover:bg-slate-800 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )
          ) : articleSessions.length === 0 ? (
            <div className="py-16 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Chưa có bài viết nào được lưu. Dán bất kỳ link bài báo nào để mở Phòng Đọc 3 Ngôn Ngữ và lưu ngoại tuyến tại đây.
            </div>
          ) : (
            articleSessions.map((art) => {
              const isCurrent = art.id === activeArticleId;
              return (
                <div
                  key={art.id}
                  onClick={() => {
                    onSelectArticle?.(art);
                    onClose();
                  }}
                  className={`p-4 flex items-start justify-between gap-3 cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                      {art.title}
                    </h4>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-teal-600 dark:text-teal-400">
                        {art.siteName || art.domain}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">{art.paragraphs.length} đoạn</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {art.sourceLanguage.toUpperCase()} ➔ {art.activeLanguage.toUpperCase()} ({art.targetLevel})
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteArticle?.(art.id);
                    }}
                    aria-label="Xóa bài viết đã lưu"
                    className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-white dark:hover:bg-slate-800 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

