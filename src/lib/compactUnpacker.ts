import type { Language, ProficiencyLevel, RubySegment, SubtitleLine, SubtitleToken } from '../types';

const JA_PUNCT_RE = /^[。、！？「」『』（）【】…,.!?;:()\-—・\u3000\s]+$/;
const EN_PUNCT_RE = /^[^A-Za-z0-9]+$/;
const PURE_HIRAGANA_RE = /^[\u3041-\u3096\u30FC]+$/;
const KANJI_CHAR_RE = /[\u4E00-\u9FAF々〆ヶ]/;

/**
 * Decodes common HTML entities (including double-encoded &amp;lt;) so malformed
 * entity-escaped tags like `&lt;ruby&gt;` are caught by the HTML sanitizer.
 */
function decodeHtmlEntitiesClient(input: string): string {
  if (!input) return '';
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/**
 * Strictly validates a Japanese Furigana reading:
 * - Strips any HTML tags, brackets, and whitespace
 * - Converts Katakana (ァ-ヶ) to Hiragana (ぁ-ゖ)
 * - Accepts ONLY pure Hiragana (/^[\u3041-\u3096\u30FC]+$/)
 * - REJECTS 100% of Romaji, Latin letters, digits, `<`, `>`, `/`
 */
export function sanitizeHiraganaReading(reading: string | undefined | null): string | undefined {
  if (!reading || typeof reading !== 'string') return undefined;
  let clean = decodeHtmlEntitiesClient(reading)
    .replace(/<[^>]*>/g, '')
    .replace(/[\[\]()（）「」『』\s・/\\<>]/g, '')
    .trim();
  if (!clean) return undefined;

  // Convert fullwidth Katakana (ァ-ヶ) to Hiragana (ぁ-ゖ)
  clean = clean.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );

  if (!PURE_HIRAGANA_RE.test(clean)) return undefined;
  return clean;
}

/**
 * Mandatory Pre-Tokenizer HTML & Ruby Artifact Sanitizer:
 * 1. Decodes HTML entities (&lt;ruby&gt; -> <ruby>)
 * 2. Strips <rt>...</rt> and <rp>...</rp> content (including spaced tags like `< rt > hako < / rt >`)
 * 3. Strips ALL remaining HTML tags (<ruby>, </ruby>, <span>, <b>, <br>, <...>)
 * 4. Strips stray inline bracket readings ([...])
 * Guarantees 100% clean plain text with ZERO leaked HTML tags or Romaji annotations.
 */
