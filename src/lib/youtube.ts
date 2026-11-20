import type { CefrLevel, JlptLevel, Language, ProficiencyLevel, SubtitleLine } from '../types';

export const JLPT_LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'];
export const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function normalizeUtf8Client(input: string): string {
  if (!input) return '';
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&#0*39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .normalize('NFC');
}

export function getLevelRank(level: ProficiencyLevel | undefined, lang: Language): number {
  if (!level) return -1;
  return lang === 'ja'
    ? JLPT_LEVELS.indexOf(level as JlptLevel)
    : CEFR_LEVELS.indexOf(level as CefrLevel);
}

export function getAdaptiveHighlightTier(
  tokenLevel: ProficiencyLevel | undefined,
  targetLevel: ProficiencyLevel,
  lang: Language
): 'target' | 'stretch' | null {
  const tokenRank = getLevelRank(tokenLevel, lang);
  const targetRank = getLevelRank(targetLevel, lang);
  if (tokenRank === -1 || targetRank === -1) return null;
  if (tokenRank === targetRank) return 'target';
  if (tokenRank === targetRank + 1) return 'stretch';
  return null;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function parseYouTubeTimeParam(raw: string | null): number {
  if (!raw) return 0;
  const cleaned = raw.trim().toLowerCase().replace(/[^0-9hms]/g, '');
  if (!cleaned) return 0;
  if (/^\d+$/.test(cleaned)) return parseInt(cleaned, 10);
  let total = 0;
  const h = cleaned.match(/(\d+)h/);
  const m = cleaned.match(/(\d+)m/);
  const s = cleaned.match(/(\d+)s/);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total;
}

/**
 * Pillar 0 — Strict Universal YouTube URL Sanitizer:
 * Immediately rejects Facebook/TikTok/plain prose/broken strings before mounting any iframe,
 * and cleanly extracts the exact 11-character Video ID + startTime from ALL YouTube formats.
 */
export function parseYouTubeUrlClient(input: string): {
  videoId: string;
  startTime: number;
  cleanUrl: string;
} | null {
  const sanitized = input
    .replace(/[\u200B-\u200D\uFEFF\r\n\t]/g, '')
    .replace(/^[\s"'<>()[\]]+|[\s"'<>()[\]]+$/g, '')
    .trim();

  if (!sanitized) return null;

  // Direct 11-char Video ID (reject plain hyphenated lowercase words like "invalid-url")
  if (/^[a-zA-Z0-9_-]{11}$/.test(sanitized) && !/^[a-z]+-[a-z]+$/.test(sanitized)) {
    return {
      videoId: sanitized,
      startTime: 0,
      cleanUrl: `https://www.youtube.com/watch?v=${sanitized}`,
    };
  }

  const embeddedUrlMatch = sanitized.match(/https?:\/\/[^\s"'<>]+/i);
  let candidate = embeddedUrlMatch ? embeddedUrlMatch[0] : sanitized;
  if (!/^https?:\/\//i.test(candidate)) {
    if (!/(youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(candidate)) {
      return null;
    }
    candidate = `https://${candidate}`;
  }

  let videoId = '';
  let startTime = 0;

  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const isYtHost =
      host === 'youtu.be' ||
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube.com');

    if (!isYtHost) {
      return null;
    }

    if (host === 'youtu.be') {
      videoId = (url.pathname.split('/').filter(Boolean)[0] || '').slice(0, 11);
    } else {
      const vParam = url.searchParams.get('v');
      if (vParam) {
        videoId = vParam.trim().slice(0, 11);
      } else {
        const pathMatch = url.pathname.match(
          /^\/(?:shorts|live|embed|v|e)\/([a-zA-Z0-9_-]{11})/i
        );
        if (pathMatch) {
          videoId = pathMatch[1];
        }
      }
    }

    const tParam = url.searchParams.get('t') || url.searchParams.get('start');
    const hashMatch = url.hash.match(/t=([0-9hms]+)/i);
    startTime = parseYouTubeTimeParam(tParam || (hashMatch ? hashMatch[1] : null));
  } catch {
    // Fallback to strict regex
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    const universalRegex =
      /(?:(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/|v\/|e\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
    const m = sanitized.match(universalRegex);
    if (m && m[1]) {
      videoId = m[1];
    }
    const timeRegex = /[?&#](?:t|start)=([0-9hms]+)/i;
    const tm = sanitized.match(timeRegex);
    if (tm && tm[1]) {
      startTime = parseYouTubeTimeParam(tm[1]);
    }
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  return {
    videoId,
    startTime,
    cleanUrl:
      startTime > 0
        ? `https://www.youtube.com/watch?v=${videoId}&t=${startTime}s`
        : `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function buildYouTubeTimestampUrl(videoId: string, seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  return `https://www.youtube.com/watch?v=${videoId}&t=${sec}s`;
}

export function getYouTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function parseTimestampToSeconds(ts: string): number {
  const cleaned = ts.trim().replace(',', '.');
  const parts = cleaned.split(':').map((p) => parseFloat(p));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Guarantees strictly monotonic, non-overlapping subtitle cues:
 *   cue[i].start < cue[i].end <= cue[i+1].start
 * Preserves authentic silence/music gaps whenever cue[i].end < cue[i+1].start.
 */
export function normalizeMonotonicSubtitleLines(rawLines: SubtitleLine[]): SubtitleLine[] {
  if (rawLines.length === 0) return [];
  const sorted = [...rawLines].sort((a, b) => a.start - b.start);
  const out: SubtitleLine[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    let start = Math.max(0, Number(cur.start.toFixed(2)));
    let end = Math.max(start + 0.35, Number((cur.end ?? cur.start + cur.duration).toFixed(2)));

    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (start < prev.start + 0.05) {
        start = Number((prev.start + 0.05).toFixed(2));
      }
      if (prev.end > start) {
        prev.end = start;
        prev.duration = Math.max(0.15, Number((prev.end - prev.start).toFixed(2)));
      }
      if (end <= start + 0.15) {
        end = Number((start + 0.35).toFixed(2));
      }
    }

    if (next && Number.isFinite(next.start) && next.start > start + 0.2 && end > next.start) {
      end = Number(next.start.toFixed(2));
    }

    const duration = Math.max(0.2, Number((end - start).toFixed(2)));
    const idx = out.length;
    out.push({
      ...cur,
      id: cur.id || `line_${idx}`,
      index: idx,
      start,
      duration,
      end: Number((start + duration).toFixed(2)),
    });
  }
  return out;
}

/**
 * Tier-4 Universal Subtitle & Plain Transcript Parser:
 * Accepts .SRT, .VTT, [H:MM:SS] / [MM:SS] stamped lines (zero duration/line cap),
 * OR plain raw Vietnamese/EN/JP paragraphs (auto-splitting sentences with natural pacing).
 */
export function parseSubtitleFile(content: string): SubtitleLine[] {
  const normalized = normalizeUtf8Client(content)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '');

  // Mode 1: Standard SRT / VTT with -->
  if (normalized.includes('-->')) {
    const blocks = normalized.split(/\n{2,}/);
    const lines: SubtitleLine[] = [];

    for (const block of blocks) {
      const rawRows = block
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);
      if (rawRows.length === 0) continue;

      const timeIdx = rawRows.findIndex((r) => r.includes('-->'));
      if (timeIdx === -1) continue;

      const [rawStart, rawEndPart] = rawRows[timeIdx].split('-->');
      if (!rawStart || !rawEndPart) continue;

      const start = parseTimestampToSeconds(rawStart.trim());
      const end = parseTimestampToSeconds(rawEndPart.trim().split(/\s+/)[0]);
      const duration = Math.max(0.4, Number((end - start).toFixed(2)));

      const textRows = normalizeUtf8Client(
        rawRows
          .slice(timeIdx + 1)
          .join(' ')
          .replace(/<[^>]+>/g, '')
          .replace(/\{[^}]+\}/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      );

      if (!textRows) continue;

      const idx = lines.length;
      const id = `line_${idx}`;
      lines.push({
        id,
        index: idx,
        start: Number(start.toFixed(2)),
        duration,
        end: Number((start + duration).toFixed(2)),
        text: textRows,
        translationVi: '',
        tokens: createBasicTokens(textRows, id),
        enriched: false,
      });
    }
    if (lines.length > 0) return normalizeMonotonicSubtitleLines(lines);
  }

  // Mode 2: YouTube Transcript Copy-Paste format (supports 0:12, [01:25], 1:05:30, 125:40)
  const rawLines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const stampedLines: SubtitleLine[] = [];
  const tsLineRegex = /^\[?(\d{1,3}:\d{2}(?::\d{2})?)\]?\s*(.*)$/;
  for (let i = 0; i < rawLines.length; i++) {
    const m = rawLines[i].match(tsLineRegex);
    if (m) {
      const start = parseTimestampToSeconds(m[1]);
      let text = (m[2] || '').trim();
      if (!text && i + 1 < rawLines.length && !tsLineRegex.test(rawLines[i + 1])) {
        text = rawLines[++i].trim();
      }
      if (text) {
        const idx = stampedLines.length;
        const id = `line_${idx}`;
        stampedLines.push({
          id,
          index: idx,
          start: Number(start.toFixed(2)),
          duration: 4,
          end: Number((start + 4).toFixed(2)),
          text: normalizeUtf8Client(text),
          translationVi: '',
          tokens: createBasicTokens(text, id),
          enriched: false,
        });
      }
    }
  }
  if (stampedLines.length > 0) {
    for (let i = 0; i < stampedLines.length - 1; i++) {
      const rawGap = stampedLines[i + 1].start - stampedLines[i].start;
      const dur = Math.max(0.6, Math.min(6.0, rawGap > 0 ? rawGap : 3.5));
      stampedLines[i].duration = Number(dur.toFixed(2));
      stampedLines[i].end = Number((stampedLines[i].start + dur).toFixed(2));
    }
    return normalizeMonotonicSubtitleLines(stampedLines);
  }

  // Mode 3: Plain raw Vietnamese / EN / JP text pasted without timestamps
  const sentenceChunks = normalized
    .split(/(?<=[.!?。？！\n])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 2);

  let cursor = 0;
  const plainLines = sentenceChunks.map((sentence, idx) => {
    const wordCount = Math.max(3, sentence.split(/\s+/).length);
    const duration = Number(Math.min(6.5, Math.max(2.2, wordCount * 0.4)).toFixed(2));
    const start = Number(cursor.toFixed(2));
    cursor += duration;
    const id = `line_${idx}`;
    return {
      id,
      index: idx,
      start,
      duration,
      end: Number((start + duration).toFixed(2)),
      text: normalizeUtf8Client(sentence),
      translationVi: '',
      tokens: createBasicTokens(sentence, id),
      enriched: false,
    };
  });
  return normalizeMonotonicSubtitleLines(plainLines);
}

export function createBasicTokens(text: string, lineId: string) {
  const clean = normalizeUtf8Client(text);
  const isJapanese = /[\u3040-\u30FF\u4E00-\u9FAF]/.test(clean);
  if (isJapanese) {
    const parts =
      clean.match(
        /[\u4E00-\u9FAF]+[\u3040-\u309F]*|[\u30A0-\u30FFー]+|[\u3040-\u309F]+|[a-zA-Z0-9]+|[^\s]/g
      ) || [clean];
    return parts.map((surface, i) => ({
      id: `${lineId}_t${i}`,
      surface,
      lemma: surface,
      isPunctuation: /^[。、！？「」『』（）…,.!?;:()\-—・]+$/.test(surface),
    }));
  }

  const parts = clean.match(/[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}'’-]+/gu) || [clean];
  return parts.map((surface, i) => ({
    id: `${lineId}_t${i}`,
    surface,
    lemma: surface.toLowerCase(),
    isPunctuation: /^[^\p{L}\p{N}]+$/u.test(surface),
  }));
}

/**
 * Display-to-Speech Parity for Japanese:
 * Builds a TTS string where Kanji segments with explicit Furigana/ruby readings are spoken
 * using their exact displayed Hiragana/Katakana reading (preventing mismatches like 今日 -> こんにち
 * instead of きょう, or 行う -> いく instead of おこなう), while preserving grammatical particles
 * (は / へ / を) untouched so browser ja-JP TTS renders natural phrasing.
 */
export function buildJapaneseSpeechText(line: SubtitleLine): string {
  if (!line.tokens || line.tokens.length === 0) return line.text;
  const hasKanjiReading = line.tokens.some(
    (t) =>
      /[\u4E00-\u9FAF]/.test(t.surface) &&
      (Boolean(t.furigana) || Boolean(t.ruby?.some((r) => Boolean(r.reading))))
  );
  if (!hasKanjiReading) return line.text;

  return line.tokens
    .map((tok) => {
      if (tok.isPunctuation) return tok.surface;
      // Preserve single-kana grammatical particles intact (は, へ, を)
      if (!/[\u4E00-\u9FAF]/.test(tok.surface)) return tok.surface;
      if (tok.ruby && tok.ruby.length > 0) {
        return tok.ruby
          .map((seg) => (seg.reading && /[\u4E00-\u9FAF]/.test(seg.base) ? seg.reading : seg.base))
          .join('');
      }
      if (tok.furigana && /^[\u3040-\u30FFー・]+$/.test(tok.furigana.trim())) {
        return tok.furigana.trim();
      }
      return tok.surface;
    })
    .join('');
}

export function speakNative(
  text: string,
  lang: Language,
  rate = 0.95,
  readingOverride?: string
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    let spokenText = text;
    if (
      lang === 'ja' &&
      readingOverride &&
      /[\u4E00-\u9FAF]/.test(text) &&
      /^[\u3040-\u30FFー・\s]+$/.test(readingOverride.trim())
    ) {
      spokenText = readingOverride.trim();
    }
    if (!spokenText.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = lang === 'ja' ? 'ja-JP' : 'en-US';
    utterance.rate = rate;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) =>
      lang === 'ja'
        ? v.lang.toLowerCase().startsWith('ja')
        : v.lang.toLowerCase().startsWith('en-us')
    );
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis errors
  }
}
