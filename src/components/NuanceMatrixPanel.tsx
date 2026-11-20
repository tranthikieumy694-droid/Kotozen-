import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Microscope,
  Play,
  Plus,
  RefreshCw,
  Scale,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  Language,
  NuanceDisplayMode,
  NuanceDualPayload,
  NuanceMatrixGroup,
  ProficiencyLevel,
} from '../types';
import { formatTime, speakNative } from '../lib/youtube';
import { DualModeNuancePanel } from './DualModeNuancePanel';

interface NuanceMatrixPanelProps {
  language: Language;
  targetLevel: ProficiencyLevel;
  matrix: NuanceMatrixGroup[] | null;
  isLoading: boolean;
  isExpanding?: boolean;
  error: string | null;
  hasLines: boolean;
  videoTitle?: string;
  onGenerateMatrix: () => void;
  onExpandThreeMore?: () => void;
  onSeekTo: (seconds: number) => void;
  onSaveNuanceDualCard?: (
    payload: NuanceDualPayload,
    context?: { timestamp?: number; sentence?: string; sentenceVi?: string }
  ) => void;
}

const CATEGORY_LABELS: Record<NuanceMatrixGroup['category'], string> = {
  homophone: 'Đồng âm khác chữ',
  near_synonym: 'Cận nghĩa dễ nhầm',
  collocation: 'Collocation bản xứ',
  register_trap: 'Sắc thái trang trọng / thân mật',
};

const SENTIMENT_META: Record<'positive' | 'neutral' | 'negative', { label: string; cls: string }> = {
  positive: { label: 'Tích cực', cls: 'text-teal-700 dark:text-teal-300' },
  neutral: { label: 'Trung lập', cls: 'opacity-70' },
  negative: { label: 'Tiêu cực', cls: 'text-rose-700 dark:text-rose-300' },
};