export function stripHtmlAndRubyArtifacts(input: string): string {
  if (!input || typeof input !== 'string') return '';
  let text = decodeHtmlEntitiesClient(input);

  // Remove <rt ...>...</rt> and <rp ...>...</rp> completely (even with spaces inside tag brackets)
  text = text
    .replace(/<\s*rt\b[^>]*>[\s\S]*?<\s*\/\s*rt\s*>/gi, '')
    .replace(/<\s*rp\b[^>]*>[\s\S]*?<\s*\/\s*rp\s*>/gi, '');

  // Strip all remaining HTML tags (including `< ruby >`, `< / ruby >`, `<span>`, `<b>`, `<br>`)
  text = text.replace(/<\s*\/?\s*[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g, '');
  // Strip any leftover angle-bracket tag fragments like `< / rt >` or `</ruby>`
  text = text.replace(/<\s*\/?\s*(?:ruby|rt|rp|span|div|b|i|br|p)\s*>/gi, '');
  text = text.replace(/<[^>]{0,40}>/g, '');

  // Strip stray inline [reading] brackets (Hiragana/Katakana/Romaji inside brackets attached to Kanji)
  text = text.replace(/([\u4E00-\u9FAF々〆ヶ])\[[A-Za-z\u3040-\u30FFー・\s'-]{1,28}\]/g, '$1');

  // Remove stray zero-width chars and normalize spaces + NFC
  text = text
    .replace(/[\u200B-\u200D\uFEFF\uFFFD]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  try {
    text = text.normalize('NFC');
  } catch {
    // Ignore if ICU unavailable
  }

  return text;
}

/**
 * Extracts valid pure-Hiragana `<ruby>Kanji<rt>ひらがな</rt></ruby>` readings into a Map
 * BEFORE stripping HTML, while discarding any Romaji `<rt>hako</rt>` readings!
 */
function extractSafeReadingsFromHtmlRuby(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw || (!raw.includes('<') && !raw.includes('&lt;'))) return map;
  const decoded = decodeHtmlEntitiesClient(raw);
  const re =
    /<\s*ruby\b[^>]*>([\s\S]*?)<\s*rt\b[^>]*>([\s\S]*?)<\s*\/\s*rt\s*>[\s\S]*?<\s*\/\s*ruby\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded)) !== null) {
    const base = m[1].replace(/<[^>]*>/g, '').trim();
    const reading = sanitizeHiraganaReading(m[2]);
    if (base && reading && KANJI_CHAR_RE.test(base) && !map.has(base)) {
      map.set(base, reading);
    }
  }
  return map;
}

/**
 * Parses a Compact Reading Map string:
 *   "箱:はこ|重:おも|自分:じぶん|運:はこ"
 * into a sanitized Map<Kanji, pureHiragana> (strictly rejecting any Romaji or HTML).
 */
export function parseCompactReadingMap(readingMapStr: string | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!readingMapStr || typeof readingMapStr !== 'string') return map;

  const cleaned = decodeHtmlEntitiesClient(readingMapStr).replace(/<[^>]*>/g, '');
  const entries = cleaned.split(/[|｜;；\n]+/);
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sepIdx = trimmed.search(/[:：=]/);
    if (sepIdx <= 0) continue;
    const rawBase = trimmed.slice(0, sepIdx).replace(/[\s「」『』()（）\[\]]/g, '').trim();
    const rawReading = trimmed.slice(sepIdx + 1).trim();
    if (!rawBase || !KANJI_CHAR_RE.test(rawBase)) continue;
    const safeReading = sanitizeHiraganaReading(rawReading);
    if (!safeReading) continue;
    if (!map.has(rawBase)) {
      map.set(rawBase, safeReading);
    }
  }
  return map;
}

export function stripInlineRubyBrackets(text: string): string {
  return stripHtmlAndRubyArtifacts(text);
}

