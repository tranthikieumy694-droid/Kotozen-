import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ThinkingLevel, Type } from '@google/genai';
import {
  extractTextFromPdfBase64,
  generateStructuredJson,
  isDailyQuotaError,
  isRateLimitError,
  streamNdjsonLines,
  streamYouTubeVideoWindow,
  transcribeTabAudioChunk,
  transcribeYouTubeVideoWindow,
} from './server/gemini.ts';
import {
  extractWebArticle,
  parseRawArticleText,
  type ArticleLanguage,
} from './server/articleExtractor.ts';
import {
  checkYouTubeOEmbed,
  extractYouTubeCaptions,
  normalizeMonotonicTimeline,
} from './server/youtube.ts';
import {
  deepNormalizeUtf8,
  isPureTargetLanguage,
  sanitizeCompactReadingMapServer,
  sanitizeHiraganaReadingServer,
  stripHtmlAndRubyArtifactsServer,
  toFriendlyErrorMessage,
} from './server/textSanitizer.ts';
import {
  buildKanjiGroundTruthPromptHint,
  extractUniqueKanji,
  formatVerifiedRadicalSummary,
  validateAndSanitizeKanjiEtymology,
} from './server/kanjiGroundTruth.ts';
import { enforceNuanceParity, sanitizeExtraScenarios } from './server/nuanceParity.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '25mb' }));

// Mandatory UTF-8 charset lock on all API JSON responses
app.use('/api', (_req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------------------
// 1. POST /api/youtube/captions — 3-Layer Zero-Error YouTube Subtitle Pipeline
// ---------------------------------------------------------------------------
app.post('/api/youtube/captions', async (req, res) => {
  try {
    const { url, language, targetLevel } = req.body as {
      url?: string;
      language?: 'en' | 'ja';
      targetLevel?: string;
    };
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Vui lòng cung cấp đường link YouTube hợp lệ.' });
    }
    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const result = await extractYouTubeCaptions(url, lang, targetLevel);
    return res.json(result);
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const isDailyQuota = isDailyQuotaError(err);
    const message = toFriendlyErrorMessage(err, 'Không thể trích xuất phụ đề cho video YouTube này.');
    return res.status(rateLimited ? 429 : 400).json({
      error: message,
      quotaExhausted: rateLimited,
      isDailyQuota,
    });
  }
});

// ---------------------------------------------------------------------------
// 1b. POST /api/youtube/validate-catalog — Pre-Flight Live oEmbed Verification
// ---------------------------------------------------------------------------
app.post('/api/youtube/validate-catalog', async (req, res) => {
  try {
    const { videoIds } = req.body as { videoIds?: string[] };
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.json({ validIds: [], metadata: {} });
    }
    const unique = [...new Set(videoIds)].slice(0, 40);
    const checks = await Promise.all(unique.map((id) => checkYouTubeOEmbed(id)));
    const validIds: string[] = [];
    const metadata: Record<string, { title: string; channelName: string }> = {};
    for (const c of checks) {
      if (c.valid) {
        validIds.push(c.videoId);
        metadata[c.videoId] = { title: c.title, channelName: c.channelName };
      }
    }
    return res.json({ validIds, metadata });
  } catch {
    return res.json({ validIds: [], metadata: {} });
  }
});

// ---------------------------------------------------------------------------
// 1c. POST /api/youtube/stt-continue — Parallel 1-Pass Direct Audio Harvester (90s-150s chunks)
// ---------------------------------------------------------------------------
app.post('/api/youtube/stt-continue', async (req, res) => {
  try {
    const {
      videoId,
      videoTitle,
      startOffsetSec,
      windowDurationSec,
      knownDurationSec,
      targetLanguage,
      targetLevel,
      contextAnchor,
      priority,
      timeoutMs,
    } = req.body as {
      videoId?: string;
      videoTitle?: string;
      startOffsetSec?: number;
      windowDurationSec?: number;
      knownDurationSec?: number;
      targetLanguage?: 'en' | 'ja';
      targetLevel?: string;
      contextAnchor?: ContextAnchorPayload;
      priority?: 'express' | 'background';
      timeoutMs?: number;
    };
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return res.status(400).json({ error: 'Video ID không hợp lệ.' });
    }
    const safeWindow = Math.max(25, Math.min(165, Number(windowDurationSec) || 120));
    const safeTimeout = Math.max(20_000, Math.min(45_000, Number(timeoutMs) || 38_000));
    const contextAnchorBlock = formatContextAnchorBlock(contextAnchor);
    const stt = await transcribeYouTubeVideoWindow({
      videoId,
      videoTitle: videoTitle || `YouTube Video (${videoId})`,
      startOffsetSec: Math.max(0, Number(startOffsetSec) || 0),
      windowDurationSec: safeWindow,
      knownDurationSec:
        Number.isFinite(Number(knownDurationSec)) && Number(knownDurationSec) > 0
          ? Number(knownDurationSec)
          : undefined,
      targetLanguage: targetLanguage === 'ja' || targetLanguage === 'en' ? targetLanguage : undefined,
      targetLevel,
      contextAnchorBlock,
      priority: priority === 'express' ? 'express' : 'background',
      timeoutMs: safeTimeout,
    });
    return res.json(
      deepNormalizeUtf8({
        ...stt,
        lines: normalizeMonotonicTimeline(stt.lines),
      })
    );
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const isDailyQuota = isDailyQuotaError(err);
    const message = toFriendlyErrorMessage(err, 'Chưa thể chép lời đoạn tiếp theo ngay lúc này.');
    return res.status(rateLimited ? 429 : 500).json({
      error: message,
      quotaExhausted: rateLimited,
      isDailyQuota,
    });
  }
});

// ---------------------------------------------------------------------------
// 1c-2. POST /api/youtube/stt-stream — 1-Pass Multimodal NDJSON Micro-Burst Streamer
// Streams Segment 0 (0s->30s) or Instant Seek Teleport (45s) cue-by-cue in 1.5-3s!
// ---------------------------------------------------------------------------
app.post('/api/youtube/stt-stream', async (req, res) => {
  const {
    videoId,
    videoTitle,
    startOffsetSec,
    windowDurationSec,
    knownDurationSec,
    targetLanguage,
    targetLevel,
    contextAnchor,
  } = req.body as {
    videoId?: string;
    videoTitle?: string;
    startOffsetSec?: number;
    windowDurationSec?: number;
    knownDurationSec?: number;
    targetLanguage?: 'en' | 'ja';
    targetLevel?: string;
    contextAnchor?: ContextAnchorPayload;
  };

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Video ID không hợp lệ.' });
  }

  const lang: 'en' | 'ja' = targetLanguage === 'ja' ? 'ja' : 'en';
  const safeStart = Math.max(0, Math.floor(Number(startOffsetSec) || 0));
  const safeWindow = Math.max(20, Math.min(90, Math.floor(Number(windowDurationSec) || 30)));
  const contextAnchorBlock = formatContextAnchorBlock(contextAnchor);

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const streamAbort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) streamAbort.abort();
  });

  const writeNdjson = (payload: Record<string, unknown>) => {
    if (!res.writableEnded && !streamAbort.signal.aborted) {
      res.write(`${JSON.stringify(deepNormalizeUtf8(payload))}\n`);
    }
  };

  try {
    const result = await streamYouTubeVideoWindow({
      videoId,
      videoTitle: videoTitle || `YouTube Video (${videoId})`,
      startOffsetSec: safeStart,
      windowDurationSec: safeWindow,
      knownDurationSec:
        Number.isFinite(Number(knownDurationSec)) && Number(knownDurationSec) > 0
          ? Number(knownDurationSec)
          : undefined,
      targetLanguage: lang,
      targetLevel,
      contextAnchorBlock,
      signal: streamAbort.signal,
      timeoutMs: 36_000,
      onLine: (line) => {
        writeNdjson({ type: 'line', line });
      },
    });
    writeNdjson({
      type: 'done',
      emittedCount: result.emittedCount,
      nextOffsetSec: result.nextOffsetSec,
      hasMoreContent: result.hasMoreContent,
    });
    if (!res.writableEnded) res.end();
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const isDailyQuota = isDailyQuotaError(err);
    const restricted = Boolean((err as { restricted?: boolean } | null)?.restricted);
    const friendly = toFriendlyErrorMessage(
      err,
      'Không thể đọc trực tiếp luồng âm thanh YouTube của video này.'
    );
    if (!res.writableEnded) {
      writeNdjson({
        type: 'error',
        status: rateLimited ? 429 : 500,
        quotaExhausted: rateLimited,
        isDailyQuota,
        restricted: !rateLimited && restricted,
        error: friendly,
      });
      writeNdjson({ type: 'done', emittedCount: 0 });
      res.end();
    }
  }
});

// ---------------------------------------------------------------------------
// 1c-3. POST /api/youtube/tab-audio-stt — Inline Tab-Audio AI Fallback (8-10s chunks)
// ---------------------------------------------------------------------------
app.post('/api/youtube/tab-audio-stt', async (req, res) => {
  try {
    const {
      audioBase64,
      mimeType,
      chunkStartSec,
      chunkDurationSec,
      videoTitle,
      targetLanguage,
      targetLevel,
      contextAnchor,
    } = req.body as {
      audioBase64?: string;
      mimeType?: string;
      chunkStartSec?: number;
      chunkDurationSec?: number;
      videoTitle?: string;
      targetLanguage?: 'en' | 'ja';
      targetLevel?: string;
      contextAnchor?: ContextAnchorPayload;
    };

    if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length < 100) {
      return res.status(400).json({ error: 'Đoạn âm thanh quá ngắn hoặc không hợp lệ.' });
    }
    const lang: 'en' | 'ja' = targetLanguage === 'ja' ? 'ja' : 'en';
    const contextAnchorBlock = formatContextAnchorBlock(contextAnchor);
    const result = await transcribeTabAudioChunk({
      audioBase64,
      mimeType: mimeType || 'audio/webm',
      chunkStartSec: Math.max(0, Number(chunkStartSec) || 0),
      chunkDurationSec: Math.max(3, Math.min(20, Number(chunkDurationSec) || 9)),
      videoTitle: videoTitle || 'YouTube Video',
      targetLanguage: lang,
      targetLevel,
      contextAnchorBlock,
    });
    return res.json(
      deepNormalizeUtf8({
        ...result,
        lines: normalizeMonotonicTimeline(result.lines),
      })
    );
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const isDailyQuota = isDailyQuotaError(err);
    const message = toFriendlyErrorMessage(err, 'Chưa thể giải mã đoạn âm thanh trực tiếp.');
    return res.status(rateLimited ? 429 : 500).json({
      error: message,
      quotaExhausted: rateLimited,
      isDailyQuota,
    });
  }
});

// ---------------------------------------------------------------------------
// 1d. POST /api/subtitles/context-anchor — Global Video Context & Dynamic Glossary Lock
// ---------------------------------------------------------------------------
interface ContextAnchorPayload {
  summaryVi: string;
  registerPolicy: string;
  glossary: Array<{ sourceTerm: string; targetTerm: string }>;
}

interface PreviousContextPair {
  source: string;
  target: string;
}

function capTextToMaxWords(raw: string, maxWords: number): string {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!clean || maxWords <= 0) return '';
  const words = clean.split(' ');
  let trimmed = words.length > maxWords ? words.slice(0, maxWords).join(' ') : clean;
  // Also protect CJK strings without spaces (roughly 3.2 chars/word equivalent)
  const maxChars = Math.max(24, Math.round(maxWords * 7));
  if (trimmed.length > maxChars) {
    trimmed = trimmed.slice(0, maxChars).trim();
  }
  return trimmed;
}

function isNonSpeechCueText(raw: string): boolean {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  const stripped = t
    .replace(
      /[\[\(（【]\s*(?:âm nhạc|nhạc nền|nhạc|tiếng vỗ tay|vỗ tay|tiếng cười|cười|hò reo|tiếng động|im lặng|music|applause|laughter|cheering|silence|sound effects?|instrumental|outro|intro|音楽|拍手|笑い|歓声|効果音|bgm)\s*[\]\)）】]/gi,
      ''
    )
    .replace(/[♪♫♬♩🎵🎶•·\-–—_.…!?！？,，。:：;；\s]/g, '')
    .trim();
  return stripped.length === 0;
}

/**
 * O(1) Constant-Size Context Header Builder:
 * - Global Context Header (summaryVi + registerPolicy): strictly <= 80 words
 * - Dynamic Glossary (LRU deduplicated): strictly <= 20 core terms
 * - Sliding Overlap (previousContext): strictly last 2 sentences, total <= 36 words
 */
function formatContextAnchorBlock(
  anchor?: ContextAnchorPayload,
  previousContext?: PreviousContextPair[]
): string {
  const parts: string[] = [];
  if (anchor && (anchor.summaryVi || anchor.registerPolicy || anchor.glossary?.length)) {
    const cappedSummary = capTextToMaxWords(anchor.summaryVi || '', 55);
    const cappedRegister = capTextToMaxWords(anchor.registerPolicy || '', 25);

    // Deduplicate & cap Dynamic Glossary strictly at <= 20 terms (O(1) constant ceiling)
    const seenTerms = new Set<string>();
    const cappedGlossary: Array<{ sourceTerm: string; targetTerm: string }> = [];
    for (const g of anchor.glossary || []) {
      const src = capTextToMaxWords(g?.sourceTerm || '', 5);
      const tgt = capTextToMaxWords(g?.targetTerm || '', 5);
      if (!src || !tgt) continue;
      const key = src.toLowerCase();
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      cappedGlossary.push({ sourceTerm: src, targetTerm: tgt });
      if (cappedGlossary.length >= 20) break;
    }
    const glossaryStr = cappedGlossary
      .map((g) => `${g.sourceTerm} ➔ ${g.targetTerm}`)
      .join(' | ');

    parts.push(
      `[HỒ SƠ NGỮ CẢNH TOÀN VIDEO — KHÓA CỐ ĐỊNH O(1)]
- Chủ đề & Vai vế: ${cappedSummary}
- Tông văn phong: ${cappedRegister}${
        glossaryStr ? `\n- Thuật ngữ khóa (≤20): ${glossaryStr}` : ''
      }`
    );
  }
  if (Array.isArray(previousContext) && previousContext.length > 0) {
    const lastTwo = previousContext.slice(-2);
    // Enforce strict <= 40 words total across the 2 read-only overlap sentences
    const perSideWordCap = lastTwo.length === 2 ? 10 : 20;
    const prevLines = lastTwo
      .map((p, idx) => {
        const s = capTextToMaxWords(p.source || '', perSideWordCap);
        const t = capTextToMaxWords(p.target || '', perSideWordCap);
        return `  (-${lastTwo.length - idx}) "${s}" ➔ "${t}"`;
      })
      .join('\n');
    parts.push(
      `[GỐI ĐẦU 2 CÂU LIỀN TRƯỚC — CHỈ ĐỌC THAM CHIẾU, KHÔNG XUẤT LẠI]
${prevLines}`
    );
  }
  return parts.length > 0 ? `${parts.join('\n\n')}\n\n` : '';
}

