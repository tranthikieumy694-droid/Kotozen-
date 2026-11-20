import React, { useState } from 'react';
import {
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  Clock,
  GitCompare,
  Layers,
  Loader2,
  Play,
  ScanSearch,
  Sliders,
  Volume2,
} from 'lucide-react';
import type {
  Language,
  SentenceGrammarNote,
  SubtitleLine,
  SyntaxSegment,
  SyntaxXRay,
} from '../types';
import { formatTime, speakNative } from '../lib/youtube';

interface SyntaxXRayTabProps {
  language: Language;
  targetLine: SubtitleLine | null;
  xray: SyntaxXRay | null;
  isLoading: boolean;
  error: string | null;
  savedTermKeys: Set<string>;
  onAnalyzeActiveLine: () => void;
  onSeekTo: (seconds: number) => void;
  onSaveGrammarNote: (note: SentenceGrammarNote, line: SubtitleLine) => void;
}

type PrismTier = 'casual' | 'standard' | 'formal';

const PASTEL_STYLES: Record<
  SyntaxSegment['colorKey'],
  { chip: string; label: string }
> = {
  subject: {
    chip: 'bg-sky-500/10 border-sky-500/25 text-sky-900 dark:text-sky-100',
    label: 'text-sky-700 dark:text-sky-300',
  },
  predicate: {
    chip: 'bg-indigo-500/10 border-indigo-500/25 text-indigo-900 dark:text-indigo-100',
    label: 'text-indigo-700 dark:text-indigo-300',
  },
  clause: {
    chip: 'bg-violet-500/10 border-violet-500/25 text-violet-900 dark:text-violet-100',
    label: 'text-violet-700 dark:text-violet-300',
  },
  particle: {
    chip: 'bg-amber-500/10 border-amber-500/25 text-amber-900 dark:text-amber-100',
    label: 'text-amber-700 dark:text-amber-300',
  },
  modifier: {
    chip: 'bg-teal-500/10 border-teal-500/25 text-teal-900 dark:text-teal-100',
    label: 'text-teal-700 dark:text-teal-300',
  },
  grammar: {
    chip: 'bg-rose-500/10 border-rose-500/25 text-rose-900 dark:text-rose-100',
    label: 'text-rose-700 dark:text-rose-300',
  },
};

