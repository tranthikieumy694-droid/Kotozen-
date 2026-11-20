import { decodeAndNormalizeText } from './textSanitizer.ts';

export interface ParsedYouTubeInput {
  videoId: string;
  startTime: number;
}

export interface RawCaptionLine {
  start: number;
  duration: number;
  text: string;
  readingMap?: string;
  ipaLine?: string;
  translationVi?: string;
}

export interface CaptionTrackInfo {
  baseUrl: string;
  languageCode: string;
  name: string;
  isAsr: boolean;
}

export interface OEmbedCheckResult {
  valid: boolean;
  videoId: string;
  title: string;
  channelName: string;
  statusCode: number;
}

export interface YouTubeExtractionResult {
  status: 'ok' | 'ai_auto_sub' | 'no_captions';
  videoId: string;
  title: string;
  channelName: string;
  videoDurationSec?: number;
  startTime: number;
  sourceLanguage: 'vi' | 'en' | 'ja';
  extractionTier: 'manual_vi' | 'asr_vi' | 'manual_target' | 'asr_target' | 'stt_ai' | 'none';
  detectedLanguage?: string;
  isAsr?: boolean;
  hasMoreStt?: boolean;
  nextSttOffsetSec?: number;
  directTranslated?: boolean;
  lines: RawCaptionLine[];
  availableTracks: { languageCode: string; name: string; isAsr: boolean }[];
  message?: string;
}

const OEMBED_CACHE = new Map<string, { result: OEmbedCheckResult; expiresAt: number }>();
const OEMBED_TTL_MS = 10 * 60 * 1000;

export function parseYouTubeTimeParam(raw: string | null): number {
  if (!raw) return 0;
  const cleaned = raw.trim().toLowerCase().replace(/[^0-9hms]/g, '');
  if (!cleaned) return 0;
  if (/^\d+$/.test(cleaned)) {
    return parseInt(cleaned, 10);
  }
  let total = 0;
  const hours = cleaned.match(/(\d+)h/);
  const mins = cleaned.match(/(\d+)m/);
  const secs = cleaned.match(/(\d+)s/);
  if (hours) total += parseInt(hours[1], 10) * 3600;
  if (mins) total += parseInt(mins[1], 10) * 60;
  if (secs) total += parseInt(secs[1], 10);
  return total;
}

/**
 * Pillar 0 — Strict Universal YouTube URL Sanitizer:
 * Rejects non-YouTube URLs (Facebook, TikTok, malformed text) immediately
 * and extracts the exact 11-char videoId + startTime from every valid YouTube format.
 */
export function parseYouTubeUrlServer(input: string): ParsedYouTubeInput | null {
  const sanitized = input
    .replace(/[\u200B-\u200D\uFEFF\r\n\t]/g, '')
    .replace(/^[\s"'<>()[\]]+|[\s"'<>()[\]]+$/g, '')
    .trim();

  if (!sanitized) return null;

  // Direct raw 11-char ID (only when input has no spaces/dots/slashes and isn't a plain lowercase hyphenated phrase)
  if (/^[a-zA-Z0-9_-]{11}$/.test(sanitized) && !/^[a-z]+-[a-z]+$/.test(sanitized)) {
    return { videoId: sanitized, startTime: 0 };
  }

  const embeddedUrlMatch = sanitized.match(/https?:\/\/[^\s"'<>]+/i);
  let normalized = embeddedUrlMatch ? embeddedUrlMatch[0] : sanitized;
  if (!/^https?:\/\//i.test(normalized)) {
    // Reject obvious plain text sentences without a youtube domain
    if (!/(youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(normalized)) {
      return null;
    }
    normalized = `https://${normalized}`;
  }

  let videoId = '';
  let startTime = 0;

  try {
    const url = new URL(normalized);
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
        if (pathMatch) videoId = pathMatch[1];
      }
    }

    const tParam = url.searchParams.get('t') || url.searchParams.get('start');
    const hashMatch = url.hash.match(/t=([0-9hms]+)/i);
    startTime = parseYouTubeTimeParam(tParam || (hashMatch ? hashMatch[1] : null));
  } catch {
    // Fallback to strict YouTube regex
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    const universalRegex =
      /(?:(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/|v\/|e\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
    const m = sanitized.match(universalRegex);
    if (m && m[1]) videoId = m[1];
    const timeRegex = /[?&#](?:t|start)=([0-9hms]+)/i;
    const tm = sanitized.match(timeRegex);
    if (tm && tm[1]) startTime = parseYouTubeTimeParam(tm[1]);
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  return { videoId, startTime };
}

/**
 * Live YouTube oEmbed Pre-Flight Check (cached 10 mins)
 * Verifies the video actually exists & is embeddable (no 401/403/404 dead videos).
 */
export async function checkYouTubeOEmbed(videoId: string): Promise<OEmbedCheckResult> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return { valid: false, videoId, title: '', channelName: '', statusCode: 400 };
  }

  const cached = OEMBED_CACHE.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const resp = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (resp.ok) {
      const data = (await resp.json()) as { title?: string; author_name?: string };
      const result: OEmbedCheckResult = {
        valid: true,
        videoId,
        title: decodeAndNormalizeText(data.title || `YouTube Video (${videoId})`),
        channelName: decodeAndNormalizeText(data.author_name || 'YouTube'),
        statusCode: resp.status,
      };
      OEMBED_CACHE.set(videoId, { result, expiresAt: Date.now() + OEMBED_TTL_MS });
      return result;
    }
    const fail: OEmbedCheckResult = {
      valid: false,
      videoId,
      title: `YouTube Video (${videoId})`,
      channelName: 'YouTube',
      statusCode: resp.status,
    };
    OEMBED_CACHE.set(videoId, { result: fail, expiresAt: Date.now() + 2 * 60 * 1000 });
    return fail;
  } catch {
    return {
      valid: true, // Don't hard-fail on transient network timeout
      videoId,
      title: `YouTube Video (${videoId})`,
      channelName: 'YouTube',
      statusCode: 0,
    };
  }
}

interface InnerTubePlayerResponse {
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string | number;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl?: string;
        languageCode?: string;
        kind?: string;
        name?: { simpleText?: string; runs?: Array<{ text?: string }> };
      }>;
    };
  };
}

function extractTracksFromPlayerResponse(data: InnerTubePlayerResponse): CaptionTrackInfo[] {
  const rawTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(rawTracks)) return [];

  const tracks: CaptionTrackInfo[] = [];
  for (const t of rawTracks) {
    if (!t.baseUrl || !t.languageCode) continue;
    const label =
      t.name?.simpleText ||
      (Array.isArray(t.name?.runs) ? t.name.runs.map((r) => r.text || '').join('') : t.languageCode);
    tracks.push({
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      name: decodeAndNormalizeText(label || t.languageCode),
      isAsr: t.kind === 'asr',
    });
  }
  return tracks;
}