app.post('/api/subtitles/context-anchor', async (req, res) => {
  try {
    const { sampleLines, language, targetLevel, videoTitle } = req.body as {
      sampleLines?: string[];
      language?: 'en' | 'ja';
      targetLevel?: string;
      videoTitle?: string;
    };

    if (!Array.isArray(sampleLines) || sampleLines.length === 0) {
      return res.status(400).json({ error: 'Thiếu dữ liệu trích mẫu toàn video.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const level = targetLevel || (lang === 'ja' ? 'N3' : 'B2');

    const prompt = `Phân tích nhanh các câu trích mẫu rải đều từ đầu đến cuối video "${videoTitle || 'YouTube Video'}" để tạo Hồ Sơ Ngữ Cảnh Chung (< 110 từ) giúp dịch nhất quán 100% từ phút 00:00 đến phút cuối cùng sang ${
      lang === 'ja' ? `Tiếng Nhật (JLPT ${level})` : `Tiếng Anh (CEFR ${level})`
    }:
1. summaryVi: Tóm tắt ngắn gọn (< 90 từ) chủ đề video, vai vế người nói và bối cảnh giao tiếp.
2. registerPolicy: Khóa cố định 1 tông văn phong nhất quán (${
      lang === 'ja'
        ? 'vd: "Lịch sự Teineigo (です・ます) · Ngôi xưng 私" hoặc "Thân mật Futsukei · Ngôi 僕/俺"'
        : 'vd: "Conversational natural English (B2)" hoặc "Professional Academic (C1)"'
    }).
3. glossary: 4–12 thuật ngữ chuyên ngành, tên riêng hoặc khái niệm lặp lại quan trọng nhất trong video (sourceTerm ➔ targetTerm chuẩn xác, giữ cố định suốt toàn video).

Trích mẫu rải đều toàn video:
${sampleLines.slice(0, 32).map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        summaryVi: { type: Type.STRING },
        registerPolicy: { type: Type.STRING },
        glossary: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              sourceTerm: { type: Type.STRING },
              targetTerm: { type: Type.STRING },
            },
            required: ['sourceTerm', 'targetTerm'],
          },
        },
      },
      required: ['summaryVi', 'registerPolicy', 'glossary'],
    };

    const anchor = await generateStructuredJson<ContextAnchorPayload>({
      prompt,
      systemInstruction:
        'Tạo Hồ sơ Ngữ cảnh & Bảng thuật ngữ khóa cứng siêu gọn, chính xác tuyệt đối để đảm bảo đồng nhất văn phong xuyên suốt video dài 1–3 giờ.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.MINIMAL,
    });

    return res.json({ anchor: deepNormalizeUtf8(anchor) });
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const isDailyQuota = isDailyQuotaError(err);
    const message = toFriendlyErrorMessage(err, 'Chưa thể tạo hồ sơ ngữ cảnh toàn video.');
    return res.status(rateLimited ? 429 : 500).json({
      error: message,
      quotaExhausted: rateLimited,
      isDailyQuota,
    });
  }
});

// ---------------------------------------------------------------------------
// 2. POST /api/subtitles/enrich — Vietnamese-to-Target Bilingual Engine + Strict 1:1 Parity
// ---------------------------------------------------------------------------
interface EnrichInputLine {
  id: string;
  index: number;
  start: number;
  duration: number;
  text: string;
}

function stripInlineRubyMarkup(text: string): string {
  return stripHtmlAndRubyArtifactsServer(text);
}

app.post('/api/subtitles/enrich', async (req, res) => {
  try {
    const {
      lines,
      language,
      sourceLanguage,
      targetLevel,
      isAsr,
      videoTitle,
      contextAnchor,
      previousContext,
      priority,
      timeoutMs,
      compactWire,
    } = req.body as {
      lines?: EnrichInputLine[];
      language?: 'en' | 'ja';
      sourceLanguage?: 'vi' | 'en' | 'ja';
      targetLevel?: string;
      isAsr?: boolean;
      videoTitle?: string;
      contextAnchor?: ContextAnchorPayload;
      previousContext?: PreviousContextPair[];
      priority?: 'express' | 'background';
      timeoutMs?: number;
      compactWire?: boolean;
    };

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Danh sách dòng phụ đề không hợp lệ.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const srcLang: 'vi' | 'en' | 'ja' =
      sourceLanguage === 'vi' || sourceLanguage === 'ja' || sourceLanguage === 'en'
        ? sourceLanguage
        : lang;
    const level = targetLevel || (lang === 'ja' ? 'N3' : 'B2');
    const isViSource = srcLang === 'vi';
    const reqPriority: 'express' | 'background' = priority === 'express' ? 'express' : 'background';
    const effectiveTimeoutMs = Math.min(
      Math.max(Number(timeoutMs) || (reqPriority === 'express' ? 4000 : 9500), 3200),
      22_000
    );

    // Zero-Waste Non-Speech Outro Filter: skip music/applause/empty cues BEFORE calling Gemini
    const nonSpeechIds = new Set<string>();
    const speechBatch: EnrichInputLine[] = [];
    for (const l of lines) {
      if (isNonSpeechCueText(l.text)) {
        nonSpeechIds.add(l.id);
      } else {
        speechBatch.push(l);
      }
    }

    if (speechBatch.length === 0) {
      return res.json({
        lines: lines.map((orig) => ({
          id: orig.id,
          index: orig.index,
          start: orig.start,
          duration: orig.duration,
          end: Number((orig.start + orig.duration).toFixed(3)),
          text: '',
          rawText: orig.text,
          translationVi: '',
          tokens: [],
          enriched: true,
        })),
      });
    }

    const batch = speechBatch;
    const contextHeader = formatContextAnchorBlock(contextAnchor, previousContext);

    // =========================================================================
    // STRICT COMPLETION SLA FAST PATH: ZERO-HTML PLAIN TEXT + COMPACT READING MAP
    // Client Web Worker unpacks plainText + readingMap ("箱:はこ|重:おも") / Oxford IPA in <0.5ms!
    // =========================================================================
    if (compactWire) {
      const compactSchema = {
        type: Type.OBJECT,
        properties: {
          rows: {
            type: Type.ARRAY,
            items: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
        },
        required: ['rows'],
      };

      // When source is clean manual Vietnamese (!isAsr), reuse orig.text directly as translationVi
      // to eliminate redundant Vietnamese echoing (-38% output tokens -> ~1.6x faster!).
      const omitViEcho = isViSource && !isAsr;
      const compactInputJson = JSON.stringify(batch.map((l) => [l.id, l.text]));
      const compactPrompt =
        lang === 'ja'
          ? omitViEcho
            ? `${contextHeader}VIDEO: "${videoTitle || 'Video'}" | MỤC TIÊU: 100% TIẾNG NHẬT THUẦN TỰ NHIÊN BẢN XỨ (JLPT ${level}, chuyển ngữ 1:1 từ Tiếng Việt gốc, CẤM gộp/bỏ dòng, CẤM tóm tắt, CẤM lọt chữ Việt).
CẤM TUYỆT ĐỐI thẻ HTML (<ruby>, <rt>, <rp>, <span>...) và CẤM Romaji (như hako, omo)!
ĐỊNH DẠNG SIÊU NÉN — mỗi phần tử trong "rows" là mảng ĐÚNG 3 chuỗi [id, plainJapanese, readingMap]:
- Phần tử 0: giữ nguyên 100% id đầu vào.
- Phần tử 1: câu TIẾNG NHẬT THUẦN (chỉ Kanji/Kana tự nhiên, KHÔNG thẻ HTML, KHÔNG ngoặc phiên âm). Giữ "— " nếu đổi người nói.
- Phần tử 2: bản đồ cách đọc HIRAGANA THUẦN cho các từ Kanji trong câu theo dạng "箱:はこ|重:おも|自分:じぶん" (CHỈ dùng Hiragana, CẤM Romaji; nếu không có Kanji để "").

Trả ĐÚNG ${batch.length} dòng khớp 100% từng id:
${compactInputJson}`
            : `${contextHeader}VIDEO: "${videoTitle || 'Video'}" | MỤC TIÊU: 100% TIẾNG NHẬT THUẦN TỰ NHIÊN BẢN XỨ (JLPT ${level})${isViSource ? ' (CHUYỂN NGỮ 1:1 TỪ TIẾNG VIỆT GỐC, CẤM GỘP/BỎ DÒNG, CẤM TÓM TẮT, CẤM LỌT CHỮ VIỆT)' : ''}${isAsr ? ' (Sửa lỗi ASR đồng âm)' : ''}.
CẤM TUYỆT ĐỐI thẻ HTML (<ruby>, <rt>, <rp>, <span>...) và CẤM Romaji (như hako, omo)!
ĐỊNH DẠNG SIÊU NÉN BẮT BUỘC — mỗi phần tử trong "rows" là mảng ĐÚNG 4 chuỗi [id, plainJapanese, readingMap, translationVi]:
- Phần tử 0: giữ nguyên 100% id đầu vào.
- Phần tử 1: câu TIẾNG NHẬT THUẦN (KHÔNG thẻ HTML, KHÔNG Romaji, KHÔNG ngoặc vuông). Giữ "— " nếu đổi người nói.
- Phần tử 2: bản đồ cách đọc HIRAGANA THUẦN cho các từ Kanji dạng "箱:はこ|重:おも|自分:じぶん" (CHỈ dùng Hiragana; nếu không có Kanji để "").
- Phần tử 3: câu tiếng Việt sạch chuẩn UTF-8 NFC đúng 100% ý lời nói.

Trả ĐÚNG ${batch.length} dòng khớp 100% từng id:
${compactInputJson}`
          : omitViEcho
            ? `${contextHeader}VIDEO: "${videoTitle || 'Video'}" | MỤC TIÊU: 100% TIẾNG ANH TỰ NHIÊN BẢN XỨ (CEFR ${level}, chuyển ngữ 1:1 từ Tiếng Việt gốc, CẤM gộp/bỏ dòng, CẤM tóm tắt, CẤM Vietlish/lọt chữ Việt, CẤM thẻ HTML).
ĐỊNH DẠNG SIÊU NÉN — mỗi phần tử trong "rows" là mảng ĐÚNG 3 chuỗi [id, naturalEnglish, oxfordIpa]:
- Phần tử 0: giữ nguyên 100% id đầu vào.
- Phần tử 1: câu TIẾNG ANH tự nhiên bản xứ chuẩn CEFR ${level}. Giữ "— " nếu đổi người nói.
- Phần tử 2: phiên âm IPA chuẩn Oxford/Cambridge (dùng nối âm ‿ khi tự nhiên), VD: "/lets ˈstʌdi təˈɡeðə təˈdeɪ/".

Trả ĐÚNG ${batch.length} dòng khớp 100% từng id:
${compactInputJson}`
            : `${contextHeader}VIDEO: "${videoTitle || 'Video'}" | MỤC TIÊU: 100% TIẾNG ANH TỰ NHIÊN BẢN XỨ (CEFR ${level})${isViSource ? ' (CHUYỂN NGỮ 1:1 TỪ TIẾNG VIỆT GỐC, CẤM GỘP/BỎ DÒNG, CẤM TÓM TẮT, CẤM VIETLISH, CẤM LỌT CHỮ VIỆT, CẤM THẺ HTML)' : ''}${isAsr ? ' (Sửa lỗi ASR đồng âm)' : ''}.
ĐỊNH DẠNG SIÊU NÉN BẮT BUỘC — mỗi phần tử trong "rows" là mảng ĐÚNG 4 chuỗi [id, naturalEnglish, translationVi, oxfordIpa]:
- Phần tử 0: giữ nguyên 100% id đầu vào.
- Phần tử 1: câu TIẾNG ANH tự nhiên bản xứ chuẩn CEFR ${level} (ưu tiên Phrasal Verbs/Collocations tự nhiên). Giữ nguyên "— " nếu có đổi người nói.
- Phần tử 2: câu tiếng Việt sạch chuẩn UTF-8 NFC đúng 100% ý lời nói.
- Phần tử 3: phiên âm IPA chuẩn Oxford/Cambridge cho câu (dùng dấu nối âm ‿ khi tự nhiên), VD: "/lets ˈstʌdi təˈɡeðə təˈdeɪ/".

Trả ĐÚNG ${batch.length} dòng khớp 100% từng id:
${compactInputJson}`;

      const runCompactCall = async (targetPrompt: string, customTimeoutMs = effectiveTimeoutMs) =>
        generateStructuredJson<{ rows: string[][] }>({
          prompt: targetPrompt,
          systemInstruction:
            lang === 'ja'
              ? omitViEcho
                ? 'Xuất JSON {"rows":[[id,plainJapanese,readingMap],...]} đủ 100% số dòng khớp ID. TUYỆT ĐỐI CẤM thẻ HTML (<ruby>,<rt>...) và CẤM Romaji. readingMap chỉ chứa cặp Kanji:Hiragana thuần phân tách bởi "|".'
                : 'Xuất JSON {"rows":[[id,plainJapanese,readingMap,vi],...]} đủ 100% số dòng khớp ID. TUYỆT ĐỐI CẤM thẻ HTML (<ruby>,<rt>...) và CẤM Romaji. readingMap chỉ chứa cặp Kanji:Hiragana thuần phân tách bởi "|".'
              : omitViEcho
                ? 'Xuất JSON {"rows":[[id,en,ipa],...]} đủ 100% số dòng khớp ID. CẤM lọt chữ Việt, CẤM thẻ HTML. Phiên âm IPA chuẩn Oxford.'
                : 'Xuất JSON {"rows":[[id,en,vi,ipa],...]} đủ 100% số dòng khớp ID. CẤM lọt chữ Việt, CẤM thẻ HTML. Phiên âm IPA chuẩn Oxford.',
          responseSchema: compactSchema,
          thinkingLevel: ThinkingLevel.MINIMAL,
          temperature: 0.1,
          priority: reqPriority,
          timeoutMs: customTimeoutMs,
          compactSystem: true,
        });

      type CompactAccepted = {
        plainText: string;
        readingMap?: string;
        translationVi: string;
        ipaLine?: string;
      };
      const acceptedMap = new Map<string, CompactAccepted>();
      const batchById = new Map(batch.map((b) => [b.id, b]));

      const acceptCompactRows = (rows: string[][] | undefined) => {
        for (const row of rows || []) {
          if (!Array.isArray(row) || row.length < 2) continue;
          const id = String(row[0] || '').trim();
          const orig = batchById.get(id);
          if (!orig) continue;
          const rawTarget = String(row[1] || '').trim();
          if (!rawTarget) continue;
          const plainText = stripHtmlAndRubyArtifactsServer(rawTarget);
          const pure = isPureTargetLanguage(
            plainText,
            lang,
            isViSource ? orig.text : undefined
          );
          if (!pure) continue;

          if (lang === 'ja') {
            const rawReadingMap = row[2] ? String(row[2]).trim() : '';
            const safeReadingMap = sanitizeCompactReadingMapServer(rawReadingMap, rawTarget);
            const viText = omitViEcho
              ? orig.text
              : String(row[3] || (isViSource ? orig.text : '')).trim();
            acceptedMap.set(id, {
              plainText,
              readingMap: safeReadingMap,
              translationVi: viText,
            });
          } else {
            const viText = omitViEcho
              ? orig.text
              : String(row[2] || (isViSource ? orig.text : '')).trim();
            const ipaRaw = omitViEcho ? row[2] : row[3];
            const ipaVal = ipaRaw ? stripHtmlAndRubyArtifactsServer(String(ipaRaw)) : undefined;
            acceptedMap.set(id, {
              plainText,
              translationVi: viText,
              ipaLine: ipaVal,
            });
          }
        }
      };

      const callStartMs = Date.now();
      const compactResult = await runCompactCall(compactPrompt);
      acceptCompactRows(compactResult.rows);

      // Compact Purity Rescue Pass ONLY when remaining time budget permits (<65% elapsed)
      const dirtyCompact = batch.filter((orig) => !acceptedMap.has(orig.id));
      const elapsedSoFar = Date.now() - callStartMs;
      if (dirtyCompact.length > 0 && dirtyCompact.length <= 12 && elapsedSoFar < effectiveTimeoutMs * 0.65) {
        const rescueBudgetMs = Math.max(3500, effectiveTimeoutMs - elapsedSoFar);
        const rescueCompactPrompt =
          lang === 'ja'
            ? `DỊCH KHẨN CẤP SANG 100% TIẾNG NHẬT THUẦN (JLPT ${level}) — CẤM LỌT TIẾNG VIỆT, CẤM THẺ HTML, CẤM ROMAJI! Trả {"rows":[${omitViEcho ? '[id,"plainJapanese","漢字:ひらがな|..."]' : '[id,"plainJapanese","漢字:ひらがな|...","tiếng Việt"]'},...]} đủ ${dirtyCompact.length} id:\n${JSON.stringify(dirtyCompact.map((l) => [l.id, l.text]))}`
            : `DỊCH KHẨN CẤP SANG 100% TIẾNG ANH BẢN XỨ (CEFR ${level}) — CẤM LỌT TIẾNG VIỆT, CẤM THẺ HTML! Trả {"rows":[${omitViEcho ? '[id,"English","/IPA/"]' : '[id,"English","tiếng Việt","/IPA/"]'},...]} đủ ${dirtyCompact.length} id:\n${JSON.stringify(dirtyCompact.map((l) => [l.id, l.text]))}`;
        try {
          const rescueRes = await runCompactCall(rescueCompactPrompt, rescueBudgetMs);
          acceptCompactRows(rescueRes.rows);
        } catch (rescueErr) {
          console.warn(
            '[KotoZen Compact Purity Rescue]',
            rescueErr instanceof Error ? rescueErr.message : rescueErr
          );
        }
      }

      const compactEnriched = lines.map((orig) => {
        if (nonSpeechIds.has(orig.id)) {
          return {
            id: orig.id,
            index: orig.index,
            start: orig.start,
            duration: orig.duration,
            end: Number((orig.start + orig.duration).toFixed(3)),
            text: '',
            rawText: orig.text,
            translationVi: '',
            tokens: [],
            enriched: true,
          };
        }
        const found = acceptedMap.get(orig.id);
        if (!found) {
          return {
            id: orig.id,
            index: orig.index,
            start: orig.start,
            duration: orig.duration,
            end: Number((orig.start + orig.duration).toFixed(3)),
            text: isViSource ? '' : orig.text,
            rawText: isViSource || isAsr ? orig.text : undefined,
            translationVi: isViSource ? orig.text : '',
            tokens: [],
            enriched: false,
          };
        }
        return {
          id: orig.id,
          index: orig.index,
          start: orig.start,
          duration: orig.duration,
          end: Number((orig.start + orig.duration).toFixed(3)),
          text: found.plainText,
          readingMap: found.readingMap,
          rawText: isViSource || isAsr ? orig.text : undefined,
          translationVi: found.translationVi || (isViSource ? orig.text : ''),
          ipaLine: found.ipaLine,
          connectedSpeech: [],
          tokens: [],
          enriched: true,
        };
      });

      return res.json({ lines: compactEnriched });
    }

    let prompt = '';
    if (srcLang === 'vi') {
      prompt =
        lang === 'ja'
          ? `${contextHeader}VIDEO GỐC 100% TIẾNG VIỆT: "${videoTitle || 'Vietnamese Video'}"
MỤC TIÊU CHUYỂN NGỮ ĐẢO CHIỀU: TIẾNG VIỆT GỐC ➔ TIẾNG NHẬT CHUẨN HỌC THUẬT (Trình độ mục tiêu: JLPT ${level})
Trạng thái nguồn tiếng Việt: ${isAsr ? 'AUTO-ASR TIẾNG VIỆT (Sửa lỗi nghe nhầm đồng âm theo phát âm tiếng Việt + ngữ cảnh, TUYỆT ĐỐI không viết lại cấu trúc làm sai lời nhân vật)' : 'Phụ đề tiếng Việt gốc'}

KỶ LUẬT THÉP ÁNH XẠ CỨNG 1:1 (output.length === ${batch.length}, input.id === output.id):
- CẤM gộp 2 dòng thành 1, CẤM bỏ qua bất kỳ id nào, CẤM dịch chuyển ý của id trước sang id sau.
- TRUNG THÀNH TUYỆT ĐỐI 100% LỜI NÓI THẬT: giữ trọn mọi mệnh đề, số liệu, tên riêng, cảm thán, sắc thái khẳng định/phủ định/nghi vấn — CẤM tóm tắt, CẤM cắt xén, CẤM bịa thêm ý ngoài lời nhân vật.
- NẾU dòng bắt đầu bằng "— " (đổi người nói), GIỮ NGUYÊN "— " ở đầu dòng dịch để tách bạch lượt nói.

XỬ LÝ TỪNG DÒNG (siêu gọn, chính xác 100%):
1. translationVi: Câu TIẾNG VIỆT GỐC làm sạch chuẩn UTF-8 NFC (khôi phục dấu câu, giữ đúng 100% lời nhân vật).
2. text: Chuyển ngữ trọn vẹn sang TIẾNG NHẬT TỰ NHIÊN BẢN XỨ trình độ JLPT ${level}, tuân thủ tuyệt đối tông văn phong & thuật ngữ trong Hồ sơ Ngữ cảnh. CẤM dịch word-by-word.
3. tokens: Tách từng hình vị/từ/cụm động từ: surface, lemma, level (N5-N1), furigana (CHỈ điền khi có Kanji, khớp 100% ngữ cảnh câu), pitchDownstep (0..n chuẩn NHK), ruby (CHỈ điền mảng {base, reading?} khi có Kanji), isPunctuation (CHỈ điền true nếu là dấu câu).

Danh sách ${batch.length} dòng tiếng Việt đầu vào (BẮT BUỘC trả đủ đúng ${batch.length} id):
${JSON.stringify(batch.map((l) => ({ id: l.id, text: l.text })))}`
          : `${contextHeader}VIDEO GỐC 100% TIẾNG VIỆT: "${videoTitle || 'Vietnamese Video'}"
MỤC TIÊU CHUYỂN NGỮ ĐẢO CHIỀU: TIẾNG VIỆT GỐC ➔ TIẾNG ANH CHUẨN BẢN XỨ (Trình độ mục tiêu: CEFR ${level})
Trạng thái nguồn tiếng Việt: ${isAsr ? 'AUTO-ASR TIẾNG VIỆT (Sửa lỗi nghe nhầm đồng âm theo phát âm tiếng Việt + ngữ cảnh, TUYỆT ĐỐI không viết lại cấu trúc làm sai lời nhân vật)' : 'Phụ đề tiếng Việt gốc'}

KỶ LUẬT THÉP ÁNH XẠ CỨNG 1:1 (output.length === ${batch.length}, input.id === output.id):
- CẤM gộp 2 dòng thành 1, CẤM bỏ qua bất kỳ id nào, CẤM dịch chuyển ý của id trước sang id sau.
- TRUNG THÀNH TUYỆT ĐỐI 100% LỜI NÓI THẬT: giữ trọn mọi mệnh đề, số liệu, tên riêng, cảm thán, sắc thái khẳng định/phủ định/nghi vấn — CẤM tóm tắt, CẤM cắt xén, CẤM bịa thêm ý ngoài lời nhân vật.
- NẾU dòng bắt đầu bằng "— " (đổi người nói), GIỮ NGUYÊN "— " ở đầu dòng dịch để tách bạch lượt nói.

XỬ LÝ TỪNG DÒNG (siêu gọn, chính xác 100%):
1. translationVi: Câu TIẾNG VIỆT GỐC làm sạch chuẩn UTF-8 NFC (khôi phục dấu câu, giữ đúng 100% lời nhân vật).
2. text: Chuyển ngữ trọn vẹn sang TIẾNG ANH TỰ NHIÊN BẢN XỨ chuẩn CEFR ${level}, tuân thủ tuyệt đối tông văn phong & thuật ngữ trong Hồ sơ Ngữ cảnh. CẤM Vietlish / dịch từng chữ.
3. ipaLine: Phiên âm IPA chuẩn Oxford/Cambridge khớp 100% từ loại ngữ cảnh, kèm ký hiệu nối âm ‿.
4. tokens: Tách từ thông minh — gom Phrasal Verbs, Idioms, Collocations thành 1 token (isMultiWord=true, phraseType). Bỏ qua các cờ boolean=false để siêu nhanh; điền surface, lemma, level (A1-C2), ipa (từ nội dung).

Danh sách ${batch.length} dòng tiếng Việt đầu vào (BẮT BUỘC trả đủ đúng ${batch.length} id):
${JSON.stringify(batch.map((l) => ({ id: l.id, text: l.text })))}`;
    } else {
      prompt =
        lang === 'ja'
          ? `Video: "${videoTitle || 'Japanese Video'}"
Chế độ nguồn: ${isAsr ? 'AUTO-ASR (CẦN KHÔI PHỤC DẤU CÂU, SỬA LỖI CHỮ HÁN / TỪ ĐỒNG ÂM THEO NGỮ CẢNH TOÀN ĐOẠN, GIỮ NGUYÊN SỐ DÒNG & ID)' : 'PHỤ ĐỀ CHÍNH THỨC (GIỮ NGUYÊN NỘI DUNG CHUẨN)'}

Hãy xử lý từng dòng phụ đề tiếng Nhật dưới đây:
1. text: câu tiếng Nhật chuẩn (nếu là Auto-ASR, khôi phục dấu câu 。、 và sửa lỗi nhận diện chữ Hán sai theo ngữ cảnh, tuyệt đối không bịa thêm câu ngoài video).
2. translationVi: dịch tiếng Việt tự nhiên, sát ngữ cảnh giao tiếp thực tế của đoạn hội thoại.
3. tokens: tách chính xác từng hình vị / từ vựng / cụm động từ chia thể hoặc cụm cố định (KHÔNG dính liền thành chuỗi dài khó bấm).
   - Với mỗi token: surface (văn bản thuần, CẤM thẻ HTML), lemma (dạng từ điển), isPunctuation (true nếu là dấu câu), level (N5|N4|N3|N2|N1), furigana (100% HIRAGANA THUẦN chuẩn ngữ cảnh câu, CẤM Romaji), pitchDownstep (số nguyên 0..n chuẩn Tokyo NHK), và ruby (mảng {base, reading?} — chỉ điền reading bằng Hiragana thuần khi base có Kanji).

Danh sách dòng đầu vào:
${JSON.stringify(batch.map((l) => ({ id: l.id, text: l.text })))}`
          : `Video: "${videoTitle || 'English Video'}"
Chế độ nguồn: ${isAsr ? 'AUTO-ASR (CẦN KHÔI PHỤC DẤU CÂU, VIẾT HOA CHUẨN, SỬA LỖI NGHE NHẦM THEO NGỮ CẢNH TOÀN ĐOẠN, GIỮ NGUYÊN SỐ DÒNG & ID)' : 'PHỤ ĐỀ CHÍNH THỨC (GIỮ NGUYÊN NỘI DUNG CHUẨN)'}

Hãy xử lý từng dòng phụ đề tiếng Anh dưới đây:
1. text: câu tiếng Anh chuẩn (nếu Auto-ASR thì khôi phục dấu câu/ngắt ý chính xác mà KHÔNG thêm nội dung bịa đặt).
2. translationVi: dịch tiếng Việt tự nhiên sát ngữ cảnh thực tế (tuyệt đối không dịch nghĩa đen sai lệch cho Phrasal Verbs và Idioms).
3. ipaLine: phiên âm IPA chuẩn Oxford/Cambridge cho cả câu (dùng ký hiệu nối âm ‿ ở chỗ nối âm tự nhiên).
4. connectedSpeech: danh sách các điểm nối âm (linking), nuốt âm (elision), âm yếu (weak_form) nổi bật trong câu (nếu có).
5. tokens: tách từ thông minh — ĐẶC BIỆT GOM CỤM các Phrasal Verbs (vd "give up", "figure out"), Idioms và Collocations thành 1 token duy nhất (isMultiWord=true, phraseType='phrasal_verb'|'idiom'|'collocation').
   - Với mỗi token: surface, lemma, isPunctuation, isMultiWord, phraseType, level (A1|A2|B1|B2|C1|C2), isIeltsAcademic (boolean), ipa (IPA từ đơn/cụm từ), linkedToNext (true nếu nối âm với token ngay sau), weakForm (true nếu đọc âm yếu).

Danh sách dòng đầu vào:
${JSON.stringify(batch.map((l) => ({ id: l.id, text: l.text })))}`;
    }

    const tokenSchema =
      lang === 'ja'
        ? {
            type: Type.OBJECT,
            properties: {
              surface: { type: Type.STRING },
              lemma: { type: Type.STRING },
              isPunctuation: { type: Type.BOOLEAN },
              level: { type: Type.STRING, enum: ['N5', 'N4', 'N3', 'N2', 'N1'] },
              furigana: { type: Type.STRING },
              pitchDownstep: { type: Type.INTEGER },
              ruby: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    base: { type: Type.STRING },
                    reading: { type: Type.STRING },
                  },
                  required: ['base'],
                },
              },
            },
            required: ['surface', 'lemma'],
          }
        : {
            type: Type.OBJECT,
            properties: {
              surface: { type: Type.STRING },
              lemma: { type: Type.STRING },
              isPunctuation: { type: Type.BOOLEAN },
              isMultiWord: { type: Type.BOOLEAN },
              phraseType: {
                type: Type.STRING,
                enum: ['word', 'phrasal_verb', 'idiom', 'collocation', 'grammar'],
              },
              level: { type: Type.STRING, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
              isIeltsAcademic: { type: Type.BOOLEAN },
              ipa: { type: Type.STRING },
              linkedToNext: { type: Type.BOOLEAN },
              weakForm: { type: Type.BOOLEAN },
            },
            required: ['surface', 'lemma'],
          };

    const lineProps: Record<string, unknown> = {
      id: { type: Type.STRING },
      text: { type: Type.STRING },
      translationVi: { type: Type.STRING },
      tokens: {
        type: Type.ARRAY,
        items: tokenSchema,
      },
    };

    if (lang === 'en') {
      lineProps.ipaLine = { type: Type.STRING };
      lineProps.connectedSpeech = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            phrase: { type: Type.STRING },
            type: {
              type: Type.STRING,
              enum: ['linking', 'elision', 'weak_form', 'assimilation'],
            },
            notation: { type: Type.STRING },
            explanation: { type: Type.STRING },
          },
          required: ['phrase', 'type', 'notation', 'explanation'],
        },
      };
    }

    const schema = {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: lineProps,
            required: ['id', 'text', 'translationVi', 'tokens'],
          },
        },
      },
      required: ['items'],
    };

    type EnrichedApiItem = {
      id: string;
      text: string;
      translationVi: string;
      ipaLine?: string;
      connectedSpeech?: Array<{
        phrase: string;
        type: 'linking' | 'elision' | 'weak_form' | 'assimilation';
        notation: string;
        explanation: string;
      }>;
      tokens: Array<Record<string, unknown>>;
    };

    const runEnrichCall = async (targetPrompt: string) =>
      generateStructuredJson<{ items: EnrichedApiItem[] }>({
        prompt: targetPrompt,
        systemInstruction:
          isViSource
            ? `BẠN PHẢI CHUYỂN NGỮ 100% TẤT CẢ CÁC DÒNG SANG ${
                lang === 'ja'
                  ? 'TIẾNG NHẬT THUẦN (CÓ KANJI + FURIGANA HIRAGANA THUẦN, TUYỆT ĐỐI CẤM THẺ HTML VÀ CẤM ROMAJI)'
                  : 'TIẾNG ANH TỰ NHIÊN BẢN XỨ (CÓ IPA & COLLOCATIONS, CẤM THẺ HTML)'
              }. TUYỆT ĐỐI CẤM ĐỂ LỌT CHỮ TIẾNG VIỆT VÀO TRƯỜNG "text" HAY "tokens". Trả về đủ 100% số dòng khớp ID đầu vào.`
            : 'Thực hiện chuẩn hóa phụ đề (CẤM thẻ HTML & CẤM Romaji), tách từ chính xác 100%, phiên âm chuẩn ngữ cảnh và dịch nghĩa tiếng Việt tự nhiên. Trả về đúng số lượng phần tử khớp ID đầu vào.',
        responseSchema: schema,
        thinkingLevel: ThinkingLevel.MINIMAL,
        temperature: 0.1,
        priority: reqPriority,
        timeoutMs: effectiveTimeoutMs,
        compactSystem: true,
      });

    const result = await runEnrichCall(prompt);
    const itemMap = new Map<string, EnrichedApiItem>();

    const acceptValidItems = (items: EnrichedApiItem[] | undefined) => {
      for (const it of items || []) {
        const orig = batch.find((b) => b.id === it.id);
        if (!orig) continue;
        const candidateText = String(it.text || '').trim();
        const isPure = isPureTargetLanguage(
          candidateText,
          lang,
          isViSource ? orig.text : undefined
        );
        if (isPure && Array.isArray(it.tokens) && it.tokens.length > 0) {
          itemMap.set(it.id, it);
        }
      }
    };

    acceptValidItems(result.items);

    // Mandatory Purity Rescue Pass: automatically re-translate any line that leaked Vietnamese or came back empty
    const dirtyLines = batch.filter((orig) => !itemMap.has(orig.id));
    if (dirtyLines.length > 0) {
      const rescuePrompt =
        lang === 'ja'
          ? `CHUYỂN NGỮ KHẨN CẤP SANG 100% TIẾNG NHẬT (trình độ JLPT ${level}) — TUYỆT ĐỐI KHÔNG ĐỂ SÓT BẤT KỲ CHỮ TIẾNG VIỆT CÓ DẤU NÀO TRONG "text" HOẶC "tokens"!
Mỗi dòng BẮT BUỘC có chữ Nhật (Hiragana/Katakana/Kanji) kèm tokens (surface, lemma, furigana, ruby, level, pitchDownstep) và translationVi giữ đúng nghĩa tiếng Việt gốc.
Danh sách các dòng cần dịch lại hoàn toàn sang Tiếng Nhật:
${JSON.stringify(dirtyLines.map((l) => ({ id: l.id, text: l.text })))}`
          : `CHUYỂN NGỮ KHẨN CẤP SANG 100% TIẾNG ANH TỰ NHIÊN BẢN XỨ (trình độ CEFR ${level}) — TUYỆT ĐỐI KHÔNG ĐỂ SÓT BẤT KỲ CHỮ TIẾNG VIỆT NÀO TRONG "text" HOẶC "tokens"!
Mỗi dòng BẮT BUỘC là câu Tiếng Anh tự nhiên chuẩn Oxford/Cambridge kèm ipaLine, tokens (surface, lemma, ipa, level, isMultiWord, phraseType) và translationVi giữ đúng nghĩa tiếng Việt gốc.
Danh sách các dòng cần dịch lại hoàn toàn sang Tiếng Anh:
${JSON.stringify(dirtyLines.map((l) => ({ id: l.id, text: l.text })))}`;

      try {
        const rescueResult = await runEnrichCall(rescuePrompt);
        acceptValidItems(rescueResult.items);
      } catch (rescueErr) {
        console.warn('[KotoZen Purity Rescue]', rescueErr instanceof Error ? rescueErr.message : rescueErr);
      }
    }

    const enriched = lines.map((orig) => {
      if (nonSpeechIds.has(orig.id)) {
        return {
          id: orig.id,
          index: orig.index,
          start: orig.start,
          duration: orig.duration,
          end: Number((orig.start + orig.duration).toFixed(3)),
          text: '',
          rawText: orig.text,
          translationVi: '',
          tokens: [],
          enriched: true,
        };
      }
      const found = itemMap.get(orig.id);
      if (!found) {
        // Strict Target-Language Gate: NEVER return raw Vietnamese inside `text` for Vietnamese source videos!
        return {
          id: orig.id,
          index: orig.index,
          start: orig.start,
          duration: orig.duration,
          end: Number((orig.start + orig.duration).toFixed(3)),
          text: isViSource ? '' : orig.text,
          rawText: isViSource || isAsr ? orig.text : undefined,
          translationVi: isViSource ? orig.text : '',
          tokens: isViSource
            ? []
            : [{ id: `${orig.id}_t0`, surface: orig.text, lemma: orig.text }],
          enriched: false,
        };
      }
      const cleanFoundText = stripHtmlAndRubyArtifactsServer(found.text);
      const tokensWithIds = (found.tokens || [])
        .map((tk, idx) => {
          const cleanSurface = stripHtmlAndRubyArtifactsServer(String(tk.surface || ''));
          if (!cleanSurface) return null;
          const cleanLemma =
            stripHtmlAndRubyArtifactsServer(String(tk.lemma || cleanSurface)) || cleanSurface;
          if (lang === 'ja') {
            const rawRuby = Array.isArray(tk.ruby)
              ? (tk.ruby as Array<{ base?: string; reading?: string }>)
                  .map((seg) => ({
                    base: stripHtmlAndRubyArtifactsServer(String(seg?.base || '')),
                    reading: sanitizeHiraganaReadingServer(seg?.reading),
                  }))
                  .filter((seg) => seg.base.length > 0)
              : undefined;
            return {
              ...tk,
              id: `${orig.id}_t${idx}`,
              surface: cleanSurface,
              lemma: cleanLemma,
              furigana: sanitizeHiraganaReadingServer(
                typeof tk.furigana === 'string' ? tk.furigana : undefined
              ),
              ruby: rawRuby && rawRuby.some((s) => s.reading) ? rawRuby : undefined,
            };
          }
          return {
            ...tk,
            id: `${orig.id}_t${idx}`,
            surface: cleanSurface,
            lemma: cleanLemma,
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);
      return {
        id: orig.id,
        index: orig.index,
        start: orig.start,
        duration: orig.duration,
        end: Number((orig.start + orig.duration).toFixed(3)),
        text: cleanFoundText,
        rawText: isViSource || isAsr ? orig.text : undefined,
        translationVi: found.translationVi || (isViSource ? orig.text : ''),
        ipaLine: found.ipaLine ? stripHtmlAndRubyArtifactsServer(found.ipaLine) : undefined,
        connectedSpeech: found.connectedSpeech || [],
        tokens: tokensWithIds,
        enriched: true,
      };
    });

    return res.json({ lines: enriched });
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const isDailyQuota = isDailyQuotaError(err);
    const status = rateLimited ? 429 : 500;
    const message = toFriendlyErrorMessage(
      err,
      'Hệ thống đang tạm bận chuyển ngữ lô phụ đề này. Đang tự động thử lại...'
    );
    return res.status(status).json({
      error: message,
      quotaExhausted: rateLimited,
      isDailyQuota,
    });
  }
});

// ---------------------------------------------------------------------------
// 2b. POST /api/subtitles/enrich-stream — Sub-Second NDJSON Micro-Batch Streaming
// ---------------------------------------------------------------------------
app.post('/api/subtitles/enrich-stream', async (req, res) => {
  const {
    lines,
    language,
    sourceLanguage,
    targetLevel,
    isAsr,
    videoTitle,
    contextAnchor,
    previousContext,
    priority,
    timeoutMs,
    compactWire,
  } = req.body as {
    lines?: EnrichInputLine[];
    language?: 'en' | 'ja';
    sourceLanguage?: 'vi' | 'en' | 'ja';
    targetLevel?: string;
    isAsr?: boolean;
    videoTitle?: string;
    contextAnchor?: ContextAnchorPayload;
    previousContext?: PreviousContextPair[];
    priority?: 'express' | 'background';
    timeoutMs?: number;
    compactWire?: boolean;
  };

  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'Danh sách dòng phụ đề không hợp lệ.' });
  }

  const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
  const srcLang: 'vi' | 'en' | 'ja' =
    sourceLanguage === 'vi' || sourceLanguage === 'ja' || sourceLanguage === 'en'
      ? sourceLanguage
      : lang;
  const level = targetLevel || (lang === 'ja' ? 'N3' : 'B2');
  const isViSource = srcLang === 'vi';
  // Express Slot streams up to 16 lines cue-by-cue (<1.0s first line with compactWire!)
  const sliced = lines.slice(0, 16);
  const nonSpeechImmediate = sliced.filter((l) => isNonSpeechCueText(l.text));
  const batch = sliced.filter((l) => !isNonSpeechCueText(l.text));
  const contextHeader = formatContextAnchorBlock(contextAnchor, previousContext);
  const reqPriority: 'express' | 'background' = priority === 'background' ? 'background' : 'express';
  const firstChunkTimeoutMs = Math.min(Math.max(Number(timeoutMs) || 4000, 3500), 10_000);

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const streamAbort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      streamAbort.abort();
    }
  });

  const byId = new Map(batch.map((b) => [b.id, b]));
  const emittedIds = new Set<string>();

  const omitViEchoStream = isViSource && !isAsr;
  const formatPrompt = compactWire
    ? lang === 'ja'
      ? omitViEchoStream
        ? `${contextHeader}XUẤT NDJSON SIÊU GỌN (1 OBJECT/HÀNG, KHÔNG MARKDOWN \`\`\`, KHÔNG MẢNG BỌC NGOÀI).
Video: "${videoTitle || 'Video'}" | Mục tiêu: 100% TIẾNG NHẬT THUẦN TỰ NHIÊN (JLPT ${level}, chuyển ngữ 1:1 từ Tiếng Việt gốc, CẤM tóm tắt, CẤM gộp dòng, CẤM lọt chữ Việt).
CẤM TUYỆT ĐỐI thẻ HTML (<ruby>, <rt>, <rp>, <span>...) và CẤM Romaji!
Mỗi dòng đúng mẫu 3 khóa: {"i":"id","t":"この箱、すごく重くて運べないんだ。","r":"箱:はこ|重:おも|運:はこ"}
- "t": câu Tiếng Nhật THUẦN (KHÔNG thẻ HTML, KHÔNG ngoặc vuông).
- "r": bản đồ HIRAGANA THUẦN cho Kanji dạng "漢字:ひらがな|..." (CHỈ dùng Hiragana, CẤM Romaji; nếu không có Kanji để "").
BẮT BUỘC xuất đủ ${batch.length} dòng đúng thứ tự:
${batch.map((l) => JSON.stringify({ i: l.id, s: l.text })).join('\n')}`
        : `${contextHeader}XUẤT NDJSON SIÊU GỌN (1 OBJECT/HÀNG, KHÔNG MARKDOWN \`\`\`, KHÔNG MẢNG BỌC NGOÀI).
Video: "${videoTitle || 'Video'}" | Mục tiêu: 100% TIẾNG NHẬT THUẦN TỰ NHIÊN (JLPT ${level})${isViSource ? ' (CHUYỂN NGỮ 1:1 TỪ TIẾNG VIỆT GỐC, CẤM TÓM TẮT, CẤM GỘP DÒNG, CẤM LỌT TIẾNG VIỆT)' : ''}${isAsr ? ' (Sửa lỗi ASR)' : ''}.
CẤM TUYỆT ĐỐI thẻ HTML (<ruby>, <rt>, <rp>, <span>...) và CẤM Romaji!
Mỗi dòng đúng mẫu 4 khóa: {"i":"id","t":"この箱、すごく重くて運べないんだ。","r":"箱:はこ|重:おも|運:はこ","v":"nghĩa tiếng Việt sạch"}
- "t": câu Tiếng Nhật THUẦN (KHÔNG thẻ HTML, KHÔNG ngoặc vuông).
- "r": bản đồ HIRAGANA THUẦN cho Kanji dạng "漢字:ひらがな|..." (CHỈ dùng Hiragana, CẤM Romaji).
BẮT BUỘC xuất đủ ${batch.length} dòng đúng thứ tự:
${batch.map((l) => JSON.stringify({ i: l.id, s: l.text })).join('\n')}`
      : omitViEchoStream
        ? `${contextHeader}XUẤT NDJSON SIÊU GỌN (1 OBJECT/HÀNG, KHÔNG MARKDOWN \`\`\`, KHÔNG MẢNG BỌC NGOÀI).
Video: "${videoTitle || 'Video'}" | Mục tiêu: 100% TIẾNG ANH TỰ NHIÊN BẢN XỨ (CEFR ${level}, chuyển ngữ 1:1 từ Tiếng Việt gốc, CẤM tóm tắt, CẤM gộp dòng, CẤM Vietlish/lọt chữ Việt, CẤM thẻ HTML).
Mỗi dòng đúng mẫu 3 khóa: {"i":"id","t":"natural English sentence","p":"/Oxford IPA with ‿/"}
BẮT BUỘC xuất đủ ${batch.length} dòng đúng thứ tự:
${batch.map((l) => JSON.stringify({ i: l.id, s: l.text })).join('\n')}`
        : `${contextHeader}XUẤT NDJSON SIÊU GỌN (1 OBJECT/HÀNG, KHÔNG MARKDOWN \`\`\`, KHÔNG MẢNG BỌC NGOÀI).
Video: "${videoTitle || 'Video'}" | Mục tiêu: 100% TIẾNG ANH TỰ NHIÊN BẢN XỨ (CEFR ${level})${isViSource ? ' (CHUYỂN NGỮ 1:1 TỪ TIẾNG VIỆT GỐC, CẤM TÓM TẮT, CẤM GỘP DÒNG, CẤM VIETLISH, CẤM LỌT TIẾNG VIỆT, CẤM THẺ HTML)' : ''}${isAsr ? ' (Sửa lỗi ASR)' : ''}.
Mỗi dòng đúng mẫu 4 khóa: {"i":"id","t":"natural English sentence","v":"nghĩa tiếng Việt sạch","p":"/Oxford IPA with ‿/"}
BẮT BUỘC xuất đủ ${batch.length} dòng đúng thứ tự:
${batch.map((l) => JSON.stringify({ i: l.id, s: l.text })).join('\n')}`
    : lang === 'ja'
      ? `${contextHeader}XUẤT ĐÚNG ĐỊNH DẠNG NDJSON (MỖI DÒNG LÀ ĐÚNG 1 OBJECT JSON HỢP LỆ TRÊN 1 HÀNG DUY NHẤT, KHÔNG MARKDOWN \`\`\`, KHÔNG MẢNG BỌC NGOÀI).
Video: "${videoTitle || 'Video'}" | Mục tiêu: 100% TIẾNG NHẬT THUẦN TỰ NHIÊN (JLPT ${level})${isViSource ? ' (CHUYỂN NGỮ ĐẦY ĐỦ 1:1 TỪ TIẾNG VIỆT GỐC, CẤM TÓM TẮT, CẤM GỘP DÒNG, CẤM LỌT TIẾNG VIỆT)' : ''}${isAsr ? ' (Sửa lỗi ASR đồng âm)' : ''}.
CẤM TUYỆT ĐỐI thẻ HTML và Romaji! SIÊU GỌN: chỉ điền "furigana" & "ruby" bằng Hiragana thuần trên token có Kanji. BẮT BUỘC xuất đủ đúng ${batch.length} dòng khớp 100% từng id:
{"id":"...","text":"câu tiếng Nhật thuần","translationVi":"nghĩa tiếng Việt","tokens":[{"surface":"...","lemma":"...","level":"N3","furigana":"ひらがな","pitchDownstep":0,"ruby":[{"base":"...","reading":"ひらがな"}]}]}

Danh sách ${batch.length} dòng đầu vào (xử lý đúng thứ tự từng id):
${batch.map((l) => JSON.stringify({ id: l.id, text: l.text })).join('\n')}`
      : `${contextHeader}XUẤT ĐÚNG ĐỊNH DẠNG NDJSON (MỖI DÒNG LÀ ĐÚNG 1 OBJECT JSON HỢP LỆ TRÊN 1 HÀNG DUY NHẤT, KHÔNG MARKDOWN \`\`\`, KHÔNG MẢNG BỌC NGOÀI).
Video: "${videoTitle || 'Video'}" | Mục tiêu: 100% TIẾNG ANH TỰ NHIÊN BẢN XỨ (CEFR ${level})${isViSource ? ' (CHUYỂN NGỮ ĐẦY ĐỦ 1:1 TỪ TIẾNG VIỆT GỐC, CẤM TÓM TẮT, CẤM GỘP DÒNG, CẤM LỌT TIẾNG VIỆT, CẤM VIETLISH, CẤM THẺ HTML)' : ''}${isAsr ? ' (Sửa lỗi ASR đồng âm)' : ''}.
SIÊU GỌN: bỏ qua cờ boolean=false, chỉ điền isMultiWord/phraseType cho cụm từ. BẮT BUỘC xuất đủ đúng ${batch.length} dòng khớp 100% từng id:
{"id":"...","text":"natural English sentence","translationVi":"nghĩa tiếng Việt","ipaLine":"Oxford IPA with ‿","tokens":[{"surface":"...","lemma":"...","level":"B2","ipa":"..."}]}

Danh sách ${batch.length} dòng đầu vào (xử lý đúng thứ tự từng id):
${batch.map((l) => JSON.stringify({ id: l.id, text: l.text })).join('\n')}`;

  const writeNdjson = (payload: Record<string, unknown>) => {
    if (!res.writableEnded && !streamAbort.signal.aborted) {
      res.write(`${JSON.stringify(deepNormalizeUtf8(payload))}\n`);
    }
  };

  try {
    // Emit non-speech outro filler cues immediately in 0ms without spending a Gemini call
    for (const orig of nonSpeechImmediate) {
      emittedIds.add(orig.id);
      writeNdjson({
        type: 'line',
        line: {
          id: orig.id,
          index: orig.index,
          start: orig.start,
          duration: orig.duration,
          end: Number((orig.start + orig.duration).toFixed(3)),
          text: '',
          rawText: orig.text,
          translationVi: '',
          tokens: [],
          enriched: true,
        },
      });
    }

    if (batch.length === 0) {
      writeNdjson({ type: 'done', emittedCount: emittedIds.size });
      if (!res.writableEnded) res.end();
      return;
    }

    await streamNdjsonLines<{
      id?: string;
      i?: string;
      text?: string;
      t?: string;
      r?: string;
      readingMap?: string;
      translationVi?: string;
      v?: string;
      ipaLine?: string;
      p?: string;
      tokens?: Array<Record<string, unknown>>;
    }>({
      prompt: formatPrompt,
      systemInstruction: compactWire
        ? lang === 'ja'
          ? omitViEchoStream
            ? `BẮT BUỘC xuất ĐỦ TẤT CẢ ${batch.length} dòng NDJSON khớp từng id đầu vào (1 object {"i","t","r"} mỗi hàng, không dừng sớm, không giải thích, không markdown). "t" là Tiếng Nhật THUẦN (CẤM thẻ HTML, CẤM Romaji), "r" là "漢字:ひらがな|..." CHỈ dùng Hiragana thuần.`
            : `BẮT BUỘC xuất ĐỦ TẤT CẢ ${batch.length} dòng NDJSON khớp từng id đầu vào (1 object {"i","t","r","v"} mỗi hàng, không dừng sớm, không giải thích, không markdown). "t" là Tiếng Nhật THUẦN (CẤM thẻ HTML, CẤM Romaji), "r" là "漢字:ひらがな|..." CHỈ dùng Hiragana thuần.`
          : omitViEchoStream
            ? `BẮT BUỘC xuất ĐỦ TẤT CẢ ${batch.length} dòng NDJSON khớp từng id đầu vào (1 object {"i","t","p"} mỗi hàng, không dừng sớm, không giải thích, không markdown). 100% "t" là Tiếng Anh bản xứ (CẤM HTML), "p" là IPA Oxford, CẤM lọt chữ Việt.`
            : `BẮT BUỘC xuất ĐỦ TẤT CẢ ${batch.length} dòng NDJSON khớp từng id đầu vào (1 object {"i","t","v","p"} mỗi hàng, không dừng sớm, không giải thích, không markdown). 100% "t" là Tiếng Anh bản xứ (CẤM HTML), "p" là IPA Oxford, CẤM lọt chữ Việt.`
        : isViSource
          ? `Stream ngay từng dòng JSON thuần túy (1 object/hàng, không giải thích). 100% trường "text" và "tokens" PHẢI là ${
              lang === 'ja'
                ? 'Tiếng Nhật thuần kèm Furigana Hiragana thuần (CẤM thẻ HTML & Romaji)'
                : 'Tiếng Anh bản xứ chuẩn Oxford IPA (CẤM thẻ HTML)'
            }, TUYỆT ĐỐI KHÔNG ĐỂ LỌT CHỮ TIẾNG VIỆT.`
          : 'Stream ngay từng dòng JSON thuần túy (1 object/hàng, không giải thích, CẤM thẻ HTML & Romaji) với tách từ và phiên âm chuẩn xác 100%.',
      signal: streamAbort.signal,
      priority: reqPriority,
      firstChunkTimeoutMs,
      compactSystem: true,
      onObject: (obj) => {
        const id = String(obj.id || obj.i || '').trim();
        const orig = byId.get(id);
        if (!orig || emittedIds.has(id)) return;

        const rawTarget = String(obj.text || obj.t || '').trim();
        if (!rawTarget) return;
        const candidateText = stripHtmlAndRubyArtifactsServer(rawTarget);
        const pure = isPureTargetLanguage(
          candidateText,
          lang,
          isViSource ? orig.text : undefined
        );
        if (!pure) return;

        const safeReadingMap =
          lang === 'ja'
            ? sanitizeCompactReadingMapServer(
                String(obj.r || obj.readingMap || ''),
                rawTarget
              )
            : undefined;

        const rawTokens = Array.isArray(obj.tokens) ? obj.tokens : [];
        const tokensWithIds = compactWire
          ? []
          : rawTokens.length > 0
            ? rawTokens
                .map((tk, idx) => {
                  const cleanSurface = stripHtmlAndRubyArtifactsServer(String(tk.surface || ''));
                  if (!cleanSurface) return null;
                  return {
                    ...tk,
                    id: `${orig.id}_t${idx}`,
                    surface: cleanSurface,
                    lemma:
                      stripHtmlAndRubyArtifactsServer(String(tk.lemma || cleanSurface)) ||
                      cleanSurface,
                    furigana:
                      lang === 'ja' && typeof tk.furigana === 'string'
                        ? sanitizeHiraganaReadingServer(tk.furigana)
                        : tk.furigana,
                  };
                })
                .filter((t): t is NonNullable<typeof t> => t !== null)
            : [{ id: `${orig.id}_t0`, surface: candidateText, lemma: candidateText }];

        emittedIds.add(id);
        writeNdjson({
          type: 'line',
          line: {
            id: orig.id,
            index: orig.index,
            start: orig.start,
            duration: orig.duration,
            end: Number((orig.start + orig.duration).toFixed(3)),
            text: candidateText,
            readingMap: safeReadingMap,
            rawText: isViSource || isAsr ? orig.text : undefined,
            translationVi: String(obj.translationVi || obj.v || (isViSource ? orig.text : '')),
            ipaLine:
              obj.ipaLine || obj.p
                ? stripHtmlAndRubyArtifactsServer(String(obj.ipaLine || obj.p))
                : undefined,
            connectedSpeech: [],
            tokens: tokensWithIds,
            enriched: true,
          },
        });
      },
    });

    writeNdjson({ type: 'done', emittedCount: emittedIds.size });
    if (!res.writableEnded) res.end();
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const isDailyQuota = isDailyQuotaError(err);
    const friendly = toFriendlyErrorMessage(
      err,
      'Kết nối luồng dịch phụ đề tạm gián đoạn.'
    );
    if (!res.writableEnded) {
      writeNdjson({
        type: 'error',
        status: rateLimited ? 429 : 500,
        quotaExhausted: rateLimited,
        isDailyQuota,
        error: friendly,
      });
      writeNdjson({ type: 'done', emittedCount: emittedIds.size });
      res.end();
    }
  }
});

// ---------------------------------------------------------------------------
// 3. POST /api/linguistics/lookup — 1:1 Locked Token Word Profile
// ---------------------------------------------------------------------------
app.post('/api/linguistics/lookup', async (req, res) => {
  try {
    const { tokenId, lineId, surface, lemma, sentence, prevSentence, nextSentence, language } =
      req.body as {
        tokenId?: string;
        lineId?: string;
        surface?: string;
        lemma?: string;
        sentence?: string;
        prevSentence?: string;
        nextSentence?: string;
        language?: 'en' | 'ja';
      };

    if (!tokenId || !surface || !sentence) {
      return res.status(400).json({ error: 'Thiếu thông tin từ vựng cần tra cứu.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';

    const levelEnum =
      lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

    const targetKanjiList =
      lang === 'ja'
        ? extractUniqueKanji(lemma || surface).length > 0
          ? extractUniqueKanji(lemma || surface)
          : extractUniqueKanji(surface)
        : [];
    const kanjiGroundTruthHint =
      lang === 'ja' && targetKanjiList.length > 0
        ? buildKanjiGroundTruthPromptHint(targetKanjiList)
        : '';

    const prompt =
      lang === 'ja'
        ? `Tra cứu Hồ Sơ Từ Vựng 5 Lớp & Cội Nguồn Từ Nguyên Tiếng Nhật CHÍNH XÁC 1:1 theo chuẩn Đại Từ Lâm (大辞林) / KANJIDIC2 / Bảng 214 Bộ Thủ Khang Hy / NHK cho từ: "${surface}" (gợi ý lemma: "${lemma || surface}")
Câu chứa từ: "${sentence}"
${prevSentence ? `Câu trước: "${prevSentence}"` : ''}
${nextSentence ? `Câu sau: "${nextSentence}"` : ''}
${kanjiGroundTruthHint ? `\n${kanjiGroundTruthHint}\n` : ''}
Yêu cầu bắt buộc (ZERO-ERROR ACADEMIC TRUTH — TUYỆT ĐỐI KHÔNG ĐOÁN MÒ BỘ THỦ, KHÔNG BỊA CHUYỆN DÂN GIAN):
1. detectedCollocation (Khối Cụm Collocation Nguyên Khối nếu có trong câu): Nếu "${surface}" thuộc cụm cố định/quán dụng ngữ (kể cả bị tách bởi định ngữ), điền phrase, patternFormula, tier ("casual"|"natural"|"academic"), level (${levelEnum.join('|')}), readingOrIpa (Furigana đúng ngữ cảnh), hanViet (Hán Việt hiện đại), meaningVi. Nếu không thuộc cụm cố định: để phrase là "".
2. Lớp 1 — Khớp Bối Cảnh & Ngữ âm:
   - lemma, partOfSpeech, contextMeaning (nghĩa khớp CHÍNH XÁC 100% câu đang xem), otherMeanings (2-3 nghĩa phổ thông khác), furigana (đúng ngữ cảnh câu này), romaji, hanViet (Hán Việt PHỔ THÔNG HIỆN ĐẠI từng chữ Kanji; nếu toàn kana để ""), pitchAccent chuẩn NHK Tokyo (patternName, downstep, morae), level (${levelEnum.join('|')}), conjugationNote, usageNote, collocations (2-4 cụm chuẩn).
3. Lớp 2 — Cội Nguồn Hán Tự & Bộ Thủ (kanjiBreakdown — CHUẨN HỌC THUẬT 100%):
   - ${
     targetKanjiList.length > 0
       ? `BẮT BUỘC trả về mảng kanjiBreakdown gồm ĐÚNG ${targetKanjiList.length} phần tử theo đúng thứ tự: ${targetKanjiList.join(', ')} (từ ghép Jukugo nhiều chữ PHẢI mổ xẻ riêng từng chữ, KHÔNG gộp bộ thủ giữa các chữ).`
       : 'Từ này toàn kana (không chứa Kanji): trả về kanjiBreakdown là mảng rỗng [].'
   }
   - Mỗi chữ Kanji phải xác định ĐÚNG 1 Bộ thủ chính duy nhất (部首) trong Bảng 214 Bộ thủ Khang Hy kèm đúng tên tiếng Việt & biến thể vị trí (ĐẶC BIỆT: 阝 bên TRÁI là #170 阜 Phụ — gò đất/đê; 阝 bên PHẢI là #163 邑 Ấp — vùng đất/đô thị).
   - Phân loại Lục thư chính xác: "Tượng hình" | "Chỉ sự" | "Hội ý" | "Hình thanh" | "Quốc tự" (với chữ Quốc tự 国字 do Nhật tạo như 働, 畑, 峠, 辻, 込, 枠 phải ghi "Quốc tự").
   - Với chữ Hình thanh (~80% Kanji): PHẢI tách bạch rõ thành phần nào là "Nghĩa phù" (mang nghĩa) và thành phần nào là "Thanh phù" (mượn âm đọc) — TUYỆT ĐỐI KHÔNG bịa chuyện dân gian kiểu "chùa" trong 持/時/待 hay "thước đo 尺" trong 駅 hay "Katakana メ" trong 気.
   - Với chữ Tân tự thể (新字体 như 気←氣, 駅←驛, 聴←聽, 学←學, 読←讀, 国←國...): BẮT BUỘC điền kyujitai và giải thích cội nguồn từ Cựu tự thể.
   - Tách bạch tuyệt đối etymologyFact (1–2 câu cội nguồn học thuật chuẩn xác) với mnemonicTip (1 dòng mẹo nhớ mặt chữ minh bạch).
   - Ghi đúng onyomi (Katakana), kunyomi (Hiragana), activeReading (âm đang dùng trong từ này), và 1–3 chữ dễ nhầm mặt chữ vào confusables.
   - radicalAnalysis: 1 dòng tóm tắt ngắn gọn khớp đúng với kanjiBreakdown (nếu toàn kana thì giải thích gốc kana ngắn gọn).
   - mnemonicVi: 1 dòng mẹo nhớ toàn từ ngắn gọn.
4. Lớp 3 — Cặp Tự động từ ↔ Tha động từ & Top 3 Từ ghép Jukugo:
   - transitivityPair: NẾU từ này là động từ có cặp Tự động từ (自動詞 đi với が) ↔ Tha động từ (他動詞 đi với を) (vd 開く あく ↔ 開ける あける, 変わる ↔ 変える), điền đầy đủ intransitive, intransitiveReading, intransitiveParticle ("が"), transitive, transitiveReading, transitiveParticle ("を"), differenceVi. Nếu KHÔNG phải động từ có cặp tự/tha: để intransitive là "".
   - topJukugo: 3 từ ghép Jukugo phổ biến nhất chứa cùng chữ Kanji cốt lõi (word, reading, hanViet, meaningVi). Nếu toàn kana để mảng rỗng [].
5. Lớp 4 — upgradeLadder (Thang Máy Collocations 3 Tầng): casual (🟢 Đời thường N5-N4), natural (🔵 Tự nhiên N3-N2), academic (🟣 Học thuật/N1), kèm contextCompareVi.
6. Lớp 5 — antiCalque (Cảnh báo Bẫy Dịch Người Việt ✅ O / ❌ X): chỉ rõ 1 cặp correctForm vs wrongTrap, particleOrPrepHighlight và explanationVi ngắn gọn.`
        : `Tra cứu Hồ Sơ Từ Vựng 5 Lớp & Cội Nguồn Từ Nguyên Tiếng Anh CHÍNH XÁC 1:1 theo chuẩn Oxford / Cambridge Collocations Dictionary cho: "${surface}" (gợi ý lemma: "${lemma || surface}")
Câu chứa từ: "${sentence}"
${prevSentence ? `Câu trước: "${prevSentence}"` : ''}
${nextSentence ? `Câu sau: "${nextSentence}"` : ''}

Yêu cầu bắt buộc (ZERO-ERROR LINGUISTIC TRUTH — TUYỆT ĐỐI KHÔNG BỊA COLLOCATION HAY VIETLISH):
1. detectedCollocation (Cụm Collocation/Phrasal Verb/Idiom Nguyên Khối nếu có trong câu): điền phrase, patternFormula, tier ("casual"|"natural"|"academic"), level (${levelEnum.join('|')}), readingOrIpa (Oxford IPA), meaningVi. Nếu không nằm trong cụm cố định: để phrase là "".
2. Lớp 1 — Khớp Bối Cảnh & Ngữ âm:
   - lemma, partOfSpeech, phraseType ("Từ đơn"|"Phrasal Verb"|"Idiom"|"Collocation"), contextMeaning (nghĩa khớp CHÍNH XÁC 100% câu đang xem), otherMeanings (2-3 nghĩa phổ thông khác), ipaUS, ipaUK (chuẩn Oxford/Cambridge Unicode IPA), level (${levelEnum.join('|')}), isIeltsAcademic, connectedSpeechNote, collocations (2-4 cụm tự nhiên), usageNote.
3. Lớp 2 — Giải phẫu Gốc từ (Morpheme Etymology Lab):
   - morphemeBreakdown: tách rõ prefix (tiền tố nếu có, vd "un-"), root (gốc từ cốt lõi, vd "predict"), suffix (hậu tố nếu có, vd "-able"), và rootMeaningVi (ý nghĩa gốc Latin/Hy Lạp/cốt lõi giúp suy luận hàng loạt từ mới).
   - mnemonicVi: 1 mẹo nhớ nhanh gọn 1 dòng.
4. Lớp 3 — Gia Đình Từ (Word Family Matrix):
   - wordFamily: 2–4 biến thể họ từ quan trọng nhất (Danh từ · Động từ · Tính từ · Trạng từ) gồm pos (vd "Noun", "Verb", "Adj", "Adv"), word, ipa, exampleShort (cụm ví dụ 3-5 từ chỉ rõ vị trí dùng).
5. Lớp 4 — upgradeLadder (Thang Máy Collocations 3 Tầng): casual (🟢 A1-B1), natural (🔵 B1-B2), academic (🟣 C1-C2 / IELTS), kèm contextCompareVi.
6. Lớp 5 — antiCalque (Cảnh báo Bẫy Dịch Người Việt ✅ O / ❌ X): chỉ rõ 1 cặp correctForm vs wrongTrap, particleOrPrepHighlight và explanationVi ngắn gọn.`;

    const variantSchema = {
      type: Type.OBJECT,
      properties: {
        expression: { type: Type.STRING },
        readingOrIpa: { type: Type.STRING },
        hanViet: { type: Type.STRING },
        level: { type: Type.STRING, enum: levelEnum },
        exampleSentence: { type: Type.STRING },
        nuanceVi: { type: Type.STRING },
      },
      required: ['expression', 'readingOrIpa', 'level', 'exampleSentence', 'nuanceVi'],
    };

    const detectedCollocationSchema = {
      type: Type.OBJECT,
      properties: {
        phrase: { type: Type.STRING },
        patternFormula: { type: Type.STRING },
        tier: { type: Type.STRING, enum: ['casual', 'natural', 'academic'] },
        level: { type: Type.STRING, enum: levelEnum },
        readingOrIpa: { type: Type.STRING },
        hanViet: { type: Type.STRING },
        meaningVi: { type: Type.STRING },
      },
      required: ['phrase', 'patternFormula', 'tier', 'level', 'readingOrIpa', 'meaningVi'],
    };

    const antiCalqueSchema = {
      type: Type.OBJECT,
      properties: {
        correctForm: { type: Type.STRING },
        wrongTrap: { type: Type.STRING },
        particleOrPrepHighlight: { type: Type.STRING },
        explanationVi: { type: Type.STRING },
      },
      required: ['correctForm', 'wrongTrap', 'explanationVi'],
    };

    const upgradeLadderSchema = {
      type: Type.OBJECT,
      properties: {
        conceptVi: { type: Type.STRING },
        casual: variantSchema,
        natural: variantSchema,
        academic: variantSchema,
        contextCompareVi: { type: Type.STRING },
      },
      required: ['conceptVi', 'casual', 'natural', 'academic', 'contextCompareVi'],
    };

    const kanjiBreakdownItemSchema = {
      type: Type.OBJECT,
      properties: {
        kanji: { type: Type.STRING },
        hanViet: { type: Type.STRING },
        strokeCount: { type: Type.INTEGER },
        jlpt: { type: Type.STRING, enum: ['N5', 'N4', 'N3', 'N2', 'N1'] },
        radical: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING },
            kangxiNumber: { type: Type.INTEGER },
            nameVi: { type: Type.STRING },
            meaningVi: { type: Type.STRING },
            positionNote: { type: Type.STRING },
          },
          required: ['symbol', 'nameVi', 'meaningVi'],
        },
        structureType: {
          type: Type.STRING,
          enum: ['Tượng hình', 'Chỉ sự', 'Hội ý', 'Hình thanh', 'Quốc tự'],
        },
        components: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              char: { type: Type.STRING },
              role: { type: Type.STRING, enum: ['Nghĩa phù', 'Thanh phù', 'Thành phần'] },
              meaning: { type: Type.STRING },
            },
            required: ['char', 'role', 'meaning'],
          },
        },
        kyujitai: { type: Type.STRING },
        etymologyFact: { type: Type.STRING },
        mnemonicTip: { type: Type.STRING },
        onyomi: { type: Type.ARRAY, items: { type: Type.STRING } },
        kunyomi: { type: Type.ARRAY, items: { type: Type.STRING } },
        activeReading: { type: Type.STRING },
        confusables: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              kanji: { type: Type.STRING },
              hanViet: { type: Type.STRING },
              meaningVi: { type: Type.STRING },
              diffNote: { type: Type.STRING },
            },
            required: ['kanji', 'hanViet', 'meaningVi'],
          },
        },
      },
      required: [
        'kanji',
        'hanViet',
        'radical',
        'structureType',
        'components',
        'etymologyFact',
        'onyomi',
        'kunyomi',
        'confusables',
      ],
    };

    const schema =
      lang === 'ja'
        ? {
            type: Type.OBJECT,
            properties: {
              detectedCollocation: detectedCollocationSchema,
              lemma: { type: Type.STRING },
              partOfSpeech: { type: Type.STRING },
              contextMeaning: { type: Type.STRING },
              otherMeanings: { type: Type.ARRAY, items: { type: Type.STRING } },
              furigana: { type: Type.STRING },
              romaji: { type: Type.STRING },
              hanViet: { type: Type.STRING },
              level: { type: Type.STRING, enum: ['N5', 'N4', 'N3', 'N2', 'N1'] },
              conjugationNote: { type: Type.STRING },
              usageNote: { type: Type.STRING },
              collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
              kanjiBreakdown: {
                type: Type.ARRAY,
                items: kanjiBreakdownItemSchema,
              },
              radicalAnalysis: { type: Type.STRING },
              mnemonicVi: { type: Type.STRING },
              transitivityPair: {
                type: Type.OBJECT,
                properties: {
                  intransitive: { type: Type.STRING },
                  intransitiveReading: { type: Type.STRING },
                  intransitiveParticle: { type: Type.STRING },
                  transitive: { type: Type.STRING },
                  transitiveReading: { type: Type.STRING },
                  transitiveParticle: { type: Type.STRING },
                  differenceVi: { type: Type.STRING },
                },
                required: [
                  'intransitive',
                  'intransitiveReading',
                  'intransitiveParticle',
                  'transitive',
                  'transitiveReading',
                  'transitiveParticle',
                  'differenceVi',
                ],
              },
              topJukugo: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    reading: { type: Type.STRING },
                    hanViet: { type: Type.STRING },
                    meaningVi: { type: Type.STRING },
                  },
                  required: ['word', 'reading', 'hanViet', 'meaningVi'],
                },
              },
              antiCalque: antiCalqueSchema,
              upgradeLadder: upgradeLadderSchema,
              pitchAccent: {
                type: Type.OBJECT,
                properties: {
                  patternName: { type: Type.STRING },
                  downstep: { type: Type.INTEGER },
                  morae: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        pitch: { type: Type.STRING, enum: ['L', 'H'] },
                        drop: { type: Type.BOOLEAN },
                      },
                      required: ['text', 'pitch'],
                    },
                  },
                },
                required: ['patternName', 'downstep', 'morae'],
              },
            },
            required: [
              'lemma',
              'partOfSpeech',
              'contextMeaning',
              'furigana',
              'level',
              'pitchAccent',
              'kanjiBreakdown',
              'radicalAnalysis',
              'mnemonicVi',
              'transitivityPair',
              'topJukugo',
              'antiCalque',
              'upgradeLadder',
            ],
          }
        : {
            type: Type.OBJECT,
            properties: {
              detectedCollocation: detectedCollocationSchema,
              lemma: { type: Type.STRING },
              partOfSpeech: { type: Type.STRING },
              phraseType: { type: Type.STRING },
              contextMeaning: { type: Type.STRING },
              otherMeanings: { type: Type.ARRAY, items: { type: Type.STRING } },
              ipaUS: { type: Type.STRING },
              ipaUK: { type: Type.STRING },
              level: { type: Type.STRING, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
              isIeltsAcademic: { type: Type.BOOLEAN },
              connectedSpeechNote: { type: Type.STRING },
              collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
              usageNote: { type: Type.STRING },
              morphemeBreakdown: {
                type: Type.OBJECT,
                properties: {
                  prefix: { type: Type.STRING },
                  root: { type: Type.STRING },
                  suffix: { type: Type.STRING },
                  rootMeaningVi: { type: Type.STRING },
                },
                required: ['root', 'rootMeaningVi'],
              },
              mnemonicVi: { type: Type.STRING },
              wordFamily: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pos: { type: Type.STRING },
                    word: { type: Type.STRING },
                    ipa: { type: Type.STRING },
                    exampleShort: { type: Type.STRING },
                  },
                  required: ['pos', 'word', 'exampleShort'],
                },
              },
              antiCalque: antiCalqueSchema,
              upgradeLadder: upgradeLadderSchema,
            },
            required: [
              'lemma',
              'partOfSpeech',
              'contextMeaning',
              'ipaUS',
              'level',
              'morphemeBreakdown',
              'mnemonicVi',
              'wordFamily',
              'antiCalque',
              'upgradeLadder',
            ],
          };

    const data = await generateStructuredJson<Record<string, unknown>>({
      prompt,
      systemInstruction:
        'Tra cứu Hồ sơ từ vựng 5 lớp, Cội nguồn Hán tự chuẩn 214 Bộ thủ Khang Hy / KANJIDIC2 & cụm Collocation với độ chính xác học thuật 100% theo Oxford/Cambridge & Đại Từ Lâm/NHK. Tuyệt đối không bịa đặt bộ thủ hay từ nguyên dân gian.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
      temperature: lang === 'ja' ? 0.05 : 0.1,
      priority: 'express',
    });

    // === 2-STEP PRE-RENDER SANITY GATE FOR JAPANESE KANJI ETYMOLOGY ===
    if (lang === 'ja') {
      const resolvedLemma = String(data.lemma || lemma || surface);
      const effectiveKanjiList =
        extractUniqueKanji(resolvedLemma).length > 0
          ? extractUniqueKanji(resolvedLemma)
          : targetKanjiList;

      if (effectiveKanjiList.length > 0) {
        const firstPass = validateAndSanitizeKanjiEtymology(
          data.kanjiBreakdown,
          effectiveKanjiList,
          { applyHardGroundTruthLock: false }
        );

        let verifiedEntries = firstPass.sanitizedEntries;

        if (!firstPass.valid) {
          console.warn(
            `[KotoZen Kanji Sanity Gate] Detected ${firstPass.issues.length} issue(s) for "${resolvedLemma}":`,
            firstPass.issues.join(' | ')
          );

          // Step 2: 1-Shot Silent Strict Self-Repair Call (temperature: 0.0)
          try {
            const repairHint = buildKanjiGroundTruthPromptHint(effectiveKanjiList);
            const repairResp = await generateStructuredJson<{ kanjiBreakdown?: unknown[] }>({
              prompt: `SỬA LỖI HỌC THUẬT KANJI TỐI KHẨN cho từ "${resolvedLemma}" (bối cảnh câu: "${sentence}", đọc: "${String(data.furigana || '')}").

CÁC LỖI PHÁT HIỆN CẦN SỬA NGAY:
${firstPass.issues.map((iss, idx) => `${idx + 1}. ${iss}`).join('\n')}

${repairHint}

Hãy trả về mảng kanjiBreakdown MỚI HOÀN HẢO 100% theo đúng thứ tự: ${effectiveKanjiList.join(', ')}. Tuyệt đối tuân thủ Bảng 214 Bộ Thủ Khang Hy, phân biệt Nghĩa phù vs Thanh phù, Cựu tự thể 旧字体, Quốc tự 国字, và quy tắc 阝 trái (阜 Phụ) vs 阝 phải (邑 Ấp).`,
              systemInstruction:
                'Bạn là chuyên gia Hán tự học (漢字学) hiệu đính KANJIDIC2 & Đại Từ Lâm. Sửa triệt để mọi sai sót bộ thủ và từ nguyên thành chuẩn học thuật 100%.',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  kanjiBreakdown: {
                    type: Type.ARRAY,
                    items: kanjiBreakdownItemSchema,
                  },
                },
                required: ['kanjiBreakdown'],
              },
              thinkingLevel: ThinkingLevel.LOW,
              temperature: 0.0,
            });

            const secondPass = validateAndSanitizeKanjiEtymology(
              repairResp.kanjiBreakdown,
              effectiveKanjiList,
              { applyHardGroundTruthLock: true }
            );
            verifiedEntries = secondPass.sanitizedEntries;
          } catch (repairErr) {
            console.warn(
              '[KotoZen Kanji Sanity Gate] Silent repair failed, applying deterministic Ground-Truth lock:',
              repairErr instanceof Error ? repairErr.message : repairErr
            );
            const fallbackPass = validateAndSanitizeKanjiEtymology(
              data.kanjiBreakdown,
              effectiveKanjiList,
              { applyHardGroundTruthLock: true }
            );
            verifiedEntries = fallbackPass.sanitizedEntries;
          }
        } else {
          // Even when AI passed validation, apply deterministic Ground-Truth polish for exact Kangxi numbers & fields
          const polished = validateAndSanitizeKanjiEtymology(
            data.kanjiBreakdown,
            effectiveKanjiList,
            { applyHardGroundTruthLock: true }
          );
          verifiedEntries = polished.sanitizedEntries;
        }

        data.kanjiBreakdown = verifiedEntries;
        if (verifiedEntries.length > 0) {
          data.radicalAnalysis = formatVerifiedRadicalSummary(verifiedEntries);
          // Synchronize top-level modern Han-Viet from verified Kanji breakdown so archaic readings can never leak
          const joinedHanViet = verifiedEntries
            .map((e) => e.hanViet)
            .filter(Boolean)
            .join(' · ');
          if (joinedHanViet) {
            data.hanViet = joinedHanViet;
          }
        }
      } else {
        data.kanjiBreakdown = [];
      }
    }

    const detected = data.detectedCollocation as { phrase?: string } | undefined;
    if (!detected || !detected.phrase || !detected.phrase.trim()) {
      delete data.detectedCollocation;
    }

    const antiCalque = data.antiCalque as { correctForm?: string; wrongTrap?: string } | undefined;
    if (!antiCalque || !antiCalque.correctForm?.trim() || !antiCalque.wrongTrap?.trim()) {
      delete data.antiCalque;
    }

    const trans = data.transitivityPair as { intransitive?: string; transitive?: string } | undefined;
    if (!trans || !trans.intransitive?.trim() || !trans.transitive?.trim()) {
      delete data.transitivityPair;
    }

    const morph = data.morphemeBreakdown as { root?: string } | undefined;
    if (!morph || !morph.root?.trim()) {
      delete data.morphemeBreakdown;
    }

    return res.json({
      profile: {
        ...data,
        tokenId,
        lineId: lineId || '',
        surface,
      },
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Hệ thống tra cứu từ điển đang tạm bận. Vui lòng bấm lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 4. POST /api/linguistics/xray — Sentence Syntax X-Ray & Native Nuance Decoder
// ---------------------------------------------------------------------------
app.post('/api/linguistics/xray', async (req, res) => {
  try {
    const { lineId, sentence, translationVi, language, prevSentence, nextSentence } = req.body as {
      lineId?: string;
      sentence?: string;
      translationVi?: string;
      language?: 'en' | 'ja';
      prevSentence?: string;
      nextSentence?: string;
    };

    if (!lineId || !sentence) {
      return res.status(400).json({ error: 'Thiếu câu cần giải phẫu cú pháp.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';

    const prompt =
      lang === 'ja'
        ? `Giải phẫu cú pháp đa tầng (Multi-Layer Syntax X-Ray), Đối chiếu ngữ pháp dễ nhầm & Lăng kính 3 tầng văn phong cho câu Tiếng Nhật sau:
Câu: "${sentence}"
Dịch nghĩa hiện tại: "${translationVi || ''}"
${prevSentence ? `Ngữ cảnh trước: "${prevSentence}"` : ''}
${nextSentence ? `Ngữ cảnh sau: "${nextSentence}"` : ''}

Yêu cầu bắt buộc (CHÂN LÝ NGỮ PHÁP TUYỆT ĐỐI):
1. segments: Tách trọn câu theo đúng thứ tự (Xương sống Chủ ngữ – Vị ngữ S-V, Mệnh đề định ngữ bổ nghĩa danh từ, vai trò thực tế của từng Trợ từ は/が/を/に/で/へ/と/より/まで trong đúng câu này, Thể chia động từ). Gán colorKey: 'subject'|'predicate'|'clause'|'particle'|'modifier'|'grammar'.
2. verbChainBreakdowns: Nếu câu có động từ chia phức hợp (vd 食べさせられたくない, 見られなかった, 行ってしまいます), bóc tách từng lớp hình thái (part + label, vd 食べ [Gốc động từ] + させ [Sai khiến] + られ [Bị động] + た [Mong muốn] + くない [Phủ định]). Nếu không có dạng phức hợp, bóc tách 1 động từ chính.
3. colloquialisms (Spoken-to-Standard Decompiler): Bóc tách mọi hình thức nói tắt/khẩu ngữ/lược trợ từ (〜ちゃう, 〜なきゃ, 〜てる, 〜んだ...) sang dạng chuẩn sách giáo khoa.
4. register & registerReason: Mức độ lịch sự thực tế và lý do người nói chọn sắc thái này.
5. grammarPoints: 1–3 mẫu ngữ pháp đắt giá trong câu (pattern, level N5–N1, formula, nuance, conjugation) KÈM contrastPairs ("Đừng nhầm với..."): 1–2 cấu trúc hay nhầm nhất (vd 〜ために vs 〜ように, 〜はずだ vs 〜わけだ, 〜ばかり vs 〜だけ, 〜ながら vs 〜つつ, 〜ておく vs 〜てある) gồm đúng 3 phần: formula nối chuẩn, coreDifferenceVi (khác biệt bản chất trong 1 câu), pairAExample & pairBExample đối lập sắc nét.
6. registerPrism (Lăng Kính Biến Hình 3 Tầng Văn Phong — 0ms Slider): Chuyển thể CHÍNH Ý NGHĨA câu này qua 3 tầng:
   - casual: Thân mật Tameguchi / Futsukei (label, sentence, readingOrIpa, highlights: mảng 1–3 cụm/đuôi câu bị biến đổi, contextNoteVi)
   - standard: Lịch sự Teineigo (です・ます)
   - formal: Trang trọng Keigo (尊敬語/謙譲語) hoặc Văn viết học thuật.`
        : `Giải phẫu cú pháp đa tầng (Multi-Layer Syntax X-Ray), Đối chiếu ngữ pháp dễ nhầm & Lăng kính 3 tầng văn phong cho câu Tiếng Anh sau:
Câu: "${sentence}"
Dịch nghĩa hiện tại: "${translationVi || ''}"
${prevSentence ? `Ngữ cảnh trước: "${prevSentence}"` : ''}
${nextSentence ? `Ngữ cảnh sau: "${nextSentence}"` : ''}

Yêu cầu bắt buộc (CHÂN LÝ NGỮ PHÁP TUYỆT ĐỐI):
1. segments: Tách trọn câu theo đúng thứ tự (Mệnh đề chính, Mệnh đề quan hệ / Mệnh đề trạng ngữ / Mệnh đề rút gọn, Cụm động từ & Thì, Đảo ngữ / Điều kiện / Bị động / Nhấn mạnh). Gán colorKey: 'subject'|'predicate'|'clause'|'particle'|'modifier'|'grammar'.
2. tenseTimelineNote: Giải thích trục thời gian ngắn gọn vì sao người nói chọn Thì (Tense) / Thể (Aspect) này trong ngữ cảnh video thay vì thì gần giống.
3. colloquialisms (Spoken-to-Standard Decompiler): Bóc tách mọi khẩu ngữ/nói tắt/tỉnh lược (gonna, wanna, gotta, shoulda, lược đại từ quan hệ...) sang dạng chuẩn học thuật.
4. register & registerReason: Mức độ trang trọng thực tế và ý đồ giao tiếp.
5. grammarPoints: 1–3 cấu trúc ngữ pháp cốt lõi (pattern, level A1–C2, formula, nuance) KÈM contrastPairs ("Đừng nhầm với..."): 1–2 cấu trúc dễ nhầm nhất (vd Past Simple vs Present Perfect, despite vs although, used to vs be used to, must have done vs should have done) gồm formula, coreDifferenceVi (1 câu sắc nét), pairAExample & pairBExample đối lập.
6. registerPrism (Lăng Kính Biến Hình 3 Tầng Văn Phong — 0ms Slider): Viết lại CHÍNH Ý NGHĨA câu này qua 3 tầng:
   - casual: Giao tiếp thân mật Casual (label, sentence, readingOrIpa: Oxford IPA điểm nhấn, highlights: 1–3 cụm biến đổi, contextNoteVi)
   - standard: Chuyên nghiệp Standard / Workplace
   - formal: Học thuật cao cấp Academic / IELTS Band 8+.`;

    const levelEnum = lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

    const prismVariantSchema = {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        sentence: { type: Type.STRING },
        readingOrIpa: { type: Type.STRING },
        highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
        contextNoteVi: { type: Type.STRING },
      },
      required: ['label', 'sentence', 'highlights', 'contextNoteVi'],
    };

    const schema = {
      type: Type.OBJECT,
      properties: {
        translationVi: { type: Type.STRING },
        register: { type: Type.STRING },
        registerReason: { type: Type.STRING },
        tenseTimelineNote: { type: Type.STRING },
        verbChainBreakdowns: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              surface: { type: Type.STRING },
              layers: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    part: { type: Type.STRING },
                    label: { type: Type.STRING },
                  },
                  required: ['part', 'label'],
                },
              },
            },
            required: ['surface', 'layers'],
          },
        },
        segments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              role: { type: Type.STRING },
              colorKey: {
                type: Type.STRING,
                enum: ['subject', 'predicate', 'clause', 'particle', 'modifier', 'grammar'],
              },
              explanation: { type: Type.STRING },
            },
            required: ['text', 'role', 'colorKey', 'explanation'],
          },
        },
        colloquialisms: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              spoken: { type: Type.STRING },
              standard: { type: Type.STRING },
              nuance: { type: Type.STRING },
            },
            required: ['spoken', 'standard', 'nuance'],
          },
        },
        grammarPoints: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pattern: { type: Type.STRING },
              level: { type: Type.STRING, enum: levelEnum },
              formula: { type: Type.STRING },
              nuance: { type: Type.STRING },
              conjugation: { type: Type.STRING },
              contrastPairs: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    vsPattern: { type: Type.STRING },
                    formula: { type: Type.STRING },
                    coreDifferenceVi: { type: Type.STRING },
                    pairAExample: { type: Type.STRING },
                    pairBExample: { type: Type.STRING },
                  },
                  required: ['vsPattern', 'formula', 'coreDifferenceVi', 'pairAExample', 'pairBExample'],
                },
              },
            },
            required: ['pattern', 'level', 'formula', 'nuance'],
          },
        },
        registerPrism: {
          type: Type.OBJECT,
          properties: {
            casual: prismVariantSchema,
            standard: prismVariantSchema,
            formal: prismVariantSchema,
          },
          required: ['casual', 'standard', 'formal'],
        },
      },
      required: [
        'translationVi',
        'register',
        'registerReason',
        'segments',
        'colloquialisms',
        'grammarPoints',
        'registerPrism',
      ],
    };

    const data = await generateStructuredJson<Record<string, unknown>>({
      prompt,
      systemInstruction:
        'Thực hiện giải phẫu cú pháp đa tầng, đối chiếu cặp ngữ pháp dễ nhầm và biến hình 3 tầng văn phong chính xác 100% học thuật.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
      priority: 'express',
    });

    return res.json({
      xray: {
        ...data,
        lineId,
        sentence,
      },
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể giải phẫu cú pháp câu này lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 5. POST /api/linguistics/curriculum — Level-Adaptive Vocabulary & Grammar Extraction
// ---------------------------------------------------------------------------
app.post('/api/linguistics/curriculum', async (req, res) => {
  try {
    const { lines, language, targetLevel, videoTitle } = req.body as {
      lines?: Array<{ id: string; start: number; text: string; translationVi?: string }>;
      language?: 'en' | 'ja';
      targetLevel?: string;
      videoTitle?: string;
    };

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Không có phụ đề để tổng hợp từ vựng và ngữ pháp.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const level = targetLevel || (lang === 'ja' ? 'N3' : 'B2');
    const levelEnum = lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

    // Build compact transcript with exact IDs & timestamps
    const transcriptSnippet = lines
      .slice(0, 90)
      .map((l) => `[${l.id} @ ${l.start.toFixed(1)}s] ${l.text}`)
      .join('\n');

    const prompt = `Video: "${videoTitle || ''}"
Ngôn ngữ: ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}
Trình độ mục tiêu người học chọn: ${level}

Dựa STRICTLY vào các câu phụ đề thực tế dưới đây (tuyệt đối KHÔNG bịa từ/câu không có trong phụ đề):
1. vocabulary: Trích xuất 12–18 từ vựng / cụm từ / collocations đắt giá nhất có trong video (ưu tiên đúng trình độ ${level} và cao hơn 1 bậc, kèm phân tầng cấp độ chuẩn).
   - Mỗi từ phải đính kèm lineIds (danh sách ID dòng phụ đề nơi từ thực sự xuất hiện!).
   - ${lang === 'ja' ? 'Ghi rõ readingOrIpa (Furigana chuẩn ngữ cảnh), hanViet (Âm Hán Việt phổ thông hiện đại nếu có Kanji).' : 'Ghi rõ readingOrIpa (IPA chuẩn Oxford/Cambridge), isIeltsAcademic (true nếu thuộc nhóm học thuật IELTS).'}
2. grammar: Trích xuất 5–8 cấu trúc ngữ pháp trọng tâm thực sự xuất hiện trong video:
   - pattern (tên mẫu ngữ pháp), level, formula (công thức cấu tạo), nuance (sắc thái & cách dùng), conjugation (quy tắc chia/kết hợp), lineId (ID dòng ví dụ trích nguyên văn), exampleSentence (trích NGUYÊN VĂN câu từ dòng đó), exampleTranslationVi (dịch tiếng Việt chuẩn).

Phụ đề video:
${transcriptSnippet}`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        vocabulary: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              lemma: { type: Type.STRING },
              readingOrIpa: { type: Type.STRING },
              hanViet: { type: Type.STRING },
              partOfSpeech: { type: Type.STRING },
              meaningVi: { type: Type.STRING },
              level: { type: Type.STRING, enum: levelEnum },
              isIeltsAcademic: { type: Type.BOOLEAN },
              lineIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['word', 'lemma', 'readingOrIpa', 'partOfSpeech', 'meaningVi', 'level', 'lineIds'],
          },
        },
        grammar: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pattern: { type: Type.STRING },
              level: { type: Type.STRING, enum: levelEnum },
              formula: { type: Type.STRING },
              nuance: { type: Type.STRING },
              conjugation: { type: Type.STRING },
              lineId: { type: Type.STRING },
              exampleSentence: { type: Type.STRING },
              exampleTranslationVi: { type: Type.STRING },
            },
            required: [
              'pattern',
              'level',
              'formula',
              'nuance',
              'conjugation',
              'lineId',
              'exampleSentence',
              'exampleTranslationVi',
            ],
          },
        },
      },
      required: ['vocabulary', 'grammar'],
    };

    const raw = await generateStructuredJson<{
      vocabulary: Array<{
        word: string;
        lemma: string;
        readingOrIpa: string;
        hanViet?: string;
        partOfSpeech: string;
        meaningVi: string;
        level: string;
        isIeltsAcademic?: boolean;
        lineIds: string[];
      }>;
      grammar: Array<{
        pattern: string;
        level: string;
        formula: string;
        nuance: string;
        conjugation: string;
        lineId: string;
        exampleSentence: string;
        exampleTranslationVi: string;
      }>;
    }>({
      prompt,
      systemInstruction:
        'Tổng hợp bảng từ vựng và ngữ pháp trọng tâm bám sát 100% nội dung video, gắn đúng ID dòng phụ đề.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.MEDIUM,
    });

    const lineLookup = new Map(lines.map((l) => [l.id, l]));

    const vocabulary = (raw.vocabulary || []).map((v, idx) => {
      const matched = (v.lineIds || [])
        .map((lid) => lineLookup.get(lid))
        .filter((l): l is { id: string; start: number; text: string } => Boolean(l));

      // Also scan lines directly for accurate occurrence count
      const scanned = lines.filter((l) =>
        l.text.toLowerCase().includes(v.word.toLowerCase()) ||
        l.text.toLowerCase().includes(v.lemma.toLowerCase())
      );
      const uniqueMap = new Map<string, { lineId: string; start: number; sentence: string }>();
      for (const l of [...matched, ...scanned]) {
        uniqueMap.set(l.id, { lineId: l.id, start: l.start, sentence: l.text });
      }
      const occurrences = Array.from(uniqueMap.values());
      if (occurrences.length === 0 && lines[0]) {
        occurrences.push({ lineId: lines[0].id, start: lines[0].start, sentence: lines[0].text });
      }

      return {
        id: `cv_${idx}_${v.lemma}`,
        word: v.word,
        lemma: v.lemma,
        readingOrIpa: v.readingOrIpa,
        hanViet: v.hanViet,
        partOfSpeech: v.partOfSpeech,
        meaningVi: v.meaningVi,
        level: v.level,
        isIeltsAcademic: Boolean(v.isIeltsAcademic),
        occurrences,
      };
    });

    const grammar = (raw.grammar || []).map((g, idx) => {
      const foundLine = lineLookup.get(g.lineId) || lines[0];
      return {
        id: `cg_${idx}_${g.pattern}`,
        pattern: g.pattern,
        level: g.level,
        formula: g.formula,
        nuance: g.nuance,
        conjugation: g.conjugation,
        exampleSentence: foundLine ? foundLine.text : g.exampleSentence,
        exampleTranslationVi: g.exampleTranslationVi,
        exampleStart: foundLine ? foundLine.start : 0,
        lineId: foundLine ? foundLine.id : g.lineId,
      };
    });

    return res.json({
      curriculum: {
        language: lang,
        targetLevel: level,
        vocabulary,
        grammar,
      },
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể tổng hợp từ vựng & ngữ pháp lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 6. POST /api/linguistics/study-sheet — Smart Study Sheet & Real-World Quiz
// ---------------------------------------------------------------------------
app.post('/api/linguistics/study-sheet', async (req, res) => {
  try {
    const { lines, language, targetLevel, videoTitle } = req.body as {
      lines?: Array<{ id: string; start: number; text: string; translationVi?: string }>;
      language?: 'en' | 'ja';
      targetLevel?: string;
      videoTitle?: string;
    };

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Chưa có phụ đề video để tạo Phiếu Học Tập & Quiz.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const level = targetLevel || (lang === 'ja' ? 'N3' : 'B2');
    const levelEnum = lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

    const transcriptSnippet = lines
      .slice(0, 90)
      .map((l) => `[${l.start.toFixed(1)}s] ${l.text}`)
      .join('\n');

    const prompt = `Video: "${videoTitle || ''}"
Ngôn ngữ học: ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'} · Trình độ mục tiêu: ${level}

Dựa STRICTLY 100% vào phụ đề thực tế bên dưới, hãy tạo:
1. summaryVi: Tóm tắt súc tích nội dung cốt lõi của video bằng tiếng Việt (3–5 câu).
2. keyTakeaways: 3–4 điểm mấu chốt người học rút ra được từ video.
3. topVocabulary: 10–12 từ vựng / cụm collocation đắt giá nhất đúng trình độ ${level} kèm readingOrIpa, ${lang === 'ja' ? 'hanViet (nếu có Kanji), ' : ''}level, meaningVi, exampleFromVideo (trích nguyên văn từ phụ đề), timestamp (số giây chính xác).
4. coreGrammar: 3–5 cấu trúc ngữ pháp cốt lõi kèm level, formula, explanation, exampleFromVideo, timestamp.
5. quiz: 7 câu hỏi kiểm tra thực chiến đa dạng 3 loại:
   - listening_comprehension (nghe hiểu tình huống/ý định người nói tại mốc timestamp)
   - cloze_fill (điền từ/cụm từ bị khuyết trong câu trích từ video)
   - grammar_fix (chọn câu đúng/sửa lỗi ngữ pháp dựa trên mẫu ngữ pháp trong video)
   Mỗi câu có 4 lựa chọn options (A/B/C/D), correctIndex (0..3), sentenceContext, timestamp (giây thực tế), và explanationVi giải thích sâu sắc tại sao đúng.

Phụ đề video:
${transcriptSnippet}`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        summaryVi: { type: Type.STRING },
        keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
        topVocabulary: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              term: { type: Type.STRING },
              readingOrIpa: { type: Type.STRING },
              hanViet: { type: Type.STRING },
              level: { type: Type.STRING, enum: levelEnum },
              meaningVi: { type: Type.STRING },
              exampleFromVideo: { type: Type.STRING },
              timestamp: { type: Type.NUMBER },
            },
            required: ['term', 'readingOrIpa', 'level', 'meaningVi', 'exampleFromVideo', 'timestamp'],
          },
        },
        coreGrammar: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pattern: { type: Type.STRING },
              level: { type: Type.STRING, enum: levelEnum },
              formula: { type: Type.STRING },
              explanation: { type: Type.STRING },
              exampleFromVideo: { type: Type.STRING },
              timestamp: { type: Type.NUMBER },
            },
            required: ['pattern', 'level', 'formula', 'explanation', 'exampleFromVideo', 'timestamp'],
          },
        },
        quiz: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                enum: ['listening_comprehension', 'cloze_fill', 'grammar_fix'],
              },
              prompt: { type: Type.STRING },
              sentenceContext: { type: Type.STRING },
              timestamp: { type: Type.NUMBER },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              explanationVi: { type: Type.STRING },
            },
            required: [
              'type',
              'prompt',
              'sentenceContext',
              'timestamp',
              'options',
              'correctIndex',
              'explanationVi',
            ],
          },
        },
      },
      required: ['summaryVi', 'keyTakeaways', 'topVocabulary', 'coreGrammar', 'quiz'],
    };

    const data = await generateStructuredJson<{
      summaryVi: string;
      keyTakeaways: string[];
      topVocabulary: Array<Record<string, unknown>>;
      coreGrammar: Array<Record<string, unknown>>;
      quiz: Array<Record<string, unknown>>;
    }>({
      prompt,
      systemInstruction:
        'Tạo Phiếu Học Tập Thông Minh và Bộ Đề Kiểm Tra 100% dựa trên dữ liệu phụ đề thực tế của video, không bịa đặt thông tin.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.MEDIUM,
    });

    return res.json({
      studySheet: {
        ...data,
        generatedAt: Date.now(),
        quiz: (data.quiz || []).map((q, idx) => ({
          ...q,
          id: `qz_${idx}_${Date.now()}`,
        })),
      },
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể tạo Phiếu Học Tập & Quiz lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 7. POST /api/linguistics/pronunciation-score — Feature 11: Real-Time Pronunciation & Intonation Scorer
// ---------------------------------------------------------------------------
app.post('/api/linguistics/pronunciation-score', async (req, res) => {
  try {
    const { audioBase64, mimeType, targetSentence, language, ipaLine } = req.body as {
      audioBase64?: string;
      mimeType?: string;
      targetSentence?: string;
      language?: 'en' | 'ja';
      ipaLine?: string;
    };

    if (!audioBase64 || !targetSentence) {
      return res.status(400).json({ error: 'Thiếu dữ liệu ghi âm hoặc câu mục tiêu để chấm phát âm.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const { generateStructuredJsonWithAudio } = await import('./server/gemini.ts');

    const prompt =
      lang === 'ja'
        ? `Hãy nghe kỹ bản ghi âm giọng đọc Tiếng Nhật của người học và đối chiếu chặt chẽ với câu gốc:
Câu mục tiêu: "${targetSentence}"

Yêu cầu phân tích học thuật thực tế:
1. overallScore (0-100), fluencyScore (0-100), intonationScore (0-100).
2. transcriptHeard: những gì bạn thực sự nghe thấy người học nói.
3. summaryVi: nhận xét ngắn gọn, truyền cảm hứng và trúng đích bằng tiếng Việt.
4. words: chấm từng từ/cụm trong câu với status ('correct' | 'warning' | 'error'), score (0-100), issue (lỗi cụ thể như kéo thiếu trường âm, nuốt xúc âm っ, sai pitch), articulatoryTip (hướng dẫn đặt lưỡi/môi/nhịp cụ thể).
5. moraRhythmNote: đánh giá nhịp Mora (trường âm ー, xúc âm っ, âm mũi ん).
6. referencePitch: mảng tối đa 10 mora quan trọng nhất của cụm trọng tâm trong câu theo chuẩn Tokyo NHK ({text, pitch: 'L'|'H', drop?: boolean}).
7. userPitch: mảng cùng số lượng và text với referencePitch nhưng phản ánh đúng cao độ L/H mà người học vừa phát âm để vẽ đè so sánh trực quan!`
        : `Hãy nghe kỹ bản ghi âm giọng đọc Tiếng Anh của người học và đối chiếu chặt chẽ với câu gốc:
Câu mục tiêu: "${targetSentence}"
${ipaLine ? `IPA tham chiếu: ${ipaLine}` : ''}

Yêu cầu phân tích học thuật thực tế:
1. overallScore (0-100), fluencyScore (0-100), intonationScore (0-100).
2. transcriptHeard: những gì bạn thực sự nghe thấy người học nói.
3. summaryVi: nhận xét ngắn gọn, trúng đích bằng tiếng Việt.
4. words: chấm từng từ trong câu với status ('correct' | 'warning' | 'error'), score (0-100), issue (vd thiếu âm cuối /s/, /t/, /d/, sai trọng âm, đọc rời rạc), articulatoryTip (hướng dẫn đặt lưỡi/môi/luồng hơi cụ thể dễ làm theo ngay).
5. endingSoundsNote: nhận xét độ rõ của các âm cuối (Ending sounds).
6. linkingAndStressNote: nhận xét trọng âm từ, nối âm (Linking) và ngữ điệu lên/xuống câu.`;

    const schema: Record<string, unknown> = {
      type: Type.OBJECT,
      properties: {
        overallScore: { type: Type.INTEGER },
        fluencyScore: { type: Type.INTEGER },
        intonationScore: { type: Type.INTEGER },
        transcriptHeard: { type: Type.STRING },
        summaryVi: { type: Type.STRING },
        words: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              status: { type: Type.STRING, enum: ['correct', 'warning', 'error'] },
              score: { type: Type.INTEGER },
              issue: { type: Type.STRING },
              articulatoryTip: { type: Type.STRING },
            },
            required: ['word', 'status', 'score'],
          },
        },
        endingSoundsNote: { type: Type.STRING },
        linkingAndStressNote: { type: Type.STRING },
        moraRhythmNote: { type: Type.STRING },
        referencePitch: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              pitch: { type: Type.STRING, enum: ['L', 'H'] },
              drop: { type: Type.BOOLEAN },
            },
            required: ['text', 'pitch'],
          },
        },
        userPitch: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              pitch: { type: Type.STRING, enum: ['L', 'H'] },
              drop: { type: Type.BOOLEAN },
            },
            required: ['text', 'pitch'],
          },
        },
      },
      required: ['overallScore', 'fluencyScore', 'intonationScore', 'transcriptHeard', 'summaryVi', 'words'],
    };

    const assessment = await generateStructuredJsonWithAudio<Record<string, unknown>>({
      prompt,
      audioBase64,
      mimeType: mimeType || 'audio/webm',
      systemInstruction:
        'Chấm điểm phát âm khách quan, chính xác, chỉ ra đúng lỗi thật nghe được từ file âm thanh của người học và hướng dẫn khẩu hình cụ thể bằng tiếng Việt.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    return res.json({ assessment });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Hệ thống chấm phát âm đang tạm bận. Vui lòng thu âm thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 8. POST /api/linguistics/roleplay — Feature 12: Video-Context AI Roleplay Studio
// ---------------------------------------------------------------------------
app.post('/api/linguistics/roleplay', async (req, res) => {
  try {
    const {
      action,
      videoTitle,
      sceneExcerpt,
      language,
      targetLevel,
      personaName,
      scenarioVi,
      missions,
      history,
      userMessage,
    } = req.body as {
      action?: 'start' | 'reply';
      videoTitle?: string;
      sceneExcerpt?: string;
      language?: 'en' | 'ja';
      targetLevel?: string;
      personaName?: string;
      scenarioVi?: string;
      missions?: Array<{ term: string; meaningVi: string; used: boolean }>;
      history?: Array<{ role: 'ai' | 'user'; text: string }>;
      userMessage?: string;
    };

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const level = targetLevel || (lang === 'ja' ? 'N3' : 'B2');

    if (action === 'start') {
      const prompt = `Video: "${videoTitle || ''}"
Ngôn ngữ: ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'} · Trình độ: ${level}
Đoạn trích cảnh video:
${sceneExcerpt || ''}

Hãy khởi tạo một buổi NHẬP VAI HỘI THOẠI (3-5 lượt) nhập tâm đúng bối cảnh cảnh video trên:
1. personaName: Tên nhân vật/vai diễn AI sẽ đóng.
2. scenarioVi: Mô tả bối cảnh ngắn gọn bằng tiếng Việt (1-2 câu) để người học hiểu mình đang nói chuyện với ai.
3. missions: 4 từ vựng / cụm từ / mẫu ngữ pháp đắt giá trích TỪ CHÍNH ĐOẠN VIDEO TRÊN mà người học được khuyến khích vận dụng lại (gồm term, meaningVi).
4. openingText: Lời thoại mở màn tự nhiên của AI bằng ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'} (phù hợp trình độ ${level}, kết thúc bằng 1 câu hỏi mở gợi phản xạ).
5. openingTranslationVi: Dịch tiếng Việt lời thoại mở màn.`;

      const schema = {
        type: Type.OBJECT,
        properties: {
          personaName: { type: Type.STRING },
          scenarioVi: { type: Type.STRING },
          missions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING },
                meaningVi: { type: Type.STRING },
              },
              required: ['term', 'meaningVi'],
            },
          },
          openingText: { type: Type.STRING },
          openingTranslationVi: { type: Type.STRING },
        },
        required: ['personaName', 'scenarioVi', 'missions', 'openingText', 'openingTranslationVi'],
      };

      const data = await generateStructuredJson<Record<string, unknown>>({
        prompt,
        systemInstruction: 'Thiết kế phiên nhập vai hội thoại tự nhiên bám sát bối cảnh video.',
        responseSchema: schema,
        thinkingLevel: ThinkingLevel.LOW,
      });

      return res.json({ startData: data });
    }

    // Reply turn
    if (!userMessage) {
      return res.status(400).json({ error: 'Vui lòng nhập câu thoại phản hồi.' });
    }

    const prompt = `Bạn đang đóng vai: ${personaName || 'Nhân vật trong video'}
Bối cảnh: ${scenarioVi || ''}
Ngôn ngữ hội thoại: ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'} (Trình độ ${level})
Nhiệm vụ vi mô cần người học vận dụng: ${JSON.stringify(missions || [])}
Lịch sử hội thoại:
${(history || []).map((h) => `${h.role === 'ai' ? 'AI' : 'User'}: ${h.text}`).join('\n')}
User vừa nói: "${userMessage}"

Yêu cầu:
1. aiReply: Trả lời tự nhiên đúng vai diễn (1-3 câu) bằng ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}, đẩy mạch chuyện tiếp diễn.
2. aiReplyTranslationVi: Dịch tiếng Việt câu trả lời của AI.
3. correctionVi: Sửa lỗi ngữ pháp/từ vựng tự nhiên và tinh tế cho câu người học vừa nói bằng tiếng Việt (nếu câu đã chuẩn, khen ngợi ngắn gọn và gợi ý cách diễn đạt bản xứ hơn).
4. naturalAlternative: 1 câu gợi ý cách người bản xứ nói ý của User tự nhiên nhất bằng ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}.
5. matchedMissionTerms: Danh sách các term trong missions mà User vừa vận dụng đúng trong câu này.`;

    const replySchema = {
      type: Type.OBJECT,
      properties: {
        aiReply: { type: Type.STRING },
        aiReplyTranslationVi: { type: Type.STRING },
        correctionVi: { type: Type.STRING },
        naturalAlternative: { type: Type.STRING },
        matchedMissionTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['aiReply', 'aiReplyTranslationVi', 'correctionVi', 'naturalAlternative', 'matchedMissionTerms'],
    };

    const replyData = await generateStructuredJson<Record<string, unknown>>({
      prompt,
      systemInstruction: 'Hội thoại nhập vai tự nhiên, sửa lỗi sắc sảo và khuyến khích người học dùng lại từ vựng trong video.',
      responseSchema: replySchema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    return res.json({ replyData });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Phòng nhập vai hội thoại đang tạm bận. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 9. POST /api/linguistics/chapters — Feature 13: AI Smart Chapters & Mind-Map
// ---------------------------------------------------------------------------
app.post('/api/linguistics/chapters', async (req, res) => {
  try {
    const { lines, language, videoTitle } = req.body as {
      lines?: Array<{ start: number; end: number; text: string }>;
      language?: 'en' | 'ja';
      videoTitle?: string;
    };

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Chưa có phụ đề để chia chương học.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const levelEnum = lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

    // Sample evenly across the entire video so long 1-2 hour podcasts are covered end-to-end
    const maxSample = 110;
    const step = Math.max(1, Math.floor(lines.length / maxSample));
    const sampled = lines.filter((_, i) => i % step === 0 || i === lines.length - 1);
    const totalEnd = lines[lines.length - 1]?.end || 60;

    const prompt = `Video: "${videoTitle || ''}" (Tổng thời lượng: ${totalEnd.toFixed(0)} giây)
Ngôn ngữ: ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'}

Hãy chia toàn bộ video thành 3–7 Chương Học Ngắn (mỗi chương khoảng 1–3 phút hoặc theo mạch chuyển ý rõ ràng), tuyệt đối không bịa nội dung ngoài phụ đề:
Với mỗi chương trả về:
- start, end (giây thực tế lấy từ phụ đề)
- titleSource (tiêu đề ngắn bằng ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'})
- titleVi (tiêu đề tiếng Việt súc tích)
- summaryVi (tóm tắt đúng 1 câu tiếng Việt)
- difficultyLevel (đánh giá độ khó thực tế của riêng chương đó: ${levelEnum.join('/')})
- mindMapNodes (mảng 3 ý chính ngắn gọn để dựng Bản đồ tư duy Mind-Map của chương)

Phụ đề mẫu theo thời gian:
${sampled.map((l) => `[${l.start.toFixed(1)}s - ${l.end.toFixed(1)}s] ${l.text}`).join('\n')}`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        chapters: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              start: { type: Type.NUMBER },
              end: { type: Type.NUMBER },
              titleSource: { type: Type.STRING },
              titleVi: { type: Type.STRING },
              summaryVi: { type: Type.STRING },
              difficultyLevel: { type: Type.STRING, enum: levelEnum },
              mindMapNodes: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['start', 'end', 'titleSource', 'titleVi', 'summaryVi', 'difficultyLevel', 'mindMapNodes'],
          },
        },
      },
      required: ['chapters'],
    };

    const data = await generateStructuredJson<{ chapters: Array<Record<string, unknown>> }>({
      prompt,
      systemInstruction: 'Chia chương học ngắn thông minh và tạo bản đồ ý chính trung thực 100% theo dòng thời gian phụ đề.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    const chapters = (data.chapters || []).map((ch, idx) => ({
      ...ch,
      id: `ch_${idx}`,
      index: idx,
    }));

    return res.json({ chapters });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể chia chương & bản đồ ý chính lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 10. POST /api/linguistics/nuance-matrix — Feature 15: Nuance, Homophone & Collocation Matrix
// ---------------------------------------------------------------------------
app.post('/api/linguistics/nuance-matrix', async (req, res) => {
  try {
    const { lines, language, targetLevel, videoTitle } = req.body as {
      lines?: Array<{ start: number; text: string }>;
      language?: 'en' | 'ja';
      targetLevel?: string;
      videoTitle?: string;
    };

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Chưa có phụ đề để phân tích Ma trận sắc thái.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const transcript = lines
      .slice(0, 85)
      .map((l) => `[${l.start.toFixed(1)}s] ${l.text}`)
      .join('\n');

    const prompt =
      lang === 'ja'
        ? `Video Tiếng Nhật: "${videoTitle || ''}" (Trình độ ${targetLevel || 'N3'})
Từ phụ đề thực tế dưới đây, trích xuất 4–5 nhóm "Ma trận Phân biệt Sắc thái, Đồng âm & Cận nghĩa" (VD: 測る/計る/量る, 聞く/聴く/訊く, 変わる/代わる/替わる/換わる, 絶対 vs 必ず...) có xuất hiện từ gốc trong video:
Mỗi nhóm gồm:
- title (vd "Phân biệt 聞く vs 聴く vs 訊く")
- category ('homophone' | 'near_synonym' | 'collocation' | 'register_trap')
- timestamp (giây xuất hiện trong video)
- summaryVi (giải thích lõi khác biệt ngắn gọn trong 1 câu)
- items: mảng 3–4 từ so sánh theo Thang Đo Sắc Thái: term, readingOrIpa (Furigana + Hán Việt phổ thông), radicalOrRegisterNote (giải mã Bộ thủ Kanji), intensityScore (số nguyên 1..5 từ Nhẹ ➔ Mạnh), formalityLevel ("Suồng sã" | "Trung tính" | "Công sở / Học thuật"), sentiment ("positive"|"neutral"|"negative"), coreDifferenceVi (đúng 1 dòng khác biệt cốt lõi), signatureCollocation (1 cụm Collocation đinh hay đi kèm nhất), meaningVi, correctExample (câu ví dụ chuẩn ✅), trapWarning (bẫy dùng sai ❌).
- collocationPairs: 3 cụm kết hợp bản xứ đi kèm.

Phụ đề:
${transcript}`
        : `Video Tiếng Anh: "${videoTitle || ''}" (Trình độ ${targetLevel || 'B2'})
Từ phụ đề thực tế dưới đây, trích xuất 4–5 nhóm "Ma trận Phân biệt Sắc thái & Cận nghĩa" (VD: look/watch/stare/glance, big/huge/substantial/immense, say/tell/speak/talk, make/do...) gắn với từ vựng xuất hiện trong video:
Mỗi nhóm gồm:
- title (vd "Thang sắc thái: look · watch · glance · observe")
- category ('homophone' | 'near_synonym' | 'collocation' | 'register_trap')
- timestamp (giây xuất hiện trong video)
- summaryVi (giải thích lõi khác biệt trong 1 câu)
- items: mảng 3–4 từ đặt trên Thang Đo Sắc Thái: term, readingOrIpa (Oxford IPA chuẩn), radicalOrRegisterNote (sắc thái ngữ cảnh/quy tắc dùng), intensityScore (1..5 từ Nhẹ ➔ Mạnh), formalityLevel ("Suồng sã" | "Trung tính" | "Công sở / Học thuật"), sentiment ("positive"|"neutral"|"negative"), coreDifferenceVi (1 dòng khác biệt cốt lõi), signatureCollocation (1 cụm Collocation đinh), meaningVi, correctExample (ví dụ chuẩn ✅), trapWarning (bẫy người Việt hay sai ❌).
- collocationPairs: 3 cụm Collocation thực chiến.

Phụ đề:
${transcript}`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        groups: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              category: {
                type: Type.STRING,
                enum: ['homophone', 'near_synonym', 'collocation', 'register_trap'],
              },
              timestamp: { type: Type.NUMBER },
              summaryVi: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    term: { type: Type.STRING },
                    readingOrIpa: { type: Type.STRING },
                    radicalOrRegisterNote: { type: Type.STRING },
                    intensityScore: { type: Type.INTEGER },
                    formalityLevel: { type: Type.STRING },
                    sentiment: { type: Type.STRING, enum: ['positive', 'neutral', 'negative'] },
                    coreDifferenceVi: { type: Type.STRING },
                    signatureCollocation: { type: Type.STRING },
                    meaningVi: { type: Type.STRING },
                    correctExample: { type: Type.STRING },
                    trapWarning: { type: Type.STRING },
                  },
                  required: [
                    'term',
                    'readingOrIpa',
                    'radicalOrRegisterNote',
                    'intensityScore',
                    'formalityLevel',
                    'sentiment',
                    'coreDifferenceVi',
                    'signatureCollocation',
                    'meaningVi',
                    'correctExample',
                    'trapWarning',
                  ],
                },
              },
              collocationPairs: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['title', 'category', 'timestamp', 'summaryVi', 'items'],
          },
        },
      },
      required: ['groups'],
    };

    const data = await generateStructuredJson<{ groups: Array<Record<string, unknown>> }>({
      prompt,
      systemInstruction:
        'Phân tích Ma trận Sắc thái 3 trục (Mức độ · Trang trọng · Thái độ), Đồng âm và Collocation chính xác học thuật tuyệt đối.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    const matrix = (data.groups || []).map((g, idx) => ({
      ...g,
      id: `nm_${idx}`,
    }));

    return res.json({ matrix });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể phân tích Ma trận sắc thái lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 11. POST /api/linguistics/tutor — Feature 17: In-Video Context-Aware AI Sensei
