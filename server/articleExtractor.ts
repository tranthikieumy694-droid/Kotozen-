import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import iconv from 'iconv-lite';
import { decodeAndNormalizeText, deepNormalizeUtf8 } from './textSanitizer.ts';

export type ArticleLanguage = 'vi' | 'en' | 'ja';
export type ArticleBlockType = 'lead' | 'h2' | 'h3' | 'p' | 'blockquote' | 'li';

export interface RubySegment {
  base: string;
  reading?: string;
}

export interface ExtractedSentence {
  id: string;
  index: number;
  paragraphId: string;
  sentenceIndexInParagraph: number;
  blockType: ArticleBlockType;
  text: string;
  nativeRuby?: RubySegment[];
}

export interface ExtractedParagraph {
  id: string;
  index: number;
  blockType: ArticleBlockType;
  text: string;
  sentenceIds: string[];
}

export interface ExtractedArticleResult {
  status: 'ok' | 'blocked_paywall';
  url: string;
  domain: string;
  title: string;
  author?: string;
  siteName?: string;
  publishedDate?: string;
  lead?: string;
  sourceLanguage: ArticleLanguage;
  wordCount: number;
  estimatedReadMinutes: number;
  extractionTier?: 'readability_direct' | 'jsonld_fallback' | 'jina_reader' | 'raw_input';
  paragraphs: ExtractedParagraph[];
  sentences: ExtractedSentence[];
  reasonVi?: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.95,en-US;q=0.9,en;q=0.85,ja-JP;q=0.8,ja;q=0.75',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

const BOILERPLATE_PATTERNS: RegExp[] = [
  /^(quảng cáo|advertisement|sponsored|tin liên quan|xem thêm|đọc thêm|bài viết liên quan|chia sẻ bài viết)\s*:?$/i,
  /^(share this article|follow us|subscribe to|sign up for our newsletter|related articles|more from)\b/i,
  /^(関連記事|スポンサーリンク|広告|おすすめ記事|この記事をシェア|会員登録して続きを読む)\s*$/,
  /^(cookie policy|privacy policy|terms of service|all rights reserved)/i,
];

const PAYWALL_PATTERNS: RegExp[] = [
  /just a moment\.{0,3}/i,
  /cf-browser-verification|attention required!.*cloudflare|enable javascript and cookies/i,
  /subscribe to continue reading|already a subscriber\? sign in|this article is for subscribers/i,
  /有料会員限定|会員登録して続きを読む|ここから先は有料|会員限定記事/,
  /you have reached your limit of free articles|create a free account to continue/i,
];

export function validateWebUrl(rawUrl: string): { ok: boolean; url?: URL; errorVi?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { ok: false, errorVi: 'Vui lòng nhập đường link bài viết hợp lệ.' };
  }
  let parsed: URL;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProto);
  } catch {
    return { ok: false, errorVi: 'Đường link không đúng định dạng URL (http:// hoặc https://).' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, errorVi: 'Chỉ hỗ trợ đọc bài viết từ đường link HTTP hoặc HTTPS.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return { ok: false, errorVi: 'Không thể truy cập địa chỉ mạng nội bộ.' };
  }

  return { ok: true, url: parsed };
}

