/// <reference lib="webworker" />
import type { InputCompatibilityReport, Language, ProficiencyLevel, SubtitleLine } from '../types';
import { stripHtmlAndRubyArtifacts, unpackCompactSubtitleBatch } from '../lib/compactUnpacker';

const JLPT_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1'];
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// Core high-frequency function words considered baseline known for i+1 accuracy
const EN_BASELINE_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
  'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up',
  'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time',
  'no', 'just', 'him', 'know', 'take', 'into', 'your', 'good', 'some', 'could', 'them', 'see',
  'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back',
  'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want',
  'is', 'are', 'was', 'were', 'am', 'been', 'has', 'had', 'did', 'does', 'very', 'much', 'more',
]);

const JA_BASELINE_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'の', 'も', 'へ', 'から', 'まで', 'より', 'や', 'ね', 'よ', 'か',
  'です', 'ます', 'た', 'だ', 'て', 'ない', 'する', 'いる', 'ある', 'こと', 'もの', 'これ', 'それ', 'あれ',
  '私', 'わたし', '僕', 'ぼく', '人', 'ひと', '今', 'いま', '日', 'ひ', '年', 'とし', '何', 'なに',
]);

const NON_VOCAB_ONLY_RE = /^[\p{P}\p{S}\p{Z}\p{C}0-9]+$/u;
const HTML_TAG_FRAGMENT_RE = /^(?:ruby|rt|rp|span|br|div)$/i;

function isGenuineVocabToken(surface: string, key: string, language: Language): boolean {
  if (!key || !surface) return false;
  if (/[<>\/\\]/.test(surface) || /[<>\/\\]/.test(key)) return false;
  if (NON_VOCAB_ONLY_RE.test(key)) return false;
  if (language === 'ja') {
    if (HTML_TAG_FRAGMENT_RE.test(key)) return false;
    // Must contain at least one genuine Japanese character (Kanji / Hiragana / Katakana)
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(key);
  }
  return /[A-Za-z]/.test(key);
}

function tokenizeTextFast(rawText: string, lineId: string) {
  const text = stripHtmlAndRubyArtifacts(rawText);
  if (!text) return [];
  const isJapanese = /[\u3040-\u30FF\u4E00-\u9FAF]/.test(text);
  if (isJapanese) {
    const parts =
      text.match(
        /[\u4E00-\u9FAF]+[\u3040-\u309F]*|[\u30A0-\u30FFー]+|[\u3040-\u309F]+|[a-zA-Z0-9]+|[^\s]/g
      ) || [text];
    return parts.map((surface, i) => ({
      id: `${lineId}_t${i}`,
      surface,
      lemma: surface,
      isPunctuation: /^[。、！？「」『』（）…,.!?;:()\-—・]+$/.test(surface),
    }));
  }
  const parts = text.match(/[A-Za-z0-9'’-]+|[^\sA-Za-z0-9'’-]+/g) || [text];
  return parts.map((surface, i) => ({
    id: `${lineId}_t${i}`,
    surface,
    lemma: surface.toLowerCase(),
    isPunctuation: /^[^A-Za-z0-9]+$/.test(surface),
  }));
}