// ---------------------------------------------------------------------------
app.post('/api/linguistics/tutor', async (req, res) => {
  try {
    const {
      selectedText,
      question,
      timestamp,
      surroundingLines,
      videoTitle,
      language,
      targetLevel,
    } = req.body as {
      selectedText?: string;
      question?: string;
      timestamp?: number;
      surroundingLines?: Array<{ start: number; text: string }>;
      videoTitle?: string;
      language?: 'en' | 'ja';
      targetLevel?: string;
    };

    if (!question && !selectedText) {
      return res.status(400).json({ error: 'Vui lòng nhập câu hỏi hoặc bôi đen đoạn thoại.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const contextBlock = (surroundingLines || [])
      .map((l) => `[${Math.floor(l.start / 60)}:${String(Math.floor(l.start % 60)).padStart(2, '0')}] ${l.text}`)
      .join('\n');

    const prompt = `Video: "${videoTitle || ''}" (${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'} · Trình độ ${targetLevel || ''})
Mốc thời gian đang hỏi: ${typeof timestamp === 'number' ? `${Math.floor(timestamp / 60)}:${String(Math.floor(timestamp % 60)).padStart(2, '0')}` : 'N/A'}
Đoạn thoại người học bôi đen: "${selectedText || ''}"
Câu hỏi của người học: "${question || 'Hãy giải thích sắc thái, ẩn ý văn hóa và cách dùng của đoạn này trong bối cảnh cảnh video.'}"

Mạch thoại xung quanh trong video:
${contextBlock}

Hãy đóng vai "AI Sensei" trả lời SIÊU NGẮN GỌN, SẮC BÉN, đi thẳng vào đúng mạch truyện/tình huống của cảnh video trên (tuyệt đối không giải thích chung chung kiểu từ điển):
- directAnswerVi: Câu trả lời cốt lõi sắc bén (3-5 câu tiếng Việt).
- culturalOrPragmaticNote: Ẩn ý văn hóa, cảm xúc nhân vật hoặc sắc thái khẩu ngữ ngay tại cảnh đó.
- nativeTakeaway: 1 mẫu câu ứng dụng thực tế người học có thể bắt chước dùng ngay.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        directAnswerVi: { type: Type.STRING },
        culturalOrPragmaticNote: { type: Type.STRING },
        nativeTakeaway: { type: Type.STRING },
      },
      required: ['directAnswerVi', 'culturalOrPragmaticNote', 'nativeTakeaway'],
    };

    const answer = await generateStructuredJson<Record<string, unknown>>({
      prompt,
      systemInstruction:
        'Bạn là Gia sư AI Sensei am hiểu sâu sắc ngữ cảnh video, giải thích ngắn gọn, đúng trọng tâm và không bao giờ trả lời máy móc.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    return res.json({ answer });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Gia sư đang tạm bận. Vui lòng gửi lại câu hỏi sau vài giây.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 12. POST /api/linguistics/collocations-3tier — 3-Tier Collocations + Dual 15s Drills
// ---------------------------------------------------------------------------
app.post('/api/linguistics/collocations-3tier', async (req, res) => {
  try {
    const { lines, language, targetLevel, videoTitle, excludeExpressions, count } = req.body as {
      lines?: Array<{ start: number; text: string; translationVi?: string }>;
      language?: 'en' | 'ja';
      targetLevel?: string;
      videoTitle?: string;
      excludeExpressions?: string[];
      count?: number;
    };

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Chưa có phụ đề để xây dựng Collocations 3 tầng.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const levelEnum =
      lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const requestedCount = typeof count === 'number' && count >= 1 && count <= 7 ? count : 6;
    const excludes = Array.isArray(excludeExpressions)
      ? excludeExpressions.map((e) => String(e).trim()).filter(Boolean).slice(-60)
      : [];

    const excerpt = lines
      .slice(0, 75)
      .map((l) => `[${l.start.toFixed(1)}s] ${l.text}${l.translationVi ? ` (${l.translationVi})` : ''}`)
      .join('\n');

    const prompt = `Video: "${videoTitle || ''}"
Ngôn ngữ học: ${lang === 'ja' ? 'Tiếng Nhật (chuẩn Đại Từ Lâm / NHK / BCCWJ)' : 'Tiếng Anh (chuẩn Oxford / Cambridge Collocations)'} · Trình độ hiện tại: ${targetLevel || (lang === 'ja' ? 'N3' : 'B2')}

Từ nội dung phụ đề thực tế bên dưới, hãy trích xuất ĐÚNG ${requestedCount} Ý DIỄN ĐẠT ĐẮT GIÁ NHẤT và xây dựng BẢNG COLLOCATIONS 3 TẦNG:
- Tầng 1 (casual — 🟢 Đời thường / Cơ bản: ${lang === 'ja' ? 'N5–N4' : 'A1–B1'}): Cách nói tự nhiên đời sống hằng ngày.
- Tầng 2 (natural — 🔵 Tự nhiên & Sắc thái bản xứ: ${lang === 'ja' ? 'N3–N2' : 'B1–B2'}): Phrasal Verb / Collocation / Quán dụng ngữ có hồn, thoát văn phong sách giáo khoa.
- Tầng 3 (academic — 🟣 Học thuật & Chuyên nghiệp: ${lang === 'ja' ? 'N2–N1 / Văn viết / Business' : 'C1–C2 / IELTS / Executive'}): Diễn đạt viết luận, thuyết trình, báo chí đỉnh cao.

${
  excludes.length > 0
    ? `KỶ LUẬT CHỐNG TRÙNG LẶP 0%: TUYỆT ĐỐI KHÔNG lặp lại bất kỳ cụm từ nào trong danh sách đã học sau đây:\n${excludes.join(' | ')}\nHãy chọn hoàn toàn ${requestedCount} ý diễn đạt & collocations MỚI 100% khác từ video!`
    : ''
}

Với mỗi mục trả về:
- vietnameseConcept: Ý diễn đạt tiếng Việt cốt lõi rút ra từ video.
- patternFormula: Công thức cấu tạo chính xác (vd "${lang === 'ja' ? 'Danh từ + を + Động từ' : 'Verb + Noun / Adj + Noun'}").
- contextCompareVi: 1-2 câu so sánh ngắn gọn khi nào dùng Tầng 1 (nói thân mật) vs Tầng 2 (giao tiếp tự nhiên) vs Tầng 3 (viết luận/thuyết trình).
- timestamp: Mốc giây xuất hiện ý này trong video.
- antiCalqueCorrect: Dạng kết hợp ĐÚNG bản xứ (vd "${lang === 'ja' ? '薬を飲む / 時間をかける' : 'take medicine / make a decision'}").
- antiCalqueTrap: Dạng bẫy SAI do dịch word-by-word từ tiếng Việt (vd "${lang === 'ja' ? '薬を食べる / 時間がかける' : 'drink medicine / do a decision'}").
- antiCalqueParticleNote: Ghi chú ngắn khóa chặt giới từ / trợ từ (vd "${lang === 'ja' ? 'Khóa trợ từ を (tha động từ) vs が (tự động từ)' : 'Bắt buộc dùng động từ make/take + giới từ chuẩn'}").
- casual / natural / academic: Mỗi tầng gồm expression, readingOrIpa (${lang === 'ja' ? 'Furigana chuẩn đúng ngữ cảnh' : 'IPA chuẩn Oxford/Cambridge'}), ${lang === 'ja' ? 'hanViet (Hán Việt hiện đại nếu có Kanji), ' : ''}level (${levelEnum.join('|')}), exampleSentence, nuanceVi.
- Chế độ Luyện 1 (Partner Cloze — Tìm Nửa Kia):
  + quickDrillQuestion: Câu điền khuyết 1 chỗ trống (___) kiểm tra ghép đúng nửa kia của collocation.
  + quickDrillOptions: Đúng 3 phương án (chỉ 1 đúng, 2 bẫy nhiễu tự nhiên).
  + quickDrillCorrectIndex: 0, 1 hoặc 2.
- Chế độ Luyện 2 (Style Upgrade — Đổi Tầng Văn Phong):
  + styleUpgradePromptVi: Yêu cầu nâng cấp câu nói bình dân lên câu học thuật/tự nhiên (vd "Nâng cấp cụm đời thường sang văn phong IELTS / Business").
  + styleUpgradeCasualSentence: 1 câu văn đời thường đơn giản chứa cụm Tầng 1.
  + styleUpgradeOptions: Đúng 3 câu viết lại (chỉ 1 câu nâng cấp chuẩn xác nhất bằng Collocation Tầng 2/3, 2 phương án còn lại sai collocation/trợ từ/giới từ).
  + styleUpgradeCorrectIndex: 0, 1 hoặc 2.

Phụ đề video:
${excerpt}`;

    const variantSchema = {
      type: Type.OBJECT,
      properties: {
        expression: { type: Type.STRING },
        readingOrIpa: { type: Type.STRING },
        hanViet: { type: Type.STRING },
        level: { type: Type.STRING, enum: levelEnum },
        exampleSentence: { type: Type.STRING },
        nuanceVi: { type: Type.STRING },
      },
      required: ['expression', 'readingOrIpa', 'level', 'exampleSentence', 'nuanceVi'],
    };

    const schema = {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              vietnameseConcept: { type: Type.STRING },
              patternFormula: { type: Type.STRING },
              contextCompareVi: { type: Type.STRING },
              timestamp: { type: Type.NUMBER },
              antiCalqueCorrect: { type: Type.STRING },
              antiCalqueTrap: { type: Type.STRING },
              antiCalqueParticleNote: { type: Type.STRING },
              casual: variantSchema,
              natural: variantSchema,
              academic: variantSchema,
              quickDrillQuestion: { type: Type.STRING },
              quickDrillOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              quickDrillCorrectIndex: { type: Type.INTEGER },
              styleUpgradePromptVi: { type: Type.STRING },
              styleUpgradeCasualSentence: { type: Type.STRING },
              styleUpgradeOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              styleUpgradeCorrectIndex: { type: Type.INTEGER },
            },
            required: [
              'vietnameseConcept',
              'patternFormula',
              'contextCompareVi',
              'timestamp',
              'antiCalqueCorrect',
              'antiCalqueTrap',
              'casual',
              'natural',
              'academic',
              'quickDrillQuestion',
              'quickDrillOptions',
              'quickDrillCorrectIndex',
              'styleUpgradePromptVi',
              'styleUpgradeCasualSentence',
              'styleUpgradeOptions',
              'styleUpgradeCorrectIndex',
            ],
          },
        },
      },
      required: ['items'],
    };

    const data = await generateStructuredJson<{ items: Array<Record<string, unknown>> }>({
      prompt,
      systemInstruction:
        'Xây dựng bảng Collocations 3 tầng Đời thường -> Tự nhiên -> Học thuật chính xác 100% theo chuẩn Oxford/Cambridge & Đại Từ Lâm/NHK, chống tuyệt đối Vietlish và sai trợ từ.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.MEDIUM,
    });

    const excludeSet = new Set(excludes.map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()));
    const items = (data.items || [])
      .filter((it) => {
        const nat = (it.natural as { expression?: string } | undefined)?.expression || '';
        const cas = (it.casual as { expression?: string } | undefined)?.expression || '';
        const aca = (it.academic as { expression?: string } | undefined)?.expression || '';
        const norms = [cas, nat, aca].map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim());
        return norms.every((n) => !n || !excludeSet.has(n));
      })
      .map((it, idx) => ({
        ...it,
        id: `col3_${idx}_${Date.now()}`,
      }));

    return res.json({ items });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể tổng hợp Collocations 3 tầng lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 13. POST /api/linguistics/collocation-web — Core-Word Collocation Map
// ---------------------------------------------------------------------------
app.post('/api/linguistics/collocation-web', async (req, res) => {
  try {
    const { coreWord, language, excludeExpressions } = req.body as {
      coreWord?: string;
      language?: 'en' | 'ja';
      excludeExpressions?: string[];
    };

    const word = String(coreWord || '').trim();
    if (!word) {
      return res.status(400).json({ error: 'Vui lòng nhập từ gốc cần mở bản đồ Collocations.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const levelEnum =
      lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const excludes = Array.isArray(excludeExpressions)
      ? excludeExpressions.map((e) => String(e).trim()).filter(Boolean).slice(-60)
      : [];

    const prompt = `Xây dựng BẢN ĐỒ COLLOCATIONS TỪ GỐC (Core-Word Collocation Web) chuẩn xác 100% theo từ điển ${
      lang === 'ja' ? 'Đại Từ Lâm (大辞林) / NHK / BCCWJ' : 'Oxford / Cambridge Collocations Dictionary'
    } cho từ gốc: "${word}".

${
  excludes.length > 0
    ? `KỶ LUẬT CHỐNG TRÙNG LẶP 0%: TUYỆT ĐỐI KHÔNG lặp lại các cụm từ sau đây:\n${excludes.join(' | ')}\nHãy sinh ra các kết hợp MỚI HOÀN TOÀN nhưng vẫn là collocation chuẩn tự nhiên 100% của "${word}".`
    : ''
}

Yêu cầu phân nhánh thành ĐÚNG 3 nhánh rõ ràng (mỗi nhánh 3 cụm kết hợp thực dụng nhất, trải đều 🟢 casual / 🔵 natural / 🟣 academic):
1. verbNoun: Các kết hợp Động từ + Danh từ (hoặc Danh từ + Trợ từ + Động từ với tiếng Nhật) xoay quanh "${word}".
2. adjNoun: Các kết hợp Tính từ + Danh từ (hoặc Định ngữ + Danh từ) xoay quanh "${word}".
3. advVerbAdj: Các kết hợp Trạng từ + Động từ/Tính từ (hoặc cụm phó từ cố định) xoay quanh "${word}".

Mỗi cụm trong nhánh gồm:
- expression: Cụm Collocation chuẩn bản xứ (khóa chặt giới từ / trợ từ が/を/に/で).
- patternFormula: Công thức ngắn (vd "${lang === 'ja' ? 'N + を + V' : 'Verb + Noun'}").
- readingOrIpa: ${lang === 'ja' ? 'Furigana Hiragana chuẩn đúng ngữ cảnh' : 'IPA chuẩn Oxford/Cambridge'}.
- hanViet: ${lang === 'ja' ? 'Hán Việt hiện đại từng chữ Kanji (để "" nếu không có Kanji)' : 'Để ""'}.
- tier: "casual" | "natural" | "academic".
- level: ${levelEnum.join('|')}.
- meaningVi: Nghĩa tiếng Việt tự nhiên, sắc nét.
- exampleSentence: 1 câu ví dụ chuẩn bản xứ giàu ngữ cảnh.
- antiCalque: { correctForm, wrongTrap, particleOrPrepHighlight, explanationVi } cảnh báo bẫy dịch sai cho cụm này.`;

    const branchItemSchema = {
      type: Type.OBJECT,
      properties: {
        expression: { type: Type.STRING },
        patternFormula: { type: Type.STRING },
        readingOrIpa: { type: Type.STRING },
        hanViet: { type: Type.STRING },
        tier: { type: Type.STRING, enum: ['casual', 'natural', 'academic'] },
        level: { type: Type.STRING, enum: levelEnum },
        meaningVi: { type: Type.STRING },
        exampleSentence: { type: Type.STRING },
        antiCalque: {
          type: Type.OBJECT,
          properties: {
            correctForm: { type: Type.STRING },
            wrongTrap: { type: Type.STRING },
            particleOrPrepHighlight: { type: Type.STRING },
            explanationVi: { type: Type.STRING },
          },
          required: ['correctForm', 'wrongTrap', 'explanationVi'],
        },
      },
      required: ['expression', 'patternFormula', 'readingOrIpa', 'tier', 'level', 'meaningVi', 'exampleSentence'],
    };

    const schema = {
      type: Type.OBJECT,
      properties: {
        coreWord: { type: Type.STRING },
        readingOrIpa: { type: Type.STRING },
        hanViet: { type: Type.STRING },
        meaningVi: { type: Type.STRING },
        verbNoun: { type: Type.ARRAY, items: branchItemSchema },
        adjNoun: { type: Type.ARRAY, items: branchItemSchema },
        advVerbAdj: { type: Type.ARRAY, items: branchItemSchema },
      },
      required: ['coreWord', 'readingOrIpa', 'meaningVi', 'verbNoun', 'adjNoun', 'advVerbAdj'],
    };

    const data = await generateStructuredJson<{
      coreWord: string;
      readingOrIpa: string;
      hanViet?: string;
      meaningVi: string;
      verbNoun: Array<Record<string, unknown>>;
      adjNoun: Array<Record<string, unknown>>;
      advVerbAdj: Array<Record<string, unknown>>;
    }>({
      prompt,
      systemInstruction:
        'Xây dựng bản đồ Collocations từ gốc theo chuẩn Oxford/Cambridge và Đại Từ Lâm/NHK. Chỉ trả về collocations có thật 100%, khóa chặt trợ từ và giới từ.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    const excludeSet = new Set(excludes.map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()));
    const tagBranch = (arr: Array<Record<string, unknown>> | undefined, prefix: string) =>
      (arr || [])
        .filter((it) => {
          const expr = String(it.expression || '').toLowerCase().replace(/\s+/g, ' ').trim();
          return expr && !excludeSet.has(expr);
        })
        .map((it, idx) => ({ ...it, id: `web_${prefix}_${idx}_${Date.now()}` }));

    return res.json({
      web: {
        coreWord: data.coreWord || word,
        language: lang,
        readingOrIpa: data.readingOrIpa || '',
        hanViet: data.hanViet || '',
        meaningVi: data.meaningVi || '',
        verbNoun: tagBranch(data.verbNoun, 'vn'),
        adjNoun: tagBranch(data.adjNoun, 'an'),
        advVerbAdj: tagBranch(data.advVerbAdj, 'av'),
      },
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể tạo bản đồ Collocations từ gốc lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 14. POST /api/linguistics/collocations-expand — Infinite [+3 Collocations Mới] (0% Duplicates)
// ---------------------------------------------------------------------------
app.post('/api/linguistics/collocations-expand', async (req, res) => {
  try {
    const {
      language,
      topicId,
      topicTitleVi,
      branch,
      tierFilter,
      excludeExpressions,
    } = req.body as {
      language?: 'en' | 'ja';
      topicId?: string;
      topicTitleVi?: string;
      branch?: 'everyday' | 'academic';
      tierFilter?: 'all' | 'casual' | 'natural' | 'academic';
      excludeExpressions?: string[];
    };

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const safeBranch: 'everyday' | 'academic' = branch === 'academic' ? 'academic' : 'everyday';
    const levelEnum =
      lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const excludes = Array.isArray(excludeExpressions)
      ? excludeExpressions.map((e) => String(e).trim()).filter(Boolean).slice(-80)
      : [];

    const tierRule =
      tierFilter && tierFilter !== 'all'
        ? `Tất cả 3 cụm BẮT BUỘC thuộc tầng "${tierFilter}".`
        : 'Trả về ĐÚNG 3 cụm phủ đủ 3 tầng: 1 cụm casual (🟢 Đời thường), 1 cụm natural (🔵 Tự nhiên bản xứ), 1 cụm academic (🟣 Học thuật/Chuyên nghiệp).';

    const prompt = `Mở rộng thư viện Collocations Bách Khoa cho chủ đề: "${topicTitleVi || topicId || 'Giao tiếp & Học thuật'}" (Nhánh: ${
      safeBranch === 'academic' ? 'Học thuật & Chuyên nghiệp' : 'Đời sống hằng ngày'
    })
Ngôn ngữ: ${lang === 'ja' ? 'Tiếng Nhật (chuẩn Đại Từ Lâm / NHK / BCCWJ)' : 'Tiếng Anh (chuẩn Oxford / Cambridge Collocations)'}
${tierRule}

${
  excludes.length > 0
    ? `KỶ LUẬT CHỐNG TRÙNG LẶP 0% (BẮT BUỘC TUYỆT ĐỐI): Không được lặp lại bất kỳ cụm từ nào dưới đây (kể cả chia thì khác):\n${excludes.join(' | ')}`
    : ''
}

Sinh ĐÚNG 3 cụm Collocations MỚI 100%, tần suất thực chiến cao, tuyệt đối không bịa đặt.
Mỗi cụm bắt buộc có:
- tier: "casual" | "natural" | "academic"
- level: ${levelEnum.join('|')}
- expression: Cụm Collocation chuẩn bản xứ
- patternFormula: Công thức cấu tạo (vd "${lang === 'ja' ? 'Danh từ + を + Động từ' : 'Verb + Noun'}")
- readingOrIpa: ${lang === 'ja' ? 'Furigana Hiragana chuẩn ngữ cảnh' : 'IPA chuẩn Oxford/Cambridge'}
- hanViet: ${lang === 'ja' ? 'Âm Hán Việt phổ thông hiện đại (để "" nếu toàn kana)' : 'Để ""'}
- meaningVi: Nghĩa tiếng Việt tự nhiên
- exampleSentence: 1 câu ví dụ chuẩn bản xứ
- exampleTranslationVi: Bản dịch tiếng Việt tự nhiên cho câu ví dụ
- antiCalque: { correctForm, wrongTrap, particleOrPrepHighlight, explanationVi } (cảnh báo lỗi dịch cứng/sai trợ từ/sai giới từ thực tế của người Việt)
- upgradeLadder: { casual, natural, academic, contextCompareVi } (3 nấc diễn đạt cùng ý từ đời thường -> tự nhiên -> học thuật + ghi chú so sánh ngữ cảnh).`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        entries: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              tier: { type: Type.STRING, enum: ['casual', 'natural', 'academic'] },
              level: { type: Type.STRING, enum: levelEnum },
              expression: { type: Type.STRING },
              patternFormula: { type: Type.STRING },
              readingOrIpa: { type: Type.STRING },
              hanViet: { type: Type.STRING },
              meaningVi: { type: Type.STRING },
              exampleSentence: { type: Type.STRING },
              exampleTranslationVi: { type: Type.STRING },
              antiCalque: {
                type: Type.OBJECT,
                properties: {
                  correctForm: { type: Type.STRING },
                  wrongTrap: { type: Type.STRING },
                  particleOrPrepHighlight: { type: Type.STRING },
                  explanationVi: { type: Type.STRING },
                },
                required: ['correctForm', 'wrongTrap', 'explanationVi'],
              },
              upgradeLadder: {
                type: Type.OBJECT,
                properties: {
                  casual: { type: Type.STRING },
                  natural: { type: Type.STRING },
                  academic: { type: Type.STRING },
                  contextCompareVi: { type: Type.STRING },
                },
                required: ['casual', 'natural', 'academic', 'contextCompareVi'],
              },
            },
            required: [
              'tier',
              'level',
              'expression',
              'patternFormula',
              'readingOrIpa',
              'meaningVi',
              'exampleSentence',
              'exampleTranslationVi',
              'antiCalque',
              'upgradeLadder',
            ],
          },
        },
      },
      required: ['entries'],
    };

    const data = await generateStructuredJson<{ entries: Array<Record<string, unknown>> }>({
      prompt,
      systemInstruction:
        'Bạn là biên tập viên từ điển Collocations Oxford/Cambridge & Đại Từ Lâm/NHK. Chỉ sinh cụm từ thực thụ 100%, không lặp lại lịch sử đã có.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    const excludeSet = new Set(excludes.map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()));
    const seenNow = new Set<string>();
    const entries = (data.entries || [])
      .filter((it) => {
        const norm = String(it.expression || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!norm || excludeSet.has(norm) || seenNow.has(norm)) return false;
        seenNow.add(norm);
        return true;
      })
      .map((it, idx) => ({
        ...it,
        id: `exp_${topicId || 'gen'}_${idx}_${Date.now()}`,
        topicId: topicId || 'daily_life',
        branch: safeBranch,
        language: lang,
      }));

    return res.json({ entries });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể mở rộng thêm Collocations mới lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 15. POST /api/linguistics/word-more-collocations — +3 Practical Collocations for 1-Click Dossier
// ---------------------------------------------------------------------------
app.post('/api/linguistics/word-more-collocations', async (req, res) => {
  try {
    const { word, language, excludeExpressions } = req.body as {
      word?: string;
      language?: 'en' | 'ja';
      excludeExpressions?: string[];
    };

    const cleanWord = String(word || '').trim();
    if (!cleanWord) {
      return res.status(400).json({ error: 'Thiếu từ gốc để mở rộng cụm từ.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const levelEnum = lang === 'ja' ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const excludes = Array.isArray(excludeExpressions) ? excludeExpressions.slice(0, 60) : [];

    const prompt =
      lang === 'ja'
        ? `Sinh ĐÚNG 3 cụm Collocation thực chiến MỚI xoay quanh từ Tiếng Nhật "${cleanWord}" (phân bổ 1 casual, 1 natural, 1 academic) theo chuẩn NHK/Đại Từ Lâm.
${excludes.length > 0 ? `CẤM TRÙNG LẶP các cụm đã có: ${excludes.join(' | ')}` : ''}
Mỗi cụm gồm: expression, tier ('casual'|'natural'|'academic'), level (${levelEnum.join('|')}), readingOrIpa (Furigana), hanViet (Hán Việt hiện đại), meaningVi, exampleSentence.`
        : `Sinh ĐÚNG 3 cụm Collocation thực chiến MỚI xoay quanh từ Tiếng Anh "${cleanWord}" (phân bổ 1 casual, 1 natural, 1 academic/IELTS) theo chuẩn Oxford/Cambridge Collocations Dictionary.
${excludes.length > 0 ? `CẤM TRÙNG LẶP các cụm đã có: ${excludes.join(' | ')}` : ''}
Mỗi cụm gồm: expression, tier ('casual'|'natural'|'academic'), level (${levelEnum.join('|')}), readingOrIpa (Oxford IPA), meaningVi, exampleSentence.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              expression: { type: Type.STRING },
              tier: { type: Type.STRING, enum: ['casual', 'natural', 'academic'] },
              level: { type: Type.STRING, enum: levelEnum },
              readingOrIpa: { type: Type.STRING },
              hanViet: { type: Type.STRING },
              meaningVi: { type: Type.STRING },
              exampleSentence: { type: Type.STRING },
            },
            required: ['expression', 'tier', 'level', 'readingOrIpa', 'meaningVi', 'exampleSentence'],
          },
        },
      },
      required: ['items'],
    };

    const data = await generateStructuredJson<{ items: Array<Record<string, unknown>> }>({
      prompt,
      systemInstruction: 'Sinh 3 cụm Collocation thực chiến chuẩn bản xứ, tuyệt đối không trùng lặp lịch sử.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    const excludeSet = new Set(excludes.map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()));
    const items = (data.items || []).filter((it) => {
      const norm = String(it.expression || '').toLowerCase().replace(/\s+/g, ' ').trim();
      return norm && !excludeSet.has(norm);
    });

    return res.json({ items: items.slice(0, 3) });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể tải thêm 3 cụm từ thực chiến lúc này.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 16. POST /api/linguistics/nuance-expand — +3 Related Confusing Synonym/Homophone Pairs
// ---------------------------------------------------------------------------
app.post('/api/linguistics/nuance-expand', async (req, res) => {
  try {
    const { language, targetLevel, videoTitle, excludeTitles } = req.body as {
      language?: 'en' | 'ja';
      targetLevel?: string;
      videoTitle?: string;
      excludeTitles?: string[];
    };

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const excludes = Array.isArray(excludeTitles) ? excludeTitles.slice(0, 40) : [];

    const prompt =
      lang === 'ja'
        ? `Sinh ĐÚNG 3 nhóm Ma trận Đồng âm / Cận nghĩa dễ nhầm MỚI cho người học Tiếng Nhật trình độ ${targetLevel || 'N3'} liên quan chủ đề "${videoTitle || 'Giao tiếp & công việc'}".
${excludes.length > 0 ? `TUYỆT ĐỐI KHÔNG TRÙNG các nhóm đã hiển thị: ${excludes.join(' | ')}` : ''}
Mỗi nhóm gồm 3 từ so sánh trên Thang Sắc Thái (intensityScore 1..5, formalityLevel, sentiment, coreDifferenceVi, signatureCollocation, radicalOrRegisterNote, correctExample ✅, trapWarning ❌).`
        : `Sinh ĐÚNG 3 nhóm Ma trận Cận nghĩa / Đồng nghĩa dễ nhầm MỚI cho người học Tiếng Anh trình độ ${targetLevel || 'B2'} liên quan chủ đề "${videoTitle || 'Giao tiếp & học thuật'}".
${excludes.length > 0 ? `TUYỆT ĐỐI KHÔNG TRÙNG các nhóm đã hiển thị: ${excludes.join(' | ')}` : ''}
Mỗi nhóm gồm 3 từ so sánh trên Thang Sắc Thái (intensityScore 1..5, formalityLevel, sentiment, coreDifferenceVi, signatureCollocation, radicalOrRegisterNote, correctExample ✅, trapWarning ❌).`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        groups: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              category: {
                type: Type.STRING,
                enum: ['homophone', 'near_synonym', 'collocation', 'register_trap'],
              },
              timestamp: { type: Type.NUMBER },
              summaryVi: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    term: { type: Type.STRING },
                    readingOrIpa: { type: Type.STRING },
                    radicalOrRegisterNote: { type: Type.STRING },
                    intensityScore: { type: Type.INTEGER },
                    formalityLevel: { type: Type.STRING },
                    sentiment: { type: Type.STRING, enum: ['positive', 'neutral', 'negative'] },
                    coreDifferenceVi: { type: Type.STRING },
                    signatureCollocation: { type: Type.STRING },
                    meaningVi: { type: Type.STRING },
                    correctExample: { type: Type.STRING },
                    trapWarning: { type: Type.STRING },
                  },
                  required: [
                    'term',
                    'readingOrIpa',
                    'radicalOrRegisterNote',
                    'intensityScore',
                    'formalityLevel',
                    'sentiment',
                    'coreDifferenceVi',
                    'signatureCollocation',
                    'meaningVi',
                    'correctExample',
                    'trapWarning',
                  ],
                },
              },
              collocationPairs: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['title', 'category', 'timestamp', 'summaryVi', 'items'],
          },
        },
      },
      required: ['groups'],
    };

    const data = await generateStructuredJson<{ groups: Array<Record<string, unknown>> }>({
      prompt,
      systemInstruction:
        'Mở rộng thêm 3 cặp từ cận nghĩa/đồng âm kinh điển chuẩn xác tuyệt đối, không trùng lặp danh sách cũ.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    const groups = (data.groups || []).slice(0, 3).map((g, idx) => ({
      ...g,
      id: `nm_exp_${Date.now()}_${idx}`,
      timestamp: typeof g.timestamp === 'number' ? g.timestamp : 0,
    }));

    return res.json({ groups });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể mở rộng thêm 3 cặp từ dễ nhầm lúc này.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 17. POST /api/linguistics/production-lab — Super-System 5: 4-Mode Active Production Pack
