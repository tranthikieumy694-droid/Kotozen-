import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  FileText,
  Flame,
  Languages,
  Layers,
  Loader2,
  Mic,
  Newspaper,
  Play,
  ScanSearch,
  Search,
  Sparkles,
} from 'lucide-react';
import type {
  DailyActivityLog,
  DiscoveryVideoItem,
  Flashcard,
  Language,
  ProficiencyLevel,
} from '../types';
import { CEFR_LEVELS, JLPT_LEVELS } from '../lib/youtube';
import { DISCOVERY_CATALOG } from '../data/discoveryCatalog';
import { CURATED_ARTICLE_SAMPLES, type CuratedArticleSample } from '../data/articleSamples';
import { getTodayDateKey } from '../lib/db';
import { hoverPrefetchVideo, speculativePrefetchVideo } from '../lib/api';

interface HeroAndBentoShowcaseProps {
  urlInput: string;
  onUrlInputChange: (val: string) => void;
  onSubmitUrl: (e: React.FormEvent) => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  targetLevel: ProficiencyLevel;
  onTargetLevelChange: (lvl: ProficiencyLevel) => void;
  isLoading: boolean;
  activityLogs: DailyActivityLog[];
  flashcards: Flashcard[];
  onSelectSampleVideo: (item: DiscoveryVideoItem) => void;
  onSelectSampleArticle?: (item: CuratedArticleSample) => void;
  onOpenArticlePasteModal?: () => void;
  onOpenCollocationLibrary?: () => void;
}

interface RingProps {
  percent: number;
  colorClass: string;
  valueText: string;
  label: string;
  subLabel: string;
}

const MiniProgressRing: React.FC<RingProps> = ({
  percent,
  colorClass,
  valueText,
  label,
  subLabel,
}) => {
  const clamped = Math.max(4, Math.min(100, percent));
  const r = 20;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;

  return (
    <div className="zen-surface border rounded-2xl p-4 flex items-center gap-3.5 min-w-0">
      <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48" aria-hidden="true">
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="opacity-10"
          />
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className={`${colorClass} transition-all duration-500`}
          />
        </svg>
        <span className="absolute text-xs font-extrabold font-mono-tabular">{valueText}</span>
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold truncate">{label}</div>
        <div className="text-[11px] opacity-65 truncate mt-0.5">{subLabel}</div>
      </div>
    </div>
  );
};

