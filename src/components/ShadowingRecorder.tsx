import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  Loader2,
  Mic,
  Play,
  RotateCcw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { Language, PitchMora, PronunciationAssessment, SubtitleLine } from '../types';
import { scorePronunciation } from '../lib/api';

interface ShadowingRecorderProps {
  language: Language;
  activeLine: SubtitleLine | null;
  onReplayOriginal: () => void;
  onShadowScored?: () => void;
  disabled?: boolean;
}

function DualPitchCompareSvg({
  reference,
  user,
}: {
  reference: PitchMora[];
  user: PitchMora[];
}) {
  if (!reference || reference.length === 0) return null;
  const count = Math.min(reference.length, user?.length || reference.length);
  const stepX = 34;
  const padX = 20;
  const highY = 16;
  const lowY = 38;
  const width = padX * 2 + Math.max(0, count - 1) * stepX;

  const refPts = reference.slice(0, count).map((m, i) => ({
    x: padX + i * stepX,
    y: m.pitch === 'H' ? highY : lowY,
    text: m.text,
  }));

  const userPts = (user || []).slice(0, count).map((m, i) => ({
    x: padX + i * stepX,
    y: m.pitch === 'H' ? highY + 3 : lowY - 3,
    mismatch: reference[i] && reference[i].pitch !== m.pitch,
  }));

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold">Đối chiếu đường Pitch Accent Tokyo NHK</span>
        <div className="flex items-center gap-3">
          <span className="text-indigo-600 dark:text-indigo-400 font-medium">● Chuẩn NHK</span>
          <span className="text-rose-600 dark:text-rose-400 font-medium">┄ Giọng bạn</span>
        </div>
      </div>
      <div className="overflow-x-auto pb-1">
        <svg width={width} height={68} viewBox={`0 0 ${width} 68`} className="block">
          {/* Reference NHK Contour */}
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            className="text-indigo-600 dark:text-indigo-400"
            points={refPts.map((p) => `${p.x},${p.y}`).join(' ')}
          />
          {/* User Recorded Pitch Contour Overlaid */}
          {userPts.length > 0 && (
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray="4 3"
              className="text-rose-500 dark:text-rose-400"
              points={userPts.map((p) => `${p.x},${p.y}`).join(' ')}
            />
          )}
          {refPts.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={3.5}
                className="fill-indigo-600 dark:fill-indigo-400"
              />
              {userPts[i] && (
                <circle
                  cx={userPts[i].x}
                  cy={userPts[i].y}
                  r={userPts[i].mismatch ? 4.5 : 3}
                  className={
                    userPts[i].mismatch
                      ? 'fill-rose-500 stroke-white dark:stroke-slate-900'
                      : 'fill-teal-500'
                  }
                  strokeWidth={1.5}
                />
              )}
              <text
                x={p.x}
                y={58}
                textAnchor="middle"
                className="font-jp text-[12px] fill-current opacity-85"
              >
                {p.text}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const str = typeof reader.result === 'string' ? reader.result : '';
      const base64 = str.includes(',') ? str.split(',')[1] : str;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export const ShadowingRecorder: React.FC<ShadowingRecorderProps> = ({
  language,
  activeLine,
  onReplayOriginal,
  onShadowScored,
  disabled,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Feature 11: AI Pronunciation Assessment State
  const [isScoring, setIsScoring] = useState(false);
  const [assessment, setAssessment] = useState<PronunciationAssessment | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // Reset pronunciation scorecard when changing sentence
  useEffect(() => {
    setAssessment(null);
    setError(null);
  }, [activeLine?.id]);

  const cleanupStream = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setLevel(0);
  };

  useEffect(() => {
    return () => {
      cleanupStream();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setError(null);
    setAssessment(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Trình duyệt không hỗ trợ thu âm micro.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setLevel(Math.min(100, Math.round(rms * 280)));
        rafRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        setAudioBlob(blob);
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        cleanupStream();
        setIsRecording(false);
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setError('Không thể truy cập micro. Hãy cấp quyền micro trong trình duyệt.');
      cleanupStream();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const playRecording = () => {
    if (!audioUrl) return;
    if (!audioElRef.current) {
      audioElRef.current = new Audio();
      audioElRef.current.onended = () => setIsPlayingBack(false);
    }
    audioElRef.current.src = audioUrl;
    setIsPlayingBack(true);
    audioElRef.current.play().catch(() => setIsPlayingBack(false));
  };

  const clearRecording = () => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      setIsPlayingBack(false);
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBlob(null);
    setAssessment(null);
  };

  const handleScoreWithAi = async () => {
    if (!audioBlob || !activeLine) return;
    setIsScoring(true);
    setError(null);
    try {
      const audioBase64 = await blobToBase64(audioBlob);
      const resp = await scorePronunciation({
        audioBase64,
        mimeType: audioBlob.type || 'audio/webm',
        targetSentence: activeLine.text,
        language,
        ipaLine: activeLine.ipaLine,
      });
      setAssessment(resp.assessment);
      onShadowScored?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể chấm phát âm lúc này.');
    } finally {
      setIsScoring(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {!isRecording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            className="h-8 px-3 text-xs font-medium rounded-lg zen-surface-subtle border hover:opacity-90 flex items-center gap-1.5 transition-opacity disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Mic className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            <span>Thu âm Shadowing</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="h-8 px-3 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Dừng thu</span>
            <span className="w-10 h-1.5 bg-white/30 rounded-full overflow-hidden inline-block">
              <span
                className="block h-full bg-white transition-transform duration-75 origin-left"
                style={{ transform: `scaleX(${Math.max(0.12, level / 100)})` }}
              />
            </span>
          </button>
        )}

        {audioUrl && !isRecording && (
          <>
            <button
              type="button"
              onClick={playRecording}
              className="h-8 px-2.5 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isPlayingBack ? 'Đang phát' : 'Nghe giọng bạn'}</span>
            </button>

            <button
              type="button"
              onClick={handleScoreWithAi}
              disabled={isScoring || !activeLine}
              className="h-8 px-3 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              {isScoring ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Award className="w-3.5 h-3.5" />
              )}
              <span>{isScoring ? 'AI đang chấm âm...' : 'AI Chấm phát âm'}</span>
            </button>

            <button
              type="button"
              onClick={onReplayOriginal}
              className="h-8 px-2.5 text-xs font-medium rounded-lg zen-surface-subtle border flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Giọng gốc</span>
            </button>

            <button
              type="button"
              onClick={clearRecording}
              aria-label="Xóa bản thu"
              className="w-8 h-8 flex items-center justify-center rounded-lg opacity-60 hover:text-rose-600 hover:opacity-100 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {/* Feature 11: Real-Time Pronunciation & Intonation Assessment Card */}
      {assessment && (
        <div className="p-3.5 rounded-xl zen-surface-subtle border space-y-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300 font-mono-tabular">
                Tổng điểm: {assessment.overallScore}/100
              </span>
              <span className="font-mono-tabular opacity-75">
                Trôi chảy: {assessment.fluencyScore} · Ngữ điệu: {assessment.intonationScore}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAssessment(null)}
              aria-label="Đóng bảng chấm phát âm"
              className="opacity-60 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="leading-relaxed opacity-90">{assessment.summaryVi}</p>

          {/* Word-by-word color-coded pronunciation map */}
          <div className="flex flex-wrap gap-1.5">
            {assessment.words.map((w, idx) => {
              const style =
                w.status === 'correct'
                  ? 'bg-teal-50 dark:bg-teal-950/50 border-teal-300 dark:border-teal-800 text-teal-900 dark:text-teal-200'
                  : w.status === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                    : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200';
              return (
                <div
                  key={idx}
                  title={w.articulatoryTip || w.issue || `Độ chuẩn ${w.score}%`}
                  className={`px-2 py-1 rounded-md border font-medium ${language === 'ja' ? 'font-jp' : ''} ${style}`}
                >
                  <span>{w.word}</span>
                  <span className="ml-1 font-mono-tabular text-[10px] opacity-75">{w.score}%</span>
                </div>
              );
            })}
          </div>

          {/* Specific articulatory tips for warning/error words */}
          {assessment.words.some((w) => w.status !== 'correct' && (w.issue || w.articulatoryTip)) && (
            <div className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/10">
              {assessment.words
                .filter((w) => w.status !== 'correct' && (w.issue || w.articulatoryTip))
                .slice(0, 4)
                .map((w, idx) => (
                  <div key={idx} className="leading-relaxed">
                    <span className="font-bold font-jp">{w.word}:</span>{' '}
                    {w.issue && <span className="opacity-85">{w.issue}. </span>}
                    {w.articulatoryTip && (
                      <span className="text-indigo-700 dark:text-indigo-300 font-medium">
                        Cách sửa: {w.articulatoryTip}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* Language-specific deep notes */}
          {language === 'en' && (assessment.endingSoundsNote || assessment.linkingAndStressNote) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-black/5 dark:border-white/10">
              {assessment.endingSoundsNote && (
                <div>
                  <span className="font-semibold">Âm cuối (Ending sounds): </span>
                  <span className="opacity-80">{assessment.endingSoundsNote}</span>
                </div>
              )}
              {assessment.linkingAndStressNote && (
                <div>
                  <span className="font-semibold">Trọng âm &amp; Nối âm: </span>
                  <span className="opacity-80">{assessment.linkingAndStressNote}</span>
                </div>
              )}
            </div>
          )}

          {language === 'ja' && (
            <div className="space-y-2.5 pt-2 border-t border-black/5 dark:border-white/10">
              {assessment.moraRhythmNote && (
                <div>
                  <span className="font-semibold">Nhịp Mora (Trường âm / Xúc âm): </span>
                  <span className="opacity-80">{assessment.moraRhythmNote}</span>
                </div>
              )}
              {assessment.referencePitch && assessment.referencePitch.length > 0 && (
                <DualPitchCompareSvg
                  reference={assessment.referencePitch}
                  user={assessment.userPitch || []}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