// ---------------------------------------------------------------------------
app.post('/api/linguistics/production-lab', async (req, res) => {
  try {
    const { lines, language, targetLevel, videoTitle } = req.body as {
      lines?: Array<{ start: number; text: string; translationVi?: string }>;
      language?: 'en' | 'ja';
      targetLevel?: string;
      videoTitle?: string;
    };

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Cần có phụ đề video để tạo Phòng Luyện Phản Xạ.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const transcript = lines
      .slice(0, 60)
      .map((l) => `[${l.start.toFixed(1)}s] ${l.text}${l.translationVi ? ` (${l.translationVi})` : ''}`)
      .join('\n');

    const prompt = `Video "${videoTitle || ''}" (${lang === 'ja' ? `Tiếng Nhật ${targetLevel || 'N3'}` : `Tiếng Anh ${targetLevel || 'B2'}`}).
Tạo bộ bài tập Phòng Luyện Phản Xạ Chủ Động (Active Production Pack) bám sát 100% các câu thực tế trong phụ đề dưới đây:

1. clozeDrills (4 câu Điền Khuyết Ngữ Cảnh Gốc):
   - Trích câu thật từ video, thay đúng 1 từ khóa / Collocation / trợ từ / dạng chia động từ bằng "_____" trong sentenceWithBlank.
   - missingAnswer: đáp án chính xác 100%; acceptedAnswers: mảng 1–2 biến thể hợp lệ (vd kèm hiragana nếu là Kanji).
   - translationVi, hintVi (gợi ý sắc nét không lộ đáp án), targetCategory ('vocab'|'collocation'|'particle'|'tense'|'grammar'), explanationVi, timestamp (giây thực tế).

2. builderDrills (3 câu Xếp Gạch Trật Tự Câu — đặc trị tư duy cú pháp):
   - Chọn 3 câu hay trong video, cắt thành 4–6 cụm mảnh logic theo đúng thứ tự chuẩn trong correctChunks.
   - translationVi, orderRuleVi (giải thích 1 câu vì sao thứ tự cú pháp phải sắp như vậy), timestamp.

3. redPenDrills (4 câu Thợ Săn Lỗi Sai Bút Đỏ):
   - Lấy câu mẫu từ ngữ cảnh video nhưng CỐ Ý CÀI ĐÚNG 1 LỖI KINH ĐIỂN (${lang === 'ja' ? 'sai trợ từ は/が/を/に/で, sai tự/tha động từ, hoặc dịch word-by-word từ tiếng Việt' : 'sai thì Tense, sai giới từ/Collocation, hoặc bẫy dịch Vietlish'}).
   - Chia câu có lỗi thành mảng 5–9 mảnh tokens, chỉ rõ errorTokenIndex (chỉ số 0-based của ĐÚNG 1 mảnh sai duy nhất), wrongFragment (khớp chính xác tokens[errorTokenIndex]), fixedFragment, fixedSentence (câu đã sửa hoàn chỉnh), errorCategory ('particle'|'transitivity'|'tense'|'preposition'|'calque'), explanationVi, timestamp.

4. suggestedPrompts (4 từ vựng / mẫu ngữ pháp đinh từ video để người học tự đặt câu ở Xưởng Output Coach): targetTerm, meaningVi, kind ('vocab'|'grammar').

Phụ đề:
${transcript}`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        clozeDrills: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.NUMBER },
              sentenceWithBlank: { type: Type.STRING },
              missingAnswer: { type: Type.STRING },
              acceptedAnswers: { type: Type.ARRAY, items: { type: Type.STRING } },
              translationVi: { type: Type.STRING },
              hintVi: { type: Type.STRING },
              targetCategory: {
                type: Type.STRING,
                enum: ['vocab', 'collocation', 'particle', 'tense', 'grammar'],
              },
              explanationVi: { type: Type.STRING },
            },
            required: [
              'timestamp',
              'sentenceWithBlank',
              'missingAnswer',
              'acceptedAnswers',
              'translationVi',
              'hintVi',
              'targetCategory',
              'explanationVi',
            ],
          },
        },
        builderDrills: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.NUMBER },
              translationVi: { type: Type.STRING },
              correctChunks: { type: Type.ARRAY, items: { type: Type.STRING } },
              orderRuleVi: { type: Type.STRING },
            },
            required: ['timestamp', 'translationVi', 'correctChunks', 'orderRuleVi'],
          },
        },
        redPenDrills: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.NUMBER },
              tokens: { type: Type.ARRAY, items: { type: Type.STRING } },
              errorTokenIndex: { type: Type.INTEGER },
              wrongFragment: { type: Type.STRING },
              fixedFragment: { type: Type.STRING },
              fixedSentence: { type: Type.STRING },
              errorCategory: {
                type: Type.STRING,
                enum: ['particle', 'transitivity', 'tense', 'preposition', 'calque'],
              },
              explanationVi: { type: Type.STRING },
            },
            required: [
              'timestamp',
              'tokens',
              'errorTokenIndex',
              'wrongFragment',
              'fixedFragment',
              'fixedSentence',
              'errorCategory',
              'explanationVi',
            ],
          },
        },
        suggestedPrompts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              targetTerm: { type: Type.STRING },
              meaningVi: { type: Type.STRING },
              kind: { type: Type.STRING, enum: ['vocab', 'grammar'] },
            },
            required: ['targetTerm', 'meaningVi', 'kind'],
          },
        },
      },
      required: ['clozeDrills', 'builderDrills', 'redPenDrills', 'suggestedPrompts'],
    };

    const data = await generateStructuredJson<{
      clozeDrills?: Array<Record<string, unknown>>;
      builderDrills?: Array<{
        timestamp: number;
        translationVi: string;
        correctChunks: string[];
        orderRuleVi: string;
      }>;
      redPenDrills?: Array<{
        timestamp: number;
        tokens: string[];
        errorTokenIndex: number;
        wrongFragment: string;
        fixedFragment: string;
        fixedSentence: string;
        errorCategory: string;
        explanationVi: string;
      }>;
      suggestedPrompts?: Array<{ targetTerm: string; meaningVi: string; kind: 'vocab' | 'grammar' }>;
    }>({
      prompt,
      systemInstruction:
        'Thiết kế bài luyện phản xạ chủ động (Cloze · Xếp gạch cú pháp · Săn lỗi Bút Đỏ) chính xác 100% học thuật, không sai đáp án.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
    });

    // Deterministic non-trivial shuffle for Sentence Builder chunks
    const shuffleChunks = (chunks: string[]): string[] => {
      const copy = [...chunks];
      if (copy.length <= 1) return copy;
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      // Guarantee shuffled differs from correct order if possible
      if (copy.every((v, idx) => v === chunks[idx]) && copy.length >= 2) {
        [copy[0], copy[copy.length - 1]] = [copy[copy.length - 1], copy[0]];
      }
      return copy;
    };

    const pack = {
      generatedAt: Date.now(),
      clozeDrills: (data.clozeDrills || []).map((d, idx) => ({
        ...d,
        id: `cloze_${idx}_${Date.now()}`,
      })),
      builderDrills: (data.builderDrills || [])
        .filter((b) => Array.isArray(b.correctChunks) && b.correctChunks.length >= 3)
        .map((b, idx) => ({
          ...b,
          id: `build_${idx}_${Date.now()}`,
          shuffledChunks: shuffleChunks(b.correctChunks),
        })),
      redPenDrills: (data.redPenDrills || [])
        .filter(
          (r) =>
            Array.isArray(r.tokens) &&
            r.tokens.length >= 3 &&
            r.errorTokenIndex >= 0 &&
            r.errorTokenIndex < r.tokens.length
        )
        .map((r, idx) => ({
          ...r,
          id: `redpen_${idx}_${Date.now()}`,
        })),
      suggestedPrompts: (data.suggestedPrompts || []).slice(0, 6),
    };

    return res.json({ pack });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'Chưa thể khởi tạo Phòng Luyện Phản Xạ lúc này. Vui lòng thử lại.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 18. POST /api/linguistics/coach-sentence — Instant Output Coach (<1.5s Red-Pen + Native Upgrade)