function computeCompatibilityReport(
  lines: SubtitleLine[],
  language: Language,
  targetLevel: ProficiencyLevel,
  knownLemmas: string[]
): InputCompatibilityReport {
  const knownSet = new Set(knownLemmas.map((w) => w.toLowerCase()));
  const order = language === 'ja' ? JLPT_ORDER : CEFR_ORDER;
  const targetRank = order.indexOf(targetLevel);

  const uniqueContentWords = new Map<string, { rank: number; isKnown: boolean }>();

  for (const line of lines) {
    for (const token of line.tokens) {
      if (token.isPunctuation) continue;
      const cleanSurface = stripHtmlAndRubyArtifacts(token.surface || '');
      const key = stripHtmlAndRubyArtifacts(token.lemma || cleanSurface).trim().toLowerCase();
      if (!isGenuineVocabToken(cleanSurface, key, language)) continue;

      const tokenRank = token.level ? order.indexOf(token.level) : -1;
      const isBaseline =
        language === 'ja'
          ? JA_BASELINE_PARTICLES.has(cleanSurface) || JA_BASELINE_PARTICLES.has(key)
          : EN_BASELINE_WORDS.has(key);

      // Words at or below target level, baseline words, or user-studied FSRS words count toward comprehension
      const isLevelMastered = tokenRank !== -1 && targetRank !== -1 && tokenRank <= targetRank;
      const isKnown = knownSet.has(key) || isBaseline || isLevelMastered;

      const existing = uniqueContentWords.get(key);
      if (!existing || (isKnown && !existing.isKnown)) {
        uniqueContentWords.set(key, { rank: tokenRank, isKnown });
      }
    }
  }

  const totalUniqueWords = uniqueContentWords.size;
  if (totalUniqueWords === 0) {
    return {
      knownPercent: 85,
      totalUniqueWords: 0,
      knownWordsCount: 0,
      stretchWordsCount: 0,
      verdictLabel: 'Đang phân tích',
      recommendationVi: 'Nạp phụ đề để tính độ vừa sức i+1 theo kho từ của bạn.',
    };
  }

  let knownWordsCount = 0;
  let stretchWordsCount = 0;

  uniqueContentWords.forEach(({ rank, isKnown }) => {
    if (isKnown) {
      knownWordsCount++;
    } else if (rank === -1 || targetRank === -1 || rank === targetRank + 1) {
      stretchWordsCount++;
    }
  });

  const knownPercent = Math.min(99, Math.max(12, Math.round((knownWordsCount / totalUniqueWords) * 100)));

  let verdictLabel = 'Vừa sức lý tưởng (i+1)';
  let recommendationVi = `Video này bạn đã nắm khoảng ${knownPercent}% từ vựng — Vùng i+1 hoàn hảo để luyện nghe sâu & Shadowing!`;

  if (knownPercent >= 93) {
    verdictLabel = 'Khá dễ · Luyện phản xạ nhanh';
    recommendationVi = `Bạn đã hiểu ${knownPercent}% từ vựng — Hãy bật chế độ Làm Mờ (Blur) hoặc tốc độ 1.25x để ép tai phản xạ tự nhiên.`;
  } else if (knownPercent < 75 && knownPercent >= 58) {
    verdictLabel = 'Thử thách vừa phải';
    recommendationVi = `Độ hiểu ước tính ${knownPercent}% — Nên bật Giải phẫu câu ở những câu dài và lưu từ mới vào FSRS.`;
  } else if (knownPercent < 58) {
    verdictLabel = 'Khá khó · Học chuyên sâu';
    recommendationVi = `Độ hiểu hiện tại khoảng ${knownPercent}% — Hãy chia nhỏ video bằng Tab Chương học, hạ tốc độ 0.85x và bật Furigana/IPA.`;
  }

  return {
    knownPercent,
    totalUniqueWords,
    knownWordsCount,
    stretchWordsCount,
    verdictLabel,
    recommendationVi,
  };
}

function decodeAndNormalizeWorker(input: string): string {
  if (!input) return '';
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&#0*39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
}

function auditAndBuildTimelineInWorker(
  rawLines: Array<{ start: number; duration: number; text: string }>,
  sourceLanguage: 'vi' | 'en' | 'ja',
  isAsr: boolean,
  videoDurationSec?: number
): {
  lines: SubtitleLine[];
  auditSummary: {
    totalCues: number;
    monotoneFixed: number;
    anomalousTrimmed: number;
    microFlickersMerged: number;
    largeGapCount: number;
  };
} {
  let monotoneFixed = 0;
  let anomalousTrimmed = 0;
  let microFlickersMerged = 0;

  const cleaned = rawLines
    .filter((r) => r && typeof r.text === 'string' && Number.isFinite(r.start) && r.start >= 0)
    .map((r) => ({
      start: Number(Math.max(0, r.start).toFixed(3)),
      duration: Number(Math.max(0.2, Number.isFinite(r.duration) ? r.duration : 2.0).toFixed(3)),
      text: decodeAndNormalizeWorker(r.text),
    }))
    .filter((r) => r.text.length > 0)
    .sort((a, b) => a.start - b.start);

  // Micro-Flicker Guard (< 0.20s)
  const deflickered: Array<{ start: number; duration: number; text: string }> = [];
  for (let i = 0; i < cleaned.length; i++) {
    const cur = cleaned[i];
    if (cur.duration < 0.2 && deflickered.length > 0) {
      const prev = deflickered[deflickered.length - 1];
      const gap = cur.start - (prev.start + prev.duration);
      if (gap >= -0.05 && gap <= 0.35 && prev.duration + cur.duration <= 6.0) {
        prev.text = `${prev.text}${sourceLanguage === 'ja' ? '' : ' '}${cur.text}`.trim();
        prev.duration = Number(Math.max(prev.duration, cur.start + cur.duration - prev.start).toFixed(3));
        microFlickersMerged++;
        continue;
      }
    }
    deflickered.push(cur);
  }

  // Strict Monotonicity + Anomalous Duration Trap
  const isVi = sourceLanguage === 'vi';
  const built: SubtitleLine[] = [];
  for (let i = 0; i < deflickered.length; i++) {
    const cur = deflickered[i];
    let start = cur.start;
    let dur = Math.max(0.22, cur.duration);

    if (dur > 6.2) {
      dur = 6.2;
      anomalousTrimmed++;
    }
    if (videoDurationSec && videoDurationSec > 5 && start + dur > videoDurationSec + 0.5) {
      dur = Math.max(0.22, Number((videoDurationSec - start).toFixed(3)));
    }

    if (built.length > 0) {
      const prev = built[built.length - 1];
      if (start < prev.start + 0.05) {
        start = Number((prev.start + 0.05).toFixed(3));
        monotoneFixed++;
      }
      if (prev.end > start) {
        prev.end = start;
        prev.duration = Math.max(0.2, Number((prev.end - prev.start).toFixed(3)));
        monotoneFixed++;
      }
    }

    const next = deflickered[i + 1];
    if (next && next.start > start + 0.2 && start + dur > next.start) {
      dur = Number((next.start - start).toFixed(3));
      monotoneFixed++;
    }

    const isNonSpeechFiller = (rawTxt: string): boolean => {
      const t = rawTxt.replace(/\s+/g, ' ').trim();
      if (!t) return true;
      const stripped = t
        .replace(
          /[\[\(（【]\s*(?:âm nhạc|nhạc nền|nhạc|tiếng vỗ tay|vỗ tay|tiếng cười|cười|hò reo|tiếng động|im lặng|music|applause|laughter|cheering|silence|sound effects?|instrumental|outro|intro|音楽|拍手|笑い|歓声|効果音|bgm)\s*[\]\)）】]/gi,
          ''
        )
        .replace(/[♪♫♬♩🎵🎶•·\-–—_.…!?！？,，。:：;；\s]/g, '')
        .trim();
      return stripped.length === 0;
    };

    const nonSpeech = isNonSpeechFiller(cur.text);
    const idx = built.length;
    const id = `line_${idx}`;
    const end = Number((start + Math.max(0.2, dur)).toFixed(3));
    built.push({
      id,
      index: idx,
      start,
      duration: Number(Math.max(0.2, end - start).toFixed(3)),
      end,
      text: nonSpeech ? '' : isVi ? '' : cur.text,
      rawText: isVi || isAsr ? cur.text : undefined,
      translationVi: nonSpeech ? '' : isVi ? cur.text : '',
      tokens: nonSpeech || isVi ? [] : tokenizeTextFast(cur.text, id),
      enriched: nonSpeech,
    });
  }

  let largeGapCount = 0;
  for (let i = 0; i < built.length - 1; i++) {
    if (built[i + 1].start - built[i].end > 20) largeGapCount++;
  }

  return {
    lines: built,
    auditSummary: {
      totalCues: built.length,
      monotoneFixed,
      anomalousTrimmed,
      microFlickersMerged,
      largeGapCount,
    },
  };
}