export const NuanceMatrixPanel: React.FC<NuanceMatrixPanelProps> = ({
  language,
  targetLevel,
  matrix,
  isLoading,
  isExpanding = false,
  error,
  hasLines,
  videoTitle,
  onGenerateMatrix,
  onExpandThreeMore,
  onSeekTo,
  onSaveNuanceDualCard,
}) => {
  const [matrixMode, setMatrixMode] = useState<NuanceDisplayMode>('summary');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});

  if (!hasLines) {
    return (
      <div className="py-14 px-6 text-center text-xs opacity-65">
        Nạp video để tự động trích xuất Ma trận Sắc thái 3 trục, Đồng âm &amp; Cận nghĩa dễ nhầm.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-black/5 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center flex-wrap gap-2 min-w-0">
          <span className="text-xs font-semibold">
            Thang Đo Sắc Thái · Cận Nghĩa · Đồng Âm ({targetLevel})
          </span>
          <div className="inline-flex items-center p-0.5 rounded-lg zen-surface-subtle border">
            <button
              type="button"
              onClick={() => setMatrixMode('summary')}
              className={`h-6 px-2 text-[11px] font-semibold rounded-md flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                matrixMode === 'summary'
                  ? 'bg-indigo-600 text-white'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <Zap className="w-3 h-3" />
              <span>Rút gọn</span>
            </button>
            <button
              type="button"
              onClick={() => setMatrixMode('deep')}
              className={`h-6 px-2 text-[11px] font-semibold rounded-md flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                matrixMode === 'deep'
                  ? 'bg-indigo-600 text-white'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <Microscope className="w-3 h-3" />
              <span>Chuyên sâu</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {matrix && onExpandThreeMore && (
            <button
              type="button"
              onClick={onExpandThreeMore}
              disabled={isExpanding || isLoading}
              className="h-7 px-2.5 text-xs font-semibold rounded-md zen-surface-subtle border hover:border-indigo-500 disabled:opacity-50 flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              {isExpanding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>+3 Cặp dễ nhầm</span>
            </button>
          )}
          <button
            type="button"
            onClick={onGenerateMatrix}
            disabled={isLoading}
            className="h-7 px-2.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{matrix ? 'Quét lại' : 'Giải mã ngay'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto zen-scroll p-3.5 space-y-4">
        {isLoading && (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs opacity-70">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span>Đang dựng Thang Đo Sắc Thái &amp; phân tách các cặp từ dễ nhầm...</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {!matrix && !isLoading && !error && (
          <div className="py-10 text-center space-y-3">
            <Scale className="w-8 h-8 opacity-40 mx-auto" strokeWidth={1.5} />
            <p className="text-xs opacity-75 max-w-xs mx-auto leading-relaxed">
              {language === 'ja'
                ? 'Đặt cạnh nhau các từ đồng âm & cận nghĩa (測る/計る/量る, 聞く/聴く/訊く, 変わる/代わる/替わる) trên trục Mức độ · Trang trọng · Bộ thủ kèm biển báo ✅ Chuẩn / ❌ Tránh.'
                : 'Đặt cạnh nhau các từ cận nghĩa (look/watch/stare/glance, big/huge/substantial/immense) trên Thang Sắc Thái 3 trục kèm Collocation đinh & bẫy cần tránh.'}
            </p>
            <button
              type="button"
              onClick={onGenerateMatrix}
              className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
            >
              Mở Ma Trận Sắc Thái &amp; Đồng Âm
            </button>
          </div>
        )}

        {matrix && !isLoading && (
          <div className="space-y-4">
            {matrix.map((group) => (
              <div
                key={group.id}
                className="p-3.5 rounded-xl zen-surface-subtle border space-y-3 min-w-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold font-jp-compact safe-wrap">{group.title}</h4>
                    <div className="text-[11px] opacity-65 mt-0.5">
                      {CATEGORY_LABELS[group.category]} · {group.items.length} từ trên thang sắc thái
                    </div>
                  </div>
                  {group.timestamp > 0 && (
                    <button
                      type="button"
                      onClick={() => onSeekTo(group.timestamp)}
                      className="text-[11px] font-mono-tabular font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      {formatTime(group.timestamp)}
                    </button>
                  )}
                </div>

                <p className="text-xs opacity-85 leading-relaxed">{group.summaryVi}</p>

                {/* Split-Card 3-Axis Nuance Spectrum */}
                <div className="space-y-2.5">
                  {group.items.map((item, idx) => {
                    const intensity = Math.max(1, Math.min(5, item.intensityScore || 3));
                    const sentimentInfo =
                      SENTIMENT_META[item.sentiment || 'neutral'] || SENTIMENT_META.neutral;

                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-lg zen-surface border space-y-2 text-xs min-w-0"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
                              <span
                                className={`text-sm font-bold ${
                                  language === 'ja' ? 'font-jp-compact' : ''
                                }`}
                              >
                                {item.term}
                              </span>
                              <span
                                className={`text-[11px] opacity-65 ${
                                  language === 'ja' ? 'font-jp-compact' : 'font-ipa'
                                }`}
                              >
                                {item.readingOrIpa}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => speakNative(item.term, language)}
                            aria-label={`Nghe ${item.term}`}
                            className="p-1 opacity-60 hover:opacity-100 cursor-pointer shrink-0"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* 3-Axis Visual Nuance Bar: Intensity · Formality · Attitude */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] pt-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="opacity-60">Mức độ</span>
                            <div className="flex items-center gap-0.5" aria-label={`Mức độ ${intensity}/5`}>
                              {[1, 2, 3, 4, 5].map((step) => (
                                <span
                                  key={step}
                                  className={`w-2.5 h-1.5 rounded-xs ${
                                    step <= intensity
                                      ? 'bg-indigo-600 dark:bg-indigo-400'
                                      : 'bg-black/10 dark:bg-white/15'
                                  }`}
                                />
                              ))}
                            </div>
                          </div>
                          {item.formalityLevel && (
                            <>
                              <span aria-hidden="true" className="opacity-35">·</span>
                              <span className="font-medium opacity-80">{item.formalityLevel}</span>
                            </>
                          )}
                          <span aria-hidden="true" className="opacity-35">·</span>
                          <span className={`font-semibold ${sentimentInfo.cls}`}>
                            {sentimentInfo.label}
                          </span>
                        </div>

                        {/* Radical / Register Decoder */}
                        <div className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300 leading-relaxed">
                          {item.radicalOrRegisterNote}
                        </div>

                        {/* 1-Line Core Difference & Signature Collocation */}
                        <div className="space-y-0.5">
                          <p className="font-semibold leading-snug">
                            {item.coreDifferenceVi || item.meaningVi}
                          </p>
                          {item.signatureCollocation && (
                            <p className="text-[11px] opacity-80">
                              <span className="font-semibold">Collocation đinh: </span>
                              <span className={language === 'ja' ? 'font-jp-compact font-semibold' : 'font-semibold'}>
                                {item.signatureCollocation}
                              </span>
                            </p>
                          )}
                        </div>

                        {/* ✅ O vs ❌ X */}
                        <div className="space-y-1 pt-1 border-t border-black/5 dark:border-white/10 text-[11px]">
                          <div className="flex items-start gap-1.5 text-teal-700 dark:text-teal-300">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span className={language === 'ja' ? 'font-jp-compact' : ''}>
                              Dùng chuẩn (O): {item.correctExample}
                            </span>
                          </div>
                          <div className="flex items-start gap-1.5 text-rose-700 dark:text-rose-300">
                            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span className={language === 'ja' ? 'font-jp-compact' : ''}>
                              Tuyệt đối tránh (X): {item.trapWarning}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {group.collocationPairs && group.collocationPairs.length > 0 && (
                  <div className="pt-2 border-t border-black/5 dark:border-white/10 text-[11px]">
                    <span className="font-semibold">Cụm từ đi kèm hay gặp: </span>
                    <span className="opacity-80 font-jp-compact">
                      {group.collocationPairs.join(' · ')}
                    </span>
                  </div>
                )}

                {/* Dual-Mode 6-Dimension Dossier Expansion for this Synonym/Homophone Group */}
                <div className="pt-2 border-t border-black/5 dark:border-white/10 space-y-2 min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedGroupIds((prev) => ({
                        ...prev,
                        [group.id]: !prev[group.id],
                      }))
                    }
                    className="h-7 px-2.5 text-[11px] font-semibold rounded-md zen-surface border hover:border-indigo-500 text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Microscope className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {expandedGroupIds[group.id]
                        ? 'Thu gọn hồ sơ sắc thái 2 tầng'
                        : 'Giải phẫu sắc thái 2 tầng (6 chiều)'}
                    </span>
                    {expandedGroupIds[group.id] ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>

                  {expandedGroupIds[group.id] && group.items.length > 0 && (
                    <DualModeNuancePanel
                      requestParams={{
                        term: group.items[0].term,
                        language,
                        targetLevel,
                        kind: 'nuance_group',
                        sentence: group.items[0].correctExample || group.summaryVi,
                        compareTerms: group.items.map((it) => it.term),
                        videoTitle,
                        timestamp: group.timestamp,
                      }}
                      defaultMode={matrixMode}
                      compact={true}
                      onSaveNuanceCard={
                        onSaveNuanceDualCard
                          ? (payload) =>
                              onSaveNuanceDualCard(payload, {
                                timestamp: group.timestamp,
                                sentence: group.items[0]?.correctExample || group.title,
                                sentenceVi: group.summaryVi,
                              })
                          : undefined
                      }
                      titleLabel={`Đối chiếu 6 chiều · ${group.title}`}
                    />
                  )}
                </div>
              </div>
            ))}

            {onExpandThreeMore && (
              <button
                type="button"
                onClick={onExpandThreeMore}
                disabled={isExpanding}
                className="w-full h-9 text-xs font-semibold rounded-xl zen-surface-subtle border hover:border-indigo-500 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                {isExpanding ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang nạp thêm 3 cặp từ dễ nhầm liên quan...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>+3 Cặp Từ Dễ Nhầm Liên Quan</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