// ---------------------------------------------------------------------------
app.post('/api/linguistics/coach-sentence', async (req, res) => {
  try {
    const { userSentence, targetTerm, language, targetLevel, videoTitle } = req.body as {
      userSentence?: string;
      targetTerm?: string;
      language?: 'en' | 'ja';
      targetLevel?: string;
      videoTitle?: string;
    };

    const cleanSentence = String(userSentence || '').trim();
    if (!cleanSentence) {
      return res.status(400).json({ error: 'Hãy gõ một câu của bạn để AI Sensei sửa bài.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';

    const prompt = `Chấm bài & sửa câu siêu tốc cho người học ${lang === 'ja' ? `Tiếng Nhật (${targetLevel || 'N3'})` : `Tiếng Anh (${targetLevel || 'B2'})`}:
Câu học viên tự đặt: "${cleanSentence}"
${targetTerm ? `Từ vựng / Mẫu ngữ pháp mục tiêu muốn áp dụng: "${targetTerm}"` : ''}
${videoTitle ? `Ngữ cảnh video: "${videoTitle}"` : ''}

Yêu cầu trả về ngắn gọn, tinh tế, chính xác 100%:
1. naturalnessTier: 'needs_fix' (Cần chỉnh ngữ pháp) | 'correct_but_stiff' (Đúng nhưng hơi cứng) | 'native_natural' (Tự nhiên như bản xứ).
2. naturalnessLabelVi: nhãn tiếng Việt tương ứng.
3. redPenCorrections: mảng các chỗ cần bút đỏ sửa (wrongSegment, fixedSegment, reasonVi giải thích gọn trong đúng 1 câu). Nếu câu đã hoàn hảo thì để mảng rỗng [].
4. nativeUpgrade: 1 phiên bản nâng cấp tự nhiên chuẩn bản xứ nhất.
5. nativeUpgradeReadingOrIpa: ${lang === 'ja' ? 'Furigana hiragana đầy đủ cho câu nâng cấp' : 'Oxford IPA cho cụm điểm nhấn trong câu nâng cấp'}.
6. upgradeNoteVi: giải thích 1 câu vì sao bản nâng cấp nghe tự nhiên hơn.
7. encouragementVi: 1 câu khích lệ ngắn gọn ấm áp.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        naturalnessTier: {
          type: Type.STRING,
          enum: ['needs_fix', 'correct_but_stiff', 'native_natural'],
        },
        naturalnessLabelVi: { type: Type.STRING },
        redPenCorrections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              wrongSegment: { type: Type.STRING },
              fixedSegment: { type: Type.STRING },
              reasonVi: { type: Type.STRING },
            },
            required: ['wrongSegment', 'fixedSegment', 'reasonVi'],
          },
        },
        nativeUpgrade: { type: Type.STRING },
        nativeUpgradeReadingOrIpa: { type: Type.STRING },
        upgradeNoteVi: { type: Type.STRING },
        encouragementVi: { type: Type.STRING },
      },
      required: [
        'naturalnessTier',
        'naturalnessLabelVi',
        'redPenCorrections',
        'nativeUpgrade',
        'upgradeNoteVi',
        'encouragementVi',
      ],
    };

    const feedback = await generateStructuredJson<Record<string, unknown>>({
      prompt,
      systemInstruction:
        'Bạn là AI Sensei bản xứ siêu tốc: chấm bài chính xác tuyệt đối, sửa bút đỏ tinh tế trong 1 câu ngắn và đề xuất 1 bản nâng cấp tự nhiên như người bản xứ.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.MINIMAL,
    });

    return res.json({ feedback });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, 'AI Sensei đang bận trong giây lát. Hãy bấm gửi lại câu của bạn.');
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 19. POST /api/linguistics/nuance-dual — Unified Dual-Mode Nuance Explanation
//     ([⚡ Rút gọn · 3 giây] + [🔬 Chuyên sâu · Toàn diện] with Summary-to-DeepDive Parity Gate)
// ---------------------------------------------------------------------------
app.post('/api/linguistics/nuance-dual', async (req, res) => {
  try {
    const {
      term,
      lemma,
      language,
      targetLevel,
      kind,
      sentence,
      prevSentence,
      nextSentence,
      videoTitle,
      compareTerms,
    } = req.body as {
      term?: string;
      lemma?: string;
      language?: 'en' | 'ja';
      targetLevel?: string;
      kind?: 'word' | 'grammar' | 'collocation' | 'nuance_group' | 'synonym_group';
      sentence?: string;
      prevSentence?: string;
      nextSentence?: string;
      videoTitle?: string;
      compareTerms?: string[];
    };

    const cleanTerm = String(term || '').trim();
    if (!cleanTerm) {
      return res.status(400).json({ error: 'Thiếu từ vựng hoặc mẫu ngữ pháp cần phân tích sắc thái.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const level = (targetLevel || (lang === 'ja' ? 'N3' : 'B2')) as
      | 'N5'
      | 'N4'
      | 'N3'
      | 'N2'
      | 'N1'
      | 'A1'
      | 'A2'
      | 'B1'
      | 'B2'
      | 'C1'
      | 'C2';
    const cleanLemma = String(lemma || cleanTerm).trim();
    const resolvedKind: 'word' | 'grammar' | 'collocation' | 'nuance_group' =
      kind === 'grammar' || kind === 'collocation'
        ? kind
        : kind === 'nuance_group' || kind === 'synonym_group'
          ? 'nuance_group'
          : 'word';
    const ctxSentence = String(sentence || '').trim();
    const compareHint =
      Array.isArray(compareTerms) && compareTerms.length > 0
        ? `Ưu tiên đặt trực diện nhóm cận nghĩa/đồng âm này vào Ma trận Đối chiếu: ${compareTerms.join(' · ')} (nếu danh sách gợi ý ít hơn 3 mục, BẮT BUỘC tự bổ sung thêm 1–2 từ/mẫu ngữ pháp cận nghĩa dễ nhầm nhất để Ma trận luôn đủ ĐÚNG 3–4 hàng).`
        : '';

    const kanjiHint =
      lang === 'ja' && extractUniqueKanji(`${cleanTerm} ${cleanLemma}`).length > 0
        ? buildKanjiGroundTruthPromptHint(extractUniqueKanji(`${cleanTerm} ${cleanLemma}`))
        : '';

    const prompt = `PHÂN TÍCH SẮC THÁI NGỮ DỤNG HỌC LƯỠNG TẦNG (DUAL-MODE NUANCE DOSSIER) CHUẨN TỪ ĐIỂN CHUYÊN KHẢO:
- Đối tượng phân tích: "${cleanTerm}" (Nguyên thể: "${cleanLemma}")
- Loại: ${resolvedKind} | Ngôn ngữ đích: ${lang === 'ja' ? `Tiếng Nhật (JLPT ${level})` : `Tiếng Anh (CEFR ${level} / IELTS)`}
${videoTitle ? `- Video đang xem: "${videoTitle}"` : ''}
${prevSentence ? `- Câu trước đó: "${prevSentence}"` : ''}
- Câu đang xuất hiện trong video: "${ctxSentence || cleanTerm}"
${nextSentence ? `- Câu tiếp theo: "${nextSentence}"` : ''}
${compareHint}
${kanjiHint}

TUÂN THỦ TUYỆT ĐỐI 4 QUY TẮC HỌC THUẬT:
0. NGÔN NGỮ GIẢI THÍCH BẮT BUỘC 100% TIẾNG VIỆT: Toàn bộ các trường giải thích (coreRule, quickContrast, translationVi, whyChosenHereVi, culturalSubtextVi, coreNuanceVi, whenToUseVi, minimalPairNoteVi, vietnameseTrapVi, socialConsequenceVi, listenerFeelingVi, situationVi, questionVi, explanationVi) BẮT BUỘC viết bằng TIẾNG VIỆT tự nhiên, kể cả khi phân tích từ Tiếng Anh.
1. ĐỒNG NHẤT 100% GIỮA summary VÀ deepDive:
   - Điểm số trên trục deepDive.axes.formality (1=Rất thân mật/Uchi, 2=Thân mật/Futsukei, 3=Trung tính/Teineigo, 4=Trang trọng/Soto, 5=Kính ngữ/Học thuật) BẮT BUỘC khớp tuyệt đối với nhãn summary.badges.formality.
   - Điểm số trên trục deepDive.axes.connotation (1-2=Tiêu cực/Chê, 3=Trung lập khách quan, 4-5=Tích cực/Khen/Trân trọng) BẮT BUỘC khớp tuyệt đối với nhãn summary.badges.attitude.
2. NHÁNH summary ([⚡ Bản Rút Gọn · 3 giây] — đúng 4 khối vi mô, KHÔNG một chữ thừa):
   - coreRule: ĐÚNG 1 câu TIẾNG VIỆT duy nhất sắc bén, ngắn gọn (<= 22 từ), chốt thẳng linh hồn sắc thái so với nghĩa tiếng Việt thông thường.
   - badges:
     * formality: ${lang === 'ja' ? 'VD: "Suồng sã (Futsukei)" / "Lịch sự (Teineigo)" / "Trang trọng (Keigo)"' : 'VD: "Suồng sã · Thân mật" / "Trung tính · Chuẩn mực" / "Trang trọng · Học thuật"'}
     * attitude: "Tích cực (+)" | "Khách quan (○)" | "Tiêu cực (–)" | "Mỉa mai · Bóng gió"
     * channel: "Văn nói · Giao tiếp" | "Văn viết" | "Công sở · Chuyên nghiệp" | "Văn chương · Học thuật"
   - quickContrast: { do: "1 tình huống ✅ dùng chuẩn sắc thái", dont: "1 tình huống ❌ dễ dùng lệch sắc thái" }
   - anchorExample: 1 câu ví dụ đinh sát bối cảnh video, kèm ${
     lang === 'ja'
       ? 'readingOrIpa (Hiragana đầy đủ) + pitchAccent (NHK chuẩn) + mảng ruby [{base, reading}] cho toàn bộ Kanji trong câu'
       : 'readingOrIpa (phiên âm Oxford/Cambridge IPA Unicode thuần 100%, CẤM ký tự ô vuông □)'
   }, highlightTerm (đúng cụm từ khóa xuất hiện trong câu), translationVi.
3. NHÁNH deepDive ([🔬 Bản Chi Tiết Chuyên Sâu · 6 Chiều Bách Khoa]):
   - axes: 4 trục định lượng (score 1..5, label, leftEnd, rightEnd): intensity, formality, connotation, frequency.
   - inVideoPragmatics:
     * whyChosenHereVi: Giải phẫu thẳng TẠI SAO nhân vật trong video chọn đúng từ/mẫu này ở câu đang xem thay vì cách nói phổ thông khác.
     * culturalSubtextLabel: ${lang === 'ja' ? 'VD: "Honne / Tatemae" · "Omoiyari (Nói giảm)" · "Uchi / Soto" · "Cảm giác tiếc nuối"' : 'VD: "Hedging (Rào đón học thuật)" · "Understatement (Nói giảm)" · "Polite Tact" · "Subtle Irony"'}
     * culturalSubtextVi: Bóc tách tầng hàm ý văn hóa ẩn sau câu nói.
   - contrastMatrix: Đúng 3–4 từ đồng nghĩa / đồng âm / mẫu ngữ pháp cận nghĩa dễ nhầm nhất (bắt buộc bao gồm cả đối tượng chính), mỗi hàng có: term, readingOrIpa (${lang === 'ja' ? 'Furigana' : 'Oxford IPA chuẩn'}), ${lang === 'ja' ? 'hanViet (âm Hán Việt phổ thông chính thống), pitchAccent (NHK), ' : ''}coreNuanceVi, whenToUseVi, minimalPairSentence (cùng 1 khung câu giống nhau thay thế từng từ), minimalPairVerdict ('natural' | 'awkward' | 'wrong'), minimalPairNoteVi (sắc thái đổi ra sao).
   - minimalPairSwap: { frameSentence: "Khung câu chung có chỗ trống [___]", explanationVi: "Tóm tắt quy luật thay thế trên cùng 1 khung câu" }.
   - collocationAndTraps:
     * mustPairWith: 3–4 kết hợp từ/danh từ/trợ từ BẮT BUỘC đi kèm tự nhiên.
     * neverPairWith: 2–3 kết hợp sai tự nhiên TUYỆT ĐỐI TRÁNH ghép.
     * vietnameseTrapVi: Bẫy tư duy dịch từ tiếng Việt hay gây mất lòng/lệch sắc thái nhất.
     * socialConsequenceVi: Hậu quả giao tiếp cụ thể nếu người Việt dùng nhầm với người bản xứ.
   - threeTierTransform: Đúng 3 tầng biến hóa của cùng thông điệp câu đang xem:
     * casual (${lang === 'ja' ? 'Tameguchi / Đời thường' : 'Casual / Đời thường'})
     * standard (${lang === 'ja' ? 'Teineigo / Lịch sự chuẩn' : 'Standard / Professional'})
     * formal (${lang === 'ja' ? 'Keigo / Trang trọng · Báo chí' : 'Formal / Academic · IELTS 8+'})
     Mỗi tầng gồm: levelTag, sentence, readingOrIpa, ${lang === 'ja' ? 'ruby, ' : ''}translationVi, listenerFeelingVi (đúng 1 dòng cảm giác người nghe bản xứ nhận được).
   - microQuiz: 1 câu hỏi vi mô 15 giây kiểm tra cảm giác sắc thái: { situationVi, options (đúng 3 phương án), correctIndex (0..2), explanationVi }.`;

    const axisSchema = {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER },
        label: { type: Type.STRING },
        leftEnd: { type: Type.STRING },
        rightEnd: { type: Type.STRING },
      },
      required: ['score', 'label', 'leftEnd', 'rightEnd'],
    };

    const rubyItemSchema = {
      type: Type.OBJECT,
      properties: {
        base: { type: Type.STRING },
        reading: { type: Type.STRING },
      },
      required: ['base'],
    };

    const tierSchema = {
      type: Type.OBJECT,
      properties: {
        levelTag: { type: Type.STRING },
        sentence: { type: Type.STRING },
        readingOrIpa: { type: Type.STRING },
        ...(lang === 'ja'
          ? { ruby: { type: Type.ARRAY, items: rubyItemSchema } }
          : {}),
        translationVi: { type: Type.STRING },
        listenerFeelingVi: { type: Type.STRING },
      },
      required: ['levelTag', 'sentence', 'readingOrIpa', 'translationVi', 'listenerFeelingVi'],
    };

    const schema = {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.OBJECT,
          properties: {
            coreRule: { type: Type.STRING },
            badges: {
              type: Type.OBJECT,
              properties: {
                formality: { type: Type.STRING },
                attitude: { type: Type.STRING },
                channel: { type: Type.STRING },
              },
              required: ['formality', 'attitude', 'channel'],
            },
            quickContrast: {
              type: Type.OBJECT,
              properties: {
                do: { type: Type.STRING },
                dont: { type: Type.STRING },
              },
              required: ['do', 'dont'],
            },
            anchorExample: {
              type: Type.OBJECT,
              properties: {
                sentence: { type: Type.STRING },
                highlightTerm: { type: Type.STRING },
                readingOrIpa: { type: Type.STRING },
                ...(lang === 'ja'
                  ? {
                      pitchAccent: { type: Type.STRING },
                      ruby: { type: Type.ARRAY, items: rubyItemSchema },
                    }
                  : {}),
                translationVi: { type: Type.STRING },
              },
              required: ['sentence', 'highlightTerm', 'readingOrIpa', 'translationVi'],
            },
          },
          required: ['coreRule', 'badges', 'quickContrast', 'anchorExample'],
        },
        deepDive: {
          type: Type.OBJECT,
          properties: {
            axes: {
              type: Type.OBJECT,
              properties: {
                intensity: axisSchema,
                formality: axisSchema,
                connotation: axisSchema,
                frequency: axisSchema,
              },
              required: ['intensity', 'formality', 'connotation', 'frequency'],
            },
            inVideoPragmatics: {
              type: Type.OBJECT,
              properties: {
                whyChosenHereVi: { type: Type.STRING },
                culturalSubtextLabel: { type: Type.STRING },
                culturalSubtextVi: { type: Type.STRING },
              },
              required: ['whyChosenHereVi', 'culturalSubtextLabel', 'culturalSubtextVi'],
            },
            contrastMatrix: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  readingOrIpa: { type: Type.STRING },
                  ...(lang === 'ja'
                    ? {
                        hanViet: { type: Type.STRING },
                        pitchAccent: { type: Type.STRING },
                      }
                    : {}),
                  coreNuanceVi: { type: Type.STRING },
                  whenToUseVi: { type: Type.STRING },
                  minimalPairSentence: { type: Type.STRING },
                  minimalPairVerdict: {
                    type: Type.STRING,
                    enum: ['natural', 'awkward', 'wrong'],
                  },
                  minimalPairNoteVi: { type: Type.STRING },
                },
                required: [
                  'term',
                  'readingOrIpa',
                  'coreNuanceVi',
                  'whenToUseVi',
                  'minimalPairSentence',
                  'minimalPairVerdict',
                  'minimalPairNoteVi',
                ],
              },
            },
            minimalPairSwap: {
              type: Type.OBJECT,
              properties: {
                frameSentence: { type: Type.STRING },
                explanationVi: { type: Type.STRING },
              },
              required: ['frameSentence', 'explanationVi'],
            },
            collocationAndTraps: {
              type: Type.OBJECT,
              properties: {
                mustPairWith: { type: Type.ARRAY, items: { type: Type.STRING } },
                neverPairWith: { type: Type.ARRAY, items: { type: Type.STRING } },
                vietnameseTrapVi: { type: Type.STRING },
                socialConsequenceVi: { type: Type.STRING },
              },
              required: [
                'mustPairWith',
                'neverPairWith',
                'vietnameseTrapVi',
                'socialConsequenceVi',
              ],
            },
            threeTierTransform: {
              type: Type.OBJECT,
              properties: {
                casual: tierSchema,
                standard: tierSchema,
                formal: tierSchema,
              },
              required: ['casual', 'standard', 'formal'],
            },
            microQuiz: {
              type: Type.OBJECT,
              properties: {
                situationVi: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                explanationVi: { type: Type.STRING },
              },
              required: ['situationVi', 'options', 'correctIndex', 'explanationVi'],
            },
          },
          required: [
            'axes',
            'inVideoPragmatics',
            'contrastMatrix',
            'minimalPairSwap',
            'collocationAndTraps',
            'threeTierTransform',
            'microQuiz',
          ],
        },
      },
      required: ['summary', 'deepDive'],
    };

    const raw = await generateStructuredJson<Record<string, unknown>>({
      prompt,
      systemInstruction:
        lang === 'ja'
          ? 'Bạn là Giáo sư Ngữ dụng học Tiếng Nhật (chuẩn Từ điển Phân biệt Từ đồng nghĩa Nhật, Daijirin & NHK Pitch Accent). Phân tích sắc thái chuẩn xác 100%, không mâu thuẫn giữa Bản Rút Gọn và Bản Chuyên Sâu, đúng 100% Kanji, Hán Việt phổ thông, Furigana Hiragana thuần theo ngữ cảnh (CẤM thẻ HTML và Romaji) và Pitch Accent.'
          : 'Bạn là Giáo sư Ngữ dụng học Tiếng Anh (chuẩn Oxford, Cambridge & Merriam-Webster Usage Notes). Phân tích sắc thái chuẩn xác 100%, không mâu thuẫn giữa Bản Rút Gọn và Bản Chuyên Sâu, đúng 100% Oxford IPA thuần Unicode (tuyệt đối không có ô vuông □) và Collocations bản xứ.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
      temperature: 0.15,
      priority: 'express',
    });

    const nuance = enforceNuanceParity(raw, {
      term: cleanTerm,
      lemma: cleanLemma,
      language: lang,
      targetLevel: level,
      kind: resolvedKind,
      fallbackSentence: ctxSentence || cleanTerm,
    });

    return res.json({ nuance: deepNormalizeUtf8(nuance) });
  } catch (err) {
    const message = toFriendlyErrorMessage(
      err,
      'Hệ thống đang bận phân tích sắc thái chuyên sâu. Vui lòng thử lại sau giây lát.'
    );
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 20. POST /api/linguistics/nuance-scenarios-expand — [+3 Tình Huống Sắc Thái Mới]
//     Zero-duplicate real-world contrastive scenarios via IndexedDB History Hash
// ---------------------------------------------------------------------------
app.post('/api/linguistics/nuance-scenarios-expand', async (req, res) => {
  try {
    const { term, lemma, language, targetLevel, sentence, excludeSituations } = req.body as {
      term?: string;
      lemma?: string;
      language?: 'en' | 'ja';
      targetLevel?: string;
      sentence?: string;
      excludeSituations?: string[];
    };

    const cleanTerm = String(term || '').trim();
    if (!cleanTerm) {
      return res.status(400).json({ error: 'Thiếu từ vựng cần mở rộng tình huống sắc thái.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const level = targetLevel || (lang === 'ja' ? 'N3' : 'B2');
    const excluded = Array.isArray(excludeSituations)
      ? excludeSituations.filter((s) => typeof s === 'string' && s.trim()).slice(0, 30)
      : [];

    const prompt = `Tạo ĐÚNG 3 TÌNH HUỐNG SO SÁNH SẮC THÁI THỰC CHIẾN HOÀN TOÀN MỚI cho "${cleanTerm}" (${lemma || cleanTerm}, ${
      lang === 'ja' ? `Tiếng Nhật JLPT ${level}` : `Tiếng Anh CEFR ${level}`
    }).
${sentence ? `Câu bối cảnh ban đầu: "${sentence}"` : ''}
${
  excluded.length > 0
    ? `TUYỆT ĐỐI KHÔNG TRÙNG LẶP bối cảnh/tình huống với các tình huống đã học sau đây:\n- ${excluded.join('\n- ')}`
    : ''
}

Yêu cầu cho MỖI tình huống trong 3 tình huống (chọn 3 bối cảnh đời thực khác nhau hẳn: VD công sở, quán ăn/du lịch, nhắn tin bạn bè, họp báo/IELTS, từ chối khéo, đàm phán...):
- situationVi: Tiêu đề + mô tả bối cảnh cụ thể bằng tiếng Việt.
- recommendedExpression: Câu nói/cách dùng ✅ CHUẨN SẮC THÁI nhất trong bối cảnh đó.
- readingOrIpa: ${lang === 'ja' ? 'Hiragana đầy đủ cho câu chuẩn' : 'Oxford IPA chuẩn Unicode (không ô vuông □)'}.
- avoidExpression: Câu nói/từ gần nghĩa ❌ DỄ DÙNG NHẦM gây gượng hoặc mất lịch sự trong cùng bối cảnh đó.
- whyVi: Giải thích 1–2 câu rõ vì sao bản chuẩn ghi điểm và bản sai gây lệch sắc thái.
- translationVi: Nghĩa tiếng Việt tự nhiên của câu chuẩn.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        scenarios: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              situationVi: { type: Type.STRING },
              recommendedExpression: { type: Type.STRING },
              readingOrIpa: { type: Type.STRING },
              avoidExpression: { type: Type.STRING },
              whyVi: { type: Type.STRING },
              translationVi: { type: Type.STRING },
            },
            required: [
              'situationVi',
              'recommendedExpression',
              'readingOrIpa',
              'avoidExpression',
              'whyVi',
              'translationVi',
            ],
          },
        },
      },
      required: ['scenarios'],
    };

    const raw = await generateStructuredJson<{ scenarios?: unknown[] }>({
      prompt,
      systemInstruction:
        'Sinh đúng 3 tình huống đối chiếu sắc thái thực chiến HOÀN TOÀN MỚI, không lặp lại tình huống cũ, chính xác 100% về ngữ dụng học và phát âm.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
      temperature: 0.25,
    });

    const scenarios = sanitizeExtraScenarios(raw.scenarios);
    return res.json({ scenarios: deepNormalizeUtf8(scenarios) });
  } catch (err) {
    const message = toFriendlyErrorMessage(
      err,
      'Không thể tạo thêm tình huống sắc thái mới lúc này. Vui lòng thử lại.'
    );
    return res.status(500).json({ error: message });
  }
});

