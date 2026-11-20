import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react';
import type { ArticleLanguage, Language, SubtitleLine } from '../types';
import { ShadowingRecorder } from './ShadowingRecorder';

interface ArticleAudioBarProps {
  activeLanguage: ArticleLanguage;
  lines: SubtitleLine[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onShadowScored?: () => void;
}

const SPEED_OPTIONS = [0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5];

function pickVoiceForLang(langCode: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;
  const prefix = langCode.slice(0, 2).toLowerCase();
  const preferred = voices.find(
    (v) =>
      v.lang.toLowerCase().startsWith(prefix) &&
      /(google|natural|neural|kyoko|otoya|samantha|daniel|linh|hoai)/i.test(v.name)
  );
  if (preferred) return preferred;
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) || null;
}

export const ArticleAudioBar: React.FC<ArticleAudioBarProps> = ({
  activeLanguage,
  lines,
  activeIndex,
  onActiveIndexChange,
  onShadowScored,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [repeatCurrent, setRepeatCurrent] = useState(false);
  const [showShadowing, setShowShadowing] = useState(false);

  const isPlayingRef = useRef(false);
  const repeatRef = useRef(false);
  const speedRef = useRef(1.0);
  const linesRef = useRef(lines);
  const langRef = useRef(activeLanguage);
  const playTokenRef = useRef(0);

  useEffect(() => {
    repeatRef.current = repeatCurrent;
  }, [repeatCurrent]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    langRef.current = activeLanguage;
  }, [activeLanguage]);

  const stopSpeech = useCallback(() => {
    playTokenRef.current += 1;
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, [stopSpeech]);

  // Stop playback cleanly if language changes
  useEffect(() => {
    stopSpeech();
  }, [activeLanguage, stopSpeech]);

  const speakAtIndex = useCallback(
    (idx: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const list = linesRef.current;
      if (!list || list.length === 0) return;
      const safeIdx = Math.max(0, Math.min(list.length - 1, idx));
      const targetLine = list[safeIdx];
      if (!targetLine?.text) return;

      onActiveIndexChange(safeIdx);
      window.speechSynthesis.cancel();

      const myToken = ++playTokenRef.current;
      isPlayingRef.current = true;
      setIsPlaying(true);

      const bcp47 =
        langRef.current === 'ja' ? 'ja-JP' : langRef.current === 'vi' ? 'vi-VN' : 'en-US';
      const utt = new SpeechSynthesisUtterance(targetLine.text);
      utt.lang = bcp47;
      utt.rate = speedRef.current;
      const voice = pickVoiceForLang(bcp47);
      if (voice) utt.voice = voice;

      utt.onend = () => {
        if (playTokenRef.current !== myToken || !isPlayingRef.current) return;
        if (repeatRef.current) {
          window.setTimeout(() => {
            if (playTokenRef.current === myToken && isPlayingRef.current) {
              speakAtIndex(safeIdx);
            }
          }, 320);
          return;
        }
        if (safeIdx + 1 < linesRef.current.length) {
          window.setTimeout(() => {
            if (playTokenRef.current === myToken && isPlayingRef.current) {
              speakAtIndex(safeIdx + 1);
            }
          }, 260);
        } else {
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
      };

      utt.onerror = () => {
        if (playTokenRef.current === myToken) {
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
      };

      window.speechSynthesis.speak(utt);
    },
    [onActiveIndexChange]
  );

  // Keyboard shortcut 'R' for Repeat sentence in Article Studio
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setRepeatCurrent((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeLine = lines[activeIndex] || lines[0] || null;
  const shadowingLang: Language = activeLanguage === 'ja' ? 'ja' : 'en';

  return (
    <div className="zen-surface border rounded-xl p-2.5 sm:p-3 space-y-2.5 no-print min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left: Playback controls */}
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => speakAtIndex(Math.max(0, activeIndex - 1))}
            disabled={lines.length === 0 || activeIndex <= 0}
            title="Đọc câu trước"
            className="w-8 h-8 rounded-lg zen-surface-subtle border flex items-center justify-center disabled:opacity-35 hover:border-indigo-500 cursor-pointer shrink-0"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (isPlaying) {
                stopSpeech();
              } else {
                speakAtIndex(activeIndex);
              }
            }}
            disabled={lines.length === 0}
            className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 sepia:bg-amber-800 sepia:hover:bg-amber-900 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-45 cursor-pointer shrink-0"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlaying ? 'Tạm dừng' : 'Nghe đọc bài'}</span>
          </button>

          <button
            type="button"
            onClick={() => speakAtIndex(Math.min(lines.length - 1, activeIndex + 1))}
            disabled={lines.length === 0 || activeIndex >= lines.length - 1}
            title="Đọc câu tiếp theo"
            className="w-8 h-8 rounded-lg zen-surface-subtle border flex items-center justify-center disabled:opacity-35 hover:border-indigo-500 cursor-pointer shrink-0"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setRepeatCurrent((v) => !v)}
            title="Lặp lại câu đang chọn (Phím R)"
            className={`h-8 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
              repeatCurrent
                ? 'bg-indigo-600/15 border-indigo-500 text-indigo-700 dark:text-indigo-300'
                : 'zen-surface-subtle hover:border-indigo-500/60'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lặp câu</span>
          </button>
        </div>

        {/* Right: Speed, sentence progress & Shadowing Lab */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-[11px] opacity-75 font-mono-tabular">
            <Volume2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>
              Câu {Math.min(activeIndex + 1, Math.max(1, lines.length))}/{lines.length}
            </span>
          </div>

          <select
            value={speed}
            onChange={(e) => {
              const nextSpeed = Number(e.target.value);
              setSpeed(nextSpeed);
              speedRef.current = nextSpeed;
              if (isPlayingRef.current) speakAtIndex(activeIndex);
            }}
            aria-label="Tốc độ đọc bài viết"
            className="h-8 px-2 rounded-lg zen-surface-subtle border text-xs font-mono-tabular font-semibold cursor-pointer"
          >
            {SPEED_OPTIONS.map((sp) => (
              <option key={sp} value={sp}>
                {sp.toFixed(sp === 1 || sp === 1.5 || sp === 0.6 ? 1 : 2)}x
              </option>
            ))}
          </select>

          {activeLanguage !== 'vi' && (
            <button
              type="button"
              onClick={() => setShowShadowing((v) => !v)}
              className={`h-8 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                showShadowing
                  ? 'bg-rose-500/15 border-rose-500 text-rose-700 dark:text-rose-300'
                  : 'zen-surface-subtle hover:border-rose-500/60'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Shadowing câu này</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Shadowing & Pronunciation Scorer for the Active Article Sentence */}
      {showShadowing && activeLanguage !== 'vi' && activeLine && (
        <div className="pt-2 border-t border-black/5 dark:border-white/10 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold opacity-80 truncate">
              Luyện nhại giọng câu #{activeIndex + 1}:{' '}
              <span className={activeLanguage === 'ja' ? 'font-jp' : ''}>
                “{activeLine.text}”
              </span>
            </span>
            <button
              type="button"
              onClick={() => setShowShadowing(false)}
              className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer shrink-0"
              aria-label="Đóng Shadowing"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ShadowingRecorder
            language={shadowingLang}
            activeLine={activeLine}
            onReplayOriginal={() => speakAtIndex(activeIndex)}
            onShadowScored={onShadowScored}
          />
        </div>
      )}
    </div>
  );
};
