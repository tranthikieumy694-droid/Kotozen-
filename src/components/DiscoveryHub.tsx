import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Plus, ShieldCheck, X } from 'lucide-react';
import type { DiscoveryTopic, DiscoveryVideoItem, Language, ProficiencyLevel } from '../types';
import {
  DISCOVERY_CATALOG,
  DISCOVERY_TOPIC_LABELS,
  getSimilarVideos,
} from '../data/discoveryCatalog';
import { CEFR_LEVELS, JLPT_LEVELS } from '../lib/youtube';
import { hoverPrefetchVideo, validateCatalogVideoIds } from '../lib/api';

interface DiscoveryHubProps {
  language: Language;
  targetLevel: ProficiencyLevel;
  currentVideoId: string | null;
  onSelectVideo: (item: DiscoveryVideoItem) => void;
  compact?: boolean;
  onCloseModal?: () => void;
}

type CatalogFilterTab = 'vi' | 'en' | 'ja';

const TOPICS: Array<'ALL' | DiscoveryTopic> = [
  'ALL',
  'vlog',
  'news',
  'podcast',
  'anime_film',
  'culture_history',
  'work_academic',
];

// Session-level cache so we only run pre-flight oEmbed validation once per page load
let cachedValidIds: Set<string> | null = null;

export const DiscoveryHub: React.FC<DiscoveryHubProps> = ({
  language,
  targetLevel,
  currentVideoId,
  onSelectVideo,
  compact = false,
  onCloseModal,
}) => {
  const [filterTab, setFilterTab] = useState<CatalogFilterTab>('vi');
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [filterTopic, setFilterTopic] = useState<'ALL' | DiscoveryTopic>('ALL');
  const [extraRecommended, setExtraRecommended] = useState<DiscoveryVideoItem[]>([]);
  const [validIds, setValidIds] = useState<Set<string> | null>(cachedValidIds);
  const hoverTimerRef = useRef<number | null>(null);

  const scheduleHoverPrefetch = (vid: string, targetLang: Language) => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverPrefetchVideo(vid, targetLang);
    }, 150);
  };

  const cancelHoverPrefetch = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  // Live pre-flight oEmbed validation: silently filter out any dead/404 video IDs at runtime
  useEffect(() => {
    if (cachedValidIds) {
      setValidIds(cachedValidIds);
      return;
    }
    let cancelled = false;
    const allIds = DISCOVERY_CATALOG.map((v) => v.videoId);
    validateCatalogVideoIds(allIds)
      .then((res) => {
        if (cancelled) return;
        const set = new Set(res.validIds);
        // Only apply filter if API returned at least 1 valid ID (protects offline mode)
        if (set.size > 0) {
          cachedValidIds = set;
          setValidIds(set);
        }
      })
      .catch(() => {
        // Offline or network hiccup: keep catalog intact
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const levels =
    filterTab === 'ja' || (filterTab === 'vi' && language === 'ja') ? JLPT_LEVELS : CEFR_LEVELS;

  const filteredVideos = useMemo(() => {
    const base = DISCOVERY_CATALOG.filter((v) => {
      if (validIds && !validIds.has(v.videoId)) return false;
      if (filterTab === 'vi') {
        if (v.sourceLanguage !== 'vi') return false;
      } else {
        if (v.sourceLanguage !== filterTab) return false;
      }
      if (filterLevel !== 'ALL' && filterTab !== 'vi' && v.level !== filterLevel) return false;
      if (filterTopic !== 'ALL' && v.topic !== filterTopic) return false;
      return true;
    });

    const combined = [...base];
    const seen = new Set(combined.map((v) => v.videoId));
    for (const ex of extraRecommended) {
      if (validIds && !validIds.has(ex.videoId)) continue;
      if (!seen.has(ex.videoId) && ex.sourceLanguage === filterTab) {
        combined.push(ex);
        seen.add(ex.videoId);
      }
    }
    return compact ? combined.slice(0, 6) : combined;
  }, [filterTab, filterLevel, filterTopic, extraRecommended, compact, validIds]);

  const handleLoadMoreSimilar = () => {
    const excludeIds = [
      ...(currentVideoId ? [currentVideoId] : []),
      ...filteredVideos.map((v) => v.videoId),
    ];
    const more = getSimilarVideos(
      filterTab === 'vi' ? language : filterTab,
      filterLevel === 'ALL' ? targetLevel : (filterLevel as ProficiencyLevel),
      excludeIds,
      filterTopic === 'ALL' ? undefined : filterTopic,
      3
    );
    if (more.length > 0) {
      setExtraRecommended((prev) => [...prev, ...more]);
    }
  };

  return (
    <div className="rounded-2xl zen-surface border p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-bold flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
            <span>Kho Video Kiểm Chứng Sống 100%</span>
          </h2>
          <p className="text-xs opacity-65 mt-0.5">
            Tự động lọc oEmbed trực tiếp · Bao gồm video 100% Tiếng Việt chuyển ngữ Anh/Nhật, English &amp; 日本語
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center p-0.5 zen-surface-subtle rounded-lg border">
            <button
              type="button"
              onClick={() => {
                setFilterTab('vi');
                setFilterLevel('ALL');
              }}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer ${
                filterTab === 'vi'
                  ? 'zen-surface text-indigo-600 dark:text-indigo-300 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              Tiếng Việt ➔ Anh/Nhật
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterTab('en');
                setFilterLevel('ALL');
              }}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer ${
                filterTab === 'en'
                  ? 'zen-surface text-indigo-600 dark:text-indigo-300 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterTab('ja');
                setFilterLevel('ALL');
              }}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md font-jp whitespace-nowrap cursor-pointer ${
                filterTab === 'ja'
                  ? 'zen-surface text-indigo-600 dark:text-indigo-300 shadow-xs'
                  : 'opacity-65 hover:opacity-100'
              }`}
            >
              日本語
            </button>
          </div>

          {onCloseModal && (
            <button
              type="button"
              onClick={onCloseModal}
              aria-label="Đóng Kho Khám Phá"
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Level & Topic Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {filterTab !== 'vi' && (
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            aria-label="Lọc cấp độ"
            className="h-7 px-2 text-xs font-semibold rounded-md zen-surface-subtle border cursor-pointer"
          >
            <option value="ALL">Mọi cấp độ</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}

        {TOPICS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilterTopic(t)}
            className={`h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              filterTopic === t
                ? 'bg-indigo-600 text-white'
                : 'zen-surface-subtle opacity-80 hover:opacity-100'
            }`}
          >
            {t === 'ALL' ? 'Tất cả chủ đề' : DISCOVERY_TOPIC_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Video Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredVideos.map((v) => (
          <button
            key={v.videoId}
            type="button"
            onMouseEnter={() =>
              scheduleHoverPrefetch(v.videoId, v.sourceLanguage === 'vi' ? language : v.language)
            }
            onMouseLeave={cancelHoverPrefetch}
            onClick={() => {
              // For Vietnamese source videos, honor user's currently chosen learning language & targetLevel!
              const effectiveItem: DiscoveryVideoItem =
                v.sourceLanguage === 'vi'
                  ? { ...v, language, level: targetLevel }
                  : v;
              onSelectVideo(effectiveItem);
              onCloseModal?.();
            }}
            className="bento-card text-left rounded-xl zen-surface-subtle border hover:border-indigo-500 overflow-hidden flex flex-col cursor-pointer group min-w-0"
          >
            <div className="relative w-full aspect-video bg-slate-900 overflow-hidden">
              <img
                src={`https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`}
                alt={v.title}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
              />
              <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono-tabular">
                {v.durationLabel}
              </span>
            </div>

            <div className="p-3 flex-1 flex flex-col justify-between space-y-1.5">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 truncate">
                  {v.sourceLanguage === 'vi'
                    ? `100% Việt ➔ ${language === 'ja' ? `Nhật ${targetLevel}` : `Anh ${targetLevel}`}`
                    : `${v.level}`}
                  {' · '}
                  {DISCOVERY_TOPIC_LABELS[v.topic]}
                </div>
                <div className="text-xs font-bold leading-snug line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-300">
                  {v.title}
                </div>
                <p className="text-[11px] opacity-70 line-clamp-2 leading-relaxed">
                  {v.descriptionVi}
                </p>
              </div>

              <div className="flex items-center justify-between text-[11px] opacity-65 pt-1">
                <span className="truncate">{v.channel}</span>
                <span className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                  <Play className="w-2.5 h-2.5 fill-current" />
                  Học ngay
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {filteredVideos.length === 0 && (
        <p className="text-xs opacity-65 text-center py-6">
          Chưa có video mẫu khớp bộ lọc này. Hãy chọn “Tất cả chủ đề” hoặc dán link YouTube bất kỳ ở thanh trên.
        </p>
      )}

      {filterTab !== 'vi' && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={handleLoadMoreSimilar}
            className="h-8 px-3 text-xs font-semibold rounded-lg zen-surface-subtle border hover:border-indigo-500 flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+3 Video Tương Tự</span>
          </button>
        </div>
      )}
    </div>
  );
};
