import React, { useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  Brain,
  Compass,
  Download,
  FileUp,
  Keyboard,
  Layers,
  Loader2,
  Menu,
  Moon,
  ScrollText,
  Search,
  Sun,
} from 'lucide-react';
import type { Language, ProficiencyLevel, ThemeMode } from '../types';
import { CEFR_LEVELS, JLPT_LEVELS } from '../lib/youtube';
import { speculativePrefetchVideo } from '../lib/api';

interface TopBarProps {
  urlInput: string;
  onUrlInputChange: (value: string) => void;
  onSubmitUrl: (e: React.FormEvent) => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  targetLevel: ProficiencyLevel;
  onTargetLevelChange: (level: ProficiencyLevel) => void;
  isLoading: boolean;
  theme: ThemeMode;
  onCycleTheme: () => void;
  onGoHome: () => void;
  onOpenDiscovery: () => void;
  onOpenCollocationLibrary: () => void;
  onOpenUploadModal: () => void;
  onOpenArticlePasteModal?: () => void;
  onOpenShortcuts: () => void;
  onOpenHistory: () => void;
  onExportBundle: () => void;
  hasActiveLesson: boolean;
  historyCount: number;
  dueCardsCount: number;
  onJumpToReview: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  urlInput,
  onUrlInputChange,
  onSubmitUrl,
  language,
  onLanguageChange,
  targetLevel,
  onTargetLevelChange,
  isLoading,
  theme,
  onCycleTheme,
  onGoHome,
  onOpenDiscovery,
  onOpenCollocationLibrary,
  onOpenUploadModal,
  onOpenArticlePasteModal,
  onOpenShortcuts,
  onOpenHistory,
  onExportBundle,
  hasActiveLesson,
  historyCount,
  dueCardsCount,
  onJumpToReview,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const levels = language === 'ja' ? JLPT_LEVELS : CEFR_LEVELS;

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const themeMeta: Record<ThemeMode, { label: string; short: string; icon: React.ReactNode }> = {
    washi: { label: 'Sáng Washi', short: 'Washi', icon: <Sun className="w-4 h-4" /> },
    dark: { label: 'Tối Đêm Zen', short: 'Đêm', icon: <Moon className="w-4 h-4" /> },
    sepia: { label: 'Giấy Sepia', short: 'Sepia', icon: <ScrollText className="w-4 h-4" /> },
  };