function renderHighlightedSentence(sentence: string, highlights: string[]) {
  if (!highlights || highlights.length === 0) return sentence;
  const escaped = highlights
    .map((h) => h.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return sentence;
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = sentence.split(regex);
  return parts.map((part, idx) => {
    const isHit = highlights.some((h) => h.trim().toLowerCase() === part.toLowerCase());
    return isHit ? (
      <mark
        key={idx}
        className="px-1 py-0.5 rounded bg-indigo-500/18 text-indigo-800 dark:text-indigo-200 font-bold"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    );
  });
}

export const SyntaxXRayTab: React.FC<SyntaxXRayTabProps> = ({
  language,
  targetLine,
  xray,
  isLoading,
  error,
  savedTermKeys,
  onAnalyzeActiveLine,
  onSeekTo,
  onSaveGrammarNote,
}) => {
  const [prismTier, setPrismTier] = useState<PrismTier>('standard');

  if (!targetLine) {
    return (
      <div className="py-16 px-6 text-center space-y-2 text-sm opacity-65">
        <p>
          Chọn bất kỳ câu phụ đề nào và bấm “X-Quang” để giải phẫu cấu trúc cú pháp đa tầng, đối chiếu mẫu ngữ pháp dễ nhầm và trượt Lăng kính 3 tầng văn phong.
        </p>
      </div>
    );
  }

  const prismVariant = xray?.registerPrism ? xray.registerPrism[prismTier] : null;
  const prismLabels: Record<PrismTier, string> =
    language === 'ja'
      ? {
          casual: 'Thân mật (タメ口)',
          standard: 'Lịch sự (丁寧語)',
          formal: 'Kính ngữ / Học thuật',
        }
      : {
          casual: 'Thân mật (Casual)',
          standard: 'Chuyên nghiệp',
          formal: 'Học thuật (IELTS 8+)',
        };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Selected Sentence Header */}
      <div className="p-3.5 border-b border-black/5 dark:border-white/10 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSeekTo(targetLine.start)}
            className="text-xs font-mono-tabular font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>
              Câu #{targetLine.index + 1} · {formatTime(targetLine.start)}
            </span>
          </button>

          <button
            type="button"
            onClick={onAnalyzeActiveLine}
            disabled={isLoading}
            className="h-7 px-2.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ScanSearch className="w-3.5 h-3.5" />
            )}
            <span>{xray ? 'Phân tích lại' : 'Giải phẫu ngay'}</span>
          </button>
        </div>

        <p
          className={`text-sm font-semibold leading-relaxed safe-wrap ${
            language === 'ja' ? 'font-jp-compact' : ''
          }`}
        >
          {targetLine.text}
        </p>
        {(xray?.translationVi || targetLine.translationVi) && (
          <p className="text-xs opacity-65 safe-wrap">
            {xray?.translationVi || targetLine.translationVi}
          </p>
        )}
      </div>

      {/* Analysis Content */}
      <div className="flex-1 overflow-y-auto zen-scroll p-3.5 space-y-5">
        {isLoading && (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs opacity-70">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span>Đang tách lớp cú pháp, so sánh ngữ pháp dễ nhầm &amp; dựng Lăng kính 3 tầng...</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {xray && !isLoading && (
          <>
            {/* 01. Multi-Layer Pastel Visual Syntax Ribbon */}
            <section className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-xs font-bold">01. Phân lớp cấu trúc câu (Pastel X-Ray)</h4>
                <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                  {xray.register}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {xray.segments.map((seg, idx) => {
                  const style = PASTEL_STYLES[seg.colorKey] || PASTEL_STYLES.clause;
                  return (
                    <div
                      key={idx}
                      className={`px-2.5 py-1.5 rounded-lg border text-left min-w-0 ${style.chip}`}
                    >
                      <div
                        className={`text-sm font-semibold leading-snug safe-wrap ${
                          language === 'ja' ? 'font-jp-compact' : ''
                        }`}
                      >
                        {seg.text}
                      </div>
                      <div className={`text-[10px] font-semibold mt-0.5 ${style.label}`}>
                        {seg.role}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Japanese Verb Conjugation Chain Decomposition */}
              {language === 'ja' &&
                xray.verbChainBreakdowns &&
                xray.verbChainBreakdowns.length > 0 && (
                  <div className="p-3 rounded-xl zen-surface-subtle border space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold">
                      <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>Bóc tách chuỗi chia thể động từ</span>
                    </div>
                    {xray.verbChainBreakdowns.map((vc, idx) => (
                      <div key={idx} className="space-y-1.5 text-xs">
                        <div className="font-jp-compact font-bold">{vc.surface}</div>
                        <div className="flex flex-wrap items-center gap-1">
                          {vc.layers.map((layer, lIdx) => (
                            <React.Fragment key={lIdx}>
                              <span className="px-2 py-0.5 rounded-md zen-surface border inline-flex flex-col items-center">
                                <span className="font-jp-compact font-bold text-indigo-700 dark:text-indigo-300">
                                  {layer.part}
                                </span>
                                <span className="text-[10px] opacity-70">{layer.label}</span>
                              </span>
                              {lIdx < vc.layers.length - 1 && (
                                <span className="opacity-40 text-xs font-bold">+</span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              {/* English Tense Timeline Justification */}
              {language === 'en' && xray.tenseTimelineNote && (
                <div className="p-2.5 rounded-xl zen-surface-subtle border flex items-start gap-2 text-xs">
                  <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 leading-relaxed">
                    <div className="font-bold">Lý do chọn Thì (Tense Timeline)</div>
                    <p className="opacity-85">{xray.tenseTimelineNote}</p>
                  </div>
                </div>
              )}

              {/* Detailed Segment Breakdown */}
              <div className="divide-y divide-black/5 dark:divide-white/10 pt-1">
                {xray.segments.map((seg, idx) => {
                  const style = PASTEL_STYLES[seg.colorKey] || PASTEL_STYLES.clause;
                  return (
                    <div key={idx} className="py-2 text-xs space-y-0.5">
                      <div className="flex items-baseline flex-wrap gap-x-2">
                        <span
                          className={`font-semibold ${language === 'ja' ? 'font-jp-compact' : ''}`}
                        >
                          {seg.text}
                        </span>
                        <span className={`text-[11px] font-semibold ${style.label}`}>
                          — {seg.role}
                        </span>
                      </div>
                      <p className="opacity-75 leading-relaxed">{seg.explanation}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 02. Zero-Latency 3-Tier Register Prism Slider */}
            {xray.registerPrism && prismVariant && (
              <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>02. Lăng Kính Biến Hình 3 Tầng Văn Phong (0ms)</span>
                  </h4>
                </div>

                {/* 3-Stop Segmented Register Slider */}
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl zen-surface-subtle border">
                  {(['casual', 'standard', 'formal'] as PrismTier[]).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setPrismTier(tier)}
                      className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-all cursor-pointer truncate ${
                        prismTier === tier
                          ? 'zen-surface text-indigo-700 dark:text-indigo-300 shadow-xs'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      {prismLabels[tier]}
                    </button>
                  ))}
                </div>

                <div className="p-3 rounded-xl zen-surface-subtle border space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                      {prismVariant.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => speakNative(prismVariant.sentence, language)}
                      className="h-6 px-2 text-[11px] font-medium rounded-md zen-surface border hover:border-indigo-500 flex items-center gap-1 cursor-pointer"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>Nghe</span>
                    </button>
                  </div>

                  <p
                    className={`text-sm font-semibold leading-relaxed safe-wrap ${
                      language === 'ja' ? 'font-jp-compact' : ''
                    }`}
                  >
                    {renderHighlightedSentence(prismVariant.sentence, prismVariant.highlights)}
                  </p>

                  {prismVariant.readingOrIpa && (
                    <p
                      className={`text-xs opacity-70 safe-wrap ${
                        language === 'ja' ? 'font-jp-compact' : 'font-ipa'
                      }`}
                    >
                      {prismVariant.readingOrIpa}
                    </p>
                  )}

                  <p className="text-xs opacity-80 leading-relaxed">{prismVariant.contextNoteVi}</p>
                </div>

                <p className="text-xs opacity-75 leading-relaxed">
                  <span className="font-semibold">Ngữ cảnh trong video: </span>
                  {xray.registerReason}
                </p>
              </section>
            )}

            {/* 03. Spoken-to-Standard Decompiler */}
            {xray.colloquialisms && xray.colloquialisms.length > 0 && (
              <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2">
                <h4 className="text-xs font-bold">03. Bản Dịch Khẩu Ngữ Ngược (Spoken → Standard)</h4>
                <div className="space-y-2">
                  {xray.colloquialisms.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg zen-surface-subtle border text-xs space-y-1"
                    >
                      <div className="flex items-center flex-wrap gap-1.5 font-jp-compact">
                        <span className="font-bold text-rose-700 dark:text-rose-300">
                          {item.spoken}
                        </span>
                        <ArrowRight className="w-3 h-3 opacity-50 shrink-0" />
                        <span className="font-semibold text-teal-700 dark:text-teal-300">
                          {item.standard}
                        </span>
                      </div>
                      <p className="opacity-75 leading-relaxed">{item.nuance}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 04. Grammar Points + Grammar Contrast Lab ("Đừng nhầm với...") */}
            {xray.grammarPoints && xray.grammarPoints.length > 0 && (
              <section className="pt-3 border-t border-black/5 dark:border-white/10 space-y-2.5">
                <h4 className="text-xs font-bold">
                  04. Mẫu Ngữ Pháp Cốt Lõi &amp; Phòng So Sánh Dễ Nhầm
                </h4>
                <div className="space-y-3">
                  {xray.grammarPoints.map((gp, idx) => {
                    const saved = savedTermKeys.has(`grammar::${gp.pattern.toLowerCase()}`);
                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-xl zen-surface-subtle border space-y-2.5 min-w-0"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-bold font-jp-compact safe-wrap">
                              {gp.pattern}
                            </div>
                            <div className="text-[11px] opacity-70 flex items-center flex-wrap gap-x-1.5 mt-0.5">
                              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                                {gp.level}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-tabular safe-wrap">{gp.formula}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onSaveGrammarNote(gp, targetLine)}
                            disabled={saved}
                            className={`h-7 px-2 text-[11px] font-semibold rounded-md flex items-center gap-1 shrink-0 cursor-pointer ${
                              saved
                                ? 'text-teal-700 dark:text-teal-300 bg-teal-500/12 cursor-default'
                                : 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12 hover:bg-indigo-500/20'
                            }`}
                          >
                            {saved ? (
                              <>
                                <BookmarkCheck className="w-3.5 h-3.5" />
                                <span>Đã lưu</span>
                              </>
                            ) : (
                              <>
                                <BookmarkPlus className="w-3.5 h-3.5" />
                                <span>Lưu FSRS</span>
                              </>
                            )}
                          </button>
                        </div>

                        <p className="text-xs opacity-85 leading-relaxed">{gp.nuance}</p>
                        {gp.conjugation && (
                          <p className="text-xs opacity-70">
                            <span className="font-semibold">Cách chia: </span>
                            {gp.conjugation}
                          </p>
                        )}

                        {/* Grammar Contrast Lab ("Đừng nhầm với...") */}
                        {gp.contrastPairs && gp.contrastPairs.length > 0 && (
                          <div className="pt-2 border-t border-black/5 dark:border-white/10 space-y-2">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                              <GitCompare className="w-3.5 h-3.5 shrink-0" />
                              <span>Đừng nhầm với...</span>
                            </div>
                            {gp.contrastPairs.map((cp, cIdx) => (
                              <div
                                key={cIdx}
                                className="p-2.5 rounded-lg zen-surface border space-y-1.5 text-xs"
                              >
                                <div className="flex items-baseline flex-wrap justify-between gap-1">
                                  <span className="font-bold font-jp-compact text-indigo-700 dark:text-indigo-300">
                                    {gp.pattern} vs {cp.vsPattern}
                                  </span>
                                  <span className="text-[11px] font-mono-tabular opacity-65">
                                    {cp.formula}
                                  </span>
                                </div>
                                <p className="font-medium leading-relaxed">{cp.coreDifferenceVi}</p>
                                <div className="grid grid-cols-1 gap-1 pt-1 text-[11px] opacity-85">
                                  <div className={language === 'ja' ? 'font-jp-compact' : ''}>
                                    <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                      A:{' '}
                                    </span>
                                    {cp.pairAExample}
                                  </div>
                                  <div className={language === 'ja' ? 'font-jp-compact' : ''}>
                                    <span className="font-bold text-teal-600 dark:text-teal-400">
                                      B:{' '}
                                    </span>
                                    {cp.pairBExample}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