export const HeroAndBentoShowcase: React.FC<HeroAndBentoShowcaseProps> = ({
  urlInput,
  onUrlInputChange,
  onSubmitUrl,
  language,
  onLanguageChange,
  targetLevel,
  onTargetLevelChange,
  isLoading,
  activityLogs,
  flashcards,
  onSelectSampleVideo,
  onSelectSampleArticle,
  onOpenArticlePasteModal,
  onOpenCollocationLibrary,
}) => {
  const [heroMode, setHeroMode] = useState<'video' | 'article'>('video');
  const levels = language === 'ja' ? JLPT_LEVELS : CEFR_LEVELS;
  const hoverTimerRef = useRef<number | null>(null);

  const scheduleHoverPrefetch = (vid: string) => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverPrefetchVideo(vid, language);
    }, 150);
  };

  const cancelHoverPrefetch = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  // Quick verified starter samples: 2 authentic 100% Vietnamese + 1 English + 1 Japanese
  const quickStarters = useMemo(() => {
    const viList = DISCOVERY_CATALOG.filter((v) => v.sourceLanguage === 'vi').slice(0, 2);
    const enOne = DISCOVERY_CATALOG.find((v) => v.sourceLanguage === 'en');
    const jaOne = DISCOVERY_CATALOG.find((v) => v.sourceLanguage === 'ja');
    return [...viList, ...(enOne ? [enOne] : []), ...(jaOne ? [jaOne] : [])];
  }, []);

  // Compute Streak, Today's Listening Minutes, and Saved Cards
  const stats = useMemo(() => {
    const todayKey = getTodayDateKey();
    const todayLog = activityLogs.find((l) => l.dateKey === todayKey);
    const todayMins = Math.round(todayLog?.listeningMinutes || 0);

    // Consecutive active days ending today or yesterday
    const activeDates = new Set(
      activityLogs
        .filter(
          (l) =>
            l.listeningMinutes > 0 ||
            l.wordsReviewed > 0 ||
            l.shadowedSentences > 0 ||
            l.roleplayTurns > 0
        )
        .map((l) => l.dateKey)
    );
    let streak = 0;
    const cursor = new Date();
    for (let i = 0; i < 60; i++) {
      const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
        cursor.getDate()
      ).padStart(2, '0')}`;
      if (activeDates.has(k)) {
        streak++;
      } else if (i > 0) {
        break;
      }
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      streak,
      todayMins,
      savedCount: flashcards.length,
    };
  }, [activityLogs, flashcards]);

  const features = [
    {
      icon: <Languages className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      title: '100% Tiếng Việt ➔ Anh · Nhật Tự Nhiên',
      desc: 'Tự động trích xuất phụ đề Việt (Manual / Auto-ASR / STT âm thanh) và chuyển ngữ chuẩn bản xứ theo đúng CEFR A1–C2 hoặc JLPT N5–N1, triệt tiêu Vietlish.',
    },
    {
      icon: <Sparkles className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
      title: 'Chạm Là Tra 1:1 · IPA & Pitch Accent',
      desc: 'Bấm vào bất kỳ từ hay cụm từ nào để xem nghĩa khớp ngữ cảnh, phiên âm Oxford/Cambridge, Furigana chuẩn âm đọc, Hán Việt hiện đại và biểu đồ cao độ NHK.',
    },
    {
      icon: <Layers className="w-5 h-5 text-violet-600 dark:text-violet-400" />,
      title: 'Phân Hệ Collocations 3 Tầng & 22 Chủ Đề',
      desc: 'Nâng cấp diễn đạt Đời thường ➔ Tự nhiên ➔ Học thuật, Bản đồ từ gốc, Radar chống Vietlish, Luyện phản xạ 15s và Thư viện 22 chủ đề mở rộng vô hạn.',
      actionLabel: onOpenCollocationLibrary ? 'Mở Thư viện 22 Chủ đề →' : undefined,
      onAction: onOpenCollocationLibrary,
    },
    {
      icon: <ScanSearch className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      title: 'Giải Phẫu Cú Pháp X-Ray Chi Tiết',
      desc: 'Bóc tách chủ–vị–bổ ngữ, rút gọn mệnh đề, kính ngữ Keigo và lưu thẳng công thức ngữ pháp kèm mốc thời gian video gốc.',
    },
    {
      icon: <Mic className="w-5 h-5 text-rose-600 dark:text-rose-400" />,
      title: 'Shadowing Chấm Âm & Nhập Vai AI',
      desc: 'Thu âm nhại giọng đối chiếu nhịp điệu, bật tự dừng 3–5 giây mỗi câu, luyện nghe mờ phụ đề và đóng vai nhân vật ngay trong bối cảnh video.',
    },
    {
      icon: <Brain className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      title: 'Thẻ Nhớ FSRS Ngoại Tuyến & Cắt Clip 12s',
      desc: 'Lưu bài học, câu thoại vàng và thẻ nhớ FSRS trong IndexedDB để mở lại 0ms kể cả khi mất mạng, hỗ trợ xuất Anki CSV UTF-8 & Markdown.',
    },
  ];

  return (
    <section className="space-y-6">
      {/* 1. HERO OMNI-INPUT BAR (YouTube Studio + Universal Web Article Studio) */}
      <div className="zen-surface border rounded-2xl p-6 md:p-8 shadow-xs relative overflow-hidden">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          {/* Quick Mode Switcher Tabs */}
          <div className="inline-flex items-center p-1 zen-surface-subtle rounded-xl border">
            <button
              type="button"
              onClick={() => setHeroMode('video')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                heroMode === 'video'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 sepia:text-amber-900 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Video YouTube</span>
            </button>
            <button
              type="button"
              onClick={() => setHeroMode('article')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                heroMode === 'article'
                  ? 'zen-surface text-indigo-700 dark:text-indigo-300 sepia:text-amber-900 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              <Newspaper className="w-3.5 h-3.5" />
              <span>Bài viết &amp; Báo chí</span>
            </button>
          </div>

          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-balance">
            {heroMode === 'video' ? (
              <>
                Dán bất kỳ video YouTube nào — kể cả 100% Tiếng Việt — để học{' '}
                <span className="text-indigo-600 dark:text-indigo-400 sepia:text-amber-800">
                  Anh · Nhật
                </span>{' '}
                chuẩn bản xứ
              </>
            ) : (
              <>
                Đọc bất kỳ bài báo, blog hay tài liệu web nào bằng{' '}
                <span className="text-indigo-600 dark:text-indigo-400 sepia:text-amber-800">
                  Việt ↔ Anh ↔ Nhật
                </span>{' '}
                trên một không gian Zen
              </>
            )}
          </h1>

          <p className="text-sm opacity-75 max-w-2xl mx-auto leading-relaxed">
            {heroMode === 'video'
              ? 'Trích xuất phụ đề đa tầng không giới hạn thời lượng, chuyển ngữ tự nhiên theo trình độ mục tiêu, hiển thị rõ nét Tri-Script (Tiếng Việt · Furigana · IPA) và tra từ 1 chạm.'
              : 'Dán đường link từ bất kỳ trang báo nào (VnExpress, BBC, NHK, Wikipedia, Medium...) để tự lọc sạch quảng cáo, chuyển mượt giữa 3 ngôn ngữ, nghe đọc từng câu và tra từ 5 tầng.'}
          </p>

          {/* Universal Omni-Input Row */}
          <form
            onSubmit={onSubmitUrl}
            className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 max-w-2xl mx-auto"
          >
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 opacity-45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => onUrlInputChange(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.getData('text') || '';
                  if (pasted.trim()) speculativePrefetchVideo(pasted.trim(), language);
                }}
                placeholder={
                  heroMode === 'video'
                    ? 'Dán link YouTube hoặc bất kỳ bài báo/blog nào (Việt · Anh · Nhật)...'
                    : 'Dán link bài báo bất kỳ (https://vnexpress.net/..., bbc.com, nhk.or.jp, wikipedia...)...'
                }
                className="w-full h-12 pl-10 pr-4 text-sm rounded-xl zen-surface-subtle border-2 border-indigo-500/30 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 focus:outline-none transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !urlInput.trim()}
              className="h-12 px-6 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 sepia:bg-amber-800 sepia:hover:bg-amber-900 disabled:opacity-45 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang nạp...</span>
                </>
              ) : heroMode === 'article' ? (
                <>
                  <Newspaper className="w-4 h-4" />
                  <span>Mở Phòng Đọc</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Bắt đầu học ngay</span>
                </>
              )}
            </button>
          </form>

          {/* Target Language + Target Level Quick Selector */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1 text-xs">
            <span className="opacity-65 font-medium">Ngôn ngữ muốn học:</span>
            <div className="inline-flex items-center p-0.5 zen-surface-subtle rounded-lg border">
              <button
                type="button"
                onClick={() => onLanguageChange('en')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  language === 'en'
                    ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'opacity-65 hover:opacity-100'
                }`}
              >
                Tiếng Anh (English)
              </button>
              <button
                type="button"
                onClick={() => onLanguageChange('ja')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md font-jp transition-colors cursor-pointer ${
                  language === 'ja'
                    ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'opacity-65 hover:opacity-100'
                }`}
              >
                Tiếng Nhật (日本語)
              </button>
            </div>

            <select
              value={targetLevel}
              onChange={(e) => onTargetLevelChange(e.target.value as ProficiencyLevel)}
              aria-label="Chọn trình độ mục tiêu"
              className="h-8 px-2.5 text-xs font-semibold rounded-lg zen-surface-subtle border cursor-pointer"
            >
              {levels.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {language === 'ja' ? `Mục tiêu JLPT ${lvl}` : `Mục tiêu CEFR ${lvl}`}
                </option>
              ))}
            </select>
          </div>

          {/* 1-Click Verified Starter Examples (Video OR 3-Language Articles) */}
          <div className="pt-3 border-t border-black/5 dark:border-white/10">
            {heroMode === 'video' ? (
              <>
                <div className="text-[11px] font-semibold opacity-60 mb-2">
                  Hoặc bấm thử ngay 1 video kiểm chứng phát mượt 100%:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                  {quickStarters.map((item) => (
                    <button
                      key={item.videoId}
                      type="button"
                      onMouseEnter={() => scheduleHoverPrefetch(item.videoId)}
                      onMouseLeave={cancelHoverPrefetch}
                      onClick={() => onSelectSampleVideo(item)}
                      className="p-2.5 rounded-xl zen-surface-subtle border hover:border-indigo-500 transition-all flex items-center justify-between gap-2.5 group cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 truncate">
                          {item.sourceLanguage === 'vi'
                            ? `Video 100% Tiếng Việt ➔ ${language === 'ja' ? `Nhật ${targetLevel}` : `Anh ${targetLevel}`}`
                            : item.sourceLanguage === 'ja'
                              ? `Tiếng Nhật gốc · ${item.level}`
                              : `Tiếng Anh gốc · ${item.level}`}
                          {' · '}
                          {item.durationLabel}
                        </div>
                        <div className="text-xs font-bold truncate mt-0.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-300">
                          {item.title}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold opacity-60">
                    Hoặc mở thử 1 bài viết kiểm chứng (Việt · Anh · Nhật):
                  </span>
                  {onOpenArticlePasteModal && (
                    <button
                      type="button"
                      onClick={onOpenArticlePasteModal}
                      className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Dán văn bản / Tải tệp .TXT · .MD · .PDF</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-left">
                  {CURATED_ARTICLE_SAMPLES.map((art) => (
                    <button
                      key={art.id}
                      type="button"
                      onClick={() => onSelectSampleArticle?.(art)}
                      className="p-2.5 rounded-xl zen-surface-subtle border hover:border-indigo-500 transition-all flex flex-col justify-between gap-1.5 group cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 truncate">
                          {art.badge}
                        </div>
                        <div className="text-xs font-bold line-clamp-2 mt-0.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-300">
                          {art.title}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] opacity-65">
                        <span className="truncate">{art.sourceName}</span>
                        <ArrowRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. MINI PROGRESS DASHBOARD (3 SVG Rings) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MiniProgressRing
          percent={Math.min(100, (stats.streak / 7) * 100)}
          colorClass="text-amber-500"
          valueText={`${stats.streak}d`}
          label="Chuỗi ngày học liên tiếp"
          subLabel={stats.streak > 0 ? 'Đang giữ nhịp đều đặn' : 'Bắt đầu ngày đầu tiên hôm nay'}
        />
        <MiniProgressRing
          percent={Math.min(100, (stats.todayMins / 20) * 100)}
          colorClass="text-indigo-600 dark:text-indigo-400"
          valueText={`${stats.todayMins}p`}
          label="Phút luyện nghe hôm nay"
          subLabel="Mục tiêu hàng ngày: 20 phút"
        />
        <MiniProgressRing
          percent={Math.min(100, (stats.savedCount / 50) * 100)}
          colorClass="text-teal-600 dark:text-teal-400"
          valueText={`${stats.savedCount}`}
          label="Từ & Collocations đã lưu"
          subLabel="Lưu ngoại tuyến trong bộ nhớ FSRS"
        />
      </div>

      {/* 3. SIGNATURE FEATURE BENTO GRID (6 Cards) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <BookOpenCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Trải nghiệm học ngoại ngữ chiều sâu trên một không gian Zen</span>
          </h2>
          <span className="hidden sm:inline-flex items-center gap-1 text-xs opacity-60">
            <Flame className="w-3.5 h-3.5 text-amber-500" />
            <span>Chuẩn xác ngữ nghĩa · Không ảo giác</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {features.map((f, idx) => (
            <div
              key={idx}
              className="bento-card zen-surface border rounded-2xl p-4 flex flex-col justify-between gap-2.5 min-w-0"
            >
              <div className="space-y-2">
                <div className="w-9 h-9 rounded-xl zen-surface-subtle border flex items-center justify-center">
                  {f.icon}
                </div>
                <h3 className="text-sm font-bold leading-snug">{f.title}</h3>
                <p className="text-xs opacity-75 leading-relaxed">{f.desc}</p>
              </div>
              {'actionLabel' in f && f.actionLabel && f.onAction && (
                <button
                  type="button"
                  onClick={f.onAction}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline text-left cursor-pointer pt-1"
                >
                  {f.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
