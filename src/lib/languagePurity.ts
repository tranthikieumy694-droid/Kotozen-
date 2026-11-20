import type { Language } from '../types';

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
 * Mandatory Language Purity Validator on the frontend UI Gate:
 * Ensures primary subtitles NEVER display raw Vietnamese when learning English or Japanese.
 */
export function isPureTargetLanguage(
  text: string,
  targetLang: Language,
  sourceViText?: string
): boolean {
  const clean = (text || '').normalize('NFC').trim();
  if (!clean) return false;

  if (hasVietnameseDiacritics(clean)) return false;

  if (targetLang === 'ja') {
    return hasJapaneseScript(clean);
  }

  if (!/[A-Za-z]/.test(clean)) return false;
  if (sourceViText) {
    const normSrc = sourceViText.normalize('NFC').trim().toLowerCase();
    const normOut = clean.toLowerCase();
    if (normSrc.length >= 6 && normOut === normSrc) return false;
  }
  return true;
}

/**
 * Strips raw JSON / HTTP status codes / technical SDK exceptions from ever showing in the UI.
 */
export function sanitizeClientErrorMessage(err: unknown, fallbackVi: string): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw.trim()) return fallbackVi;

  if (
    /^\s*\{/.test(raw) ||
    /"error"\s*:/.test(raw) ||
    /\b(404|429|500|502|503|NOT_FOUND|UNAVAILABLE|RESOURCE_EXHAUSTED|PERMISSION_DENIED|Failed to fetch)\b/i.test(
      raw
    )
  ) {
    console.warn('[KotoZen Client Warning]', raw);
    if (/Failed to fetch|NetworkError/i.test(raw)) {
      return 'Kết nối mạng tạm gián đoạn. Vui lòng kiểm tra đường truyền và thử lại.';
    }
    return fallbackVi;
  }

  return raw.length <= 220 ? raw : fallbackVi;
}