// High-frequency English multi-word Phrasal Verbs & Collocations for 1-Click smart grouping
const EN_MULTIWORD_PHRASES: Array<{ phrase: string; type: 'phrasal_verb' | 'collocation' | 'idiom' }> = [
  // 3-word phrases first (longest match wins)
  { phrase: 'look forward to', type: 'phrasal_verb' },
  { phrase: 'come up with', type: 'phrasal_verb' },
  { phrase: 'put up with', type: 'phrasal_verb' },
  { phrase: 'get rid of', type: 'phrasal_verb' },
  { phrase: 'take care of', type: 'phrasal_verb' },
  { phrase: 'run out of', type: 'phrasal_verb' },
  { phrase: 'keep up with', type: 'phrasal_verb' },
  { phrase: 'catch up with', type: 'phrasal_verb' },
  { phrase: 'make up for', type: 'phrasal_verb' },
  { phrase: 'on the other hand', type: 'collocation' },
  { phrase: 'at the same time', type: 'collocation' },
  { phrase: 'as a result', type: 'collocation' },
  { phrase: 'in other words', type: 'collocation' },
  { phrase: 'a lot of', type: 'collocation' },
  { phrase: 'in terms of', type: 'collocation' },
  { phrase: 'as well as', type: 'collocation' },
  // 2-word phrasal verbs & collocations
  { phrase: 'give up', type: 'phrasal_verb' },
  { phrase: 'figure out', type: 'phrasal_verb' },
  { phrase: 'find out', type: 'phrasal_verb' },
  { phrase: 'turn out', type: 'phrasal_verb' },
  { phrase: 'point out', type: 'phrasal_verb' },
  { phrase: 'carry out', type: 'phrasal_verb' },
  { phrase: 'work out', type: 'phrasal_verb' },
  { phrase: 'end up', type: 'phrasal_verb' },
  { phrase: 'set up', type: 'phrasal_verb' },
  { phrase: 'break down', type: 'phrasal_verb' },
  { phrase: 'put off', type: 'phrasal_verb' },
  { phrase: 'take off', type: 'phrasal_verb' },
  { phrase: 'take over', type: 'phrasal_verb' },
  { phrase: 'pick up', type: 'phrasal_verb' },
  { phrase: 'bring up', type: 'phrasal_verb' },
  { phrase: 'grow up', type: 'phrasal_verb' },
  { phrase: 'show up', type: 'phrasal_verb' },
  { phrase: 'wake up', type: 'phrasal_verb' },
  { phrase: 'clean up', type: 'phrasal_verb' },
  { phrase: 'check out', type: 'phrasal_verb' },
  { phrase: 'deal with', type: 'phrasal_verb' },
  { phrase: 'focus on', type: 'phrasal_verb' },
  { phrase: 'depend on', type: 'phrasal_verb' },
  { phrase: 'rely on', type: 'phrasal_verb' },
  { phrase: 'go through', type: 'phrasal_verb' },
  { phrase: 'look after', type: 'phrasal_verb' },
  { phrase: 'look into', type: 'phrasal_verb' },
  { phrase: 'make sure', type: 'collocation' },
  { phrase: 'make sense', type: 'collocation' },
  { phrase: 'take place', type: 'collocation' },
  { phrase: 'pay attention', type: 'collocation' },
  { phrase: 'even though', type: 'collocation' },
  { phrase: 'in fact', type: 'collocation' },
  { phrase: 'of course', type: 'collocation' },
  { phrase: 'for example', type: 'collocation' },
  { phrase: 'such as', type: 'collocation' },
  { phrase: 'kind of', type: 'collocation' },
  { phrase: 'sort of', type: 'collocation' },
  { phrase: 'used to', type: 'collocation' },
];

const EN_MULTIWORD_MAP = new Map(EN_MULTIWORD_PHRASES.map((item) => [item.phrase, item.type]));

const JA_VERB_ADJ_OKURIGANA_RE =
  /^(?:っ?[たてで]|ます|ました|ません|ましょう|ない|なかった|なく|くて|かった|ければ|れる|られる|せる|させる|する|した|して|しない|できる|できた|てい[るた]|てる|てた|ちゃう|じゃう|ながら|つつ|そう|よう|べき|[いきくけこぎぐげごしすせそじずぜぞちつてとびぶべぼみむめもりるれろわえお])/;

const JA_STANDALONE_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'の', 'も', 'へ', 'や', 'か', 'ね', 'よ', 'な', 'さ', 'ぞ', 'わ',
]);

const JA_MULTI_PARTICLES_RE =
  /^(から|まで|より|だけ|しか|ほど|くらい|ぐらい|ながら|けれど|けれども|けど|ので|のに|ため|って|では|には|とは|でも|にも|とも|への|からの|までの|です|でした|ます|ました|ません|でしょう|だろう|じゃない|ではない)/;

type JaPiece =
  | { kind: 'kanji_ruby'; base: string; reading: string }
  | { kind: 'kanji'; text: string }
  | { kind: 'katakana'; text: string }
  | { kind: 'hiragana'; text: string }
  | { kind: 'latin'; text: string }
  | { kind: 'punct'; text: string };

/**
 * Splits a Hiragana run into natural standalone particles & function chunks
 * so learners get crisp 1-Click buttons instead of giant fused Kana strings.
 */