// ===========================================================================
// UNIVERSAL WEB ARTICLE STUDIO ROUTES (3-Tier Extractor + Tri-Lingual Engine)
// ===========================================================================

interface ArticleSentenceInput {
  id: string;
  index: number;
  paragraphId: string;
  blockType?: string;
  text: string;
}

interface ArticleEnrichedOutput {
  id: string;
  text: string;
  translationVi: string;
  ipaLine?: string;
  tokens: Array<{
    id: string;
    surface: string;
    lemma: string;
    isPunctuation?: boolean;
    isMultiWord?: boolean;
    phraseType?: 'word' | 'phrasal_verb' | 'idiom' | 'collocation' | 'grammar';
    level?: string;
    isIeltsAcademic?: boolean;
    furigana?: string;
    ruby?: Array<{ base: string; reading?: string }>;
    ipa?: string;
  }>;
  enriched: boolean;
}

function buildArticleFallbackTokens(
  text: string,
  lineId: string,
  targetLang: ArticleLanguage
): ArticleEnrichedOutput['tokens'] {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (targetLang === 'ja') {
    const segs =
      raw.match(
        /[\u4E00-\u9FFF々ヶ]+[\u3040-\u309F]*|[\u30A0-\u30FFー]+|[\u3040-\u309F]+|[A-Za-z0-9]+|[^\s]/g
      ) || [raw];
    return segs.map((s, idx) => ({
      id: `${lineId}_tk_${idx}`,
      surface: s,
      lemma: s,
      isPunctuation: /^[。、！？「」『』（）(),.!?・…ー\s]+$/.test(s),
    }));
  }
  const parts = raw.match(/[A-Za-zÀ-ỹ0-9]+(?:['’-][A-Za-zÀ-ỹ0-9]+)*|[^\sA-Za-zÀ-ỹ0-9]+/g) || [raw];
  return parts.map((p, idx) => ({
    id: `${lineId}_tk_${idx}`,
    surface: p,
    lemma: p.toLowerCase(),
    isPunctuation: /^[^\p{L}\p{N}]+$/u.test(p),
  }));
}

function normalizeArticleTokenList(
  rawTokens: unknown,
  fallbackText: string,
  lineId: string,
  targetLang: ArticleLanguage
): ArticleEnrichedOutput['tokens'] {
  if (!Array.isArray(rawTokens) || rawTokens.length === 0) {
    return buildArticleFallbackTokens(fallbackText, lineId, targetLang);
  }
  const cleaned = rawTokens
    .map((tk, idx) => {
      const obj = (tk || {}) as Record<string, unknown>;
      const surface = String(obj.surface || '').trim();
      if (!surface) return null;
      const isPunct =
        typeof obj.isPunctuation === 'boolean'
          ? obj.isPunctuation
          : /^[。、！？「」『』（）(),.!?;:"'“”‘’…—–\-]+$/.test(surface);
      const rubyArr = Array.isArray(obj.ruby)
        ? obj.ruby
            .map((r) => {
              const ro = (r || {}) as Record<string, unknown>;
              const base = String(ro.base || '');
              const reading = ro.reading ? String(ro.reading).trim() : undefined;
              return base ? (reading ? { base, reading } : { base }) : null;
            })
            .filter((r): r is { base: string; reading?: string } => Boolean(r))
        : undefined;
      return {
        id: `${lineId}_tk_${idx}`,
        surface,
        lemma: String(obj.lemma || surface).trim(),
        isPunctuation: isPunct,
        isMultiWord: Boolean(obj.isMultiWord),
        phraseType: (obj.phraseType as ArticleEnrichedOutput['tokens'][number]['phraseType']) || 'word',
        level: obj.level ? String(obj.level) : undefined,
        isIeltsAcademic: Boolean(obj.isIeltsAcademic),
        furigana: obj.furigana ? String(obj.furigana).trim() : undefined,
        ruby: rubyArr && rubyArr.length > 0 ? rubyArr : undefined,
        ipa: obj.ipa ? String(obj.ipa).trim() : undefined,
      };
    })
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  return cleaned.length > 0 ? cleaned : buildArticleFallbackTokens(fallbackText, lineId, targetLang);
}

function buildArticleBatchPrompt(params: {
  sentences: ArticleSentenceInput[];
  sourceLang: ArticleLanguage;
  targetLang: ArticleLanguage;
  targetLevel: string;
  articleTitle: string;
  contextAnchor?: ContextAnchorPayload;
  previousContext?: PreviousContextPair[];
  streamingNdjson?: boolean;
}): { prompt: string; systemInstruction: string } {
  const {
    sentences,
    sourceLang,
    targetLang,
    targetLevel,
    articleTitle,
    contextAnchor,
    previousContext,
    streamingNdjson,
  } = params;

  const langNames: Record<ArticleLanguage, string> = {
    vi: 'Tiếng Việt',
    en: 'Tiếng Anh (English)',
    ja: 'Tiếng Nhật (日本語)',
  };

  const isSameLang = sourceLang === targetLang;
  const levelSpec =
    targetLang === 'ja'
      ? `JLPT ${targetLevel || 'N3'}`
      : targetLang === 'en'
        ? `CEFR ${targetLevel || 'B2'}`
        : 'Tiếng Việt báo chí chuẩn mực';

  const contextBlock = formatContextAnchorBlock(contextAnchor, previousContext);

  const inputPayload = sentences
    .map(
      (s) =>
        `{"id":"${s.id}","block":"${s.blockType || 'p'}","text":${JSON.stringify(s.text)}}`
    )
    .join('\n');

  const taskDirective =
    targetLang === 'vi'
      ? isSameLang
        ? `Giữ nguyên văn 100% câu Tiếng Việt gốc vào cả trường "text" và "translationVi", tách từ (tokens) sạch sẽ theo từng từ/cụm có nghĩa.`
        : `Dịch chuẩn xác 100% từng câu từ ${langNames[sourceLang]} sang Tiếng Việt báo chí mượt mà, tự nhiên (chống dịch máy/word-by-word), đặt bản dịch Tiếng Việt vào CẢ hai trường "text" và "translationVi".`
      : isSameLang
        ? `Giữ nguyên văn 100% câu ${langNames[targetLang]} gốc vào trường "text" (tuyệt đối không viết lại hay lược bỏ), dịch sát nghĩa tự nhiên sang Tiếng Việt vào trường "translationVi", đồng thời gán đầy đủ ${
            targetLang === 'ja'
              ? 'Furigana chuẩn ngữ cảnh (ruby/furigana) + tách từ/ngữ pháp + cấp độ JLPT (N5-N1)'
              : 'IPA chuẩn Oxford/Cambridge (ipaLine + ipa cho từng từ) + tách cụm collocation/phrasal verb + cấp độ CEFR (A1-C2)'
          } vào mảng "tokens".`
        : `Chuyển ngữ 100% từng câu từ ${langNames[sourceLang]} sang ${langNames[targetLang]} tự nhiên như báo chí / học thuật bản xứ ở trình độ ${levelSpec} (vào trường "text") — TUYỆT ĐỐI KHÔNG ĐỂ LỌT BẤT KỲ TỪ TIẾNG VIỆT NÀO trong trường "text" hay "tokens.surface"!
- Nếu nguồn là Tiếng Việt: giữ nguyên câu gốc tiếng Việt vào "translationVi".
- Nếu nguồn là ${langNames[sourceLang]} (khác Tiếng Việt): dịch chuẩn tự nhiên câu đó sang Tiếng Việt vào "translationVi".
- Gán đầy đủ ${
            targetLang === 'ja'
              ? 'Furigana chuẩn ngữ cảnh (ruby: [{base, reading}] cho Kanji và furigana cho từng token Kanji) + cấp độ JLPT (N5-N1)'
              : 'IPA chuẩn Oxford/Cambridge (ipaLine đầy đủ Unicode và ipa cho từng từ) + tách cụm phrasal_verb/collocation + cấp độ CEFR (A1-C2)'
          } vào mảng "tokens".`;

  const formatRule = streamingNdjson
    ? `ĐỊNH DẠNG NDJSON STREAMING NGHIÊM NGẶT:
- Xuất ĐÚNG ${sentences.length} dòng JSON độc lập (mỗi dòng 1 object hoàn chỉnh cho 1 câu theo ĐÚNG THỨ TỰ và ĐÚNG "id" đầu vào).
- KHÔNG bọc mảng [...], KHÔNG dùng markdown \`\`\`json, KHÔNG viết lời giải thích trước/sau.
- Mỗi dòng có cấu trúc:
{"id":"p0_s0","text":"...","translationVi":"...","ipaLine":"...","tokens":[{"surface":"...","lemma":"...","isPunctuation":false,"phraseType":"word","level":"...","furigana":"...","ruby":[{"base":"...","reading":"..."}],"ipa":"..."}]}`
    : `Trả về JSON object {"items":[...]} chứa ĐÚNG ${sentences.length} phần tử theo ĐÚNG thứ tự và ĐÚNG "id" của từng câu đầu vào. TUYỆT ĐỐI KHÔNG gộp câu, KHÔNG tách câu, KHÔNG bỏ sót câu nào.`;

  const prompt = `${contextBlock}Bài viết: "${articleTitle || 'Bài viết web'}"
Hướng xử lý: ${langNames[sourceLang]} ➔ ${langNames[targetLang]} (${levelSpec})

NHIỆM VỤ BẮT BUỘC:
${taskDirective}
- KHÓA CẤU TRÚC 1:1 TUYỆT ĐỐI: Đầu vào có đúng ${sentences.length} câu (theo ID). Đầu ra BẮT BUỘC có đúng ${sentences.length} mục khớp từng ID 100%, giữ trọn vẹn ý nghĩa văn bản gốc, tuyệt đối không tóm tắt hay cắt cụt.
- Văn phong nhất quán xuyên suốt các đoạn văn (heading ngắn gọn, súc tích; đoạn văn mạch lạc, dùng collocations bản xứ chuẩn xác).
${formatRule}

DANH SÁCH CÂU ĐẦU VÀO (${sentences.length} câu):
${inputPayload}`;

  const systemInstruction = `Chuyên gia biên dịch báo chí & ngôn ngữ học đối chiếu Việt–Anh–Nhật. Luôn bảo toàn 100% số lượng câu và đúng ID 1:1. Tuyệt đối không để lọt chữ tiếng Việt vào văn bản đích tiếng Anh/Nhật. Chuẩn UTF-8 NFC, chuẩn Furigana ngữ cảnh và IPA Oxford/Cambridge.`;

  return { prompt, systemInstruction };
}

// ---------------------------------------------------------------------------
// A1. POST /api/article/extract — 3-Tier Universal Web Article Extractor
// ---------------------------------------------------------------------------
app.post('/api/article/extract', async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Vui lòng dán đường link bài viết hợp lệ.' });
    }
    const result = await extractWebArticle(url);
    return res.json(result);
  } catch (err) {
    const message = toFriendlyErrorMessage(
      err,
      'Không thể đọc nội dung từ đường link này. Bạn có thể dán trực tiếp văn bản bài viết vào khung nhập tay.'
    );
    return res.status(400).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// A2. POST /api/article/parse-raw — Tier 3 Rescue (Paste Text / .txt / .md / .pdf)
// ---------------------------------------------------------------------------
app.post('/api/article/parse-raw', async (req, res) => {
  try {
    const { rawText, pdfBase64, title, sourceUrl } = req.body as {
      rawText?: string;
      pdfBase64?: string;
      title?: string;
      sourceUrl?: string;
    };

    let contentToParse = String(rawText || '').trim();
    let finalTitle = String(title || '').trim();

    if (pdfBase64 && typeof pdfBase64 === 'string' && pdfBase64.length > 40) {
      const pdfExtracted = await extractTextFromPdfBase64(pdfBase64);
      contentToParse = pdfExtracted.content;
      if (!finalTitle && pdfExtracted.title) {
        finalTitle = pdfExtracted.title;
      }
    }

    if (!contentToParse || contentToParse.length < 20) {
      return res.status(400).json({
        error: 'Nội dung bài viết quá ngắn. Vui lòng dán ít nhất một đoạn văn bản đầy đủ.',
      });
    }

    const parsed = parseRawArticleText({
      rawText: contentToParse,
      title: finalTitle || undefined,
      sourceUrl: sourceUrl || undefined,
      extractionTier: 'raw_input',
    });

    if (parsed.sentences.length === 0) {
      return res.status(400).json({
        error: 'Không nhận diện được câu văn hợp lệ từ nội dung vừa dán.',
      });
    }

    return res.json(parsed);
  } catch (err) {
    const message = toFriendlyErrorMessage(
      err,
      'Không thể xử lý nội dung bài viết lúc này. Vui lòng thử lại.'
    );
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// A3. POST /api/article/translate-batch — 1:1 Locked Tri-Lingual Article Batch
// ---------------------------------------------------------------------------
app.post('/api/article/translate-batch', async (req, res) => {
  try {
    const {
      sentences,
      sourceLanguage,
      targetLanguage,
      targetLevel,
      articleTitle,
      contextAnchor,
      previousContext,
    } = req.body as {
      sentences?: ArticleSentenceInput[];
      sourceLanguage?: ArticleLanguage;
      targetLanguage?: ArticleLanguage;
      targetLevel?: string;
      articleTitle?: string;
      contextAnchor?: ContextAnchorPayload;
      previousContext?: PreviousContextPair[];
    };

    if (!Array.isArray(sentences) || sentences.length === 0) {
      return res.status(400).json({ error: 'Danh sách câu bài viết đang trống.' });
    }

    const srcLang: ArticleLanguage =
      sourceLanguage === 'ja' || sourceLanguage === 'vi' || sourceLanguage === 'en'
        ? sourceLanguage
        : 'en';
    const tgtLang: ArticleLanguage =
      targetLanguage === 'ja' || targetLanguage === 'vi' || targetLanguage === 'en'
        ? targetLanguage
        : 'en';

    const levelStr =
      targetLevel || (tgtLang === 'ja' ? 'N3' : tgtLang === 'en' ? 'B2' : 'B2');

    // Fast path: VI -> VI needs zero AI roundtrip for 100% pure Vietnamese display
    if (srcLang === 'vi' && tgtLang === 'vi') {
      const viLines: ArticleEnrichedOutput[] = sentences.map((s) => ({
        id: s.id,
        text: s.text,
        translationVi: s.text,
        tokens: buildArticleFallbackTokens(s.text, s.id, 'vi'),
        enriched: true,
      }));
      return res.json({ lines: deepNormalizeUtf8(viLines) });
    }

    const { prompt, systemInstruction } = buildArticleBatchPrompt({
      sentences,
      sourceLang: srcLang,
      targetLang: tgtLang,
      targetLevel: levelStr,
      articleTitle: articleTitle || '',
      contextAnchor,
      previousContext,
      streamingNdjson: false,
    });

    const schema = {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              text: { type: Type.STRING },
              translationVi: { type: Type.STRING },
              ipaLine: { type: Type.STRING },
              tokens: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    surface: { type: Type.STRING },
                    lemma: { type: Type.STRING },
                    isPunctuation: { type: Type.BOOLEAN },
                    isMultiWord: { type: Type.BOOLEAN },
                    phraseType: {
                      type: Type.STRING,
                      enum: ['word', 'phrasal_verb', 'idiom', 'collocation', 'grammar'],
                    },
                    level: { type: Type.STRING },
                    isIeltsAcademic: { type: Type.BOOLEAN },
                    furigana: { type: Type.STRING },
                    ruby: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          base: { type: Type.STRING },
                          reading: { type: Type.STRING },
                        },
                        required: ['base'],
                      },
                    },
                    ipa: { type: Type.STRING },
                  },
                  required: ['surface', 'lemma'],
                },
              },
            },
            required: ['id', 'text', 'translationVi', 'tokens'],
          },
        },
      },
      required: ['items'],
    };

    const raw = await generateStructuredJson<{ items?: Array<Record<string, unknown>> }>({
      prompt,
      systemInstruction,
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
      temperature: 0.1,
    });

    const byId = new Map<string, Record<string, unknown>>();
    for (const item of raw.items || []) {
      const id = String(item.id || '').trim();
      if (id) byId.set(id, item);
    }

    const mapped: ArticleEnrichedOutput[] = sentences.map((src, idx) => {
      const hit = byId.get(src.id) || (raw.items || [])[idx];
      const textVal = String(hit?.text || '').trim();
      const viVal =
        srcLang === 'vi'
          ? src.text
          : String(hit?.translationVi || (tgtLang === 'vi' ? textVal : '')).trim();
      const safeText = textVal || src.text;
      const pureOk =
        tgtLang === 'vi' ? Boolean(safeText) : isPureTargetLanguage(safeText, tgtLang);

      return {
        id: src.id,
        text: safeText,
        translationVi: viVal || (tgtLang === 'vi' ? safeText : ''),
        ipaLine: hit?.ipaLine ? String(hit.ipaLine).trim() : undefined,
        tokens: normalizeArticleTokenList(hit?.tokens, safeText, src.id, tgtLang),
        enriched: Boolean(hit && textVal && pureOk),
      };
    });

    // Self-healing purity repair for any line that leaked Vietnamese or missed translation
    if (tgtLang !== 'vi') {
      const broken = sentences.filter((s, idx) => !mapped[idx]?.enriched);
      if (broken.length > 0 && broken.length <= sentences.length) {
        try {
          const repair = buildArticleBatchPrompt({
            sentences: broken,
            sourceLang: srcLang,
            targetLang: tgtLang,
            targetLevel: levelStr,
            articleTitle: articleTitle || '',
            contextAnchor,
            streamingNdjson: false,
          });
          const fixedRaw = await generateStructuredJson<{
            items?: Array<Record<string, unknown>>;
          }>({
            prompt: `${repair.prompt}\n\nCẢNH BÁO KIỂM DUYỆT NGHIÊM NGẶT: Các câu trên bắt buộc dịch 100% sang ${
              tgtLang === 'ja' ? 'Tiếng Nhật thuần (có Hiragana/Katakana/Kanji)' : 'Tiếng Anh thuần'
            }, TUYỆT ĐỐI KHÔNG ĐỂ SÓT BẤT KỲ TỪ TIẾNG VIỆT NÀO trong trường "text"!`,
            systemInstruction: repair.systemInstruction,
            responseSchema: schema,
            thinkingLevel: ThinkingLevel.LOW,
            temperature: 0.1,
          });
          const fixMap = new Map<string, Record<string, unknown>>();
          for (const it of fixedRaw.items || []) {
            const id = String(it.id || '').trim();
            if (id) fixMap.set(id, it);
          }
          for (let i = 0; i < mapped.length; i += 1) {
            const fix = fixMap.get(mapped[i].id);
            if (!fix) continue;
            const fixedText = String(fix.text || '').trim();
            if (fixedText && isPureTargetLanguage(fixedText, tgtLang)) {
              mapped[i] = {
                id: mapped[i].id,
                text: fixedText,
                translationVi:
                  srcLang === 'vi'
                    ? sentences[i].text
                    : String(fix.translationVi || mapped[i].translationVi).trim(),
                ipaLine: fix.ipaLine ? String(fix.ipaLine).trim() : mapped[i].ipaLine,
                tokens: normalizeArticleTokenList(fix.tokens, fixedText, mapped[i].id, tgtLang),
                enriched: true,
              };
            }
          }
        } catch {
          // Return best-effort batch
        }
      }
    }

    return res.json({ lines: deepNormalizeUtf8(mapped) });
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const isDailyQuota = isDailyQuotaError(err);
    const message = toFriendlyErrorMessage(
      err,
      'Chưa thể chuyển ngữ đoạn bài viết này ngay lúc này. Hệ thống sẽ tự động thử lại.'
    );
    return res.status(rateLimited ? 429 : 500).json({
      error: message,
      quotaExhausted: rateLimited,
      isDailyQuota,
    });
  }
});