type WorkerRequest =
  | {
      type: 'TOKENIZE_BATCH';
      requestId: string;
      rawLines: Array<{ start: number; duration: number; text: string; isAsr?: boolean }>;
    }
  | {
      type: 'AUDIT_AND_BUILD_TIMELINE';
      requestId: string;
      rawLines: Array<{ start: number; duration: number; text: string }>;
      sourceLanguage: 'vi' | 'en' | 'ja';
      isAsr: boolean;
      videoDurationSec?: number;
    }
  | {
      type: 'COMPUTE_I_PLUS_1';
      requestId: string;
      lines: SubtitleLine[];
      language: Language;
      targetLevel: ProficiencyLevel;
      knownLemmas: string[];
    }
  | {
      type: 'UNPACK_COMPACT_BATCH';
      requestId: string;
      lines: SubtitleLine[];
      language: Language;
      targetLevel?: ProficiencyLevel;
      immutableTimeEntries?: Array<[string, { start: number; duration: number; end: number }]>;
    };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'TOKENIZE_BATCH') {
    const lines: SubtitleLine[] = msg.rawLines.map((r, idx) => {
      const id = `line_${idx}`;
      const dur = Math.max(0.25, Number(r.duration.toFixed(3)));
      return {
        id,
        index: idx,
        start: Number(r.start.toFixed(3)),
        duration: dur,
        end: Number((r.start + dur).toFixed(3)),
        text: r.text,
        rawText: r.isAsr ? r.text : undefined,
        translationVi: '',
        tokens: tokenizeTextFast(r.text, id),
        enriched: false,
      };
    });
    self.postMessage({ type: 'TOKENIZE_BATCH_RESULT', requestId: msg.requestId, lines });
  } else if (msg.type === 'AUDIT_AND_BUILD_TIMELINE') {
    const result = auditAndBuildTimelineInWorker(
      msg.rawLines,
      msg.sourceLanguage,
      msg.isAsr,
      msg.videoDurationSec
    );
    self.postMessage({
      type: 'AUDIT_AND_BUILD_TIMELINE_RESULT',
      requestId: msg.requestId,
      lines: result.lines,
      auditSummary: result.auditSummary,
    });
  } else if (msg.type === 'COMPUTE_I_PLUS_1') {
    const report = computeCompatibilityReport(
      msg.lines,
      msg.language,
      msg.targetLevel,
      msg.knownLemmas
    );
    self.postMessage({ type: 'COMPUTE_I_PLUS_1_RESULT', requestId: msg.requestId, report });
  } else if (msg.type === 'UNPACK_COMPACT_BATCH') {
    const unpacked = unpackCompactSubtitleBatch(
      msg.lines,
      msg.language,
      msg.targetLevel,
      msg.immutableTimeEntries
    );
    self.postMessage({
      type: 'UNPACK_COMPACT_BATCH_RESULT',
      requestId: msg.requestId,
      lines: unpacked,
    });
  }
};