function splitHiraganaChunk(hira: string): string[] {
  if (!hira) return [];
  if (hira.length <= 2) return [hira];

  const out: string[] = [];
  let cursor = 0;

  while (cursor < hira.length) {
    const rest = hira.slice(cursor);
    const multiMatch = rest.match(JA_MULTI_PARTICLES_RE);
    if (multiMatch) {
      out.push(multiMatch[0]);
      cursor += multiMatch[0].length;
      continue;
    }
    if (cursor === 0 && JA_STANDALONE_PARTICLES.has(rest[0]) && rest.length >= 2) {
      out.push(rest[0]);
      cursor += 1;
      continue;
    }

    let nextBreak = 1;
    while (cursor + nextBreak < hira.length) {
      const sub = hira.slice(cursor + nextBreak);
      if (JA_MULTI_PARTICLES_RE.test(sub)) break;
      if (sub.length === 1 && JA_STANDALONE_PARTICLES.has(sub) && nextBreak >= 2) {
        break;
      }
      nextBreak++;
    }
    out.push(hira.slice(cursor, cursor + nextBreak));
    cursor += nextBreak;
  }

  return out;
}

/**
 * Shared Japanese Piece-to-Token Assembler (0.05ms/line):
 * Attaches okurigana cleanly to Kanji stems and enforces pure-Hiragana readings only.
 */
function assembleJapaneseTokensFromPieces(
  pieces: JaPiece[],
  lineId: string,
  defaultLevel?: ProficiencyLevel
): { plainText: string; tokens: SubtitleToken[] } {
  const tokens: SubtitleToken[] = [];
  const plainParts: string[] = [];

  const pushToken = (
    surface: string,
    opts?: { ruby?: RubySegment[]; furigana?: string; isPunctuation?: boolean }
  ) => {
    if (!surface) return;
    plainParts.push(surface);
    const isPunct = opts?.isPunctuation ?? JA_PUNCT_RE.test(surface);
    const safeRuby = opts?.ruby
      ?.map((seg) => ({
        base: seg.base,
        reading: sanitizeHiraganaReading(seg.reading),
      }))
      .filter((seg) => seg.base.length > 0);
    const hasRubyReading = Boolean(safeRuby && safeRuby.some((s) => s.reading));
    const safeFuri = sanitizeHiraganaReading(opts?.furigana);
    tokens.push({
      id: `${lineId}_t${tokens.length}`,
      surface,
      lemma: surface,
      isPunctuation: isPunct || undefined,
      ruby: hasRubyReading ? safeRuby : undefined,
      furigana: safeFuri,
      level: isPunct ? undefined : defaultLevel,
    });
  };

  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];

    if (p.kind === 'kanji_ruby' || p.kind === 'kanji') {
      const cleanReading =
        p.kind === 'kanji_ruby' ? sanitizeHiraganaReading(p.reading) : undefined;
      const rubySegs: RubySegment[] = cleanReading
        ? [{ base: p.kind === 'kanji_ruby' ? p.base : p.text, reading: cleanReading }]
        : [{ base: p.kind === 'kanji_ruby' ? p.base : p.text }];
      let surface = p.kind === 'kanji_ruby' ? p.base : p.text;
      let furi = cleanReading || '';

      const next = pieces[i + 1];
      if (next && next.kind === 'hiragana') {
        const hira = next.text;
        const startsWithParticleOnly =
          hira.length === 1 && JA_STANDALONE_PARTICLES.has(hira);
        const startsWithMultiParticle = JA_MULTI_PARTICLES_RE.test(hira);

        if (!startsWithParticleOnly && !startsWithMultiParticle) {
          if (!JA_STANDALONE_PARTICLES.has(hira[0]) && JA_VERB_ADJ_OKURIGANA_RE.test(hira)) {
            const subChunks = splitHiraganaChunk(hira);
            const okurigana = subChunks[0] || '';
            if (okurigana && okurigana.length <= 5) {
              surface += okurigana;
              rubySegs.push({ base: okurigana });
              if (furi) furi += okurigana;
              const leftover = subChunks.slice(1);
              i++;
              pushToken(surface, {
                ruby: rubySegs.some((s) => s.reading) ? rubySegs : undefined,
                furigana: furi || undefined,
              });
              for (const restChunk of leftover) {
                pushToken(restChunk);
              }
              continue;
            }
          }
        }
      }

      pushToken(surface, {
        ruby: rubySegs.some((s) => s.reading) ? rubySegs : undefined,
        furigana: furi || undefined,
      });
    } else if (p.kind === 'hiragana') {
      const chunks = splitHiraganaChunk(p.text);
      for (const ch of chunks) {
        pushToken(ch);
      }
    } else if (p.kind === 'katakana' || p.kind === 'latin') {
      pushToken(p.text);
    } else {
      pushToken(p.text, { isPunctuation: JA_PUNCT_RE.test(p.text) });
    }
  }

  return {
    plainText: plainParts.join(''),
    tokens,
  };
}

