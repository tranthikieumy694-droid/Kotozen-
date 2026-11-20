/**
 * UTF-8 NFC & HTML Entity Sanitizer + Bulletproof JSON Normalizer
 * Eliminates 100% of NFD split Vietnamese diacritics, stray &amp;/&#39;/&nbsp;,
 * escaped \uXXXX sequences, and invisible control characters across all responses.
 */

export function decodeAndNormalizeText(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let text = input
    // Decode literal \uXXXX escape sequences if present in raw caption payloads
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Decode common HTML entities (including double-encoded &amp;amp;)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, num) => {
      const code = parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    // Run a second pass for double-encoded entities like &amp;#39;
    .replace(/&amp;/gi, '&')
    .replace(/&#0*39;/gi, "'")
    .replace(/&quot;/gi, '"')
    // Strip zero-width joiners / BOM / replacement chars
    .replace(/[\u200B-\u200D\uFEFF\uFFFD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Enforce NFC Unicode normalization so Vietnamese tones/diacritics never split
  try {
    text = text.normalize('NFC');
  } catch {
    // Ignore if environment lacks full ICU normalize
  }

  return text;
}

/**
 * Recursively normalizes every string property in a JSON object to clean UTF-8 NFC.
 */
export function deepNormalizeUtf8<T>(value: T): T {
  if (typeof value === 'string') {
    return decodeAndNormalizeText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepNormalizeUtf8(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepNormalizeUtf8(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Bulletproof JSON parser that handles markdown code fences, trailing commas,
 * smart quotes, and partial surrounding prose without crashing.
 */
export function bulletproofParseJson<T>(rawText: string | undefined, fallback: T): T {
  if (!rawText) return fallback;
  const trimmed = rawText.trim().normalize('NFC');

  const tryParse = (candidate: string): T | null => {
    try {
      return deepNormalizeUtf8(JSON.parse(candidate) as T);
    } catch {
      // Attempt safe trailing-comma cleanup
      try {
        const cleaned = candidate.replace(/,\s*([}\]])/g, '$1');
        return deepNormalizeUtf8(JSON.parse(cleaned) as T);
      } catch {
        return null;
      }
    }
  };

  const direct = tryParse(trimmed);
  if (direct !== null) return direct;

  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const fromFence = tryParse(fenced);
  if (fromFence !== null) return fromFence;

  const firstObj = fenced.indexOf('{');
  const firstArr = fenced.indexOf('[');
  let start = -1;
  let end = -1;
  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj;
    end = fenced.lastIndexOf('}');
  } else if (firstArr !== -1) {
    start = firstArr;
    end = fenced.lastIndexOf(']');
  }

  if (start !== -1 && end > start) {
    const sliced = tryParse(fenced.slice(start, end + 1));
    if (sliced !== null) return sliced;
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Mandatory Language Purity Validator (Zero Vietnamese Leakage on EN/JA)
// ---------------------------------------------------------------------------
const VIETNAMESE_DIACRITIC_REGEX =
  /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ]/;

const JAPANESE_SCRIPT_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;

export function hasVietnameseDiacritics(text: string): boolean {
  return VIETNAMESE_DIACRITIC_REGEX.test((text || '').normalize('NFC'));
}

export function hasJapaneseScript(text: string): boolean {
  return JAPANESE_SCRIPT_REGEX.test(text || '');
}

/**
 * Strictly validates that translated/enriched subtitle text is 100% in the selected
 * target language ('ja' or 'en') and never leaks raw Vietnamese source text.
 */
export function isPureTargetLanguage(
  text: string,
  targetLang: 'en' | 'ja',
  sourceViText?: string
): boolean {
  const clean = decodeAndNormalizeText(text || '');
  if (!clean) return false;

  // Never allow Vietnamese diacritics in EN or JA target subtitles
  if (hasVietnameseDiacritics(clean)) return false;

  if (targetLang === 'ja') {
    // Japanese target MUST contain Japanese characters (Hiragana / Katakana / Kanji)
    return hasJapaneseScript(clean);
  }

  // English target MUST contain Latin letters and must not duplicate the Vietnamese source verbatim
  if (!/[A-Za-z]/.test(clean)) return false;
  if (sourceViText) {
    const normSrc = decodeAndNormalizeText(sourceViText).toLowerCase();
    const normOut = clean.toLowerCase();
    if (normSrc.length >= 6 && normOut === normSrc) return false;
  }
  return true;
}

let lastUnexpectedErrorLogAt = 0;

/**
 * Strips raw JSON payloads, HTTP codes, and technical SDK error dumps so the UI
 * NEVER displays raw {"error":{"code":404,...}} strings to learners.
 * Also avoids flooding server stderr/console.error with expected 429/quota JSON blobs.
 */
export function toFriendlyErrorMessage(err: unknown, fallbackVi: string): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw.trim()) return fallbackVi;

  const isExplicitDaily = Boolean((err as { isDailyQuota?: boolean } | null)?.isDailyQuota);
  const isDailyQuotaPattern =
    isExplicitDaily ||
    /limit:\s*0\b|PerDay|per\s+day|daily\s+limit/i.test(raw) ||
    (() => {
      const m = raw.match(/retryDelay["':\s]+(\d+)s/i);
      return Boolean(m && Number(m[1]) >= 300);
    })();

  const isExpectedApiTransient =
    isDailyQuotaPattern ||
    /\b(404|429|502|503|NOT_FOUND|UNAVAILABLE|RESOURCE_EXHAUSTED)\b|quota|rate.?limit|Request timeout on|Stream handshake timeout|Stream chunk stall|aborted/i.test(
      raw
    );

  // Only log concise 1-line warning for unexpected non-quota errors (rate-limited)
  if (!isExpectedApiTransient) {
    const now = Date.now();
    if (now - lastUnexpectedErrorLogAt > 5000) {
      lastUnexpectedErrorLogAt = now;
      const concise = raw.replace(/\s+/g, ' ').slice(0, 220);
      console.warn('[KotoZen AI Service]', concise);
    }
  }

  if (isDailyQuotaPattern) {
    return 'Hạn mức gọi AI miễn phí hôm nay đã tạm hết. Các phụ đề đã dịch vẫn được giữ nguyên; vui lòng chờ hạn mức làm mới hoặc chuyển sang khóa API trả phí trong Settings > Secrets.';
  }

  if (
    /^\s*\{/.test(raw) ||
    /"error"\s*:/.test(raw) ||
    /\b(404|429|500|502|503|NOT_FOUND|UNAVAILABLE|RESOURCE_EXHAUSTED|PERMISSION_DENIED|INVALID_ARGUMENT)\b/i.test(
      raw
    )
  ) {
    if (/429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(raw)) {
      return 'Hệ thống AI đang có lưu lượng truy cập cao. Vui lòng thử lại sau vài giây.';
    }
    if (/PERMISSION_DENIED|API_KEY_INVALID|403/i.test(raw)) {
      return 'Kết nối dịch vụ AI chưa sẵn sàng. Vui lòng kiểm tra cấu hình khóa API trong Settings > Secrets.';
    }
    return fallbackVi;
  }

  // Keep clean short Vietnamese messages authored by our own code
  if (raw.length <= 240 && !/Error:|TypeError:|SyntaxError:|https?:\/\//i.test(raw)) {
    return decodeAndNormalizeText(raw);
  }
  return fallbackVi;
}

// ---------------------------------------------------------------------------
// Zero-HTML & Zero-Romaji Sanitizer for Subtitles & Compact Reading Maps
// ---------------------------------------------------------------------------
const SERVER_PURE_HIRAGANA_RE = /^[\u3041-\u3096\u30FC]+$/;
const SERVER_KANJI_RE = /[\u4E00-\u9FAF々〆ヶ]/;

export function sanitizeHiraganaReadingServer(reading: string | undefined | null): string | undefined {
  if (!reading || typeof reading !== 'string') return undefined;
  let clean = decodeAndNormalizeText(reading)
    .replace(/<[^>]*>/g, '')
    .replace(/[\[\]()（）「」『』\s・/\\<>]/g, '')
    .trim();
  if (!clean) return undefined;
  clean = clean.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
  return SERVER_PURE_HIRAGANA_RE.test(clean) ? clean : undefined;
}

export function stripHtmlAndRubyArtifactsServer(input: string): string {
  if (!input || typeof input !== 'string') return '';
  let text = decodeAndNormalizeText(input);
  // Remove <rt>...</rt> and <rp>...</rp> content completely (even with spaces inside tags)
  text = text
    .replace(/<\s*rt\b[^>]*>[\s\S]*?<\s*\/\s*rt\s*>/gi, '')
    .replace(/<\s*rp\b[^>]*>[\s\S]*?<\s*\/\s*rp\s*>/gi, '');
  // Strip all remaining HTML tags (<ruby>, </ruby>, <span>, <b>, <br>, etc.)
  text = text
    .replace(/<\s*\/?\s*[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g, '')
    .replace(/<\s*\/?\s*(?:ruby|rt|rp|span|div|b|i|br|p)\s*>/gi, '')
    .replace(/<[^>]{0,40}>/g, '')
    // Strip stray inline [reading] brackets attached to Kanji
    .replace(/([\u4E00-\u9FAF々〆ヶ])\[[A-Za-z\u3040-\u30FFー・\s'-]{1,28}\]/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  try {
    text = text.normalize('NFC');
  } catch {
    // ignore
  }
  return text;
}

/**
 * Validates and cleans a Compact Reading Map string ("箱:はこ|重:おも|自分:じぶん").
 * Strips ALL HTML tags and REJECTS any Romaji / non-Hiragana readings!
 */
export function sanitizeCompactReadingMapServer(
  rawMap: string | undefined | null,
  fallbackRawText?: string
): string | undefined {
  const pairs = new Map<string, string>();

  // Salvage valid pure-Hiragana inline [ひらがな] or <ruby>漢<rt>ひらがな</rt></ruby> if model fell back
  if (fallbackRawText && typeof fallbackRawText === 'string') {
    const decoded = decodeAndNormalizeText(fallbackRawText);
    const htmlRe =
      /<\s*ruby\b[^>]*>([\s\S]*?)<\s*rt\b[^>]*>([\s\S]*?)<\s*\/\s*rt\s*>[\s\S]*?<\s*\/\s*ruby\s*>/gi;
    let hm: RegExpExecArray | null;
    while ((hm = htmlRe.exec(decoded)) !== null) {
      const base = hm[1].replace(/<[^>]*>/g, '').trim();
      const reading = sanitizeHiraganaReadingServer(hm[2]);
      if (base && reading && SERVER_KANJI_RE.test(base) && !pairs.has(base)) {
        pairs.set(base, reading);
      }
    }
    const inlineRe = /([\u4E00-\u9FAF々〆ヶ]+)\[([\u3040-\u30FFー・]+)\]/g;
    let im: RegExpExecArray | null;
    while ((im = inlineRe.exec(decoded)) !== null) {
      const reading = sanitizeHiraganaReadingServer(im[2]);
      if (im[1] && reading && !pairs.has(im[1])) {
        pairs.set(im[1], reading);
      }
    }
  }

  if (rawMap && typeof rawMap === 'string') {
    const cleaned = decodeAndNormalizeText(rawMap).replace(/<[^>]*>/g, '');
    for (const part of cleaned.split(/[|｜;；\n]+/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const sepIdx = trimmed.search(/[:：=]/);
      if (sepIdx <= 0) continue;
      const base = trimmed.slice(0, sepIdx).replace(/[\s「」『』()（）\[\]]/g, '').trim();
      const reading = sanitizeHiraganaReadingServer(trimmed.slice(sepIdx + 1));
      if (base && reading && SERVER_KANJI_RE.test(base)) {
        pairs.set(base, reading);
      }
    }
  }

  if (pairs.size === 0) return undefined;
  return Array.from(pairs.entries())
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
}