const CAPTIONS_HOT_CACHE = new Map<string, { result: YouTubeExtractionResult; expiresAt: number }>();
const IN_FLIGHT_EXTRACTIONS = new Map<string, Promise<YouTubeExtractionResult>>();
const CAPTIONS_HOT_TTL_MS = 5 * 60 * 1000;

async function fetchViaInnerTube(
  videoId: string,
  clientName: 'ANDROID' | 'IOS' | 'WEB',
  clientVersion: string,
  userAgent: string,
  hl: 'vi' | 'en' = 'vi',
  gl: 'VN' | 'US' = 'VN',
  timeoutMs = 3500
): Promise<{
  tracks: CaptionTrackInfo[];
  title?: string;
  channelName?: string;
  videoDurationSec?: number;
}> {
  try {
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        'Accept-Language': 'vi-VN,vi;q=0.95,en-US;q=0.85,ja;q=0.8',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName,
            clientVersion,
            hl,
            gl,
          },
        },
        videoId,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) return { tracks: [] };
    const data = (await resp.json()) as InnerTubePlayerResponse;
    const dur = Number(data.videoDetails?.lengthSeconds);
    return {
      tracks: extractTracksFromPlayerResponse(data),
      title: data.videoDetails?.title ? decodeAndNormalizeText(data.videoDetails.title) : undefined,
      channelName: data.videoDetails?.author
        ? decodeAndNormalizeText(data.videoDetails.author)
        : undefined,
      videoDurationSec: Number.isFinite(dur) && dur > 0 ? dur : undefined,
    };
  } catch {
    return { tracks: [] };
  }
}