// ---------------------------------------------------------------------------
// A4. POST /api/article/translate-batch-stream — Express NDJSON Streaming (< 1.2s TTFL)
// ---------------------------------------------------------------------------
app.post('/api/article/translate-batch-stream', async (req, res) => {
  const {
    sentences,
    sourceLanguage,
    targetLanguage,
    targetLevel,
    articleTitle,
    contextAnchor,
    previousContext,
  } = req.body as {
    sentences?: ArticleSentenceInput[];
    sourceLanguage?: ArticleLanguage;
    targetLanguage?: ArticleLanguage;
    targetLevel?: string;
    articleTitle?: string;
    contextAnchor?: ContextAnchorPayload;
    previousContext?: PreviousContextPair[];
  };

  if (!Array.isArray(sentences) || sentences.length === 0) {
    return res.status(400).json({ error: 'Danh sách câu bài viết đang trống.' });
  }

  const srcLang: ArticleLanguage =
    sourceLanguage === 'ja' || sourceLanguage === 'vi' || sourceLanguage === 'en'
      ? sourceLanguage
      : 'en';
  const tgtLang: ArticleLanguage =
    targetLanguage === 'ja' || targetLanguage === 'vi' || targetLanguage === 'en'
      ? targetLanguage
      : 'en';
  const levelStr = targetLevel || (tgtLang === 'ja' ? 'N3' : 'B2');

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const writeEvent = (obj: unknown) => {
    if (!res.writableEnded) {
      res.write(`${JSON.stringify(deepNormalizeUtf8(obj))}\n`);
    }
  };

  // Fast 0ms path for VI -> VI
  if (srcLang === 'vi' && tgtLang === 'vi') {
    for (const s of sentences) {
      writeEvent({
        type: 'line',
        line: {
          id: s.id,
          text: s.text,
          translationVi: s.text,
          tokens: buildArticleFallbackTokens(s.text, s.id, 'vi'),
          enriched: true,
        },
      });
    }
    writeEvent({ type: 'done', count: sentences.length });
    return res.end();
  }

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  const srcById = new Map<string, ArticleSentenceInput>(sentences.map((s) => [s.id, s]));
  const emittedIds = new Set<string>();
  let seqCursor = 0;

  try {
    const { prompt, systemInstruction } = buildArticleBatchPrompt({
      sentences,
      sourceLang: srcLang,
      targetLang: tgtLang,
      targetLevel: levelStr,
      articleTitle: articleTitle || '',
      contextAnchor,
      previousContext,
      streamingNdjson: true,
    });

    await streamNdjsonLines<Record<string, unknown>>({
      prompt,
      systemInstruction,
      signal: abortController.signal,
      onObject: (obj) => {
        const rawId = String(obj.id || '').trim();
        let matched = rawId ? srcById.get(rawId) : undefined;
        if (!matched) {
          while (seqCursor < sentences.length && emittedIds.has(sentences[seqCursor].id)) {
            seqCursor += 1;
          }
          matched = sentences[seqCursor];
        }
        if (!matched || emittedIds.has(matched.id)) return;

        const textVal = String(obj.text || '').trim();
        if (!textVal) return;
        const pureOk =
          tgtLang === 'vi' ? true : isPureTargetLanguage(textVal, tgtLang);
        if (!pureOk) return;

        emittedIds.add(matched.id);
        const lineOut: ArticleEnrichedOutput = {
          id: matched.id,
          text: textVal,
          translationVi:
            srcLang === 'vi'
              ? matched.text
              : String(obj.translationVi || (tgtLang === 'vi' ? textVal : '')).trim(),
          ipaLine: obj.ipaLine ? String(obj.ipaLine).trim() : undefined,
          tokens: normalizeArticleTokenList(obj.tokens, textVal, matched.id, tgtLang),
          enriched: true,
        };
        writeEvent({ type: 'line', line: lineOut });
      },
    });

    writeEvent({ type: 'done', count: emittedIds.size });
    return res.end();
  } catch (err) {
    if (!abortController.signal.aborted) {
      const rateLimited = isRateLimitError(err);
      const isDailyQuota = isDailyQuotaError(err);
      writeEvent({
        type: 'error',
        status: rateLimited ? 429 : 500,
        quotaExhausted: rateLimited,
        isDailyQuota,
        error: toFriendlyErrorMessage(err, 'Kết nối luồng dịch bài viết tạm gián đoạn.'),
      });
    }
    return res.end();
  }
});