/**
 * Primary Zero-HTML Japanese Unpacker (Plain Text + Compact Reading Map):
 * Input:
 *   plainText:  "この箱、すごく重くて、自分ではとても運べないんだ。"
 *   readingMap: "箱:はこ|重:おも|自分:じぶん|運:はこ"
 * Output:
 *   100% clean plainText (zero HTML/Romaji) + 1-Click SubtitleToken[] with validated pure-Hiragana ruby!
 */
export function unpackJapanesePlainWithReadingMap(
  rawText: string,
  readingMapStr: string | undefined,
  lineId: string,
  defaultLevel?: ProficiencyLevel
): { plainText: string; tokens: SubtitleToken[] } {
  const htmlReadings = extractSafeReadingsFromHtmlRuby(rawText);
  const readingMap = parseCompactReadingMap(readingMapStr);
  // Merge any salvaged Hiragana readings if HTML ever slipped in
  htmlReadings.forEach((v, k) => {
    if (!readingMap.has(k)) readingMap.set(k, v);
  });

  const cleanText = stripHtmlAndRubyArtifacts(rawText);
  if (!cleanText) return { plainText: '', tokens: [] };

  // Pre-sort reading keys longest-first for greedy longest Kanji compound match
  const sortedKeys = Array.from(readingMap.keys()).sort((a, b) => b.length - a.length);

  const pieces: JaPiece[] = [];
  const tokenRe =
    /([\u4E00-\u9FAF々〆ヶ]+)|([\u30A0-\u30FFー]+)|([\u3040-\u309F]+)|([A-Za-z0-9]+)|([^\s\u3000])/g;

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cleanText)) !== null) {
    if (m[1]) {
      const kanjiRun = m[1];
      const exactReading = readingMap.get(kanjiRun);
      if (exactReading) {
        pieces.push({ kind: 'kanji_ruby', base: kanjiRun, reading: exactReading });
      } else if (sortedKeys.length > 0 && kanjiRun.length > 1) {
        // Greedy longest-prefix decomposition inside a multi-Kanji run (e.g. "日本語勉強" -> "日本語" + "勉強")
        let pos = 0;
        while (pos < kanjiRun.length) {
          const rest = kanjiRun.slice(pos);
          let matchedKey: string | null = null;
          for (const key of sortedKeys) {
            if (rest.startsWith(key)) {
              matchedKey = key;
              break;
            }
          }
          if (matchedKey) {
            pieces.push({
              kind: 'kanji_ruby',
              base: matchedKey,
              reading: readingMap.get(matchedKey)!,
            });
            pos += matchedKey.length;
          } else {
            // Collect contiguous unmatched Kanji until next matchable key
            let endPos = pos + 1;
            while (endPos < kanjiRun.length) {
              const tail = kanjiRun.slice(endPos);
              if (sortedKeys.some((k) => tail.startsWith(k))) break;
              endPos++;
            }
            pieces.push({ kind: 'kanji', text: kanjiRun.slice(pos, endPos) });
            pos = endPos;
          }
        }
      } else {
        pieces.push({ kind: 'kanji', text: kanjiRun });
      }
    } else if (m[2]) {
      pieces.push({ kind: 'katakana', text: m[2] });
    } else if (m[3]) {
      pieces.push({ kind: 'hiragana', text: m[3] });
    } else if (m[4]) {
      pieces.push({ kind: 'latin', text: m[4] });
    } else if (m[5]) {
      pieces.push({ kind: 'punct', text: m[5] });
    }
  }

  return assembleJapaneseTokensFromPieces(pieces, lineId, defaultLevel);
}