async function fetchViaWatchHtml(
  videoId: string,
  timeoutMs = 4500
): Promise<{
  tracks: CaptionTrackInfo[];
  title?: string;
  channelName?: string;
  videoDurationSec?: number;
}> {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=vi`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.95,en-US;q=0.85,ja;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return { tracks: [] };
    const html = await resp.text();
    const marker = 'ytInitialPlayerResponse = ';
    const idx = html.indexOf(marker);
    if (idx === -1) return { tracks: [] };

    const jsonStart = idx + marker.length;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let jsonEnd = -1;

    // Zero byte cutoff: scan full player response JSON regardless of video length/metadata size
    for (let i = jsonStart; i < html.length; i++) {
      const ch = html[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
    }

    if (jsonEnd === -1) return { tracks: [] };
    const data = JSON.parse(html.slice(jsonStart, jsonEnd)) as InnerTubePlayerResponse;
    const dur = Number(data.videoDetails?.lengthSeconds);
    return {
      tracks: extractTracksFromPlayerResponse(data),
      title: data.videoDetails?.title ? decodeAndNormalizeText(data.videoDetails.title) : undefined,
      channelName: data.videoDetails?.author
        ? decodeAndNormalizeText(data.videoDetails.author)
        : undefined,
      videoDurationSec: Number.isFinite(dur) && dur > 0 ? dur : undefined,
    };
  } catch {
    return { tracks: [] };
  }
}

/**
 * Heuristic detector: checks whether video title/channel contains Vietnamese diacritics
 * so Vietnamese videos prioritize Vietnamese manual/ASR tracks for vi->target learning.
 */
function looksVietnameseTitle(title: string, channelName: string): boolean {
  const combined = `${title} ${channelName}`.normalize('NFC');
  return /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(
    combined
  );
}

/**
 * Priority Selector supporting BOTH 100% Vietnamese videos (Tier 1 Manual VI -> Tier 2 Auto-ASR VI)
 * AND native English/Japanese videos (Manual Target -> Auto-ASR Target).
 */
function selectBestTrack(
  tracks: CaptionTrackInfo[],
  targetLanguage: 'en' | 'ja',
  preferVietnamese: boolean
): {
  track: CaptionTrackInfo;
  sourceLanguage: 'vi' | 'en' | 'ja';
  tier: 'manual_vi' | 'asr_vi' | 'manual_target' | 'asr_target';
} | null {
  if (tracks.length === 0) return null;

  const isLang = (code: string, lang: string) => {
    const lower = code.toLowerCase();
    return lower === lang || lower.startsWith(`${lang}-`);
  };

  const manualVi = tracks.find((t) => isLang(t.languageCode, 'vi') && !t.isAsr);
  const asrVi = tracks.find((t) => isLang(t.languageCode, 'vi') && t.isAsr);
  const manualTarget = tracks.find((t) => isLang(t.languageCode, targetLanguage) && !t.isAsr);
  const asrTarget = tracks.find((t) => isLang(t.languageCode, targetLanguage) && t.isAsr);

  if (preferVietnamese) {
    // Vietnamese Video Priority: Tier 1 Manual VI -> Tier 2 Auto-ASR VI -> Target tracks
    if (manualVi) return { track: manualVi, sourceLanguage: 'vi', tier: 'manual_vi' };
    if (asrVi) return { track: asrVi, sourceLanguage: 'vi', tier: 'asr_vi' };
    if (manualTarget)
      return { track: manualTarget, sourceLanguage: targetLanguage, tier: 'manual_target' };
    if (asrTarget)
      return { track: asrTarget, sourceLanguage: targetLanguage, tier: 'asr_target' };
  } else {
    // Native EN/JP Video Priority: Manual Target -> Auto-ASR Target -> Manual VI -> Auto-ASR VI
    if (manualTarget)
      return { track: manualTarget, sourceLanguage: targetLanguage, tier: 'manual_target' };
    if (asrTarget)
      return { track: asrTarget, sourceLanguage: targetLanguage, tier: 'asr_target' };
    if (manualVi) return { track: manualVi, sourceLanguage: 'vi', tier: 'manual_vi' };
    if (asrVi) return { track: asrVi, sourceLanguage: 'vi', tier: 'asr_vi' };
  }

  return null;
}

function parseVttTimestamp(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':').map((p) => parseFloat(p));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function parseVttPayload(vtt: string): RawCaptionLine[] {
  const normalized = vtt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '');

  const blocks = normalized.split(/\n{2,}/);
  const lines: RawCaptionLine[] = [];

  for (const block of blocks) {
    const rows = block
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    const timeIdx = rows.findIndex((r) => r.includes('-->'));
    if (timeIdx === -1) continue;
    const [rawStart, rawEndPart] = rows[timeIdx].split('-->');
    if (!rawStart || !rawEndPart) continue;

    const start = parseVttTimestamp(rawStart);
    const end = parseVttTimestamp(rawEndPart.trim().split(/\s+/)[0]);
    const duration = Math.max(0.6, Number((end - start).toFixed(2)));
    const text = decodeAndNormalizeText(
      rows
        .slice(timeIdx + 1)
        .join(' ')
        .replace(/<[^>]+>/g, ' ')
    );
    if (!text || /^\[.*\]$/.test(text) || /^♪+$/.test(text)) continue;
    lines.push({ start, duration, text });
  }
  return lines;
}

interface WordTimedSpan {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TimelineAuditReport {
  totalCues: number;
  monotoneFixed: number;
  anomalousTrimmed: number;
  microFlickersMerged: number;
  largeGaps: Array<{ afterIndex: number; gapStartSec: number; gapEndSec: number; gapSec: number }>;
  firstStartSec: number;
  lastEndSec: number;
}

/**
 * Estimates spoken duration (ms) for a single word/token when YouTube omits explicit end time
 * (used only for the final word of an utterance before a silence gap).
 */
function estimateSpokenWordMs(text: string, sourceLanguage: 'vi' | 'en' | 'ja'): number {
  const clean = text.trim();
  if (!clean) return 180;
  if (sourceLanguage === 'ja') {
    return Math.min(720, Math.max(160, clean.length * 145));
  }
  const words = clean.split(/\s+/).filter(Boolean).length;
  return Math.min(820, Math.max(200, words * 270));
}

function estimateUtteranceMaxSpeechSec(text: string, sourceLanguage: 'vi' | 'en' | 'ja'): number {
  const clean = text.trim();
  if (!clean) return 1.2;
  if (sourceLanguage === 'ja') {
    // Natural Japanese speech ~4.5-6.5 chars/sec -> generous ceiling prevents false cuts while catching 5s trailing silence
    return Math.min(6.2, Math.max(1.2, Number((clean.length / 4.2 + 0.55).toFixed(3))));
  }
  const words = countWords(clean);
  // Natural Vietnamese/English speech ~2.3-3.5 words/sec
  return Math.min(6.2, Math.max(1.2, Number((words * 0.48 + 0.55).toFixed(3))));
}

/**
 * Exact Word-Boundary Utterance Builder (Zero-Early / Zero-Late Attack + Anti-Lingering Silence Cut):
 * Converts raw word-level spans (wordStartMs = ev.tStartMs + seg.tOffsetMs) into crisp, breath-aligned
 * cues where EVERY cue inherits:
 *   cue.start = firstWord.startMs / 1000
 *   cue.end   = min(lastWord.endMs + 120ms, nextWord.startMs) / 1000
 * Splits long utterances (> 5.0s) or sentence punctuation cleanly at EXACT word boundaries!
 */
function buildPrecisionCuesFromWordSpans(
  rawSpans: WordTimedSpan[],
  sourceLanguage: 'vi' | 'en' | 'ja'
): RawCaptionLine[] {
  if (rawSpans.length === 0) return [];

  // Sort stably by absolute startMs (zero cumulative drift!) and deduplicate exact rolling ASR echoes
  const sorted = [...rawSpans]
    .filter((s) => s.text.trim().length > 0 && Number.isFinite(s.startMs))
    .sort((a, b) => a.startMs - b.startMs);

  const spans: WordTimedSpan[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = spans[spans.length - 1];
    if (
      prev &&
      cur.text.toLowerCase() === prev.text.toLowerCase() &&
      Math.abs(cur.startMs - prev.startMs) < 180
    ) {
      continue;
    }
    spans.push({
      startMs: Math.max(0, Math.round(cur.startMs)),
      endMs: Math.max(Math.round(cur.startMs) + 90, Math.round(cur.endMs)),
      text: cur.text,
    });
  }

  // Clamp every word's endMs strictly to next word's startMs so words never overlap into future speech
  for (let i = 0; i < spans.length; i++) {
    const next = spans[i + 1];
    const maxSingleWordEnd = spans[i].startMs + Math.max(estimateSpokenWordMs(spans[i].text, sourceLanguage), 320);
    if (spans[i].endMs > maxSingleWordEnd + 350) {
      spans[i].endMs = maxSingleWordEnd;
    }
    if (next && next.startMs > spans[i].startMs + 50 && spans[i].endMs > next.startMs) {
      spans[i].endMs = next.startMs;
    }
  }

  const maxChars = sourceLanguage === 'ja' ? 42 : 96;
  const maxWords = 18;
  const maxDurationMs = 5000; // Hard 5.0s utterance split so translated EN/JA never lags half a sentence!
  const breathPauseMs = 450; // 450ms natural breath pause -> immediate clean break
  const trailingTailMs = 120; // Max 120ms natural vocal decay tail (anti-lingering silence cut)

  const cues: RawCaptionLine[] = [];
  let group: WordTimedSpan[] = [];

  const flushGroup = (nextSpanStartMs?: number) => {
    if (group.length === 0) return;
    const joined = group
      .reduce((acc, sp) => {
        const piece = sp.text;
        if (!acc) return piece;
        if (sourceLanguage === 'ja') return `${acc}${piece}`;
        const needsSpace =
          !/\s$/.test(acc) && !/^[\s.,!?;:)\]]/.test(piece) && !/[(\[]$/.test(acc);
        return `${acc}${needsSpace ? ' ' : ''}${piece}`;
      }, '')
      .replace(/\s*>>\s*/g, '— ')
      .trim();

    const cleaned = decodeAndNormalizeText(joined);
    if (cleaned && !/^\[.*\]$/.test(cleaned) && !/^♪+$/.test(cleaned)) {
      const startMs = group[0].startMs;
      const lastWord = group[group.length - 1];
      let endMs = lastWord.endMs + trailingTailMs;
      if (typeof nextSpanStartMs === 'number' && nextSpanStartMs > startMs + 150) {
        endMs = Math.min(endMs, nextSpanStartMs);
      }
      const startSec = Number((startMs / 1000).toFixed(3));
      const endSec = Number((Math.max(startMs + 220, endMs) / 1000).toFixed(3));
      cues.push({
        start: startSec,
        duration: Number(Math.max(0.22, endSec - startSec).toFixed(3)),
        text: cleaned,
      });
    }
    group = [];
  };

  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    const textTrim = sp.text.trim();
    const isSpeakerChange = /^(?:>>|—)/.test(textTrim);

    if (group.length > 0) {
      const first = group[0];
      const prev = group[group.length - 1];
      const gapMs = sp.startMs - prev.endMs;
      const spanDurationMs = sp.endMs - first.startMs;
      const prevEndsSentence = /[.!?。？！]$/.test(prev.text.trim());
      const prevEndsClause = /[,;:、]$/.test(prev.text.trim());
      const currentText = group.map((g) => g.text).join(sourceLanguage === 'ja' ? '' : ' ');
      const curChars = currentText.length + textTrim.length;
      const curWords =
        sourceLanguage === 'ja' ? 0 : countWords(currentText) + countWords(textTrim);

      const shouldSplit =
        isSpeakerChange ||
        prevEndsSentence ||
        gapMs >= breathPauseMs ||
        spanDurationMs > maxDurationMs ||
        curChars > maxChars ||
        (sourceLanguage !== 'ja' && curWords > maxWords) ||
        (prevEndsClause && spanDurationMs > 3200);

      if (shouldSplit) {
        flushGroup(sp.startMs);
      }
    }

    group.push(sp);
  }
  flushGroup(undefined);

  return auditSubtitleTimeline(cues, undefined, sourceLanguage).lines;
}

function parseSrv3Payload(xml: string, sourceLanguage: 'vi' | 'en' | 'ja' = 'vi'): RawCaptionLine[] {
  const wordSpans: WordTimedSpan[] = [];
  const fallbackLines: RawCaptionLine[] = [];
  let hasWordLevelOffsets = false;

  const pRegex = /<p[^>]*t="(\d+)"(?:[^>]*d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xml)) !== null) {
    const pStartMs = Math.max(0, parseInt(match[1], 10));
    const pDurMs = match[2] ? Math.max(250, parseInt(match[2], 10)) : 2400;
    const inner = match[3] || '';

    // Check for word-level <s t="offsetMs"> segments inside <p>
    const sRegex = /<s(?:\s+[^>]*?t="(\d+)")?[^>]*>([\s\S]*?)<\/s>/g;
    const localSpans: WordTimedSpan[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = sRegex.exec(inner)) !== null) {
      const segText = decodeAndNormalizeText((sm[2] || '').replace(/<[^>]+>/g, ' ').replace(/\n+/g, ' '));
      if (!segText || /^\[.*\]$/.test(segText) || /^♪+$/.test(segText)) continue;
      const offsetMs = sm[1] ? parseInt(sm[1], 10) : 0;
      if (sm[1]) hasWordLevelOffsets = true;
      const wStart = pStartMs + Math.max(0, offsetMs);
      localSpans.push({
        startMs: wStart,
        endMs: wStart + estimateSpokenWordMs(segText, sourceLanguage),
        text: segText,
      });
    }

    if (localSpans.length > 0) {
      for (let k = 0; k < localSpans.length - 1; k++) {
        if (localSpans[k + 1].startMs > localSpans[k].startMs) {
          localSpans[k].endMs = localSpans[k + 1].startMs;
        }
      }
      const last = localSpans[localSpans.length - 1];
      const maxEnd = pStartMs + pDurMs;
      if (last.endMs > maxEnd && maxEnd > last.startMs + 120) {
        last.endMs = maxEnd;
      }
      wordSpans.push(...localSpans);
      continue;
    }

    const text = decodeAndNormalizeText(inner.replace(/<[^>]+>/g, ' ').replace(/\n+/g, ' '));
    if (!text || /^\[.*\]$/.test(text) || /^♪+$/.test(text)) continue;
    fallbackLines.push({
      start: Number((pStartMs / 1000).toFixed(3)),
      duration: Number(Math.max(0.35, pDurMs / 1000).toFixed(3)),
      text,
    });
  }

  if (hasWordLevelOffsets && wordSpans.length > 0) {
    return buildPrecisionCuesFromWordSpans(wordSpans, sourceLanguage);
  }
  return fallbackLines.length > 0 ? mergeFragmentedLines(fallbackLines, sourceLanguage) : [];
}

function parseXmlPayload(xml: string): RawCaptionLine[] {
  const lines: RawCaptionLine[] = [];
  const regex = /<text[^>]*start="([\d.]+)"(?:[^>]*dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1]);
    if (!Number.isFinite(start)) continue;
    const duration = match[2] ? parseFloat(match[2]) : 2.5;
    const text = decodeAndNormalizeText(match[3].replace(/<[^>]+>/g, ' ').replace(/\n+/g, ' '));
    if (!text || /^\[.*\]$/.test(text) || /^♪+$/.test(text)) continue;
    lines.push({
      start: Math.max(0, Number(start.toFixed(3))),
      duration: Math.max(0.25, Number((Number.isFinite(duration) ? duration : 2.5).toFixed(3))),
      text,
    });
  }
  return lines;
}

/**
 * Multi-format Zero-Cap Lossless YouTube Caption Downloader:
 * - Reads absolute ms timestamps (NEVER cumulative sums) across 100% of events (never breaks early on empty/style blocks)
 * - Uses word-level tStartMs + tOffsetMs (json3 & srv3) for exact first-syllable attack and anti-lingering silence cut
 * - Runs Automated 7-Point Timing & Continuity Auditor before returning
 */
async function downloadCaptionLines(
  track: CaptionTrackInfo,
  sourceLanguage: 'vi' | 'en' | 'ja'
): Promise<RawCaptionLine[]> {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const withFmt = (fmt: string) =>
    track.baseUrl.includes('fmt=')
      ? track.baseUrl.replace(/fmt=[^&]+/, `fmt=${fmt}`)
      : `${track.baseUrl}&fmt=${fmt}`;

  // 1. Try json3 (exact ms timestamps + per-word tOffsetMs for word-boundary precision!)
  try {
    const resp = await fetch(withFmt('json3'), {
      headers: { 'User-Agent': ua },
      signal: AbortSignal.timeout(18000),
    });
    if (resp.ok) {
      const content = await resp.text();
      if (content.trim().startsWith('{')) {
        const parsed = JSON.parse(content) as {
          events?: Array<{
            tStartMs?: number;
            dDurationMs?: number;
            segs?: Array<{ utf8?: string; tOffsetMs?: number }>;
          }>;
        };
        if (Array.isArray(parsed.events)) {
          const wordSpans: WordTimedSpan[] = [];
          const eventLines: RawCaptionLine[] = [];
          let wordOffsetHits = 0;

          // Lossless iteration: skip non-text/positioning events with `continue`, NEVER `break` or `return` early!
          for (let evIdx = 0; evIdx < parsed.events.length; evIdx++) {
            const ev = parsed.events[evIdx];
            if (!ev || !Array.isArray(ev.segs) || typeof ev.tStartMs !== 'number') continue;

            const nonEmptySegs = ev.segs.filter(
              (s) => typeof s?.utf8 === 'string' && s.utf8.replace(/\n+/g, ' ').trim().length > 0
            );
            if (nonEmptySegs.length === 0) continue;

            const localWords: WordTimedSpan[] = [];
            for (let sIdx = 0; sIdx < nonEmptySegs.length; sIdx++) {
              const seg = nonEmptySegs[sIdx];
              const cleanSeg = decodeAndNormalizeText((seg.utf8 || '').replace(/\n+/g, ' '));
              if (!cleanSeg || /^\[.*\]$/.test(cleanSeg) || /^♪+$/.test(cleanSeg)) continue;
              const offsetMs =
                typeof seg.tOffsetMs === 'number' && Number.isFinite(seg.tOffsetMs) && seg.tOffsetMs >= 0
                  ? seg.tOffsetMs
                  : 0;
              if (typeof seg.tOffsetMs === 'number' && seg.tOffsetMs > 0) {
                wordOffsetHits++;
              }
              const wStartMs = Math.max(0, ev.tStartMs + offsetMs);
              localWords.push({
                startMs: wStartMs,
                endMs: wStartMs + estimateSpokenWordMs(cleanSeg, sourceLanguage),
                text: cleanSeg,
              });
            }

            if (localWords.length === 0) continue;

            // Lock each word's endMs tightly to the next word in the same event
            for (let k = 0; k < localWords.length - 1; k++) {
              if (localWords[k + 1].startMs > localWords[k].startMs) {
                localWords[k].endMs = localWords[k + 1].startMs;
              }
            }
            const lastWord = localWords[localWords.length - 1];
            const eventEndMs =
              typeof ev.dDurationMs === 'number' && ev.dDurationMs > 0
                ? ev.tStartMs + ev.dDurationMs
                : lastWord.endMs;
            if (eventEndMs > lastWord.startMs + 120 && eventEndMs < lastWord.endMs) {
              lastWord.endMs = eventEndMs;
            }
            wordSpans.push(...localWords);

            // Also record event-level fallback in case track is a manual caption with 0 word-level tOffsetMs
            const rawText = ev.segs.map((s) => s.utf8 || '').join('');
            const cleaned = decodeAndNormalizeText(rawText.replace(/\n+/g, ' '));
            if (cleaned && !/^\[.*\]$/.test(cleaned) && !/^♪+$/.test(cleaned)) {
              const firstOffsetMs =
                typeof nonEmptySegs[0].tOffsetMs === 'number' && nonEmptySegs[0].tOffsetMs >= 0
                  ? nonEmptySegs[0].tOffsetMs
                  : 0;
              const startMs = Math.max(0, ev.tStartMs + firstOffsetMs);
              const rawDurMs = ev.dDurationMs
                ? Math.max(250, ev.dDurationMs - firstOffsetMs)
                : 2400;
              eventLines.push({
                start: Number((startMs / 1000).toFixed(3)),
                duration: Number(Math.max(0.25, rawDurMs / 1000).toFixed(3)),
                text: cleaned,
              });
            }
          }

          if (wordOffsetHits > 0 && wordSpans.length > 0) {
            return buildPrecisionCuesFromWordSpans(wordSpans, sourceLanguage);
          }
          if (eventLines.length > 0) {
            return mergeFragmentedLines(eventLines, sourceLanguage);
          }
        }
      }
    }
  } catch {
    // Fall through to srv3 / vtt / xml
  }

  // 2. Try srv3 (supports word-level <s t="offsetMs">)
  try {
    const resp = await fetch(withFmt('srv3'), {
      headers: { 'User-Agent': ua },
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      const xml = await resp.text();
      const lines = parseSrv3Payload(xml, sourceLanguage);
      if (lines.length > 0) return lines;
    }
  } catch {
    // Fall through
  }

  // 3. Try vtt
  try {
    const resp = await fetch(withFmt('vtt'), {
      headers: { 'User-Agent': ua },
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      const vtt = await resp.text();
      const lines = parseVttPayload(vtt);
      if (lines.length > 0) return mergeFragmentedLines(lines, sourceLanguage);
    }
  } catch {
    // Fall through
  }

  // 4. Fallback: standard XML timedtext
  try {
    const resp = await fetch(track.baseUrl, {
      headers: { 'User-Agent': ua },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const lines = parseXmlPayload(xml);
    return mergeFragmentedLines(lines, sourceLanguage);
  } catch {
    return [];
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Splits overly long (> 5.2s) or multi-sentence cues at natural punctuation/clause boundaries
 * using proportional syllable/char weighting strictly clamped inside [cue.start, cue.end].
 */
function splitLongOrMultiSpeakerCue(
  cue: RawCaptionLine,
  sourceLanguage: 'vi' | 'en' | 'ja'
): RawCaptionLine[] {
  const clean = decodeAndNormalizeText(cue.text);
  if (!clean) return [];

  // 1. Always split on explicit speaker markers (`>>`, `—`)
  const normalizedSpeakers = clean.replace(/\s*>>\s*/g, '\n— ').replace(/\s+—\s+/g, '\n— ').trim();
  let parts = normalizedSpeakers
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

  // 2. If single cue is still > 5.2s, split cleanly on sentence or clause boundaries
  if (parts.length === 1 && cue.duration > 5.2) {
    const sentenceSplit = clean
      .split(/(?<=[.!?。？！])\s+|(?<=[。？！])/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (sentenceSplit.length > 1) {
      parts = sentenceSplit;
    } else if (cue.duration > 6.0) {
      const clauseSplit = clean
        .split(/(?<=[,;،、])\s+|(?<=、)/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (clauseSplit.length > 1) {
        // Re-balance into 2 even halves so we don't produce micro-fragments
        const mid = Math.ceil(clauseSplit.length / 2);
        parts = [
          clauseSplit.slice(0, mid).join(sourceLanguage === 'ja' ? '' : ' '),
          clauseSplit.slice(mid).join(sourceLanguage === 'ja' ? '' : ' '),
        ].filter(Boolean);
      }
    }
  }

  if (parts.length <= 1) {
    return [{ start: cue.start, duration: cue.duration, text: normalizedSpeakers }];
  }

  const totalWeight = parts.reduce((sum, p) => sum + Math.max(1, p.length), 0);
  const cueEnd = cue.start + cue.duration;
  let cursor = cue.start;
  const out: RawCaptionLine[] = [];

  for (let i = 0; i < parts.length; i++) {
    const ratio = Math.max(1, parts[i].length) / totalWeight;
    const isLast = i === parts.length - 1;
    const segEnd = isLast ? cueEnd : Math.min(cueEnd, cursor + Math.max(0.35, cue.duration * ratio));
    const segDur = Math.max(0.25, Number((segEnd - cursor).toFixed(3)));
    out.push({
      start: Number(cursor.toFixed(3)),
      duration: segDur,
      text: parts[i],
    });
    cursor = Number((cursor + segDur).toFixed(3));
  }
  return out;
}

function expandSpeakerTurns(
  raw: RawCaptionLine[],
  sourceLanguage: 'vi' | 'en' | 'ja' = 'vi'
): RawCaptionLine[] {
  const out: RawCaptionLine[] = [];
  for (const cue of raw) {
    out.push(...splitLongOrMultiSpeakerCue(cue, sourceLanguage));
  }
  return out;
}

/**
 * Automated 6-Point / 7-Point Pre-Render Timing & Continuity Auditor (`auditSubtitleTimeline`):
 * 1. Strict Monotonicity: cue[i].start < cue[i].end <= cue[i+1].start (0% overlap, 0 NaN)
 * 2. Anomalous Duration Trap: trims trailing silence on cues > 6.2s or stretched past natural vocal rate
 * 3. Micro-Flicker Guard: merges stray < 200ms fragments cleanly into adjacent cue (0 dropped words)
 * 4. Anti-Skip Continuity Diagnostics: flags any > 20s unvoiced gaps for verification
 * 5. Full-Duration Coverage: zero hard caps from 00:00:00 to 03:00:00+
 */
export function auditSubtitleTimeline(
  lines: RawCaptionLine[],
  videoDurationSec?: number,
  sourceLanguage: 'vi' | 'en' | 'ja' = 'vi'
): { lines: RawCaptionLine[]; report: TimelineAuditReport } {
  if (lines.length === 0) {
    return {
      lines: [],
      report: {
        totalCues: 0,
        monotoneFixed: 0,
        anomalousTrimmed: 0,
        microFlickersMerged: 0,
        largeGaps: [],
        firstStartSec: 0,
        lastEndSec: 0,
      },
    };
  }

  let monotoneFixed = 0;
  let anomalousTrimmed = 0;
  let microFlickersMerged = 0;

  const sorted = [...lines]
    .filter((l) => l && l.text && l.text.trim().length > 0 && Number.isFinite(l.start) && l.start >= 0)
    .sort((a, b) => a.start - b.start);

  // Pass 1: Split anomalous > 6.2s multi-clause cues before tightening
  const expanded: RawCaptionLine[] = [];
  for (const c of sorted) {
    if (c.duration > 6.2) {
      const split = splitLongOrMultiSpeakerCue(c, sourceLanguage);
      if (split.length > 1) {
        anomalousTrimmed++;
        expanded.push(...split);
        continue;
      }
    }
    expanded.push(c);
  }

  // Pass 2: Micro-Flicker Guard (< 0.20s) — attach cleanly to adjacent cue instead of flashing unreadable text
  const deflickered: RawCaptionLine[] = [];
  for (let i = 0; i < expanded.length; i++) {
    const cur = expanded[i];
    const dur = Number.isFinite(cur.duration) ? cur.duration : 1.5;
    if (dur < 0.2 && deflickered.length > 0) {
      const prev = deflickered[deflickered.length - 1];
      const gap = cur.start - (prev.start + prev.duration);
      if (gap >= -0.05 && gap <= 0.35 && prev.duration + Math.max(0.2, dur) <= 6.0) {
        const sep = sourceLanguage === 'ja' ? '' : ' ';
        prev.text = decodeAndNormalizeText(`${prev.text}${sep}${cur.text}`);
        prev.duration = Number(
          Math.max(prev.duration, cur.start + Math.max(0.2, dur) - prev.start).toFixed(3)
        );
        microFlickersMerged++;
        continue;
      }
    }
    deflickered.push({
      start: Math.max(0, Number(cur.start.toFixed(3))),
      duration: Math.max(0.22, Number(dur.toFixed(3))),
      text: decodeAndNormalizeText(cur.text),
      readingMap: cur.readingMap,
      ipaLine: cur.ipaLine,
      translationVi: cur.translationVi,
    });
  }

  // Pass 3: Strict Monotonicity + Anomalous Trailing Silence Cut
  const normalized: RawCaptionLine[] = [];
  for (let i = 0; i < deflickered.length; i++) {
    const cur = deflickered[i];
    let start = Math.max(0, Number(cur.start.toFixed(3)));
    let dur = Math.max(0.22, Number(cur.duration.toFixed(3)));

    // Trim anomalous trailing silence (YouTube ASR cues often stretch 4-8s over silence)
    const maxSpeechSec = estimateUtteranceMaxSpeechSec(cur.text, sourceLanguage);
    if (dur > Math.max(6.2, maxSpeechSec + 1.4)) {
      dur = Number(Math.min(6.2, maxSpeechSec + 0.45).toFixed(3));
      anomalousTrimmed++;
    }

    // Clamp cleanly against videoDurationSec if known
    if (videoDurationSec && videoDurationSec > 5 && start + dur > videoDurationSec + 0.5) {
      dur = Math.max(0.22, Number((videoDurationSec - start).toFixed(3)));
    }

    const prev = normalized[normalized.length - 1];
    if (prev) {
      if (start < prev.start + 0.05) {
        start = Number((prev.start + 0.05).toFixed(3));
        monotoneFixed++;
      }
      if (prev.start + prev.duration > start) {
        prev.duration = Math.max(0.2, Number((start - prev.start).toFixed(3)));
        monotoneFixed++;
      }
    }

    const next = deflickered[i + 1];
    if (next && Number.isFinite(next.start)) {
      const maxAllowDur = next.start - start;
      if (maxAllowDur >= 0.2 && dur > maxAllowDur) {
        dur = Number(maxAllowDur.toFixed(3));
        monotoneFixed++;
      }
    }

    normalized.push({
      start,
      duration: Math.max(0.2, dur),
      text: cur.text,
      readingMap: cur.readingMap,
      ipaLine: cur.ipaLine,
      translationVi: cur.translationVi,
    });
  }

  // Pass 4: Continuity gap diagnostics (> 20s silence gaps)
  const largeGaps: TimelineAuditReport['largeGaps'] = [];
  for (let i = 0; i < normalized.length - 1; i++) {
    const endA = normalized[i].start + normalized[i].duration;
    const startB = normalized[i + 1].start;
    const gap = startB - endA;
    if (gap > 20) {
      largeGaps.push({
        afterIndex: i,
        gapStartSec: Number(endA.toFixed(2)),
        gapEndSec: Number(startB.toFixed(2)),
        gapSec: Number(gap.toFixed(2)),
      });
    }
  }

  const firstStartSec = normalized.length > 0 ? normalized[0].start : 0;
  const lastCue = normalized[normalized.length - 1];
  const lastEndSec = lastCue ? Number((lastCue.start + lastCue.duration).toFixed(3)) : 0;

  return {
    lines: normalized,
    report: {
      totalCues: normalized.length,
      monotoneFixed,
      anomalousTrimmed,
      microFlickersMerged,
      largeGaps,
      firstStartSec,
      lastEndSec,
    },
  };
}

/**
 * Monotonic Non-Overlapping Full-Timeline Normalizer (backwards-compatible wrapper around auditSubtitleTimeline)
 */
export function normalizeMonotonicTimeline(
  lines: RawCaptionLine[],
  videoDurationSec?: number,
  sourceLanguage: 'vi' | 'en' | 'ja' = 'vi'
): RawCaptionLine[] {
  return auditSubtitleTimeline(lines, videoDurationSec, sourceLanguage).lines;
}

/**
 * Breath-Aware Utterance Segmenter (Vietnamese / English / Japanese) — ZERO HARD CAPS:
 * - Processes 100% of the full video timeline (500 to 6,000+ lines) without ever slicing or truncating.
 * - Golden Utterance Bounds: <= 5.0s or ~18 words (42 chars JA) so translated EN/JA stays locked in sync.
 * - Breaks immediately on silence/breath gap > 450ms (0.45s), sentence punctuation, or speaker change (`—`).
 * - Ends with Automated 7-Point Timing & Continuity Auditor (`auditSubtitleTimeline`).
 */
export function mergeFragmentedLines(
  raw: RawCaptionLine[],
  sourceLanguage: 'vi' | 'en' | 'ja' = 'vi'
): RawCaptionLine[] {
  const expanded = expandSpeakerTurns(raw, sourceLanguage);
  if (expanded.length === 0) return [];

  const merged: RawCaptionLine[] = [];
  let current: RawCaptionLine = {
    start: expanded[0].start,
    duration: expanded[0].duration,
    text: decodeAndNormalizeText(expanded[0].text),
  };

  const maxChars = sourceLanguage === 'ja' ? 42 : 96;
  const maxWords = 18;
  const maxDuration = 5.0;
  const breathPauseThresholdSec = 0.45; // 450ms natural breath pause -> immediate new cue

  for (let i = 1; i < expanded.length; i++) {
    const nextText = decodeAndNormalizeText(expanded[i].text);
    if (!nextText) continue;
    const next: RawCaptionLine = {
      start: expanded[i].start,
      duration: expanded[i].duration,
      text: nextText,
    };

    // Deduplicate overlapping rolling ASR echoes
    if (next.text === current.text && next.start - current.start < 2.0) {
      current.duration = Number(
        Math.max(current.duration, next.start + next.duration - current.start).toFixed(3)
      );
      continue;
    }

    const currentEnd = current.start + current.duration;
    const gap = next.start - currentEnd;
    const combinedDuration = next.start + next.duration - current.start;
    const endsSentence = /[.!?。？！]$/.test(current.text.trim());
    const startsNewSpeaker = /^(?:—|–|-\s|>>)/.test(next.text.trim());
    const combinedLen = current.text.length + next.text.length;
    const combinedWords =
      sourceLanguage === 'ja' ? 0 : countWords(current.text) + countWords(next.text);

    const canMerge =
      !endsSentence &&
      !startsNewSpeaker &&
      gap <= breathPauseThresholdSec &&
      combinedDuration <= maxDuration &&
      combinedLen <= maxChars &&
      (sourceLanguage === 'ja' || combinedWords <= maxWords);

    if (canMerge) {
      const needsSpace =
        sourceLanguage !== 'ja' &&
        /[\p{L}\p{N},;:]$/u.test(current.text) &&
        /^[\p{L}\p{N}"'(]/u.test(next.text);
      current = {
        start: current.start,
        duration: Number(Math.max(combinedDuration, 0.45).toFixed(3)),
        text: decodeAndNormalizeText(`${current.text}${needsSpace ? ' ' : ''}${next.text}`),
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  return auditSubtitleTimeline(merged, undefined, sourceLanguage).lines;
}

/**
 * 4-Tier Zero-Latency YouTube Caption Extraction Pipeline:
 * - L1 Server Hot Cache + In-Flight Deduplication (0ms hit after speculative onPaste pre-fetch!)
 * - Fast Race: InnerTube ANDROID (2.5s timeout) in parallel with oEmbed -> Parallel Watch HTML + IOS fallback
 * - Tier 1: Official Manual Captions (Vietnamese or Target EN/JP)
 * - Tier 2: Auto-ASR Captions (kind='asr', vi/vi-VN/en/ja across json3/srv3/vtt/xml)
 * - Tier 3: Smart Rescue — Gemini Native Multimodal YouTube Audio Speech-to-Text
 * - Tier 4: Zero-Dead-End Signal (opens instant transcript paste / .SRT/.VTT rescue box)
 */
export async function extractYouTubeCaptions(
  urlOrId: string,
  targetLanguage: 'en' | 'ja',
  targetLevel?: string
): Promise<YouTubeExtractionResult> {
  const parsed = parseYouTubeUrlServer(urlOrId);
  if (!parsed) {
    throw new Error(
      'Đường link chưa đúng định dạng YouTube — hãy dán lại link video đầy đủ (watch?v=, youtu.be/, shorts/, live/...).'
    );
  }

  const { videoId, startTime } = parsed;
  const cacheKey = `${videoId}_${targetLanguage}_${targetLevel || 'auto'}`;

  // 0ms Server Hot Cache hit (e.g., from speculative onPaste or repeated load)
  const hotHit = CAPTIONS_HOT_CACHE.get(cacheKey);
  if (hotHit && hotHit.expiresAt > Date.now()) {
    return { ...hotHit.result, startTime };
  }

  // Deduplicate concurrent requests for the same videoId + language (e.g. onPaste + submit click)
  const existingFlight = IN_FLIGHT_EXTRACTIONS.get(cacheKey);
  if (existingFlight) {
    const shared = await existingFlight;
    return { ...shared, startTime };
  }

  const work = (async (): Promise<YouTubeExtractionResult> => {
    // Run oEmbed + Fast InnerTube ANDROID (2.5s timeout) simultaneously at t = 0ms!
    const [oembed, androidRes] = await Promise.all([
      checkYouTubeOEmbed(videoId),
      fetchViaInnerTube(
        videoId,
        'ANDROID',
        '20.10.38',
        'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
        'vi',
        'VN',
        2500
      ),
    ]);

    let title = androidRes.title || oembed.title || `YouTube Video (${videoId})`;
    let channelName = androidRes.channelName || oembed.channelName || 'YouTube';
    let videoDurationSec = androidRes.videoDurationSec;
    let availableTracks = androidRes.tracks.map((t) => ({
      languageCode: t.languageCode,
      name: t.name,
      isAsr: t.isAsr,
    }));

    const tryDownloadCandidateTracks = async (
      candidateTracks: CaptionTrackInfo[],
      curTitle: string,
      curChannel: string
    ): Promise<YouTubeExtractionResult | null> => {
      if (candidateTracks.length === 0) return null;
      const preferVi = looksVietnameseTitle(curTitle, curChannel);
      const picked = selectBestTrack(candidateTracks, targetLanguage, preferVi);
      if (!picked) return null;
      const downloaded = await downloadCaptionLines(picked.track, picked.sourceLanguage);
      if (downloaded.length === 0) return null;
      const lastEnd =
        downloaded[downloaded.length - 1].start + downloaded[downloaded.length - 1].duration;
      return {
        status: 'ok',
        videoId,
        title: curTitle,
        channelName: curChannel,
        videoDurationSec: videoDurationSec || Math.ceil(lastEnd),
        startTime,
        sourceLanguage: picked.sourceLanguage,
        extractionTier: picked.tier,
        detectedLanguage: picked.track.languageCode,
        isAsr: picked.track.isAsr,
        lines: downloaded,
        availableTracks: candidateTracks.map((t) => ({
          languageCode: t.languageCode,
          name: t.name,
          isAsr: t.isAsr,
        })),
      };
    };

    // Attempt 1: ANDROID InnerTube tracks
    const androidSuccess = await tryDownloadCandidateTracks(androidRes.tracks, title, channelName);
    if (androidSuccess) {
      CAPTIONS_HOT_CACHE.set(cacheKey, {
        result: androidSuccess,
        expiresAt: Date.now() + CAPTIONS_HOT_TTL_MS,
      });
      return androidSuccess;
    }

    // Attempt 2: Fast 2.2s Race Watch HTML + IOS + WEB InnerTube in parallel so captionless videos
    // NEVER hang before activating the AI Auto-Subtitle Engine!
    const [htmlRes, iosRes, webRes] = await Promise.all([
      fetchViaWatchHtml(videoId, 2400),
      fetchViaInnerTube(
        videoId,
        'IOS',
        '20.10.4',
        'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
        'vi',
        'VN',
        2200
      ),
      fetchViaInnerTube(
        videoId,
        'WEB',
        '2.20250201.00.00',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'vi',
        'VN',
        2200
      ),
    ]);

    for (const candidate of [htmlRes, iosRes, webRes]) {
      if (candidate.title) title = candidate.title;
      if (candidate.channelName) channelName = candidate.channelName;
      if (candidate.videoDurationSec && !videoDurationSec) {
        videoDurationSec = candidate.videoDurationSec;
      }
      if (candidate.tracks.length > 0 && availableTracks.length === 0) {
        availableTracks = candidate.tracks.map((t) => ({
          languageCode: t.languageCode,
          name: t.name,
          isAsr: t.isAsr,
        }));
      }
      const dlSuccess = await tryDownloadCandidateTracks(candidate.tracks, title, channelName);
      if (dlSuccess) {
        CAPTIONS_HOT_CACHE.set(cacheKey, {
          result: dlSuccess,
          expiresAt: Date.now() + CAPTIONS_HOT_TTL_MS,
        });
        return dlSuccess;
      }
    }

    const preferVietnamese = looksVietnameseTitle(title, channelName);

    // SEAMLESS AUTO-TRIGGER: AI Auto-Subtitle Engine (ZERO blocking popup, 1.5-3s streaming opener!)
    // Immediately return ai_auto_sub handoff so the client streams Segment 0 (0s->30s) via
    // /api/youtube/stt-stream and launches 4-6 parallel 1-Pass Audio workers across the full duration.
    if (oembed.valid) {
      const initialOffset = startTime > 10 ? Math.max(0, startTime - 5) : 0;
      return {
        status: 'ai_auto_sub',
        videoId,
        title,
        channelName,
        videoDurationSec,
        startTime,
        sourceLanguage: preferVietnamese ? 'vi' : targetLanguage,
        extractionTier: 'stt_ai',
        detectedLanguage: preferVietnamese ? 'vi' : targetLanguage,
        isAsr: false,
        hasMoreStt: true,
        nextSttOffsetSec: initialOffset,
        directTranslated: true,
        lines: [],
        availableTracks,
      };
    }

    return {
      status: 'no_captions',
      videoId,
      title,
      channelName,
      startTime,
      sourceLanguage: preferVietnamese ? 'vi' : targetLanguage,
      extractionTier: 'none',
      lines: [],
      availableTracks,
      message:
        'Video này hiện ở chế độ riêng tư hoặc bị giới hạn quyền truy cập. Bạn có thể bật AI nghe trực tiếp hoặc nạp tệp .SRT/.VTT để học ngay.',
    };
  })();

  IN_FLIGHT_EXTRACTIONS.set(cacheKey, work);
  try {
    return await work;
  } finally {
    IN_FLIGHT_EXTRACTIONS.delete(cacheKey);
  }
}
