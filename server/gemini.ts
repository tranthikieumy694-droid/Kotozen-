import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  bulletproofParseJson,
  decodeAndNormalizeText,
  sanitizeCompactReadingMapServer,
  stripHtmlAndRubyArtifactsServer,
  toFriendlyErrorMessage,
} from './textSanitizer.ts';

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY chưa được cấu hình. Vui lòng thiết lập khóa API trong Settings > Secrets.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

/**
 * Single Source of Truth for Global Gemini Model Configuration.
 * Primary: gemini-3.8-flash (recommended by Google Gemini API)
 * Automatic zero-404 / zero-503 failover cascade + dynamic live-model discovery.
 */
export const GEMINI_MODEL = 'gemini-3.8-flash';

const STATIC_MODEL_CASCADE: Array<{ model: string; supportsThinking: boolean }> = [
  { model: 'gemini-3.8-flash', supportsThinking: true },
  { model: 'gemini-4-hydrogen', supportsThinking: true },
  { model: 'gemini-3-flash-preview', supportsThinking: true },
  { model: 'gemini-3.1-flash-lite', supportsThinking: false },
];

type CooldownReason = 'not_found' | 'daily_quota' | 'transient';
interface ModelCooldownEntry {
  until: number;
  reason: CooldownReason;
}

// Remember the last known healthy model in memory to avoid repeating 404/503/daily-quota probes
let preferredHealthyModel: string | null = null;
const modelCooldowns = new Map<string, ModelCooldownEntry>();
let globalDailyQuotaUntil = 0;
let discoveredLiveModelsCache: { fetchedAt: number; models: string[] } | null = null;

function setModelCooldown(model: string, reason: CooldownReason, err?: unknown) {
  const now = Date.now();
  let durationMs = 20 * 1000; // transient RPM / 503
  if (reason === 'not_found') {
    durationMs = 30 * 60 * 1000; // 30m for 404 models
  } else if (reason === 'daily_quota') {
    // Models with limit: 0 or PerDay quota exhaustion should NOT be re-hammered every 12s
    const raw = err instanceof Error ? err.message : String(err || '');
    const m = raw.match(/retryDelay["':\s]+(\d+)s/i);
    const retrySec = m ? Number(m[1]) : 1800;
    durationMs = Math.min(Math.max(retrySec * 1000, 15 * 60 * 1000), 60 * 60 * 1000);
  }
  modelCooldowns.set(model, { until: now + durationMs, reason });
  if (preferredHealthyModel === model) {
    preferredHealthyModel = null;
  }
}

function getActiveCooldown(model: string, now = Date.now()): ModelCooldownEntry | null {
  const entry = modelCooldowns.get(model);
  if (!entry) return null;
  if (entry.until <= now) {
    modelCooldowns.delete(model);
    return null;
  }
  return entry;
}

function createDailyQuotaError(): Error & { status: number; isDailyQuota: boolean } {
  const err = new Error(
    'Hạn mức gọi AI miễn phí hôm nay đã tạm hết. Các phụ đề đã dịch vẫn được giữ nguyên; vui lòng chờ hạn mức làm mới hoặc chuyển sang khóa API trả phí trong Settings > Secrets.'
  ) as Error & { status: number; isDailyQuota: boolean };
  err.status = 429;
  err.isDailyQuota = true;
  return err;
}

// Priority Concurrency Scheduler (Strict Completion SLA v2):
// - Background pool up to 10 concurrent calls (Tier 1: 4-6, Tier 2: 6-8, Tier 3: 8-10)
// - 2 Dedicated Express Slots ALWAYS reserved above background (total ceiling = 12)
//   so playhead streaming, tail-end scrubbing, and 1-Click lookups NEVER starve!
const MAX_BACKGROUND_GEMINI_CALLS = 10;
const MAX_TOTAL_GEMINI_CALLS = 12;
let activeBackgroundCalls = 0;
let activeExpressCalls = 0;
const expressWaitQueue: Array<() => void> = [];
const backgroundWaitQueue: Array<() => void> = [];

function dispatchNextGeminiSlot() {
  while (
    expressWaitQueue.length > 0 &&
    activeExpressCalls + activeBackgroundCalls < MAX_TOTAL_GEMINI_CALLS
  ) {
    const nextExpress = expressWaitQueue.shift();
    if (nextExpress) {
      activeExpressCalls += 1;
      nextExpress();
    }
  }
  while (
    backgroundWaitQueue.length > 0 &&
    activeBackgroundCalls < MAX_BACKGROUND_GEMINI_CALLS &&
    activeExpressCalls + activeBackgroundCalls < MAX_TOTAL_GEMINI_CALLS
  ) {
    const nextBg = backgroundWaitQueue.shift();
    if (nextBg) {
      activeBackgroundCalls += 1;
      nextBg();
    }
  }
}

async function withGeminiConcurrencySlot<T>(
  fn: () => Promise<T>,
  priority: 'express' | 'background' = 'background'
): Promise<T> {
  if (priority === 'express') {
    if (activeExpressCalls + activeBackgroundCalls >= MAX_TOTAL_GEMINI_CALLS) {
      await new Promise<void>((resolve) => expressWaitQueue.push(resolve));
    } else {
      activeExpressCalls += 1;
    }
  } else {
    if (
      activeBackgroundCalls >= MAX_BACKGROUND_GEMINI_CALLS ||
      activeExpressCalls + activeBackgroundCalls >= MAX_TOTAL_GEMINI_CALLS
    ) {
      await new Promise<void>((resolve) => backgroundWaitQueue.push(resolve));
    } else {
      activeBackgroundCalls += 1;
    }
  }

  try {
    return await fn();
  } finally {
    if (priority === 'express') {
      activeExpressCalls = Math.max(0, activeExpressCalls - 1);
    } else {
      activeBackgroundCalls = Math.max(0, activeBackgroundCalls - 1);
    }
    dispatchNextGeminiSlot();
  }
}

function isModelNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /404|NOT_FOUND|no longer available|not found|is not supported for generateContent/i.test(
    msg
  );
}

function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /Request timeout on|Stream handshake timeout|Stream chunk stall|aborted/i.test(msg);
}

export function isDailyQuotaError(err: unknown): boolean {
  if (!err) return false;
  if (Boolean((err as { isDailyQuota?: boolean } | null)?.isDailyQuota)) return true;
  const msg = err instanceof Error ? err.message : String(err || '');
  if (/limit:\s*0\b|PerDay|per\s+day|daily\s+limit/i.test(msg)) return true;
  const retryMatch = msg.match(/retryDelay["':\s]+(\d+)s/i);
  if (retryMatch && Number(retryMatch[1]) >= 300) return true;
  return false;
}

export function isRateLimitError(err: unknown): boolean {
  if (isDailyQuotaError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err || '');
  const status = (err as { status?: number } | null)?.status;
  return status === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg);
}

function isTransientError(err: unknown): boolean {
  if (isTimeoutError(err)) return false;
  const msg = err instanceof Error ? err.message : String(err || '');
  return /503|429|500|502|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|ECONNRESET|fetch failed/i.test(
    msg
  );
}

function isThinkingConfigError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /400|INVALID_ARGUMENT/i.test(msg) && /thinking/i.test(msg);
}

/**
 * Dynamically queries active generateContent-capable models on the current API key
 * if every static cascade candidate fails with 404 NOT_FOUND or quota saturation.
 */