// ---------------------------------------------------------------------------
// A5. POST /api/article/reading-quiz — JLPT / IELTS Reading Comprehension Quiz
// ---------------------------------------------------------------------------
app.post('/api/article/reading-quiz', async (req, res) => {
  try {
    const { title, language, targetLevel, paragraphs } = req.body as {
      title?: string;
      language?: 'en' | 'ja';
      targetLevel?: string;
      paragraphs?: Array<{ id: string; text: string; translationVi?: string }>;
    };

    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'Chưa có nội dung bài viết để tạo bài kiểm tra đọc hiểu.' });
    }

    const lang: 'en' | 'ja' = language === 'ja' ? 'ja' : 'en';
    const level = targetLevel || (lang === 'ja' ? 'N3' : 'B2');

    const excerpt = paragraphs
      .slice(0, 45)
      .map((p) => `[${p.id}] ${p.text}`)
      .join('\n\n');

    const prompt = `Bài viết: "${title || 'Article'}"
Ngôn ngữ mục tiêu: ${lang === 'ja' ? `Tiếng Nhật (phong cách đề thi Đọc hiểu JLPT ${level})` : `Tiếng Anh (phong cách đề thi Reading IELTS / CEFR ${level})`}

Hãy xây dựng ĐÚNG 6 câu hỏi ĐỌC HIỂU BÀI BÁO chuẩn học thuật, phủ đủ 5 kỹ năng:
1. Ý chính toàn bài (main_idea)
2. Chi tiết cụ thể trong bài (detail — 2 câu)
3. Từ vựng / Sắc thái trong ngữ cảnh bài viết (vocab_in_context)
4. Suy luận logic từ thông tin tác giả (inference)
5. Thái độ / Giọng điệu của tác giả (author_tone)

Với mỗi câu hỏi trả về:
- id: "rq_1" .. "rq_6"
- skill: "main_idea" | "detail" | "vocab_in_context" | "inference" | "author_tone"
- skillLabelVi: Nhãn tiếng Việt ngắn gọn (vd "Ý chính toàn bài", "Chi tiết thực tế", "Từ vựng ngữ cảnh", "Suy luận logic", "Giọng điệu tác giả")
- question: Câu hỏi bằng ${lang === 'ja' ? 'Tiếng Nhật tự nhiên' : 'Tiếng Anh học thuật'}
- questionVi: Bản dịch tiếng Việt của câu hỏi (giúp người học đối chiếu)
- options: Đúng 4 phương án A/B/C/D bằng ${lang === 'ja' ? 'Tiếng Nhật' : 'Tiếng Anh'} (chỉ 1 đáp án đúng, 3 phương án nhiễu thông minh dựa trên bài)
- correctIndex: 0, 1, 2 hoặc 3
- evidenceParagraphId: Mã đoạn [pX] chứa dẫn chứng trong bài viết (vd "p2")
- evidenceQuote: Trích dẫn 1 câu ngắn từ đoạn dẫn chứng đó
- explanationVi: Giải thích súc tích 2-3 câu bằng tiếng Việt vì sao đáp án đúng và tại sao các bẫy khác sai.

NỘI DUNG BÀI VIẾT:
${excerpt}`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              skill: {
                type: Type.STRING,
                enum: ['main_idea', 'detail', 'vocab_in_context', 'inference', 'author_tone'],
              },
              skillLabelVi: { type: Type.STRING },
              question: { type: Type.STRING },
              questionVi: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              evidenceParagraphId: { type: Type.STRING },
              evidenceQuote: { type: Type.STRING },
              explanationVi: { type: Type.STRING },
            },
            required: [
              'id',
              'skill',
              'skillLabelVi',
              'question',
              'questionVi',
              'options',
              'correctIndex',
              'evidenceParagraphId',
              'evidenceQuote',
              'explanationVi',
            ],
          },
        },
      },
      required: ['questions'],
    };

    const data = await generateStructuredJson<{ questions?: unknown[] }>({
      prompt,
      systemInstruction:
        'Biên soạn đề thi Đọc hiểu JLPT / IELTS chuẩn học thuật, câu hỏi và phương án bám sát 100% văn bản gốc, không bịa đặt dữ kiện ngoài bài.',
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.LOW,
      temperature: 0.15,
    });

    return res.json({ questions: deepNormalizeUtf8(data.questions || []) });
  } catch (err) {
    const message = toFriendlyErrorMessage(
      err,
      'Chưa thể tạo bài kiểm tra Đọc hiểu cho bài viết này lúc này.'
    );
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Mount Vite dev middleware or static production build
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KotoZen server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