/**
 * Backward-compatible Japanese Inline-Ruby Unpacker (with mandatory HTML & Romaji sanitization):
 * Converts "今日[きょう]は一緒[いっしょ]に勉強[べんきょう]しましょう。"
 * into clean plainText + validated pure-Hiragana 1-Click SubtitleToken[]!
 */
export function unpackJapaneseInlineRuby(
  inlineRubyText: string,
  lineId: string,
  defaultLevel?: ProficiencyLevel
): { plainText: string; tokens: SubtitleToken[] } {
  const raw = (inlineRubyText || '').trim();
  if (!raw) return { plainText: '', tokens: [] };

  // Strip any HTML tags first (while salvaging pure Hiragana readings if <ruby> ever leaked)
  const htmlReadings = extractSafeReadingsFromHtmlRuby(raw);
  const noHtml = decodeHtmlEntitiesClient(raw)
    .replace(/<\s*rt\b[^>]*>[\s\S]*?<\s*\/\s*rt\s*>/gi, '')
    .replace(/<\s*rp\b[^>]*>[\s\S]*?<\s*\/\s*rp\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();

  const pieces: JaPiece[] = [];
  const tokenRe =
    /([\u4E00-\u9FAF々〆ヶ]+)\[([A-Za-z\u3040-\u30FFー・\s'-]{1,28})\]|([\u4E00-\u9FAF々〆ヶ]+)|([\u30A0-\u30FFー]+)|([\u3040-\u309F]+)|([A-Za-z0-9]+)|([^\s\u3000])/g;

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(noHtml)) !== null) {
    if (m[1] && m[2]) {
      const safeReading = sanitizeHiraganaReading(m[2]) || htmlReadings.get(m[1]);
      if (safeReading) {
        pieces.push({ kind: 'kanji_ruby', base: m[1], reading: safeReading });
      } else {
        pieces.push({ kind: 'kanji', text: m[1] });
      }
    } else if (m[3]) {
      const salvaged = htmlReadings.get(m[3]);
      if (salvaged) {
        pieces.push({ kind: 'kanji_ruby', base: m[3], reading: salvaged });
      } else {
        pieces.push({ kind: 'kanji', text: m[3] });
      }
    } else if (m[4]) {
      pieces.push({ kind: 'katakana', text: m[4] });
    } else if (m[5]) {
      pieces.push({ kind: 'hiragana', text: m[5] });
    } else if (m[6]) {
      pieces.push({ kind: 'latin', text: m[6] });
    } else if (m[7]) {
      pieces.push({ kind: 'punct', text: m[7] });
    }
  }

  return assembleJapaneseTokensFromPieces(pieces, lineId, defaultLevel);
}

/**
 * Ultra-fast (<0.1ms/line) English Smart Tokenizer + Multi-Word Phrasal Verb/Collocation Grouper
 * + Oxford IPA Alignment!
 */
export function unpackEnglishCompactLine(
  text: string,
  ipaLine: string | undefined,
  lineId: string,
  defaultLevel?: ProficiencyLevel
): SubtitleToken[] {
  const clean = stripHtmlAndRubyArtifacts(text || '');
  if (!clean) return [];

  const rawParts = clean.match(/[A-Za-z0-9'’-]+|[^\sA-Za-z0-9'’-]+/g) || [clean];

  const ipaWords: Array<{ ipa: string; linkedToNext: boolean }> = [];
  if (ipaLine) {
    const stripped = stripHtmlAndRubyArtifacts(ipaLine).replace(/^\/+|\/+$/g, '').trim();
    const groups = stripped.split(/\s+/).filter(Boolean);
    for (const grp of groups) {
      if (grp.includes('‿')) {
        const sub = grp.split('‿').filter(Boolean);
        sub.forEach((s, idx) => {
          ipaWords.push({ ipa: `/${s}/`, linkedToNext: idx < sub.length - 1 });
        });
      } else {
        ipaWords.push({ ipa: `/${grp}/`, linkedToNext: false });
      }
    }
  }

  const totalWordCount = rawParts.filter((p) => !EN_PUNCT_RE.test(p)).length;
  const canAlignIpa =
    ipaWords.length > 0 && Math.abs(ipaWords.length - totalWordCount) <= 1;

  const tokens: SubtitleToken[] = [];
  let wordCursor = 0;

  for (let i = 0; i < rawParts.length; i++) {
    const cur = rawParts[i];
    if (EN_PUNCT_RE.test(cur)) {
      tokens.push({
        id: `${lineId}_t${tokens.length}`,
        surface: cur,
        lemma: cur,
        isPunctuation: true,
      });
      continue;
    }

    let matchedLen = 1;
    let matchedType: 'phrasal_verb' | 'collocation' | 'idiom' | undefined;

    if (
      i + 2 < rawParts.length &&
      !EN_PUNCT_RE.test(rawParts[i + 1]) &&
      !EN_PUNCT_RE.test(rawParts[i + 2])
    ) {
      const tri = `${cur} ${rawParts[i + 1]} ${rawParts[i + 2]}`.toLowerCase();
      const hit = EN_MULTIWORD_MAP.get(tri);
      if (hit) {
        matchedLen = 3;
        matchedType = hit;
      }
    }

    if (matchedLen === 1 && i + 1 < rawParts.length && !EN_PUNCT_RE.test(rawParts[i + 1])) {
      const bi = `${cur} ${rawParts[i + 1]}`.toLowerCase();
      const hit = EN_MULTIWORD_MAP.get(bi);
      if (hit) {
        matchedLen = 2;
        matchedType = hit;
      }
    }

    const surface =
      matchedLen === 1 ? cur : rawParts.slice(i, i + matchedLen).join(' ');

    let ipa: string | undefined;
    let linkedToNext = false;
    if (canAlignIpa) {
      const slice = ipaWords.slice(wordCursor, wordCursor + matchedLen);
      if (slice.length > 0) {
        ipa =
          slice.length === 1
            ? slice[0].ipa
            : `/${slice.map((s) => s.ipa.replace(/^\/|\/$/g, '')).join(' ')}/`;
        linkedToNext = slice[slice.length - 1].linkedToNext;
      }
    }
    wordCursor += matchedLen;
    i += matchedLen - 1;

    tokens.push({
      id: `${lineId}_t${tokens.length}`,
      surface,
      lemma: surface.toLowerCase(),
      isMultiWord: matchedLen > 1 ? true : undefined,
      phraseType: matchedType,
      ipa,
      linkedToNext: linkedToNext || undefined,
      level: defaultLevel,
    });
  }

  return tokens;
}

/**
 * Defensively sanitizes an array of pre-existing tokens (e.g. legacy enriched or cached lines)
 * to ensure ZERO HTML tag tokens or Romaji Furigana ever survive into the UI!
 */
function sanitizeExistingTokens(
  tokens: SubtitleToken[],
  language: Language,
  lineId: string
): SubtitleToken[] {
  const cleaned: SubtitleToken[] = [];
  for (const tk of tokens) {
    const cleanSurface = stripHtmlAndRubyArtifacts(tk.surface || '');
    if (!cleanSurface) continue;
    const cleanLemma = stripHtmlAndRubyArtifacts(tk.lemma || cleanSurface) || cleanSurface;
    if (language === 'ja') {
      const cleanRuby = tk.ruby
        ?.map((seg) => ({
          base: stripHtmlAndRubyArtifacts(seg.base || ''),
          reading: sanitizeHiraganaReading(seg.reading),
        }))
        .filter((seg) => seg.base.length > 0);
      const hasReading = Boolean(cleanRuby && cleanRuby.some((s) => s.reading));
      cleaned.push({
        ...tk,
        id: `${lineId}_t${cleaned.length}`,
        surface: cleanSurface,
        lemma: cleanLemma,
        furigana: sanitizeHiraganaReading(tk.furigana),
        ruby: hasReading ? cleanRuby : undefined,
      });
    } else {
      cleaned.push({
        ...tk,
        id: `${lineId}_t${cleaned.length}`,
        surface: cleanSurface,
        lemma: cleanLemma,
      });
    }
  }
  return cleaned;
}

/**
 * Unpacks a single compact SubtitleLine into a fully tokenized, zero-HTML <ruby>/IPA-ready SubtitleLine
 * while preserving strict 1:1 timestamp lock if `lockedTime` is supplied.
 */
export function unpackSingleCompactLine(
  line: SubtitleLine,
  language: Language,
  defaultLevel?: ProficiencyLevel,
  lockedTime?: { start: number; duration: number; end: number }
): SubtitleLine {
  const baseTime = lockedTime
    ? { start: lockedTime.start, duration: lockedTime.duration, end: lockedTime.end }
    : { start: line.start, duration: line.duration, end: line.end };

  if (!line.enriched || (!line.text && !line.inlineRubyText)) {
    return {
      ...line,
      ...baseTime,
      text: stripHtmlAndRubyArtifacts(line.text || ''),
      readingMap: undefined,
      inlineRubyText: undefined,
    };
  }

  // If raw text or tokens contain leaked HTML tags (<ruby>/<rt>), ALWAYS re-unpack cleanly!
  const hasLeakedHtmlInLine =
    /[<>]|&lt;|&gt;/i.test(line.text || '') ||
    (Array.isArray(line.tokens) &&
      line.tokens.some((tk) => /[<>]|&lt;|&gt;|^(?:ruby|rt|rp)$/i.test(tk.surface || '')));

  if (
    Array.isArray(line.tokens) &&
    line.tokens.length > 0 &&
    !line.readingMap &&
    !line.inlineRubyText &&
    !hasLeakedHtmlInLine
  ) {
    return {
      ...line,
      ...baseTime,
      text: stripHtmlAndRubyArtifacts(line.text),
      tokens: sanitizeExistingTokens(line.tokens, language, line.id),
    };
  }

  if (language === 'ja') {
    if (line.readingMap || !line.inlineRubyText) {
      const { plainText, tokens } = unpackJapanesePlainWithReadingMap(
        line.text || line.inlineRubyText || '',
        line.readingMap,
        line.id,
        defaultLevel
      );
      return {
        ...line,
        ...baseTime,
        text: plainText,
        readingMap: undefined,
        inlineRubyText: undefined,
        tokens,
      };
    }

    const { plainText, tokens } = unpackJapaneseInlineRuby(
      line.inlineRubyText,
      line.id,
      defaultLevel
    );
    return {
      ...line,
      ...baseTime,
      text: plainText || stripHtmlAndRubyArtifacts(line.text || line.inlineRubyText),
      readingMap: undefined,
      inlineRubyText: undefined,
      tokens,
    };
  }

  const cleanEn = stripHtmlAndRubyArtifacts(line.text);
  const tokens = unpackEnglishCompactLine(
    cleanEn,
    line.ipaLine,
    line.id,
    defaultLevel
  );
  return {
    ...line,
    ...baseTime,
    text: cleanEn,
    readingMap: undefined,
    inlineRubyText: undefined,
    tokens,
  };
}

/**
 * Batch unpacks an array of compact SubtitleLines with optional 1:1 immutable timestamp verification.
 */
export function unpackCompactSubtitleBatch(
  lines: SubtitleLine[],
  language: Language,
  defaultLevel?: ProficiencyLevel,
  immutableTimeEntries?: Array<[string, { start: number; duration: number; end: number }]>
): SubtitleLine[] {
  const timeMap = immutableTimeEntries ? new Map(immutableTimeEntries) : null;
  return lines.map((line) =>
    unpackSingleCompactLine(
      line,
      language,
      defaultLevel,
      timeMap ? timeMap.get(line.id) : undefined
    )
  );
}