async function discoverLiveGenerateModels(ai: GoogleGenAI): Promise<string[]> {
  const now = Date.now();
  if (discoveredLiveModelsCache && now - discoveredLiveModelsCache.fetchedAt < 10 * 60 * 1000) {
    return discoveredLiveModelsCache.models;
  }

  try {
    const pager = await ai.models.list();
    const candidates: string[] = [];
    for await (const m of pager) {
      const rawName = String(m.name || '').replace(/^models\//, '');
      const actions = Array.isArray((m as { supportedActions?: string[] }).supportedActions)
        ? (m as { supportedActions?: string[] }).supportedActions!
        : [];
      const supportsGen =
        actions.length === 0 ||
        actions.some((a) => /generateContent/i.test(a));

      if (
        rawName &&
        supportsGen &&
        /^gemini-/i.test(rawName) &&
        !/(tts|image|live|transcribe|embedding|audio|vision|robotics|computer-use|1\.5|2\.0|2\.5)/i.test(
          rawName
        )
      ) {
        candidates.push(rawName);
      }
    }

    // Prioritize fast flash / hydrogen models; deprioritize neon (limit: 0 on Free Tier)
    candidates.sort((a, b) => {
      const score = (name: string) => {
        if (/3\.8-flash$/i.test(name)) return 0;
        if (/4-hydrogen/i.test(name)) return 1;
        if (/3(\.\d+)?-flash/i.test(name) && !/lite/i.test(name)) return 2;
        if (/flash/i.test(name) && !/lite/i.test(name)) return 3;
        if (/lite/i.test(name)) return 4;
        if (/4-neon/i.test(name)) return 9;
        return 6;
      };
      return score(a) - score(b);
    });

    discoveredLiveModelsCache = { fetchedAt: now, models: candidates };
    return candidates;
  } catch {
    return [];
  }
}

/**
 * Calls ai.models.generateContent with Auto-Resilient Model Cascade:
 * - Zero 404 interruption: immediately skips 404 models & rotates to next live model
 * - Circuit-breaker cooldown on 503/429 spikes: routes subsequent calls directly to healthy model
 * - Fast per-attempt timeout guard + concurrency gate to prevent request pileups
 * - ThinkingConfig safety: automatically strips thinkingConfig if rejected by a fallback model
 */
async function callGeminiResilient(params: {
  contents: unknown;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
  timeoutMs?: number;
  temperature?: number;
  priority?: 'express' | 'background';
}): Promise<string> {
  return withGeminiConcurrencySlot(async () => {
    const ai = getGeminiClient();
    const now = Date.now();
    if (now < globalDailyQuotaUntil) {
      throw createDailyQuotaError();
    }
    const attemptTimeoutMs = params.timeoutMs || 18_000;

    // Build ordered candidate queue, promoting the last healthy model to front
    const ordered: Array<{ model: string; supportsThinking: boolean }> = [];
    const seen = new Set<string>();

    if (preferredHealthyModel) {
      const match = STATIC_MODEL_CASCADE.find((c) => c.model === preferredHealthyModel);
      if (!getActiveCooldown(preferredHealthyModel, now)) {
        ordered.push(match || { model: preferredHealthyModel, supportsThinking: false });
        seen.add(preferredHealthyModel);
      }
    }

    for (const item of STATIC_MODEL_CASCADE) {
      if (!seen.has(item.model) && !getActiveCooldown(item.model, now)) {
        ordered.push(item);
        seen.add(item.model);
      }
    }

    // Only fallback-probe static models that are on SHORT transient cooldown (never daily_quota/not_found!)
    if (ordered.length === 0) {
      for (const item of [...STATIC_MODEL_CASCADE].reverse()) {
        const cd = getActiveCooldown(item.model, now);
        if (!cd || cd.reason === 'transient') {
          ordered.push(item);
          seen.add(item.model);
        }
      }
    }

    const runSingleModel = async (model: string, useThinking: boolean): Promise<string> => {
      const config: Record<string, unknown> = {
        systemInstruction: params.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: params.responseSchema,
      };
      if (typeof params.temperature === 'number' && !/^gemini-4-/i.test(model)) {
        config.temperature = params.temperature;
      }
      if (useThinking && params.thinkingLevel) {
        // Gemini 4 models reject ThinkingLevel.MINIMAL (400); safely map to LOW on Gemini 4
        const effectiveLevel =
          /^gemini-4-/i.test(model) && params.thinkingLevel === ThinkingLevel.MINIMAL
            ? ThinkingLevel.LOW
            : params.thinkingLevel;
        config.thinkingConfig = { thinkingLevel: effectiveLevel };
      }

      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Request timeout on ${model} after ${attemptTimeoutMs}ms`)),
          attemptTimeoutMs
        );
      });

      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model,
            contents: params.contents as never,
            config: config as never,
          }),
          timeoutPromise,
        ]);
        const text = response.text;
        if (!text) {
          throw new Error('Phản hồi từ mô hình ngôn ngữ bị rỗng.');
        }
        return text;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    let lastError: unknown = null;
    let all404 = true;
    let sawDailyQuota = false;

    for (let i = 0; i < ordered.length; i++) {
      const { model, supportsThinking } = ordered[i];
      // Re-check cooldown in case a concurrent sibling call just tripped it
      const freshCd = getActiveCooldown(model);
      if (freshCd && (freshCd.reason !== 'transient' || (i > 0 && i < ordered.length - 1))) {
        if (freshCd.reason === 'daily_quota') sawDailyQuota = true;
        continue;
      }

      try {
        const text = await runSingleModel(model, supportsThinking);
        preferredHealthyModel = model;
        modelCooldowns.delete(model);
        globalDailyQuotaUntil = 0;
        return text;
      } catch (err) {
        lastError = err;

        // If thinkingConfig isn't supported on this model, immediately retry same model without it
        if (supportsThinking && isThinkingConfigError(err)) {
          try {
            const text = await runSingleModel(model, false);
            preferredHealthyModel = model;
            modelCooldowns.delete(model);
            globalDailyQuotaUntil = 0;
            return text;
          } catch (retryErr) {
            lastError = retryErr;
          }
        }

        if (isTimeoutError(lastError)) {
          // Do NOT ban a healthy model or cascade through slow models on a per-batch timeout!
          throw lastError;
        }

        if (isModelNotFoundError(lastError)) {
          setModelCooldown(model, 'not_found', lastError);
          continue;
        }

        all404 = false;

        if (isDailyQuotaError(lastError)) {
          sawDailyQuota = true;
          setModelCooldown(model, 'daily_quota', lastError);
          continue;
        }

        if (isTransientError(lastError)) {
          setModelCooldown(model, 'transient', lastError);
          await new Promise((r) => setTimeout(r, 200 * (i + 1)));
          continue;
        }

        // Non-transient error on first model (e.g. YouTube fileData support): still try next candidate
        if (i < ordered.length - 1) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
      }
    }

    // Dynamic Discovery Rescue if static candidates hit 404, daily quota, or transient overload
    if (
      ordered.length === 0 ||
      all404 ||
      sawDailyQuota ||
      isModelNotFoundError(lastError) ||
      isTransientError(lastError)
    ) {
      const discovered = await discoverLiveGenerateModels(ai);
      for (const model of discovered) {
        if (seen.has(model)) continue;
        const cd = getActiveCooldown(model);
        if (cd) {
          if (cd.reason === 'daily_quota') sawDailyQuota = true;
          continue;
        }
        seen.add(model);
        try {
          const text = await runSingleModel(model, false);
          preferredHealthyModel = model;
          modelCooldowns.delete(model);
          globalDailyQuotaUntil = 0;
          return text;
        } catch (err) {
          lastError = err;
          if (isModelNotFoundError(err)) {
            setModelCooldown(model, 'not_found', err);
          } else if (isDailyQuotaError(err)) {
            sawDailyQuota = true;
            setModelCooldown(model, 'daily_quota', err);
          } else if (isTransientError(err)) {
            setModelCooldown(model, 'transient', err);
          }
        }
      }

      // One final retry ONLY for brief transient RPM spikes (NEVER on daily_quota / limit: 0!)
      const retryTarget = !sawDailyQuota && !isDailyQuotaError(lastError)
        ? [...STATIC_MODEL_CASCADE].reverse().find((c) => {
            const cd = getActiveCooldown(c.model);
            return !cd || cd.reason === 'transient';
          })
        : undefined;
      if (retryTarget && isTransientError(lastError)) {
        await new Promise((r) => setTimeout(r, 900));
        try {
          const text = await runSingleModel(retryTarget.model, retryTarget.supportsThinking);
          preferredHealthyModel = retryTarget.model;
          modelCooldowns.delete(retryTarget.model);
          globalDailyQuotaUntil = 0;
          return text;
        } catch (err) {
          lastError = err;
          if (isDailyQuotaError(err)) {
            sawDailyQuota = true;
            setModelCooldown(retryTarget.model, 'daily_quota', err);
          }
        }
      }
    }

    // If every available model is daily-exhausted / limit: 0, open a 45s fast-fail circuit breaker
    const isHardDaily =
      sawDailyQuota ||
      isDailyQuotaError(lastError) ||
      STATIC_MODEL_CASCADE.every((c) => {
        const cd = getActiveCooldown(c.model);
        return Boolean(cd && (cd.reason === 'daily_quota' || cd.reason === 'not_found'));
      });

    if (isHardDaily) {
      globalDailyQuotaUntil = Date.now() + 45_000;
      throw createDailyQuotaError();
    }

    const friendlyErr = new Error(
      toFriendlyErrorMessage(
        lastError,
        'Hệ thống AI đang bận trong giây lát. Vui lòng thử lại sau ít giây.'
      )
    ) as Error & { status?: number; isDailyQuota?: boolean };
    if (isRateLimitError(lastError)) {
      friendlyErr.status = 429;
    }
    throw friendlyErr;
  }, params.priority || 'background');
}

export const ZERO_HALLUCINATION_DIRECTIVE = `
BẠN LÀ CHUYÊN GIA NGÔN NGỮ HỌC (VIỆT - ANH - NHẬT) TUÂN THỦ KỶ LUẬT CHÂN LÝ NGÔN NGỮ TUYỆT ĐỐI (ABSOLUTE ZERO-ERROR LINGUISTIC TRUTH):

1. CẤM TUYỆT ĐỐI LỖI DỊCH TỪNG CHỮ (ANTI-CALQUE / ANTI-VIETLISH):
   - Khi chuyển ngữ từ Tiếng Việt sang Tiếng Anh hoặc Tiếng Nhật (và ngược lại), phải chuyển hóa tinh tế thành ngữ, tiếng lóng, khẩu ngữ và ẩn dụ tiếng Việt sang cách diễn đạt TỰ NHIÊN BẢN XỨ tương đương.
   - TUYỆT ĐỐI KHÔNG dịch từng từ cứng nhắc gây sai ngữ pháp hoặc tạo ra Collocation giả không tồn tại trong đời thực.

2. KỶ LUẬT CHÂN LÝ TIẾNG NHẬT (ZERO-HALLUCINATION JP):
   - Kiểm chuẩn 100% mặt chữ Kanji, đúng Âm Hán Việt PHỔ THÔNG CHÍNH THỐNG theo nghĩa tiếng Nhật hiện đại. CẤM TUYỆT ĐỐI lấy âm cổ hoặc âm hiếm gây sai lệch (VD: KHÔNG dùng 会→Cối, 子→Tí; ĐÚNG: 会→HỘI, 子→TỬ, 経験→KINH·NGHIỆM, 勉強→MIỄN·CƯỠNG, 準備→CHUẨN·BỊ, 意味→Ý·VỊ).
   - Furigana BẮT BUỘC 100% chữ Hiragana thuần khớp NGỮ CẢNH CÂU cụ thể (VD: 今日 = きょう/こんにち, 大人 = おとな, 辛い = つらい/からい, 行く = いく/ゆく, 一日 = いちにち/ついたち). CẤM TUYỆT ĐỐI xuất thẻ HTML (<ruby>, <rt>, <rp>, <span>, <b>, <br>) và CẤM Romaji (như hako, omo) trong văn bản hay Furigana.
   - Chính xác 100% trợ từ (は / が / を / に / で / へ / から / まで), tự động từ vs tha động từ, và sắc thái người nói (Futsukei / Teineigo / Keigo).
   - Pitch Accent chuẩn Tokyo NHK / Daijirin: ghi rõ loại trọng âm (平板型 Heiban [0], 頭高型 Atamadaka [1], 中高型 Nakadaka [2..n-1], 尾高型 Odaka [n]) và dãy mora L/H chính xác (mora 1 và mora 2 luôn khác cao độ; sau downstep hạ xuống L).
   - Phân loại cấp độ JLPT (N5, N4, N3, N2, N1) nhất quán.

3. KỶ LUẬT CHÂN LÝ TIẾNG ANH (ZERO-HALLUCINATION EN):
   - Phiên âm IPA BẮT BUỘC chuẩn từ điển Oxford / Cambridge đầy đủ ký tự ngữ âm Unicode (/θ/, /ð/, /ʃ/, /ʒ/, /ŋ/, /æ/, /ɑː/, /ɔː/, /ɜː/, /ə/, /ˈ/, /ˌ/).
   - Chia thì (Tense), mạo từ (a/an/the), giới từ và cụm động từ (Phrasal Verbs) chính xác 100%, không sai loại từ.
   - Dịch nghĩa tiếng Việt bám sát ngữ cảnh thực tế — TUYỆT ĐỐI KHÔNG dịch word-by-word cho Phrasal Verbs và Idioms.
   - Phân tầng CEFR (A1–C2) theo Oxford 3000/5000 & Cambridge English Profile; gắn isIeltsAcademic=true cho từ học thuật AWL / IELTS 7.0+.

4. TOÀN VẸN UTF-8 NFC & DỮ LIỆU JSON:
   - Mọi chuỗi tiếng Việt dùng chuẩn Unicode dựng sẵn (NFC), tuyệt đối không dùng thẻ HTML hay HTML entities (&amp;, &#39;, &quot;, &lt;, &gt;).
   - Không bao giờ bịa đặt câu nói hay mốc thời gian không có trong nguồn. Trả về JSON thuần chuẩn schema.
`.trim();

export function safeParseJson<T>(rawText: string | undefined, fallback: T): T {
  return bulletproofParseJson<T>(rawText, fallback);
}

export const COMPACT_SUBTITLE_TRUTH_DIRECTIVE =
  'Chuyên gia ngôn ngữ Việt–Anh–Nhật (Zero-Error Truth): Dịch tự nhiên bản xứ (CẤM dịch word-by-word/Vietlish), giữ nguyên 100% ý lời nói thật (CẤM tóm tắt/gộp/bỏ dòng). CẤM TUYỆT ĐỐI xuất bất kỳ thẻ HTML nào (<ruby>, <rt>, <rp>, <span>, <b>, <br>) và CẤM TUYỆT ĐỐI Romaji trong câu hay Furigana. Tiếng Nhật: văn bản thuần tự nhiên + Furigana 100% Hiragana thuần khớp ngữ cảnh câu, JLPT N5–N1. Tiếng Anh: IPA chuẩn Oxford/Cambridge theo đúng từ loại, CEFR A1–C2. Chuỗi UTF-8 NFC thuần, không HTML entities.';

export async function generateStructuredJson<T>({
  prompt,
  systemInstruction,
  responseSchema,
  thinkingLevel = ThinkingLevel.LOW,
  temperature,
  timeoutMs,
  priority = 'background',
  compactSystem = false,
}: {
  prompt: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  timeoutMs?: number;
  priority?: 'express' | 'background';
  compactSystem?: boolean;
  retries?: number;
}): Promise<T> {
  const directive = compactSystem
    ? COMPACT_SUBTITLE_TRUTH_DIRECTIVE
    : ZERO_HALLUCINATION_DIRECTIVE;
  const text = await callGeminiResilient({
    contents: prompt,
    systemInstruction: `${directive}\n\n${systemInstruction}`,
    responseSchema,
    thinkingLevel,
    temperature,
    timeoutMs,
    priority,
  });

  const parsed = bulletproofParseJson<T | null>(text, null);
  if (parsed === null) {
    throw new Error('Không thể phân tích dữ liệu ngôn ngữ trả về. Hệ thống sẽ tự động thử lại.');
  }
  return parsed;
}

/**
 * Extracts clean UTF-8 NFC text from an uploaded PDF (base64) using gemini-3.8-flash multimodal.
 */
export async function extractTextFromPdfBase64(pdfBase64: string): Promise<{
  title: string;
  content: string;
}> {
  const schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      content: { type: Type.STRING },
    },
    required: ['title', 'content'],
  };
  const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '').trim();
  const text = await callGeminiResilient({
    contents: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: cleanBase64,
        },
      },
      {
        text: 'Trích xuất nguyên văn 100% nội dung bài viết từ tài liệu PDF này (giữ nguyên ngôn ngữ gốc, bảo toàn đầy đủ từng đoạn văn và tiêu đề con theo đúng thứ tự, phân tách đoạn bằng 2 dấu xuống dòng, bỏ qua số trang và tiêu đề chân trang lặp lại). TUYỆT ĐỐI không tóm tắt hay cắt bỏ bất kỳ đoạn nào.',
      },
    ],
    systemInstruction: `${ZERO_HALLUCINATION_DIRECTIVE}\n\nTrích xuất nguyên văn chính xác 100% nội dung tài liệu PDF, không thêm bớt, không tóm tắt.`,
    responseSchema: schema,
    thinkingLevel: ThinkingLevel.LOW,
    timeoutMs: 32_000,
  });

  const parsed = bulletproofParseJson<{ title?: string; content?: string } | null>(text, null);
  if (!parsed?.content) {
    throw new Error('Không thể đọc được nội dung chữ trong tệp PDF này.');
  }
  return {
    title: decodeAndNormalizeText(parsed.title || ''),
    content: decodeAndNormalizeText(parsed.content || ''),
  };
}

/**
 * Sub-Second Streaming NDJSON Engine (generateContentStream on gemini-3.8-flash + Auto-Resilient Cascade)
 * Streams compact 1-line JSON objects as tokens arrive with zero unnecessary thinking overhead
 * so Micro-Batch 0 renders subtitle line #1 in < 1s.
 */
export async function streamNdjsonLines<T extends Record<string, unknown>>({
  prompt,
  systemInstruction,
  onObject,
  signal,
  priority = 'express',
  firstChunkTimeoutMs = 5500,
  compactSystem = false,
}: {
  prompt: string;
  systemInstruction: string;
  onObject: (obj: T) => void;
  signal?: AbortSignal;
  priority?: 'express' | 'background';
  firstChunkTimeoutMs?: number;
  compactSystem?: boolean;
}): Promise<number> {
  return withGeminiConcurrencySlot(async () => {
    const ai = getGeminiClient();
    const now = Date.now();
    if (now < globalDailyQuotaUntil) {
      throw createDailyQuotaError();
    }
    const ordered: Array<{ model: string; supportsThinking: boolean }> = [];
    const seen = new Set<string>();

    if (preferredHealthyModel) {
      const match = STATIC_MODEL_CASCADE.find((c) => c.model === preferredHealthyModel);
      if (!getActiveCooldown(preferredHealthyModel, now)) {
        ordered.push(match || { model: preferredHealthyModel, supportsThinking: false });
        seen.add(preferredHealthyModel);
      }
    }
    for (const item of STATIC_MODEL_CASCADE) {
      if (!seen.has(item.model) && !getActiveCooldown(item.model, now)) {
        ordered.push(item);
        seen.add(item.model);
      }
    }
    if (ordered.length === 0) {
      for (const item of [...STATIC_MODEL_CASCADE].reverse()) {
        const cd = getActiveCooldown(item.model, now);
        if (!cd || cd.reason === 'transient') {
          ordered.push(item);
          seen.add(item.model);
        }
      }
    }

    const directive = compactSystem
      ? COMPACT_SUBTITLE_TRUTH_DIRECTIVE
      : ZERO_HALLUCINATION_DIRECTIVE;
    const fullSystem = `${directive}\n\n${systemInstruction}`;
    let lastError: unknown = null;
    let sawDailyQuota = false;

    for (let i = 0; i < ordered.length; i++) {
      if (signal?.aborted) return 0;
      const { model, supportsThinking } = ordered[i];
      const freshCd = getActiveCooldown(model);
      if (freshCd && (freshCd.reason !== 'transient' || (i > 0 && i < ordered.length - 1))) {
        if (freshCd.reason === 'daily_quota') sawDailyQuota = true;
        continue;
      }
      let emittedCount = 0;

      const tryStreamModel = async (useMinimalThinking: boolean): Promise<number> => {
        const config: Record<string, unknown> = {
          systemInstruction: fullSystem,
        };
        if (!/^gemini-4-/i.test(model)) {
          config.temperature = 0.1;
        }
        // Minimal thinking on Gemini 3.x (or LOW on Gemini 4.x) for sub-second subtitle streaming
        if (useMinimalThinking) {
          config.thinkingConfig = {
            thinkingLevel: /^gemini-4-/i.test(model)
              ? ThinkingLevel.LOW
              : ThinkingLevel.MINIMAL,
          };
        }

        let openTimer: ReturnType<typeof setTimeout> | null = null;
        const stream = await Promise.race([
          ai.models.generateContentStream({
            model,
            contents: prompt,
            config: config as never,
          }),
          new Promise<never>((_, reject) => {
            openTimer = setTimeout(
              () =>
                reject(
                  new Error(`Stream handshake timeout on ${model} after ${firstChunkTimeoutMs}ms`)
                ),
              firstChunkTimeoutMs
            );
          }),
        ]).finally(() => {
          if (openTimer) clearTimeout(openTimer);
        });

        let objBuf = '';
        let depth = 0;
        let inString = false;
        let escaped = false;

        const emitCandidate = (rawObj: string) => {
          const parsed = bulletproofParseJson<T | null>(rawObj, null);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            emittedCount += 1;
            onObject(parsed);
          }
        };

        // Iterate stream with per-chunk stall guard so a hung tail socket never blocks > firstChunkTimeoutMs
        const iter = stream[Symbol.asyncIterator]();
        while (true) {
          if (signal?.aborted) break;
          let stallTimer: ReturnType<typeof setTimeout> | null = null;
          const nextResult = await Promise.race([
            iter.next(),
            new Promise<never>((_, reject) => {
              stallTimer = setTimeout(
                () => reject(new Error(`Stream chunk stall on ${model} after ${firstChunkTimeoutMs}ms`)),
                emittedCount === 0 ? firstChunkTimeoutMs : Math.max(firstChunkTimeoutMs, 5500)
              );
            }),
          ]).finally(() => {
            if (stallTimer) clearTimeout(stallTimer);
          });
          if (nextResult.done) break;
          const chunk = nextResult.value;
          const piece = chunk.text || '';
          if (!piece) continue;

          for (let idx = 0; idx < piece.length; idx++) {
            const ch = piece[idx];
            if (depth === 0) {
              if (ch === '{') {
                depth = 1;
                objBuf = '{';
                inString = false;
                escaped = false;
              }
              continue;
            }

            objBuf += ch;
            if (inString) {
              if (escaped) {
                escaped = false;
              } else if (ch === '\\') {
                escaped = true;
              } else if (ch === '"') {
                inString = false;
              }
            } else {
              if (ch === '"') {
                inString = true;
              } else if (ch === '{') {
                depth += 1;
              } else if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                  emitCandidate(objBuf);
                  objBuf = '';
                }
              }
            }
          }
        }
        return emittedCount;
      };

      try {
        const count = await tryStreamModel(supportsThinking);
        preferredHealthyModel = model;
        modelCooldowns.delete(model);
        globalDailyQuotaUntil = 0;
        if (count > 0 || signal?.aborted) return count;
        throw new Error('Stream ended with 0 parsed subtitle objects');
      } catch (err) {
        lastError = err;
        if (signal?.aborted) return emittedCount;

        // If minimal thinkingConfig isn't supported on this model, retry same model without it
        if (supportsThinking && isThinkingConfigError(err) && emittedCount === 0) {
          try {
            const count = await tryStreamModel(false);
            preferredHealthyModel = model;
            modelCooldowns.delete(model);
            globalDailyQuotaUntil = 0;
            if (count > 0) return count;
          } catch (retryErr) {
            lastError = retryErr;
          }
        }

        if (emittedCount > 0) {
          // Partial stream succeeded; let caller rescue any remaining missing lines cleanly
          return emittedCount;
        }

        if (isTimeoutError(lastError)) {
          // Return immediately on stream timeout so client half-splits cleanly without 40s cascade!
          return emittedCount;
        }

        if (isModelNotFoundError(lastError)) {
          setModelCooldown(model, 'not_found', lastError);
          continue;
        }
        if (isDailyQuotaError(lastError)) {
          sawDailyQuota = true;
          setModelCooldown(model, 'daily_quota', lastError);
          continue;
        }
        if (isTransientError(lastError)) {
          setModelCooldown(model, 'transient', lastError);
          continue;
        }
      }
    }

    // Dynamic Discovery Rescue if static candidates returned 404, daily quota, or transient overload
    if (
      !signal?.aborted &&
      (ordered.length === 0 ||
        sawDailyQuota ||
        isModelNotFoundError(lastError) ||
        isTransientError(lastError))
    ) {
      const discovered = await discoverLiveGenerateModels(ai);
      for (const model of discovered) {
        if (seen.has(model) || signal?.aborted) continue;
        const cd = getActiveCooldown(model);
        if (cd) {
          if (cd.reason === 'daily_quota') sawDailyQuota = true;
          continue;
        }
        seen.add(model);
        let emittedCount = 0;
        try {
          const config: Record<string, unknown> = {
            systemInstruction: fullSystem,
          };
          if (!/^gemini-4-/i.test(model)) {
            config.temperature = 0.1;
          }
          let openTimer: ReturnType<typeof setTimeout> | null = null;
          const stream = await Promise.race([
            ai.models.generateContentStream({
              model,
              contents: prompt,
              config: config as never,
            }),
            new Promise<never>((_, reject) => {
              openTimer = setTimeout(
                () =>
                  reject(
                    new Error(`Stream handshake timeout on ${model} after ${firstChunkTimeoutMs}ms`)
                  ),
                firstChunkTimeoutMs
              );
            }),
          ]).finally(() => {
            if (openTimer) clearTimeout(openTimer);
          });

          let objBuf = '';
          let depth = 0;
          let inString = false;
          let escaped = false;
          const iter = stream[Symbol.asyncIterator]();
          while (true) {
            if (signal?.aborted) break;
            let stallTimer: ReturnType<typeof setTimeout> | null = null;
            const nextResult = await Promise.race([
              iter.next(),
              new Promise<never>((_, reject) => {
                stallTimer = setTimeout(
                  () =>
                    reject(
                      new Error(`Stream chunk stall on ${model} after ${firstChunkTimeoutMs}ms`)
                    ),
                  emittedCount === 0 ? firstChunkTimeoutMs : Math.max(firstChunkTimeoutMs, 5500)
                );
              }),
            ]).finally(() => {
              if (stallTimer) clearTimeout(stallTimer);
            });
            if (nextResult.done) break;
            const piece = nextResult.value.text || '';
            if (!piece) continue;
            for (let idx = 0; idx < piece.length; idx++) {
              const ch = piece[idx];
              if (depth === 0) {
                if (ch === '{') {
                  depth = 1;
                  objBuf = '{';
                  inString = false;
                  escaped = false;
                }
                continue;
              }
              objBuf += ch;
              if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
              } else {
                if (ch === '"') inString = true;
                else if (ch === '{') depth += 1;
                else if (ch === '}') {
                  depth -= 1;
                  if (depth === 0) {
                    const parsed = bulletproofParseJson<T | null>(objBuf, null);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      emittedCount += 1;
                      onObject(parsed);
                    }
                    objBuf = '';
                  }
                }
              }
            }
          }
          if (emittedCount > 0) {
            preferredHealthyModel = model;
            modelCooldowns.delete(model);
            globalDailyQuotaUntil = 0;
            return emittedCount;
          }
        } catch (err) {
          lastError = err;
          if (emittedCount > 0) {
            preferredHealthyModel = model;
            return emittedCount;
          }
          if (isModelNotFoundError(err)) {
            setModelCooldown(model, 'not_found', err);
          } else if (isDailyQuotaError(err)) {
            sawDailyQuota = true;
            setModelCooldown(model, 'daily_quota', err);
          } else if (isTransientError(err)) {
            setModelCooldown(model, 'transient', err);
          }
        }
      }
    }

    const isHardDaily =
      sawDailyQuota ||
      isDailyQuotaError(lastError) ||
      STATIC_MODEL_CASCADE.every((c) => {
        const cd = getActiveCooldown(c.model);
        return Boolean(cd && (cd.reason === 'daily_quota' || cd.reason === 'not_found'));
      });

    if (isHardDaily) {
      globalDailyQuotaUntil = Date.now() + 45_000;
      throw createDailyQuotaError();
    }

    if (lastError && isRateLimitError(lastError)) {
      const rateErr = new Error(
        toFriendlyErrorMessage(
          lastError,
          'Hệ thống AI đang có lưu lượng truy cập cao. Vui lòng thử lại sau vài giây.'
        )
      ) as Error & { status?: number; isDailyQuota?: boolean };
      rateErr.status = 429;
      throw rateErr;
    }

    return 0;
  }, priority);
}

export async function generateStructuredJsonWithAudio<T>({
  prompt,
  audioBase64,
  mimeType,
  systemInstruction,
  responseSchema,
  thinkingLevel = ThinkingLevel.LOW,
}: {
  prompt: string;
  audioBase64: string;
  mimeType: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
}): Promise<T> {
  const text = await callGeminiResilient({
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType || 'audio/webm',
            data: audioBase64,
          },
        },
        { text: prompt },
      ],
    },
    systemInstruction: `${ZERO_HALLUCINATION_DIRECTIVE}\n\n${systemInstruction}`,
    responseSchema,
    thinkingLevel,
  });

  const parsed = bulletproofParseJson<T | null>(text, null);
  if (parsed === null) {
    throw new Error('Không thể phân tích kết quả chấm phát âm.');
  }
  return parsed;
}

export interface SttTranscriptLine {
  start: number;
  duration: number;
  text: string;
  readingMap?: string;
  ipaLine?: string;
  translationVi?: string;
}

export interface SttTranscriptResult {
  spokenLanguage: 'vi' | 'en' | 'ja';
  lines: SttTranscriptLine[];
  hasMoreContent: boolean;
  nextOffsetSec: number;
  directTranslated?: boolean;
}

/**
 * Tier 3 AI Auto-Subtitle Engine — 1-PASS DIRECT MULTIMODAL AUDIO PIPELINE (3x-5x FASTER):
 * - Uses fileData: { fileUri, mimeType: 'video/mp4' } + videoMetadata: { startOffset, endOffset, fps: 0.1 }
 * - Automatic compatibility fallback (drops videoMetadata/fps if rejected with 400 INVALID_ARGUMENT)
 * - Outputs exact timestamps + clean target-language JA/EN (zero HTML, zero Romaji) + pure-Hiragana readingMap / Oxford IPA + clean Vietnamese translation!
 */
export async function transcribeYouTubeVideoWindow({
  videoId,
  videoTitle,
  startOffsetSec = 0,
  windowDurationSec = 120,
  knownDurationSec,
  targetLanguage,
  targetLevel,
  contextAnchorBlock = '',
  priority = 'background',
  timeoutMs = 38_000,
}: {
  videoId: string;
  videoTitle: string;
  startOffsetSec?: number;
  windowDurationSec?: number;
  knownDurationSec?: number;
  targetLanguage?: 'en' | 'ja';
  targetLevel?: string;
  contextAnchorBlock?: string;
  priority?: 'express' | 'background';
  timeoutMs?: number;
}): Promise<SttTranscriptResult> {
  const safeStart = Math.max(0, Math.floor(startOffsetSec));
  const safeWindow = Math.max(25, Math.min(180, Math.floor(windowDurationSec)));
  const rawEnd = safeStart + safeWindow;
  const endOffsetSec =
    knownDurationSec && knownDurationSec > safeStart + 10
      ? Math.min(rawEnd, Math.ceil(knownDurationSec))
      : rawEnd;

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const videoPartWithMeta: Record<string, unknown> = {
    fileData: {
      fileUri: videoUrl,
      mimeType: 'video/mp4',
    },
    videoMetadata: {
      startOffset: `${safeStart}s`,
      endOffset: `${endOffsetSec}s`,
      fps: 0.1,
    },
  };
  const videoPartFallback: Record<string, unknown> = {
    fileData: {
      fileUri: videoUrl,
      mimeType: 'video/mp4',
    },
  };

  const isDirectOnePass = targetLanguage === 'ja' || targetLanguage === 'en';
  const level = targetLevel || (targetLanguage === 'ja' ? 'N3' : 'B2');
  const ctxPrefix = contextAnchorBlock ? `${contextAnchorBlock}\n` : '';

  const prompt = isDirectOnePass
    ? targetLanguage === 'ja'
      ? `${ctxPrefix}Tiêu đề video: "${videoTitle}"
Đoạn âm thanh cần xử lý 1-PASS TRỰC TIẾP: từ giây ${safeStart}s đến giây ${endOffsetSec}s (mốc thời gian trả về PHẢI là mốc tuyệt đối tính từ 00:00 đầu video, nằm trong [${safeStart}, ${endOffsetSec}]).

NHIỆM VỤ 1-PASS SIÊU TỐC (NGHE ÂM THANH THẬT ➔ XUẤT THẲNG TIẾNG NHẬT JLPT ${level} + BẢN ĐỒ FURIGANA + NGHĨA VIỆT):
1. NGHE THẬT TẠO THẬT (ZERO-HALLUCINATION): Chỉ chuyển ngữ câu thoại nhân vật thực sự nói trong âm thanh [${safeStart}s .. ${endOffsetSec}s]. TUYỆT ĐỐI KHÔNG bịa lời từ tiêu đề/ảnh bìa. Nếu chỉ có nhạc nền/im lặng trả lines: [].
2. Chia từng câu nói tự nhiên (3–6 giây/câu) với start & duration khớp chính xác giọng nói.
3. Với mỗi câu xuất:
   - text: Câu TIẾNG NHẬT THUẦN tự nhiên bản xứ trình độ JLPT ${level} chuyển ngữ trọn vẹn 100% lời nói thật (đúng Futsukei/Teineigo/Keigo, đúng Trợ từ は/が/を/に/で, đúng Tự/Tha động từ). TUYỆT ĐỐI KHÔNG chứa thẻ HTML (<ruby>, <rt>, <rp>, <span>...) và KHÔNG chứa Romaji!
   - readingMap: Danh sách cách đọc HIRAGANA THUẦN cho mọi từ có Kanji trong câu theo dạng "漢字:ひらがな|漢字:ひらがな" (CHỈ dùng Hiragana, CẤM Romaji, CẤM thẻ HTML; nếu không có Kanji để "").
   - translationVi: Nghĩa tiếng Việt ngắn gọn, sạch chuẩn UTF-8 NFC đúng 100% lời nhân vật.
4. Đặt hasMoreContent = true nếu video còn tiếp tục sau giây ${endOffsetSec - 8}s, ngược lại false.`
      : `${ctxPrefix}Tiêu đề video: "${videoTitle}"
Đoạn âm thanh cần xử lý 1-PASS TRỰC TIẾP: từ giây ${safeStart}s đến giây ${endOffsetSec}s (mốc thời gian trả về PHẢI là mốc tuyệt đối tính từ 00:00 đầu video, nằm trong [${safeStart}, ${endOffsetSec}]).

NHIỆM VỤ 1-PASS SIÊU TỐC (NGHE ÂM THANH THẬT ➔ XUẤT THẲNG TIẾNG ANH CEFR ${level} + OXFORD IPA + NGHĨA VIỆT):
1. NGHE THẬT TẠO THẬT (ZERO-HALLUCINATION): Chỉ chuyển ngữ câu thoại nhân vật thực sự nói trong âm thanh [${safeStart}s .. ${endOffsetSec}s]. TUYỆT ĐỐI KHÔNG bịa lời từ tiêu đề/ảnh bìa. Nếu chỉ có nhạc nền/im lặng trả lines: [].
2. Chia từng câu nói tự nhiên (3–6 giây/câu) với start & duration khớp chính xác giọng nói.
3. Với mỗi câu xuất:
   - text: Câu TIẾNG ANH TỰ NHIÊN BẢN XỨ chuẩn CEFR ${level} chuyển ngữ trọn vẹn 100% lời nói thật (ưu tiên Collocations & Phrasal Verbs, chuẩn Thì/Mạo từ/Giới từ, CẤM Vietlish, CẤM thẻ HTML).
   - ipaLine: Phiên âm IPA chuẩn Oxford/Cambridge cho câu (dùng dấu nối âm ‿ khi tự nhiên).
   - translationVi: Nghĩa tiếng Việt ngắn gọn, sạch chuẩn UTF-8 NFC đúng 100% lời nhân vật.
4. Đặt hasMoreContent = true nếu video còn tiếp tục sau giây ${endOffsetSec - 8}s, ngược lại false.`
    : `${ctxPrefix}Tiêu đề video: "${videoTitle}"
Đoạn âm thanh cần chép lời: từ giây ${safeStart}s đến giây ${endOffsetSec}s (mốc thời gian trả về PHẢI là mốc tuyệt đối tính từ 00:00 đầu video gốc, nằm trong [${safeStart}, ${endOffsetSec}]).

NHIỆM VỤ CHÉP LỜI CHÍNH XÁC 100% (STRICT AUDIO SPEECH-TO-TEXT — ZERO HALLUCINATION):
1. Nghe thật kỹ giọng nói thực tế trong đoạn [${safeStart}s .. ${endOffsetSec}s] và xác định spokenLanguage ('vi'|'en'|'ja').
2. Chép lại CHÍNH XÁC từng câu nói thực sự có trong âm thanh video (TUYỆT ĐỐI KHÔNG bịa lời; nếu chỉ có nhạc/im lặng trả lines: []).
3. Chia thành các câu ngắn gọn dễ học (mỗi câu 3–6 giây), ghi chính xác start và duration.
4. Đặt hasMoreContent = true nếu video vẫn còn tiếp tục sau giây ${endOffsetSec - 8}s, ngược lại false.`;

  const lineProperties: Record<string, unknown> = {
    start: { type: Type.NUMBER },
    duration: { type: Type.NUMBER },
    text: { type: Type.STRING },
  };
  const lineRequired = ['start', 'duration', 'text'];

  if (isDirectOnePass) {
    lineProperties.translationVi = { type: Type.STRING };
    lineRequired.push('translationVi');
    if (targetLanguage === 'ja') {
      lineProperties.readingMap = { type: Type.STRING };
    } else {
      lineProperties.ipaLine = { type: Type.STRING };
    }
  }

  const schema = {
    type: Type.OBJECT,
    properties: {
      spokenLanguage: { type: Type.STRING, enum: ['vi', 'en', 'ja'] },
      hasMoreContent: { type: Type.BOOLEAN },
      lines: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: lineProperties,
          required: lineRequired,
        },
      },
    },
    required: ['spokenLanguage', 'lines', 'hasMoreContent'],
  };

  const sysInstr = isDirectOnePass
    ? targetLanguage === 'ja'
      ? 'Bộ máy giải mã âm thanh & chuyển ngữ trực tiếp 1-Pass sang Tiếng Nhật chuẩn NHK/Daijirin. Chỉ dịch lời nói thật; TUYỆT ĐỐI CẤM thẻ HTML (<ruby>,<rt>...) và CẤM Romaji; readingMap CHỈ chứa cặp Kanji:Hiragana thuần.'
      : 'Bộ máy giải mã âm thanh & chuyển ngữ trực tiếp 1-Pass sang Tiếng Anh chuẩn Oxford/Cambridge kèm IPA. Chỉ dịch lời nói thật; TUYỆT ĐỐI CẤM thẻ HTML và CẤM Vietlish.'
    : 'Bạn là bộ máy nhận diện giọng nói (Speech-to-Text) độ chính xác cao. Chỉ chép lại lời nói thực sự nghe thấy trong khung thời gian yêu cầu với mốc giây tuyệt đối khớp thực tế.';

  let rawText: string;
  try {
    rawText = await callGeminiResilient({
      contents: [videoPartWithMeta, { text: prompt }],
      systemInstruction: sysInstr,
      responseSchema: schema,
      thinkingLevel: ThinkingLevel.MINIMAL,
      temperature: 0.1,
      timeoutMs,
      priority,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    // Automatic compatibility fallback if SDK/endpoint rejects videoMetadata or fps
    if (/videoMetadata|fps|INVALID_ARGUMENT|400/i.test(msg) && !isRateLimitError(err)) {
      rawText = await callGeminiResilient({
        contents: [
          videoPartFallback,
          {
            text: `${prompt}\n\n[LƯU Ý PHẠM VI THỜI GIAN BẮT BUỘC]: CHỈ nghe và xuất phụ đề cho đúng đoạn từ ${safeStart}s đến ${endOffsetSec}s của video này.`,
          },
        ],
        systemInstruction: sysInstr,
        responseSchema: schema,
        thinkingLevel: ThinkingLevel.MINIMAL,
        temperature: 0.1,
        timeoutMs,
        priority,
      });
    } else {
      throw err;
    }
  }

  const parsed = bulletproofParseJson<{
    spokenLanguage?: 'vi' | 'en' | 'ja';
    hasMoreContent?: boolean;
    lines?: Array<{
      start: number;
      duration: number;
      text: string;
      readingMap?: string;
      ipaLine?: string;
      translationVi?: string;
    }>;
  } | null>(rawText, null);

  if (!parsed || !Array.isArray(parsed.lines)) {
    const stillMore =
      knownDurationSec && knownDurationSec > 0 ? endOffsetSec < knownDurationSec - 8 : false;
    return {
      spokenLanguage: 'vi',
      lines: [],
      hasMoreContent: stillMore,
      nextOffsetSec: endOffsetSec,
      directTranslated: isDirectOnePass,
    };
  }

  const cleanedLines = normalizeAndSanitizeSttLines(
    parsed.lines,
    safeStart,
    endOffsetSec,
    targetLanguage
  );

  const lastEnd =
    cleanedLines.length > 0
      ? cleanedLines[cleanedLines.length - 1].start +
        cleanedLines[cleanedLines.length - 1].duration
      : 0;

  const actualNextOffsetSec =
    cleanedLines.length > 0 && lastEnd >= safeStart + 22 && lastEnd < endOffsetSec - 12
      ? Math.max(safeStart + 22, Math.floor(lastEnd))
      : endOffsetSec;

  const hasMoreContent =
    knownDurationSec && knownDurationSec > 0
      ? actualNextOffsetSec < knownDurationSec - 10
      : Boolean(parsed.hasMoreContent) ||
        (cleanedLines.length > 0 && lastEnd >= safeStart + 18);

  return {
    spokenLanguage: parsed.spokenLanguage || 'vi',
    lines: cleanedLines,
    hasMoreContent,
    nextOffsetSec: actualNextOffsetSec,
    directTranslated: isDirectOnePass,
  };
}

function normalizeAndSanitizeSttLines(
  rawLines: Array<{
    start?: number;
    end?: number;
    duration?: number;
    text?: string;
    readingMap?: string;
    ipaLine?: string;
    translationVi?: string;
  }>,
  safeStart: number,
  endOffsetSec: number,
  targetLanguage?: 'en' | 'ja'
): SttTranscriptLine[] {
  const cleanedLines: SttTranscriptLine[] = rawLines
    .map((l) => {
      let start = Number(l.start);
      if (!Number.isFinite(start) || start < 0) start = safeStart;
      if (safeStart >= 20 && start < safeStart - 5) {
        start = safeStart + start;
      }
      let dur = Number(l.duration);
      if (!Number.isFinite(dur) || dur <= 0) {
        let endVal = Number(l.end);
        if (Number.isFinite(endVal)) {
          if (safeStart >= 20 && endVal < safeStart - 5) endVal = safeStart + endVal;
          dur = endVal - start;
        }
      }
      const duration = Math.max(0.6, Math.min(12, Number.isFinite(dur) && dur > 0 ? dur : 3.2));
      const rawLineText = String(l.text || '');
      const text = stripHtmlAndRubyArtifactsServer(rawLineText);
      const readingMap =
        targetLanguage === 'ja'
          ? sanitizeCompactReadingMapServer(l.readingMap, rawLineText)
          : undefined;
      const ipaLine =
        targetLanguage === 'en' && l.ipaLine
          ? stripHtmlAndRubyArtifactsServer(l.ipaLine)
          : undefined;
      const translationVi = l.translationVi
        ? decodeAndNormalizeText(l.translationVi)
        : undefined;
      return {
        start: Number(start.toFixed(2)),
        duration: Number(duration.toFixed(2)),
        text,
        readingMap,
        ipaLine,
        translationVi,
      };
    })
    .filter((l) => l.text.length > 0 && l.start <= endOffsetSec + 6)
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < cleanedLines.length - 1; i++) {
    const gap = cleanedLines[i + 1].start - cleanedLines[i].start;
    if (gap > 0.25 && cleanedLines[i].duration > gap) {
      cleanedLines[i].duration = Number(gap.toFixed(2));
    }
  }
  return cleanedLines;
}

/**
 * 1-PASS MULTIMODAL MICRO-BURST STREAMER (Segment 0: 0s->30s & Instant Seek Teleport):
 * Streams YouTube audio directly via generateContentStream + Incremental JSON Parser
 * (supporting both compact tuple arrays [s, e, text, map, vi] and compact NDJSON objects)
 * so the VERY FIRST AI-generated subtitle appears in 1.5-3 seconds!
 */
export async function streamYouTubeVideoWindow({
  videoId,
  videoTitle,
  startOffsetSec = 0,
  windowDurationSec = 30,
  knownDurationSec,
  targetLanguage,
  targetLevel,
  contextAnchorBlock = '',
  signal,
  onLine,
  timeoutMs = 36_000,
}: {
  videoId: string;
  videoTitle: string;
  startOffsetSec?: number;
  windowDurationSec?: number;
  knownDurationSec?: number;
  targetLanguage: 'en' | 'ja';
  targetLevel?: string;
  contextAnchorBlock?: string;
  signal?: AbortSignal;
  onLine: (line: SttTranscriptLine) => void;
  timeoutMs?: number;
}): Promise<{ emittedCount: number; nextOffsetSec: number; hasMoreContent: boolean }> {
  const safeStart = Math.max(0, Math.floor(startOffsetSec));
  const safeWindow = Math.max(20, Math.min(90, Math.floor(windowDurationSec)));
  const rawEnd = safeStart + safeWindow;
  const endOffsetSec =
    knownDurationSec && knownDurationSec > safeStart + 6
      ? Math.min(rawEnd, Math.ceil(knownDurationSec))
      : rawEnd;
  const level = targetLevel || (targetLanguage === 'ja' ? 'N3' : 'B2');
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const ctxPrefix = contextAnchorBlock ? `${contextAnchorBlock}\n` : '';

  const prompt =
    targetLanguage === 'ja'
      ? `${ctxPrefix}Video: "${videoTitle}" | Đoạn âm thanh cần nghe 1-PASS TRỰC TIẾP: [${safeStart}s .. ${endOffsetSec}s].
XUẤT NDJSON TỪNG CÂU NGAY KHI NGHE THẤY (1 OBJECT JSON/HÀNG, KHÔNG MARKDOWN \`\`\`, KHÔNG MẢNG BỌC NGOÀI).
Quy tắc tuyệt đối:
- CHỈ chuyển ngữ lời nói thật nghe thấy trong [${safeStart}s .. ${endOffsetSec}s] (CẤM bịa lời từ tiêu đề; nhạc nền/im lặng không xuất gì).
- s = giây bắt đầu tuyệt đối (tính từ 00:00 đầu video), e = giây kết thúc (e > s).
- t = câu TIẾNG NHẬT THUẦN tự nhiên chuẩn JLPT ${level} (CẤM thẻ HTML <ruby>/<rt>, CẤM Romaji, CẤM lọt tiếng Việt).
- r = bản đồ HIRAGANA THUẦN cho Kanji dạng "漢字:ひらがな|..." (CHỈ Hiragana, CẤM Romaji; không có Kanji để "").
- v = nghĩa tiếng Việt ngắn gọn chuẩn UTF-8 NFC.
Mẫu mỗi hàng: {"s":1.2,"e":4.6,"t":"この箱、すごく重くて運べないんだ。","r":"箱:はこ|重:おも|運:はこ","v":"Cái hộp này nặng quá không khiêng nổi."}`
      : `${ctxPrefix}Video: "${videoTitle}" | Đoạn âm thanh cần nghe 1-PASS TRỰC TIẾP: [${safeStart}s .. ${endOffsetSec}s].
XUẤT NDJSON TỪNG CÂU NGAY KHI NGHE THẤY (1 OBJECT JSON/HÀNG, KHÔNG MARKDOWN \`\`\`, KHÔNG MẢNG BỌC NGOÀI).
Quy tắc tuyệt đối:
- CHỈ chuyển ngữ lời nói thật nghe thấy trong [${safeStart}s .. ${endOffsetSec}s] (CẤM bịa lời từ tiêu đề; nhạc nền/im lặng không xuất gì).
- s = giây bắt đầu tuyệt đối (tính từ 00:00 đầu video), e = giây kết thúc (e > s).
- t = câu TIẾNG ANH TỰ NHIÊN BẢN XỨ chuẩn CEFR ${level} (ưu tiên Collocations/Phrasal Verbs, CẤM Vietlish, CẤM thẻ HTML, CẤM lọt tiếng Việt).
- p = phiên âm IPA chuẩn Oxford/Cambridge (có nối âm ‿ khi tự nhiên).
- v = nghĩa tiếng Việt ngắn gọn chuẩn UTF-8 NFC.
Mẫu mỗi hàng: {"s":1.2,"e":4.6,"t":"This box is way too heavy to carry.","p":"/ðɪs bɑːks ɪz weɪ tuː ˈhevi tə ˈkæri/","v":"Cái hộp này nặng quá không khiêng nổi."}`;

  const sysInstr =
    targetLanguage === 'ja'
      ? `${COMPACT_SUBTITLE_TRUTH_DIRECTIVE}\nNghe âm thanh thật đoạn [${safeStart}s..${endOffsetSec}s] và stream ngay từng dòng JSON {"s","e","t","r","v"} (1 object/hàng). CẤM thẻ HTML, CẤM Romaji, CẤM bịa lời.`
      : `${COMPACT_SUBTITLE_TRUTH_DIRECTIVE}\nNghe âm thanh thật đoạn [${safeStart}s..${endOffsetSec}s] và stream ngay từng dòng JSON {"s","e","t","p","v"} (1 object/hàng). CẤM thẻ HTML, CẤM Vietlish, CẤM bịa lời.`;

  return withGeminiConcurrencySlot(async () => {
    const ai = getGeminiClient();
    const now = Date.now();
    if (now < globalDailyQuotaUntil) {
      throw createDailyQuotaError();
    }

    const ordered: Array<{ model: string; supportsThinking: boolean }> = [];
    const seen = new Set<string>();
    if (preferredHealthyModel && !getActiveCooldown(preferredHealthyModel, now)) {
      const match = STATIC_MODEL_CASCADE.find((c) => c.model === preferredHealthyModel);
      ordered.push(match || { model: preferredHealthyModel, supportsThinking: false });
      seen.add(preferredHealthyModel);
    }
    for (const item of STATIC_MODEL_CASCADE) {
      if (!seen.has(item.model) && !getActiveCooldown(item.model, now)) {
        ordered.push(item);
        seen.add(item.model);
      }
    }
    if (ordered.length === 0) {
      for (const item of [...STATIC_MODEL_CASCADE].reverse()) {
        const cd = getActiveCooldown(item.model, now);
        if (!cd || cd.reason === 'transient') {
          ordered.push(item);
          seen.add(item.model);
        }
      }
    }

    let lastError: unknown = null;
    let sawDailyQuota = false;
    let maxEndObserved = safeStart;

    const parseAndEmitRawObj = (rawObj: string): boolean => {
      const parsed = bulletproofParseJson<Record<string, unknown> | unknown[] | null>(rawObj, null);
      if (!parsed) return false;
      let sVal: number | undefined;
      let eVal: number | undefined;
      let durVal: number | undefined;
      let txtVal = '';
      let mapVal: string | undefined;
      let ipaVal: string | undefined;
      let viVal: string | undefined;

      if (Array.isArray(parsed) && parsed.length >= 3) {
        sVal = Number(parsed[0]);
        eVal = Number(parsed[1]);
        txtVal = String(parsed[2] || '');
        if (targetLanguage === 'ja') mapVal = typeof parsed[3] === 'string' ? parsed[3] : undefined;
        else ipaVal = typeof parsed[3] === 'string' ? parsed[3] : undefined;
        viVal = typeof parsed[4] === 'string' ? parsed[4] : undefined;
      } else if (typeof parsed === 'object') {
        const o = parsed as Record<string, unknown>;
        sVal = Number(o.s ?? o.start);
        eVal = o.e !== undefined || o.end !== undefined ? Number(o.e ?? o.end) : undefined;
        durVal = o.d !== undefined || o.duration !== undefined ? Number(o.d ?? o.duration) : undefined;
        txtVal = String(o.t ?? o.text ?? '');
        mapVal = typeof (o.r ?? o.readingMap) === 'string' ? String(o.r ?? o.readingMap) : undefined;
        ipaVal = typeof (o.p ?? o.ipaLine) === 'string' ? String(o.p ?? o.ipaLine) : undefined;
        viVal = typeof (o.v ?? o.translationVi) === 'string' ? String(o.v ?? o.translationVi) : undefined;
      }
      if (!txtVal.trim()) return false;
      const normalized = normalizeAndSanitizeSttLines(
        [
          {
            start: sVal,
            end: eVal,
            duration: durVal,
            text: txtVal,
            readingMap: mapVal,
            ipaLine: ipaVal,
            translationVi: viVal,
          },
        ],
        safeStart,
        endOffsetSec,
        targetLanguage
      );
      if (normalized.length === 0) return false;
      const line = normalized[0];
      maxEndObserved = Math.max(maxEndObserved, line.start + line.duration);
      onLine(line);
      return true;
    };

    const runVideoStream = async (
      model: string,
      useThinking: boolean,
      includeVideoMetadata: boolean
    ): Promise<number> => {
      const videoPart: Record<string, unknown> = includeVideoMetadata
        ? {
            fileData: { fileUri: videoUrl, mimeType: 'video/mp4' },
            videoMetadata: {
              startOffset: `${safeStart}s`,
              endOffset: `${endOffsetSec}s`,
              fps: 0.1,
            },
          }
        : {
            fileData: { fileUri: videoUrl, mimeType: 'video/mp4' },
          };
      const effectivePrompt = includeVideoMetadata
        ? prompt
        : `${prompt}\n\n[PHẠM VI BẮT BUỘC]: CHỈ xuất phụ đề cho đoạn từ ${safeStart}s đến ${endOffsetSec}s.`;

      const config: Record<string, unknown> = {
        systemInstruction: sysInstr,
      };
      if (!/^gemini-4-/i.test(model)) {
        config.temperature = 0.1;
      }
      if (useThinking) {
        config.thinkingConfig = {
          thinkingLevel: /^gemini-4-/i.test(model) ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
        };
      }

      let openTimer: ReturnType<typeof setTimeout> | null = null;
      const stream = await Promise.race([
        ai.models.generateContentStream({
          model,
          contents: [videoPart, { text: effectivePrompt }] as never,
          config: config as never,
        }),
        new Promise<never>((_, reject) => {
          openTimer = setTimeout(
            () => reject(new Error(`Multimodal stream timeout on ${model} after ${timeoutMs}ms`)),
            timeoutMs
          );
        }),
      ]).finally(() => {
        if (openTimer) clearTimeout(openTimer);
      });

      let emittedCount = 0;
      let buf = '';
      let depth = 0;
      let openCh: '{' | '[' | null = null;
      let inString = false;
      let escaped = false;
      const iter = stream[Symbol.asyncIterator]();

      while (true) {
        if (signal?.aborted) break;
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const nextResult = await Promise.race([
          iter.next(),
          new Promise<never>((_, reject) => {
            stallTimer = setTimeout(
              () => reject(new Error(`Multimodal stream stall on ${model}`)),
              emittedCount === 0 ? timeoutMs : 12_000
            );
          }),
        ]).finally(() => {
          if (stallTimer) clearTimeout(stallTimer);
        });
        if (nextResult.done) break;
        const piece = nextResult.value.text || '';
        if (!piece) continue;

        for (let idx = 0; idx < piece.length; idx++) {
          const ch = piece[idx];
          if (depth === 0) {
            if (ch === '{') {
              depth = 1;
              openCh = '{';
              buf = '{';
              inString = false;
              escaped = false;
            }
            continue;
          }
          buf += ch;
          if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
          } else {
            if (ch === '"') inString = true;
            else if (openCh === '{' && ch === '{') depth += 1;
            else if (openCh === '{' && ch === '}') {
              depth -= 1;
              if (depth === 0) {
                if (parseAndEmitRawObj(buf)) emittedCount += 1;
                buf = '';
                openCh = null;
              }
            }
          }
        }
      }
      return emittedCount;
    };

    const tryCandidate = async (model: string, supportsThinking: boolean): Promise<number | null> => {
      try {
        const count = await runVideoStream(model, supportsThinking, true);
        preferredHealthyModel = model;
        modelCooldowns.delete(model);
        globalDailyQuotaUntil = 0;
        return count;
      } catch (err) {
        lastError = err;
        if (signal?.aborted) return 0;

        // Retry same model without videoMetadata/fps if rejected (400 INVALID_ARGUMENT)
        const msg = err instanceof Error ? err.message : String(err || '');
        if (/videoMetadata|fps|INVALID_ARGUMENT|400/i.test(msg) && !isRateLimitError(err)) {
          try {
            const count = await runVideoStream(model, false, false);
            preferredHealthyModel = model;
            modelCooldowns.delete(model);
            globalDailyQuotaUntil = 0;
            return count;
          } catch (retryErr) {
            lastError = retryErr;
          }
        } else if (supportsThinking && isThinkingConfigError(err)) {
          try {
            const count = await runVideoStream(model, false, true);
            preferredHealthyModel = model;
            modelCooldowns.delete(model);
            globalDailyQuotaUntil = 0;
            return count;
          } catch (retryErr) {
            lastError = retryErr;
          }
        }

        if (isModelNotFoundError(lastError)) {
          setModelCooldown(model, 'not_found', lastError);
          return null;
        }
        if (isDailyQuotaError(lastError)) {
          sawDailyQuota = true;
          setModelCooldown(model, 'daily_quota', lastError);
          return null;
        }
        if (isTransientError(lastError)) {
          setModelCooldown(model, 'transient', lastError);
          return null;
        }
        return null;
      }
    };

    for (let i = 0; i < ordered.length; i++) {
      if (signal?.aborted) break;
      const { model, supportsThinking } = ordered[i];
      const count = await tryCandidate(model, supportsThinking);
      if (count !== null) {
        const hasMoreContent =
          knownDurationSec && knownDurationSec > 0
            ? endOffsetSec < knownDurationSec - 8
            : true;
        return {
          emittedCount: count,
          nextOffsetSec: Math.max(endOffsetSec, Math.floor(maxEndObserved)),
          hasMoreContent,
        };
      }
    }

    if (!signal?.aborted && (ordered.length === 0 || sawDailyQuota || isModelNotFoundError(lastError) || isTransientError(lastError))) {
      const discovered = await discoverLiveGenerateModels(ai);
      for (const model of discovered) {
        if (seen.has(model) || signal?.aborted) continue;
        const cd = getActiveCooldown(model);
        if (cd) {
          if (cd.reason === 'daily_quota') sawDailyQuota = true;
          continue;
        }
        seen.add(model);
        const count = await tryCandidate(model, false);
        if (count !== null) {
          const hasMoreContent =
            knownDurationSec && knownDurationSec > 0
              ? endOffsetSec < knownDurationSec - 8
              : true;
          return {
            emittedCount: count,
            nextOffsetSec: Math.max(endOffsetSec, Math.floor(maxEndObserved)),
            hasMoreContent,
          };
        }
      }
    }

    const isHardDaily =
      sawDailyQuota ||
      isDailyQuotaError(lastError) ||
      STATIC_MODEL_CASCADE.every((c) => {
        const cd = getActiveCooldown(c.model);
        return Boolean(cd && (cd.reason === 'daily_quota' || cd.reason === 'not_found'));
      });

    if (isHardDaily) {
      globalDailyQuotaUntil = Date.now() + 45_000;
      throw createDailyQuotaError();
    }

    if (lastError) {
      const wrapped = new Error(
        toFriendlyErrorMessage(
          lastError,
          'Không thể đọc trực tiếp luồng âm thanh YouTube của video này.'
        )
      ) as Error & { status?: number; restricted?: boolean };
      if (isRateLimitError(lastError)) wrapped.status = 429;
      else wrapped.restricted = true;
      throw wrapped;
    }

    return { emittedCount: 0, nextOffsetSec: endOffsetSec, hasMoreContent: false };
  }, 'express');
}

/**
 * INLINE TAB-AUDIO AI FALLBACK (for Private / Region-Locked / Age-Restricted Videos):
 * Receives a short 8-10s audio blob captured directly from the browser tab and runs 1-Pass
 * Listening-to-Target translation on gemini-3.8-flash in real time!
 */
export async function transcribeTabAudioChunk({
  audioBase64,
  mimeType,
  chunkStartSec,
  chunkDurationSec = 9,
  videoTitle,
  targetLanguage,
  targetLevel,
  contextAnchorBlock = '',
}: {
  audioBase64: string;
  mimeType: string;
  chunkStartSec: number;
  chunkDurationSec?: number;
  videoTitle: string;
  targetLanguage: 'en' | 'ja';
  targetLevel?: string;
  contextAnchorBlock?: string;
}): Promise<SttTranscriptResult> {
  const safeStart = Math.max(0, Number(chunkStartSec.toFixed(2)));
  const safeDur = Math.max(3, Math.min(20, Number(chunkDurationSec) || 9));
  const endOffsetSec = Number((safeStart + safeDur).toFixed(2));
  const level = targetLevel || (targetLanguage === 'ja' ? 'N3' : 'B2');
  const ctxPrefix = contextAnchorBlock ? `${contextAnchorBlock}\n` : '';

  const prompt =
    targetLanguage === 'ja'
      ? `${ctxPrefix}Tiêu đề video: "${videoTitle}"
Đây là đoạn ghi âm trực tiếp ${safeDur} giây tính từ mốc ${safeStart}s đến ${endOffsetSec}s của video.
NHIỆM VỤ 1-PASS: Nghe lời thoại thực tế trong đoạn âm thanh này (KHÔNG bịa nếu chỉ có nhạc/im lặng -> trả lines: []).
Xuất từng câu thoại với start (giây tuyệt đối trong [${safeStart}, ${endOffsetSec}]), duration, text (100% TIẾNG NHẬT THUẦN tự nhiên JLPT ${level}, CẤM HTML <ruby>/<rt>, CẤM Romaji), readingMap ("漢字:ひらがな|..." CHỈ Hiragana), và translationVi (nghĩa Việt ngắn gọn).`
      : `${ctxPrefix}Tiêu đề video: "${videoTitle}"
Đây là đoạn ghi âm trực tiếp ${safeDur} giây tính từ mốc ${safeStart}s đến ${endOffsetSec}s của video.
NHIỆM VỤ 1-PASS: Nghe lời thoại thực tế trong đoạn âm thanh này (KHÔNG bịa nếu chỉ có nhạc/im lặng -> trả lines: []).
Xuất từng câu thoại với start (giây tuyệt đối trong [${safeStart}, ${endOffsetSec}]), duration, text (100% TIẾNG ANH TỰ NHIÊN BẢN XỨ CEFR ${level}, CẤM Vietlish, CẤM HTML), ipaLine (Oxford IPA), và translationVi (nghĩa Việt ngắn gọn).`;

  const lineProps: Record<string, unknown> = {
    start: { type: Type.NUMBER },
    duration: { type: Type.NUMBER },
    text: { type: Type.STRING },
    translationVi: { type: Type.STRING },
  };
  if (targetLanguage === 'ja') {
    lineProps.readingMap = { type: Type.STRING };
  } else {
    lineProps.ipaLine = { type: Type.STRING };
  }

  const schema = {
    type: Type.OBJECT,
    properties: {
      spokenLanguage: { type: Type.STRING, enum: ['vi', 'en', 'ja'] },
      lines: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: lineProps,
          required: ['start', 'duration', 'text', 'translationVi'],
        },
      },
    },
    required: ['spokenLanguage', 'lines'],
  };

  const rawText = await callGeminiResilient({
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType || 'audio/webm',
            data: audioBase64,
          },
        },
        { text: prompt },
      ],
    },
    systemInstruction:
      targetLanguage === 'ja'
        ? `${COMPACT_SUBTITLE_TRUTH_DIRECTIVE}\nNghe đoạn âm thanh tab trực tiếp và xuất thẳng câu Tiếng Nhật sạch + readingMap Hiragana thuần + nghĩa Việt.`
        : `${COMPACT_SUBTITLE_TRUTH_DIRECTIVE}\nNghe đoạn âm thanh tab trực tiếp và xuất thẳng câu Tiếng Anh chuẩn bản xứ + Oxford IPA + nghĩa Việt.`,
    responseSchema: schema,
    thinkingLevel: ThinkingLevel.MINIMAL,
    temperature: 0.1,
    timeoutMs: 18_000,
    priority: 'express',
  });

  const parsed = bulletproofParseJson<{
    spokenLanguage?: 'vi' | 'en' | 'ja';
    lines?: Array<{
      start: number;
      duration: number;
      text: string;
      readingMap?: string;
      ipaLine?: string;
      translationVi?: string;
    }>;
  } | null>(rawText, null);

  const cleaned = normalizeAndSanitizeSttLines(
    Array.isArray(parsed?.lines) ? parsed!.lines : [],
    safeStart,
    endOffsetSec,
    targetLanguage
  );

  return {
    spokenLanguage: parsed?.spokenLanguage || 'vi',
    lines: cleaned,
    hasMoreContent: true,
    nextOffsetSec: endOffsetSec,
    directTranslated: true,
  };
}