export function detectArticleLanguage(text: string): ArticleLanguage {
  const sample = String(text || '').slice(0, 8000);
  const jpKanaCount = (sample.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const jpKanjiCount = (sample.match(/[\u4E00-\u9FFF]/g) || []).length;
  const viDiacriticCount = (
    sample.match(
      /[ăâđêôơưàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/gi
    ) || []
  ).length;
  const latinCount = (sample.match(/[A-Za-z]/g) || []).length;

  const jpScriptCount = jpKanaCount + jpKanjiCount;
  const totalLetters = jpScriptCount + latinCount + viDiacriticCount;

  if (totalLetters === 0) return 'en';

  // Genuine Japanese prose has Kana present AND significant CJK/Kana density (>= 15% of letters)
  if (jpKanaCount >= 4 && jpScriptCount / totalLetters >= 0.15) {
    return 'ja';
  }
  if (jpKanaCount >= 2 && latinCount < 25) {
    return 'ja';
  }

  // Genuine Vietnamese prose has Vietnamese diacritics on >= 4% of Latin letters (typically 15-35%)
  const latinAndVi = latinCount + viDiacriticCount;
  if (viDiacriticCount >= 4 && viDiacriticCount / Math.max(1, latinAndVi) >= 0.04) {
    return 'vi';
  }
  if (viDiacriticCount >= 2 && latinAndVi < 40) {
    return 'vi';
  }

  return 'en';
}

function normalizeCharsetName(raw: string): string {
  const c = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '');
  if (!c) return 'utf-8';
  if (/^(utf-?8|utf8)$/.test(c)) return 'utf-8';
  if (/^(shift[-_]?jis|sjis|x-sjis|ms932|cp932|windows-31j)$/.test(c)) return 'shift_jis';
  if (/^(euc[-_]?jp|x-euc-jp)$/.test(c)) return 'euc-jp';
  if (/^iso-2022-jp$/i.test(c)) return 'iso-2022-jp';
  if (/^(iso-8859-1|latin1|windows-1252)$/.test(c)) return 'windows-1252';
  if (/^windows-1258$/.test(c)) return 'windows-1258';
  return c;
}

function detectAndDecodeBuffer(buf: Buffer, contentTypeHeader: string): string {
  let detectedCharset = '';
  const headerMatch = contentTypeHeader.match(/charset\s*=\s*([^\s;]+)/i);
  if (headerMatch?.[1]) {
    detectedCharset = normalizeCharsetName(headerMatch[1]);
  }

  // Peek ASCII head for <meta charset=...> if header did not specify or said iso-8859-1
  const asciiHead = buf.subarray(0, Math.min(buf.length, 6144)).toString('latin1');
  const metaCharset =
    asciiHead.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i)?.[1] ||
    asciiHead.match(/content\s*=\s*["'][^"']*charset\s*=\s*([a-zA-Z0-9_-]+)/i)?.[1];

  if (metaCharset) {
    const normalizedMeta = normalizeCharsetName(metaCharset);
    if (!detectedCharset || detectedCharset === 'windows-1252') {
      detectedCharset = normalizedMeta;
    }
  }

  const finalCharset = detectedCharset || 'utf-8';
  try {
    if (finalCharset !== 'utf-8' && iconv.encodingExists(finalCharset)) {
      return iconv.decode(buf, finalCharset).normalize('NFC');
    }
  } catch {
    // Fall through to utf-8
  }

  const utf8Text = buf.toString('utf8');
  // Heuristic repair: if UTF-8 contains many replacement characters (\uFFFD), try Shift_JIS / EUC-JP
  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;
  if (replacementCount > 12) {
    for (const candidate of ['shift_jis', 'euc-jp']) {
      try {
        const decoded = iconv.decode(buf, candidate);
        const bad = (decoded.match(/\uFFFD/g) || []).length;
        if (bad < replacementCount / 3) {
          return decoded.normalize('NFC');
        }
      } catch {
        // ignore
      }
    }
  }

  return utf8Text.normalize('NFC');
}

function isBoilerplateLine(text: string): boolean {
  const clean = text.trim();
  if (!clean) return true;
  if (clean.length <= 2 && !/[\u3040-\u30FF\u4E00-\u9FFF]/.test(clean)) return true;
  return BOILERPLATE_PATTERNS.some((re) => re.test(clean));
}

function cleanBlockText(raw: string): string {
  return decodeAndNormalizeText(raw)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

/**
 * Splits a paragraph into clean sentences without breaking abbreviations,
 * decimals, URLs, or Japanese closing quotes.
 */
export function splitIntoSentences(text: string, lang: ArticleLanguage): string[] {
  const clean = cleanBlockText(text);
  if (!clean) return [];

  if (lang === 'ja') {
    const sentences: string[] = [];
    let current = '';
    const chars = Array.from(clean);
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      current += ch;
      if (ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?') {
        // Attach trailing closing quotes/brackets or consecutive punctuation
        while (
          i + 1 < chars.length &&
          /[」』）】"'”’!?！？。]/.test(chars[i + 1])
        ) {
          i += 1;
          current += chars[i];
        }
        const trimmed = current.trim();
        if (trimmed) sentences.push(trimmed);
        current = '';
      }
    }
    if (current.trim()) sentences.push(current.trim());
    return sentences.length > 0 ? sentences : [clean];
  }

  // English & Vietnamese sentence segmentation protecting abbreviations & decimals
  const ABBREV = new Set([
    'mr',
    'mrs',
    'ms',
    'dr',
    'prof',
    'sr',
    'jr',
    'st',
    'vs',
    'etc',
    'fig',
    'no',
    'vol',
    'inc',
    'ltd',
    'co',
    'corp',
    'e.g',
    'i.e',
    'u.s',
    'u.k',
    'tp',
    'ts',
    'gs',
    'pgs',
    'ths',
    'ks',
    'bs',
    'cn',
  ]);

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Skip ellipsis "..."
    if (ch === '.' && (clean[i + 1] === '.' || clean[i - 1] === '.')) continue;

    // Skip decimal numbers (e.g., 3.14, 1.5%)
    if (ch === '.' && /\d/.test(clean[i - 1] || '') && /\d/.test(clean[i + 1] || '')) continue;

    // Include closing quotes/parens immediately after punctuation
    let endIdx = i;
    while (endIdx + 1 < clean.length && /["'”’)\]]/.test(clean[endIdx + 1])) {
      endIdx += 1;
    }

    const nextChar = clean[endIdx + 1];
    // Must be end-of-string or followed by whitespace
    if (nextChar !== undefined && !/\s/.test(nextChar)) continue;

    // Check abbreviation before "."
    if (ch === '.') {
      const before = clean.slice(start, i).trim();
      const lastToken = before.split(/\s+/).pop() || '';
      const normToken = lastToken.replace(/^["'(«]+/, '').toLowerCase();
      if (
        ABBREV.has(normToken) ||
        /^[a-z]$/i.test(normToken) ||
        /^(?:[a-z]\.)+[a-z]?$/i.test(normToken)
      ) {
        continue;
      }
    }

    const piece = clean.slice(start, endIdx + 1).trim();
    if (piece) {
      sentences.push(piece);
    }
    start = endIdx + 1;
    while (start < clean.length && /\s/.test(clean[start])) {
      start += 1;
    }
    i = start - 1;
  }

  const tail = clean.slice(start).trim();
  if (tail) {
    // Merge tiny trailing fragment if needed
    if (tail.length < 4 && sentences.length > 0) {
      sentences[sentences.length - 1] = `${sentences[sentences.length - 1]} ${tail}`;
    } else {
      sentences.push(tail);
    }
  }

  return sentences.length > 0 ? sentences : [clean];
}

/**
 * Extracts text AND preserves native <ruby><rb>...</rb><rt>...</rt></ruby> segments from a DOM element.
 */
function extractTextAndRuby(el: Element): { text: string; ruby?: RubySegment[] } {
  const segments: RubySegment[] = [];
  let hasRuby = false;

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      // Text node
      const val = String(node.nodeValue || '');
      if (val) {
        segments.push({ base: val });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const elem = node as Element;
    const tag = elem.tagName.toLowerCase();
    if (
      tag === 'script' ||
      tag === 'style' ||
      tag === 'noscript' ||
      tag === 'rp' ||
      tag === 'svg' ||
      tag === 'iframe' ||
      tag === 'button'
    ) {
      return;
    }
    if (tag === 'ruby') {
      hasRuby = true;
      let baseAcc = '';
      let rtAcc = '';
      const children = Array.from(elem.childNodes);
      for (const ch of children) {
        if (ch.nodeType === 3) {
          baseAcc += String(ch.nodeValue || '');
        } else if (ch.nodeType === 1) {
          const ct = (ch as Element).tagName.toLowerCase();
          if (ct === 'rt') {
            rtAcc += String(ch.textContent || '');
            if (baseAcc.trim()) {
              segments.push({
                base: baseAcc.trim(),
                reading: rtAcc.trim() || undefined,
              });
            }
            baseAcc = '';
            rtAcc = '';
          } else if (ct === 'rb' || ct === 'span') {
            baseAcc += String(ch.textContent || '');
          } else if (ct !== 'rp') {
            baseAcc += String(ch.textContent || '');
          }
        }
      }
      if (baseAcc.trim()) {
        segments.push({ base: baseAcc.trim() });
      }
      return;
    }

    if (tag === 'br') {
      segments.push({ base: ' ' });
      return;
    }

    for (const child of Array.from(elem.childNodes)) {
      walk(child);
    }
  };

  walk(el);

  const rawText = segments.map((s) => s.base).join('');
  const cleanText = cleanBlockText(rawText);
  if (!hasRuby) {
    return { text: cleanText };
  }

  // Compact adjacent non-ruby text segments and normalize whitespace
  const compacted: RubySegment[] = [];
  for (const seg of segments) {
    const base = decodeAndNormalizeText(seg.base).replace(/[ \t\r\n]+/g, ' ');
    if (!base) continue;
    const reading = seg.reading ? decodeAndNormalizeText(seg.reading).trim() : undefined;
    if (!reading && compacted.length > 0 && !compacted[compacted.length - 1].reading) {
      compacted[compacted.length - 1].base += base;
    } else {
      compacted.push(reading ? { base, reading } : { base });
    }
  }
  return { text: cleanText, ruby: compacted };
}

/**
 * Slices a paragraph's native RubySegment[] so each sentence receives its exact ruby subset.
 */
function sliceRubyForSentence(
  paragraphRuby: RubySegment[] | undefined,
  sentenceText: string
): RubySegment[] | undefined {
  if (!paragraphRuby || paragraphRuby.length === 0) return undefined;
  const full = paragraphRuby.map((s) => s.base).join('');
  const idx = full.indexOf(sentenceText);
  if (idx === -1) return undefined;
  const end = idx + sentenceText.length;

  const out: RubySegment[] = [];
  let cursor = 0;
  for (const seg of paragraphRuby) {
    const segLen = seg.base.length;
    const segEnd = cursor + segLen;
    if (segEnd > idx && cursor < end) {
      const overlapStart = Math.max(0, idx - cursor);
      const overlapEnd = Math.min(segLen, end - cursor);
      const subBase = seg.base.slice(overlapStart, overlapEnd);
      if (subBase) {
        out.push(
          seg.reading && overlapStart === 0 && overlapEnd === segLen
            ? { base: subBase, reading: seg.reading }
            : { base: subBase }
        );
      }
    }
    cursor = segEnd;
  }
  return out.some((s) => Boolean(s.reading)) ? out : undefined;
}

interface RawBlock {
  blockType: ArticleBlockType;
  text: string;
  nativeRuby?: RubySegment[];
}

function buildStructuredArticle(params: {
  url: string;
  domain: string;
  title: string;
  author?: string;
  siteName?: string;
  publishedDate?: string;
  lead?: string;
  blocks: RawBlock[];
  extractionTier: ExtractedArticleResult['extractionTier'];
}): ExtractedArticleResult {
  // Deduplicate adjacent identical blocks and strip boilerplate
  const filteredBlocks: RawBlock[] = [];
  const seenBlocks = new Set<string>();
  const normTitle = cleanBlockText(params.title).toLowerCase();

  for (const blk of params.blocks) {
    const clean = cleanBlockText(blk.text);
    if (!clean || isBoilerplateLine(clean)) continue;
    // Skip duplicate of H1 title at top
    if (filteredBlocks.length === 0 && clean.toLowerCase() === normTitle) continue;
    const key = clean.toLowerCase();
    if (seenBlocks.has(key) && clean.length > 25) continue;
    seenBlocks.add(key);
    filteredBlocks.push({ ...blk, text: clean });
  }

  // Promote lead/sapo if provided separately and not already the first paragraph
  const cleanLead = params.lead ? cleanBlockText(params.lead) : '';
  if (
    cleanLead &&
    cleanLead.length >= 25 &&
    cleanLead.toLowerCase() !== normTitle &&
    !filteredBlocks.some((b) => b.text.toLowerCase().includes(cleanLead.toLowerCase().slice(0, 40)))
  ) {
    filteredBlocks.unshift({ blockType: 'lead', text: cleanLead });
  }

  const allText = `${params.title} ${filteredBlocks.map((b) => b.text).join(' ')}`;
  const sourceLanguage = detectArticleLanguage(allText);

  const paragraphs: ExtractedParagraph[] = [];
  const sentences: ExtractedSentence[] = [];
  let globalSentenceIndex = 0;

  for (let pIdx = 0; pIdx < filteredBlocks.length; pIdx += 1) {
    const blk = filteredBlocks[pIdx];
    const paragraphId = `p${pIdx}`;
    const sentenceTexts =
      blk.blockType === 'h2' || blk.blockType === 'h3'
        ? [blk.text]
        : splitIntoSentences(blk.text, sourceLanguage);

    const sentenceIds: string[] = [];
    for (let sIdx = 0; sIdx < sentenceTexts.length; sIdx += 1) {
      const sText = sentenceTexts[sIdx];
      if (!sText) continue;
      const sid = `${paragraphId}_s${sIdx}`;
      sentenceIds.push(sid);
      const nativeRuby = sliceRubyForSentence(blk.nativeRuby, sText);
      sentences.push({
        id: sid,
        index: globalSentenceIndex,
        paragraphId,
        sentenceIndexInParagraph: sIdx,
        blockType: blk.blockType,
        text: sText,
        ...(nativeRuby ? { nativeRuby } : {}),
      });
      globalSentenceIndex += 1;
    }

    if (sentenceIds.length > 0) {
      paragraphs.push({
        id: paragraphId,
        index: pIdx,
        blockType: blk.blockType,
        text: blk.text,
        sentenceIds,
      });
    }
  }

  const totalChars = sentences.reduce((acc, s) => acc + s.text.length, 0);
  const wordCount =
    sourceLanguage === 'ja'
      ? totalChars
      : sentences.reduce((acc, s) => acc + s.text.split(/\s+/).filter(Boolean).length, 0);
  const estimatedReadMinutes = Math.max(
    1,
    Math.round(sourceLanguage === 'ja' ? wordCount / 450 : wordCount / 210)
  );

  return deepNormalizeUtf8({
    status: 'ok',
    url: params.url,
    domain: params.domain,
    title: cleanBlockText(params.title) || params.domain,
    author: params.author ? cleanBlockText(params.author) : undefined,
    siteName: params.siteName ? cleanBlockText(params.siteName) : params.domain,
    publishedDate: params.publishedDate ? cleanBlockText(params.publishedDate) : undefined,
    lead: cleanLead || undefined,
    sourceLanguage,
    wordCount,
    estimatedReadMinutes,
    extractionTier: params.extractionTier,
    paragraphs,
    sentences,
  });
}

function extractBlocksFromHtmlFragment(htmlFragment: string): RawBlock[] {
  const { document } = parseHTML(`<!doctype html><html><body>${htmlFragment}</body></html>`);
  const blocks: RawBlock[] = [];

  const targetTags = new Set(['h2', 'h3', 'h4', 'p', 'blockquote', 'li']);
  const walkElements = (root: Element) => {
    for (const child of Array.from(root.children)) {
      const tag = child.tagName.toLowerCase();
      if (
        tag === 'script' ||
        tag === 'style' ||
        tag === 'nav' ||
        tag === 'aside' ||
        tag === 'footer' ||
        tag === 'form' ||
        tag === 'noscript' ||
        tag === 'iframe' ||
        tag === 'svg'
      ) {
        continue;
      }

      if (targetTags.has(tag)) {
        // Avoid double-reading paragraphs nested inside blockquote/li
        const { text, ruby } = extractTextAndRuby(child);
        if (text && !isBoilerplateLine(text)) {
          const blockType: ArticleBlockType =
            tag === 'h2'
              ? 'h2'
              : tag === 'h3' || tag === 'h4'
                ? 'h3'
                : tag === 'blockquote'
                  ? 'blockquote'
                  : tag === 'li'
                    ? 'li'
                    : 'p';
          blocks.push({ blockType, text, nativeRuby: ruby });
        }
        continue;
      }

      // Recurse into wrapper divs / sections / articles / ul / ol
      if (child.children.length > 0) {
        walkElements(child);
      } else {
        const { text, ruby } = extractTextAndRuby(child);
        if (text && text.length >= 30 && !isBoilerplateLine(text)) {
          blocks.push({ blockType: 'p', text, nativeRuby: ruby });
        }
      }
    }
  };

  if (document.body) {
    walkElements(document.body);
  }
  return blocks;
}

function extractJsonLdArticle(document: Document): {
  title?: string;
  author?: string;
  siteName?: string;
  publishedDate?: string;
  description?: string;
  articleBody?: string;
} {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of scripts) {
    try {
      const raw = s.textContent || '';
      if (!raw.trim()) continue;
      const parsed = JSON.parse(raw);
      const candidates: Array<Record<string, unknown>> = [];
      if (Array.isArray(parsed)) {
        candidates.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        candidates.push(parsed as Record<string, unknown>);
        if (Array.isArray((parsed as { '@graph'?: unknown[] })['@graph'])) {
          candidates.push(
            ...((parsed as { '@graph': Array<Record<string, unknown>> })['@graph'] || [])
          );
        }
      }
      for (const obj of candidates) {
        const typeVal = String(obj['@type'] || '');
        if (/Article|NewsArticle|BlogPosting|ReportageNewsArticle|WebPage/i.test(typeVal)) {
          const authorField = obj.author;
          let authorName = '';
          if (typeof authorField === 'string') authorName = authorField;
          else if (Array.isArray(authorField) && authorField[0]) {
            authorName =
              typeof authorField[0] === 'string'
                ? authorField[0]
                : String((authorField[0] as { name?: string }).name || '');
          } else if (authorField && typeof authorField === 'object') {
            authorName = String((authorField as { name?: string }).name || '');
          }
          const pubObj = obj.publisher as { name?: string } | undefined;
          return {
            title: typeof obj.headline === 'string' ? obj.headline : undefined,
            author: authorName || undefined,
            siteName: pubObj?.name || undefined,
            publishedDate:
              typeof obj.datePublished === 'string'
                ? obj.datePublished.slice(0, 10)
                : undefined,
            description: typeof obj.description === 'string' ? obj.description : undefined,
            articleBody: typeof obj.articleBody === 'string' ? obj.articleBody : undefined,
          };
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return {};
}

function getMetaContent(document: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const val = el?.getAttribute('content') || el?.textContent || '';
    if (val.trim()) return val.trim();
  }
  return undefined;
}

/**
 * Parses clean Markdown / plain text (used for Jina Reader fallback AND user raw paste / .txt / .md).
 */
export function parseRawArticleText(params: {
  rawText: string;
  title?: string;
  sourceUrl?: string;
  author?: string;
  siteName?: string;
  publishedDate?: string;
  extractionTier?: ExtractedArticleResult['extractionTier'];
}): ExtractedArticleResult {
  const normalized = decodeAndNormalizeText(params.rawText || '').replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');

  let inferredTitle = params.title?.trim() || '';
  let inferredDate = params.publishedDate?.trim() || '';
  const blocks: RawBlock[] = [];
  let paragraphBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return;
    const joined = cleanBlockText(paragraphBuf.join(' '));
    paragraphBuf = [];
    if (joined && !isBoilerplateLine(joined)) {
      blocks.push({ blockType: 'p', text: joined });
    }
  };

  let inMarkdownBody = false;
  for (const rawLine of rawLines) {
    const line = rawLine.trim();

    // Strip Jina Reader metadata headers cleanly
    if (!inMarkdownBody && /^Title:\s*(.+)$/i.test(line)) {
      const m = line.match(/^Title:\s*(.+)$/i);
      if (!inferredTitle && m?.[1]) inferredTitle = m[1].trim();
      continue;
    }
    if (!inMarkdownBody && /^URL Source:\s*/i.test(line)) continue;
    if (!inMarkdownBody && /^Published Time:\s*(.+)$/i.test(line)) {
      const m = line.match(/^Published Time:\s*(.+)$/i);
      if (!inferredDate && m?.[1]) inferredDate = m[1].trim().slice(0, 16);
      continue;
    }
    if (!inMarkdownBody && /^Markdown Content:\s*$/i.test(line)) {
      inMarkdownBody = true;
      continue;
    }

    if (!line) {
      flushParagraph();
      continue;
    }

    // Skip pure markdown images, horizontal rules, or bare nav link lists like "[Home](...)"
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(line)) continue;
    if (/^[-*_]{3,}$/.test(line)) continue;
    if (/^(\[[^\]]{1,30}\]\([^)]+\)\s*[|/·•]?\s*){2,}$/.test(line)) continue;
    if (/^={3,}$/.test(line)) continue;

    // Strip inline markdown links & emphasis cleanly -> keep readable text
    const stripMd = (s: string) =>
      s
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(`)(.*?)\1/g, '$2')
        .trim();

    if (/^#\s+/.test(line)) {
      flushParagraph();
      const heading = stripMd(line.replace(/^#\s+/, ''));
      if (!inferredTitle && heading) {
        inferredTitle = heading;
      } else if (heading) {
        blocks.push({ blockType: 'h2', text: heading });
      }
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushParagraph();
      const heading = stripMd(line.replace(/^##\s+/, ''));
      if (heading && !isBoilerplateLine(heading)) blocks.push({ blockType: 'h2', text: heading });
      continue;
    }
    if (/^#{3,6}\s+/.test(line)) {
      flushParagraph();
      const heading = stripMd(line.replace(/^#{3,6}\s+/, ''));
      if (heading && !isBoilerplateLine(heading)) blocks.push({ blockType: 'h3', text: heading });
      continue;
    }
    if (/^>\s*/.test(line)) {
      flushParagraph();
      const quote = stripMd(line.replace(/^>\s*/, ''));
      if (quote && !isBoilerplateLine(quote)) blocks.push({ blockType: 'blockquote', text: quote });
      continue;
    }
    if (/^([-*•]|\d+\.)\s+/.test(line)) {
      flushParagraph();
      const item = stripMd(line.replace(/^([-*•]|\d+\.)\s+/, ''));
      if (item && item.length >= 12 && !isBoilerplateLine(item)) {
        blocks.push({ blockType: 'li', text: item });
      }
      continue;
    }

    const cleanedLine = stripMd(line);
    if (cleanedLine) {
      paragraphBuf.push(cleanedLine);
    }
  }
  flushParagraph();

  const sourceUrl = params.sourceUrl || 'manual://pasted-article';
  let domain = 'Bài viết cá nhân';
  try {
    if (/^https?:\/\//i.test(sourceUrl)) {
      domain = new URL(sourceUrl).hostname.replace(/^www\./, '');
    }
  } catch {
    // keep default
  }

  if (!inferredTitle) {
    inferredTitle = blocks[0]?.text.slice(0, 90) || 'Bài viết KotoZen';
  }

  return buildStructuredArticle({
    url: sourceUrl,
    domain,
    title: inferredTitle,
    author: params.author,
    siteName: params.siteName || domain,
    publishedDate: inferredDate || undefined,
    blocks,
    extractionTier: params.extractionTier || 'raw_input',
  });
}

async function fetchJinaReaderFallback(
  targetUrl: string,
  domain: string
): Promise<ExtractedArticleResult | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    const resp = await fetch(jinaUrl, {
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Accept: 'text/plain; charset=utf-8',
        'X-Return-Format': 'markdown',
      },
      signal: AbortSignal.timeout(14_000),
    });
    if (!resp.ok) return null;
    const text = (await resp.text()).normalize('NFC');
    if (!text || text.length < 180) return null;
    if (PAYWALL_PATTERNS.some((re) => re.test(text.slice(0, 1400))) && text.length < 700) {
      return null;
    }
    const parsed = parseRawArticleText({
      rawText: text,
      sourceUrl: targetUrl,
      siteName: domain,
      extractionTier: 'jina_reader',
    });
    const totalChars = parsed.sentences.reduce((acc, s) => acc + s.text.length, 0);
    if (parsed.sentences.length < 2 || totalChars < 140) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 3-Tier Universal Web Article Extractor:
 * - Tier 1: Direct browser-emulated HTML fetch + charset auto-detect (UTF-8 / Shift_JIS / EUC-JP)
 *           + Readability + Native <ruby> preservation + JSON-LD Article fallback.
 * - Tier 2: Jina Reader clean-markdown fallback for JS-rendered SPAs or light anti-bot sites.
 * - Tier 3: Structured 'blocked_paywall' rescue response (zero crash, opens Smart Paste & File Modal).
 */
export async function extractWebArticle(rawUrl: string): Promise<ExtractedArticleResult> {
  const valid = validateWebUrl(rawUrl);
  if (!valid.ok || !valid.url) {
    throw new Error(valid.errorVi || 'Đường link không hợp lệ.');
  }

  const targetUrl = valid.url.toString();
  const domain = valid.url.hostname.replace(/^www\./, '');

  let tier1FailedReason = '';
  let detectedTitle = '';

  // --- TIER 1: Direct HTML Fetch + Multi-Charset + Readability ---
  try {
    const reqHeaders: Record<string, string> = { ...BROWSER_HEADERS };
    if (/(?:^|\.)(?:wikipedia|wikimedia|wiktionary)\.org$/i.test(domain)) {
      reqHeaders['User-Agent'] =
        'KotoZenArticleStudio/1.0 (https://kotozen.app; educational-language-reader) Mozilla/5.0';
    }
    const resp = await fetch(targetUrl, {
      headers: reqHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(13_000),
    });

    if (resp.ok) {
      const contentType = resp.headers.get('content-type') || '';
      if (/application\/pdf/i.test(contentType)) {
        return {
          status: 'blocked_paywall',
          url: targetUrl,
          domain,
          title: domain,
          sourceLanguage: 'en',
          wordCount: 0,
          estimatedReadMinutes: 1,
          paragraphs: [],
          sentences: [],
          reasonVi:
            'Đường link này là tệp PDF trực tiếp. Bạn hãy tải tệp PDF lên hoặc dán nội dung vào khung bên dưới để hệ thống phân tích 100% trọn vẹn.',
        };
      }

      const arrayBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const html = detectAndDecodeBuffer(buf, contentType);

      const looksLikeChallenge =
        html.length < 25_000 &&
        PAYWALL_PATTERNS.slice(0, 2).some((re) => re.test(html));

      if (!looksLikeChallenge && html.length > 200) {
        const { document } = parseHTML(html);

        // Set documentURI / base URL so Readability resolves relative links cleanly
        try {
          Object.defineProperty(document, 'documentURI', { value: targetUrl, configurable: true });
        } catch {
          // ignore
        }

        const jsonLd = extractJsonLdArticle(document);
        const ogTitle = getMetaContent(document, [
          'meta[property="og:title"]',
          'meta[name="twitter:title"]',
          'h1',
          'title',
        ]);
        const ogSiteName = getMetaContent(document, [
          'meta[property="og:site_name"]',
          'meta[name="application-name"]',
        ]);
        const ogDesc = getMetaContent(document, [
          'meta[property="og:description"]',
          'meta[name="description"]',
        ]);
        const metaAuthor = getMetaContent(document, [
          'meta[name="author"]',
          'meta[property="article:author"]',
        ]);
        const metaDate = getMetaContent(document, [
          'meta[property="article:published_time"]',
          'meta[name="pubdate"]',
          'meta[name="publish-date"]',
          'time[datetime]',
        ]);

        detectedTitle = jsonLd.title || ogTitle || domain;

        // Run Mozilla Readability on a clone so we preserve original document for fallback
        let readabilityBlocks: RawBlock[] = [];
        let readabilityMeta: { title?: string; byline?: string; siteName?: string; excerpt?: string } = {};
        try {
          const cloneDoc = document.cloneNode(true) as Document;
          const reader = new Readability(cloneDoc, { charThreshold: 120 });
          const parsed = reader.parse();
          if (parsed?.content) {
            readabilityMeta = {
              title: parsed.title || undefined,
              byline: parsed.byline || undefined,
              siteName: parsed.siteName || undefined,
              excerpt: parsed.excerpt || undefined,
            };
            readabilityBlocks = extractBlocksFromHtmlFragment(parsed.content);
          }
        } catch {
          // Fall through to direct DOM / JSON-LD extraction
        }

        const readabilityChars = readabilityBlocks.reduce((acc, b) => acc + b.text.length, 0);

        if (readabilityBlocks.length >= 2 && readabilityChars >= 180) {
          return buildStructuredArticle({
            url: targetUrl,
            domain,
            title: readabilityMeta.title || jsonLd.title || ogTitle || domain,
            author: readabilityMeta.byline || jsonLd.author || metaAuthor,
            siteName: readabilityMeta.siteName || jsonLd.siteName || ogSiteName || domain,
            publishedDate: (jsonLd.publishedDate || metaDate || '').slice(0, 10) || undefined,
            lead: ogDesc || jsonLd.description || readabilityMeta.excerpt,
            blocks: readabilityBlocks,
            extractionTier: 'readability_direct',
          });
        }

        // Direct semantic container fallback (<article>, <main>, Wikipedia #mw-content-text, NHK #js-article-body)
        const mainEl =
          document.querySelector('#js-article-body') ||
          document.querySelector('#mw-content-text .mw-parser-output') ||
          document.querySelector('article') ||
          document.querySelector('[role="main"]') ||
          document.querySelector('main');
        if (mainEl) {
          const directBlocks = extractBlocksFromHtmlFragment(mainEl.innerHTML);
          const directChars = directBlocks.reduce((acc, b) => acc + b.text.length, 0);
          if (directBlocks.length >= 2 && directChars >= 180) {
            return buildStructuredArticle({
              url: targetUrl,
              domain,
              title: jsonLd.title || ogTitle || domain,
              author: jsonLd.author || metaAuthor,
              siteName: jsonLd.siteName || ogSiteName || domain,
              publishedDate: (jsonLd.publishedDate || metaDate || '').slice(0, 10) || undefined,
              lead: ogDesc || jsonLd.description,
              blocks: directBlocks,
              extractionTier: 'readability_direct',
            });
          }
        }

        // JSON-LD articleBody fallback
        if (jsonLd.articleBody && jsonLd.articleBody.length >= 180) {
          const jsonBlocks: RawBlock[] = jsonLd.articleBody
            .split(/\n{2,}|\r\n\r\n/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((text) => ({ blockType: 'p' as const, text }));
          if (jsonBlocks.length > 0) {
            return buildStructuredArticle({
              url: targetUrl,
              domain,
              title: jsonLd.title || ogTitle || domain,
              author: jsonLd.author || metaAuthor,
              siteName: jsonLd.siteName || ogSiteName || domain,
              publishedDate: jsonLd.publishedDate,
              lead: jsonLd.description || ogDesc,
              blocks: jsonBlocks,
              extractionTier: 'jsonld_fallback',
            });
          }
        }
      }
    } else {
      tier1FailedReason = `HTTP ${resp.status}`;
    }
  } catch (err) {
    tier1FailedReason = err instanceof Error ? err.message : 'fetch_failed';
  }

  // --- TIER 2: Jina Reader Clean-Markdown Fallback (JS-rendered / Anti-bot sites) ---
  const tier2 = await fetchJinaReaderFallback(targetUrl, domain);
  if (tier2) {
    return tier2;
  }

  // --- TIER 3: Zero-Dead-End Paywall / Cloudflare Rescue ---
  return deepNormalizeUtf8({
    status: 'blocked_paywall',
    url: targetUrl,
    domain,
    title: detectedTitle || domain,
    sourceLanguage: 'en',
    wordCount: 0,
    estimatedReadMinutes: 1,
    paragraphs: [],
    sentences: [],
    reasonVi: tier1FailedReason.includes('403') || tier1FailedReason.includes('429')
      ? `Trang ${domain} đang bật tường lửa chống bot hoặc yêu cầu đăng nhập tài khoản trả phí (Paywall).`
      : `Trang ${domain} không cho phép trích xuất tự động (Paywall / nội dung bảo vệ).`,
  });
}
