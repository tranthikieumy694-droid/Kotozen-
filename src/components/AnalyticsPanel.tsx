import React, { useMemo } from 'react';
import type { DailyActivityLog, Flashcard, InputCompatibilityReport } from '../types';
import { CEFR_LEVELS, JLPT_LEVELS } from '../lib/youtube';

interface AnalyticsPanelProps {
  activityLogs: DailyActivityLog[];
  flashcards: Flashcard[];
  iPlusOneReport: InputCompatibilityReport | null;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
  activityLogs,
  flashcards,
  iPlusOneReport,
}) => {
  const totals = useMemo(() => {
    let minutes = 0;
    let shadowed = 0;
    let reviewed = 0;
    let roleplay = 0;
    for (const log of activityLogs) {
      minutes += log.listeningMinutes;
      shadowed += log.shadowedSentences;
      reviewed += log.wordsReviewed;
      roleplay += log.roleplayTurns;
    }
    return {
      minutes: Math.round(minutes),
      shadowed,
      reviewed,
      roleplay,
    };
  }, [activityLogs]);

  // Build 12-week (84 days) Heatmap grid
  const heatmapDays = useMemo(() => {
    const map = new Map(activityLogs.map((l) => [l.dateKey, l]));
    const cells: Array<{ dateKey: string; score: number; minutes: number }> = [];
    const today = new Date();
    for (let i = 83; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${day}`;
      const log = map.get(key);
      const score = log
        ? log.listeningMinutes + log.shadowedSentences * 3 + log.wordsReviewed * 2 + log.roleplayTurns * 4
        : 0;
      cells.push({ dateKey: key, score, minutes: Math.round(log?.listeningMinutes || 0) });
    }
    return cells;
  }, [activityLogs]);

  // Calculate current active streak
  const streakDays = useMemo(() => {
    let streak = 0;
    for (let i = heatmapDays.length - 1; i >= 0; i--) {
      if (heatmapDays[i].score > 0) streak++;
      else if (i < heatmapDays.length - 1) break;
    }
    return streak;
  }, [heatmapDays]);

  // Mastery counts per JLPT & CEFR level from saved FSRS deck
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of flashcards) {
      counts[c.level] = (counts[c.level] || 0) + 1;
    }
    return counts;
  }, [flashcards]);

  const maxLevelCount = Math.max(1, ...Object.values(levelCounts));

  return (
    <div className="space-y-5 text-xs">
      {/* 1. Video i+1 Compatibility Summary */}
      {iPlusOneReport && iPlusOneReport.totalUniqueWords > 0 && (
        <section className="p-3.5 rounded-xl zen-surface-subtle border space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-bold">Độ vừa sức i+1 của video hiện tại</span>
            <span className="font-mono-tabular font-bold text-indigo-600 dark:text-indigo-400">
              {iPlusOneReport.knownPercent}% quen thuộc
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full transition-all"
              style={{ width: `${iPlusOneReport.knownPercent}%` }}
            />
          </div>
          <p className="opacity-80 leading-relaxed">{iPlusOneReport.recommendationVi}</p>
        </section>
      )}

      {/* 2. Key Discipline Metrics (Tabular Numerals) */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="p-3 rounded-xl zen-surface-subtle border">
          <div className="text-[11px] opacity-65">Nghe chủ động</div>
          <div className="text-lg font-bold font-mono-tabular mt-0.5">{totals.minutes} phút</div>
        </div>
        <div className="p-3 rounded-xl zen-surface-subtle border">
          <div className="text-[11px] opacity-65">Câu Shadowing</div>
          <div className="text-lg font-bold font-mono-tabular mt-0.5">{totals.shadowed} câu</div>
        </div>
        <div className="p-3 rounded-xl zen-surface-subtle border">
          <div className="text-[11px] opacity-65">Kho FSRS</div>
          <div className="text-lg font-bold font-mono-tabular mt-0.5">{flashcards.length} thẻ</div>
        </div>
        <div className="p-3 rounded-xl zen-surface-subtle border">
          <div className="text-[11px] opacity-65">Chuỗi kỷ luật</div>
          <div className="text-lg font-bold font-mono-tabular mt-0.5 text-teal-600 dark:text-teal-400">
            {streakDays} ngày
          </div>
        </div>
      </section>

      {/* 3. 12-Week Study Consistency Heatmap */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-bold">Biểu đồ nhiệt Kỷ luật học (12 tuần gần nhất)</h4>
          <span className="text-[10px] opacity-60">Ít ▯ ▮ Nhiều</span>
        </div>
        <div className="grid grid-cols-12 gap-1 p-3 rounded-xl zen-surface-subtle border">
          {heatmapDays.map((cell) => {
            const intensity =
              cell.score === 0
                ? 'bg-black/8 dark:bg-white/8'
                : cell.score < 8
                  ? 'bg-teal-200 dark:bg-teal-900'
                  : cell.score < 20
                    ? 'bg-teal-400 dark:bg-teal-600'
                    : 'bg-teal-600 dark:bg-teal-400';
            return (
              <div
                key={cell.dateKey}
                title={`${cell.dateKey}: ${cell.minutes} phút nghe · Điểm kỷ luật ${Math.round(cell.score)}`}
                className={`aspect-square rounded-[3px] ${intensity}`}
              />
            );
          })}
        </div>
      </section>

      {/* 4. Mastery Map across JLPT N5-N1 & CEFR A1-C2 */}
      <section className="space-y-3">
        <h4 className="font-bold">Bản đồ chinh phục JLPT &amp; CEFR</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl zen-surface-subtle border space-y-2">
            <div className="text-[11px] font-semibold opacity-75">Tiếng Nhật (JLPT)</div>
            {JLPT_LEVELS.map((lvl) => {
              const count = levelCounts[lvl] || 0;
              return (
                <div key={lvl} className="flex items-center gap-2">
                  <span className="w-7 font-mono-tabular font-semibold">{lvl}</span>
                  <div className="flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full"
                      style={{ width: `${Math.round((count / maxLevelCount) * 100)}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono-tabular opacity-70">{count}</span>
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-xl zen-surface-subtle border space-y-2">
            <div className="text-[11px] font-semibold opacity-75">Tiếng Anh (CEFR)</div>
            {CEFR_LEVELS.map((lvl) => {
              const count = levelCounts[lvl] || 0;
              return (
                <div key={lvl} className="flex items-center gap-2">
                  <span className="w-7 font-mono-tabular font-semibold">{lvl}</span>
                  <div className="flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-teal-600 dark:bg-teal-400 rounded-full"
                      style={{ width: `${Math.round((count / maxLevelCount) * 100)}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono-tabular opacity-70">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};
