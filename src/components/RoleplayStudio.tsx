import React, { useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Send,
  Theater,
  Volume2,
} from 'lucide-react';
import type {
  Language,
  ProficiencyLevel,
  RoleplaySession,
  SubtitleLine,
} from '../types';
import { sendRoleplayReply, startRoleplaySession } from '../lib/api';
import { speakNative } from '../lib/youtube';

interface RoleplayStudioProps {
  language: Language;
  targetLevel: ProficiencyLevel;
  videoTitle: string;
  lines: SubtitleLine[];
  activeLine: SubtitleLine | null;
  onTurnCompleted?: () => void;
}

export const RoleplayStudio: React.FC<RoleplayStudioProps> = ({
  language,
  targetLevel,
  videoTitle,
  lines,
  activeLine,
  onTurnCompleted,
}) => {
  const [session, setSession] = useState<RoleplaySession | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (lines.length === 0) return;
    setIsLoading(true);
    setError(null);

    // Grab ±6 lines around active scene for authentic context
    const centerIdx = activeLine ? activeLine.index : 0;
    const startIdx = Math.max(0, centerIdx - 4);
    const endIdx = Math.min(lines.length, centerIdx + 8);
    const sceneExcerpt = lines
      .slice(startIdx, endIdx)
      .map((l) => l.text)
      .join('\n');

    try {
      const resp = await startRoleplaySession({
        videoTitle,
        sceneExcerpt,
        language,
        targetLevel,
      });
      const d = resp.startData;
      setSession({
        personaName: d.personaName,
        scenarioVi: d.scenarioVi,
        turnCount: 0,
        maxTurns: 5,
        missions: (d.missions || []).map((m) => ({ ...m, used: false })),
        messages: [
          {
            id: `rp_open_${Date.now()}`,
            role: 'ai',
            text: d.openingText,
            translationVi: d.openingTranslationVi,
          },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể khởi tạo phòng nhập vai.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !input.trim() || isLoading) return;
    const userText = input.trim();
    setInput('');
    setIsLoading(true);
    setError(null);

    const userMsg = {
      id: `rp_u_${Date.now()}`,
      role: 'user' as const,
      text: userText,
    };

    const nextHistory = [...session.messages, userMsg];
    setSession({ ...session, messages: nextHistory });

    try {
      const resp = await sendRoleplayReply({
        language,
        targetLevel,
        personaName: session.personaName,
        scenarioVi: session.scenarioVi,
        missions: session.missions,
        history: nextHistory.map((m) => ({ role: m.role, text: m.text })),
        userMessage: userText,
      });

      const r = resp.replyData;
      const matchedSet = new Set((r.matchedMissionTerms || []).map((t) => t.toLowerCase()));

      const updatedMissions = session.missions.map((m) => ({
        ...m,
        used:
          m.used ||
          matchedSet.has(m.term.toLowerCase()) ||
          userText.toLowerCase().includes(m.term.toLowerCase()),
      }));

      const updatedMessages = nextHistory.map((m) =>
        m.id === userMsg.id
          ? {
              ...m,
              correctionVi: r.correctionVi,
              naturalAlternative: r.naturalAlternative,
              usedTerms: r.matchedMissionTerms,
            }
          : m
      );

      updatedMessages.push({
        id: `rp_a_${Date.now()}`,
        role: 'ai',
        text: r.aiReply,
        translationVi: r.aiReplyTranslationVi,
      });

      setSession({
        ...session,
        turnCount: session.turnCount + 1,
        missions: updatedMissions,
        messages: updatedMessages,
      });
      onTurnCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi gửi câu thoại nhập vai.');
    } finally {
      setIsLoading(false);
    }
  };

  if (lines.length === 0) {
    return (
      <div className="py-14 px-6 text-center text-xs opacity-65">
        Nạp một video để mở Phòng Nhập Vai Hội Thoại AI theo đúng bối cảnh cảnh phim / bài giảng.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {!session ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3.5">
          <Theater className="w-9 h-9 text-indigo-600 dark:text-indigo-400" strokeWidth={1.5} />
          <div className="space-y-1 max-w-xs">
            <h4 className="text-sm font-bold">Phòng Nhập Vai Theo Bối Cảnh Video</h4>
            <p className="text-xs opacity-70 leading-relaxed">
              AI hóa thân thành nhân vật tại cảnh bạn đang xem (3–5 lượt thoại) kèm Thanh Nhiệm Vụ Vi Mô giúp bạn chủ động dùng lại đúng từ vựng &amp; ngữ pháp vừa học.
            </p>
          </div>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <button
            type="button"
            onClick={handleStart}
            disabled={isLoading}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Theater className="w-3.5 h-3.5" />
            )}
            <span>{isLoading ? 'Đang dựng bối cảnh...' : 'Nhập vai theo cảnh này'}</span>
          </button>
        </div>
      ) : (
        <>
          {/* Header & Micro-Mission Bar */}
          <div className="p-3 border-b border-black/5 dark:border-white/10 space-y-2 shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold">
                  Vai diễn: {session.personaName}{' '}
                  <span className="font-mono-tabular font-normal opacity-65">
                    · Lượt {session.turnCount}/{session.maxTurns}
                  </span>
                </div>
                <p className="text-[11px] opacity-70 leading-snug mt-0.5">{session.scenarioVi}</p>
              </div>
              <button
                type="button"
                onClick={handleStart}
                disabled={isLoading}
                title="Tạo cảnh nhập vai mới"
                className="h-7 px-2 text-[11px] font-medium rounded-md zen-surface-subtle border flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Cảnh mới</span>
              </button>
            </div>

            {/* Micro-Mission Checklist */}
            <div className="space-y-1">
              <div className="text-[11px] font-semibold opacity-75">
                Nhiệm vụ vi mô — hãy dùng các từ vừa học trong video:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {session.missions.map((m, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setInput((prev) => (prev ? `${prev} ${m.term}` : m.term))}
                    title={`${m.meaningVi} — Bấm để chèn nhanh`}
                    className={`px-2 py-0.5 text-[11px] rounded-md border flex items-center gap-1 transition-colors cursor-pointer font-jp ${
                      m.used
                        ? 'bg-teal-50 dark:bg-teal-950/50 border-teal-400 text-teal-800 dark:text-teal-200 line-through'
                        : 'zen-surface-subtle hover:border-indigo-500'
                    }`}
                  >
                    {m.used && <CheckCircle2 className="w-3 h-3 text-teal-600" />}
                    <span className="font-semibold">{m.term}</span>
                    <span className="opacity-65">({m.meaningVi})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chat Turns */}
          <div className="flex-1 overflow-y-auto zen-scroll p-3.5 space-y-3">
            {session.messages.map((msg) => (
              <div
                key={msg.id}
                className={`space-y-1.5 ${msg.role === 'user' ? 'pl-6' : 'pr-4'}`}
              >
                <div
                  className={`p-3 rounded-xl text-xs space-y-1.5 ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white ml-auto'
                      : 'zen-surface-subtle border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-[13px] leading-relaxed font-medium ${language === 'ja' ? 'font-jp' : ''}`}>
                      {msg.text}
                    </p>
                    {msg.role === 'ai' && (
                      <button
                        type="button"
                        onClick={() => speakNative(msg.text, language)}
                        title="Nghe lời thoại AI"
                        className="opacity-65 hover:opacity-100 shrink-0 cursor-pointer"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {msg.translationVi && (
                    <p className="text-[11px] opacity-70 border-t border-black/5 dark:border-white/10 pt-1">
                      {msg.translationVi}
                    </p>
                  )}
                </div>

                {/* Natural AI Correction & Upgrade right under user turn */}
                {msg.role === 'user' && (msg.correctionVi || msg.naturalAlternative) && (
                  <div className="p-2.5 rounded-lg bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200/80 dark:border-teal-900/60 text-[11px] space-y-1">
                    {msg.correctionVi && (
                      <p className="leading-relaxed">
                        <span className="font-semibold text-teal-800 dark:text-teal-300">
                          Góp ý tự nhiên:{' '}
                        </span>
                        {msg.correctionVi}
                      </p>
                    )}
                    {msg.naturalAlternative && (
                      <p className={`font-medium text-indigo-700 dark:text-indigo-300 ${language === 'ja' ? 'font-jp' : ''}`}>
                        Cách nói bản xứ: “{msg.naturalAlternative}”
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs opacity-65">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{session.personaName} đang phản hồi...</span>
              </div>
            )}
            {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </div>

          {/* Reply Composer */}
          <form
            onSubmit={handleSend}
            className="p-2.5 border-t border-black/5 dark:border-white/10 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                language === 'ja'
                  ? 'Nhập câu trả lời tiếng Nhật (dùng từ nhiệm vụ ở trên)...'
                  : 'Nhập câu trả lời tiếng Anh (dùng từ nhiệm vụ ở trên)...'
              }
              className="flex-1 h-9 px-3 text-xs rounded-lg zen-surface-subtle border focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="h-9 px-3 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Gửi</span>
            </button>
          </form>
        </>
      )}
    </div>
  );
};