  return (
    <header className="sticky top-0 z-30 w-full zen-surface/95 backdrop-blur-md border-b no-print">
      <div className="zen-container h-14 flex items-center justify-between gap-2.5 md:gap-4">
        {/* 1. Clean Single-Line Wordmark */}
        <button
          type="button"
          onClick={onGoHome}
          className="flex items-center shrink-0 text-lg font-extrabold tracking-tight whitespace-nowrap cursor-pointer"
          title="Về trang chủ KotoZen"
        >
          Koto<span className="text-indigo-600 dark:text-indigo-400 sepia:text-amber-800">Zen</span>
        </button>

        {/* 2. Compact URL Bar + Language & Level Selector */}
        <form onSubmit={onSubmitUrl} className="flex-1 min-w-0 max-w-2xl flex items-center gap-1.5 sm:gap-2">
          <div
            className="hidden md:flex items-center p-0.5 zen-surface-subtle rounded-lg border shrink-0"
            role="group"
            aria-label="Chọn ngôn ngữ học"
          >
            <button
              type="button"
              onClick={() => onLanguageChange('en')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                language === 'en'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 sepia:text-amber-900 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => onLanguageChange('ja')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer font-jp ${
                language === 'ja'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 sepia:text-amber-900 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              日本語
            </button>
          </div>

          <select
            value={targetLevel}
            onChange={(e) => onTargetLevelChange(e.target.value as ProficiencyLevel)}
            aria-label="Chọn trình độ mục tiêu"
            className="hidden lg:block h-9 px-2 text-xs font-semibold rounded-lg zen-surface-subtle border focus:outline-none focus:ring-2 focus:ring-indigo-500/35 shrink-0 cursor-pointer"
          >
            {levels.map((lvl) => (
              <option key={lvl} value={lvl}>
                {language === 'ja' ? `JLPT ${lvl}` : `CEFR ${lvl}`}
              </option>
            ))}
          </select>

          <div className="relative flex-1 min-w-0">
            <Search
              className="w-3.5 h-3.5 opacity-45 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => onUrlInputChange(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData?.getData('text') || '';
                if (pasted.trim()) speculativePrefetchVideo(pasted.trim(), language);
              }}
              placeholder="Dán link YouTube hoặc bài báo / blog bất kỳ (Việt · Anh · Nhật)..."
              className="w-full h-9 pl-8 pr-3 text-xs sm:text-sm rounded-lg zen-surface-subtle border focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !urlInput.trim()}
            className="h-9 px-3 sm:px-3.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 sepia:bg-amber-800 sepia:hover:bg-amber-900 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <span>Nạp</span>
            )}
          </button>
        </form>

        {/* 3. Ultra-Clean Right Controls (Khám phá · Cụm từ · Theme · Thêm Menu) */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenDiscovery}
            title="Kho Khám Phá Video (Việt · Anh · Nhật)"
            className="h-9 px-2.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Compass className="w-4 h-4" />
            <span className="hidden sm:inline">Khám phá</span>
          </button>

          <button
            type="button"
            onClick={onOpenCollocationLibrary}
            title="Thư Viện Collocations Bách Khoa (22 Chủ đề Đời sống & Học thuật)"
            className="h-9 px-2.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden md:inline">Cụm từ</span>
          </button>

          <button
            type="button"
            onClick={onCycleTheme}
            title={`Chủ đề hiện tại: ${themeMeta[theme].label} — Bấm để chuyển`}
            className="h-9 px-2.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {themeMeta[theme].icon}
            <span className="hidden xl:inline">{themeMeta[theme].short}</span>
          </button>

          {/* Overflow [☰ Thêm] Menu */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Mở menu công cụ bổ sung"
              className="h-9 px-2.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
              <span className="hidden sm:inline">Thêm</span>
              {dueCardsCount > 0 && (
                <span className="font-mono-tabular text-[11px] font-bold text-teal-600 dark:text-teal-400">
                  ({dueCardsCount})
                </span>
              )}
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-60 rounded-xl zen-surface border shadow-xl p-1.5 z-50 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenCollocationLibrary();
                  }}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between gap-2 text-left cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Thư viện Collocations</span>
                  </span>
                  <span className="font-mono-tabular opacity-60">22</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenHistory();
                  }}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between gap-2 text-left cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <BookMarked className="w-4 h-4 opacity-70" />
                    <span>Thư viện đã học</span>
                  </span>
                  <span className="font-mono-tabular opacity-60">{historyCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onJumpToReview();
                  }}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between gap-2 text-left cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span>Ôn tập FSRS &amp; Quiz</span>
                  </span>
                  {dueCardsCount > 0 && (
                    <span className="font-mono-tabular font-semibold text-teal-600 dark:text-teal-400">
                      {dueCardsCount} đến hạn
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenUploadModal();
                  }}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 text-left cursor-pointer"
                >
                  <FileUp className="w-4 h-4 opacity-70" />
                  <span>Nạp .SRT / Phụ đề video</span>
                </button>

                {onOpenArticlePasteModal && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenArticlePasteModal();
                    }}
                    className="w-full px-3 py-2 text-xs font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 text-left cursor-pointer"
                  >
                    <ScrollText className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span>Dán bài viết / Tải .TXT · .MD · .PDF</span>
                  </button>
                )}

                {hasActiveLesson && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportBundle();
                    }}
                    className="w-full px-3 py-2 text-xs font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 text-left cursor-pointer"
                  >
                    <Download className="w-4 h-4 opacity-70" />
                    <span>Xuất trọn bộ bài học (.MD)</span>
                  </button>
                )}

                <div className="my-1 border-t border-black/5 dark:border-white/10" />

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenShortcuts();
                  }}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 text-left cursor-pointer"
                >
                  <Keyboard className="w-4 h-4 opacity-70" />
                  <span>Phím tắt bàn phím</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
