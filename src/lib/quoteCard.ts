import type { Language, SubtitleLine } from '../types';
import { formatTime } from './youtube';

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const isCjk = /[\u3040-\u30FF\u4E00-\u9FAF]/.test(text);
  const units = isCjk ? Array.from(text) : text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const u of units) {
    const test = current ? (isCjk ? `${current}${u}` : `${current} ${u}`) : u;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = u;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Feature 18: Renders a crisp 2x Retina Zen Visual Quote Card (.png)
 * with blurred scene atmosphere, source quote (with Furigana/IPA line),
 * Vietnamese contextual meaning, grammar insight, and exact timestamp anchor.
 */
export async function downloadVisualQuoteCard(params: {
  line: SubtitleLine;
  language: Language;
  videoTitle: string;
  grammarNote?: string;
  theme: 'washi' | 'dark' | 'sepia';
}): Promise<void> {
  const { line, language, videoTitle, grammarNote, theme } = params;

  const width = 1200;
  const height = 675;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. Atmospheric Zen Backdrop (clean gradient inspired by chosen eye-care theme)
  const grad = ctx.createLinearGradient(0, 0, width, height);
  if (theme === 'dark') {
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(0.55, '#1E1B4B');
    grad.addColorStop(1, '#0B1120');
  } else if (theme === 'sepia') {
    grad.addColorStop(0, '#F5ECDA');
    grad.addColorStop(0.55, '#EFE2C8');
    grad.addColorStop(1, '#E6D4B5');
  } else {
    grad.addColorStop(0, '#F8FAFC');
    grad.addColorStop(0.5, '#EEF2FF');
    grad.addColorStop(1, '#F1F5F9');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle ambient circle glow
  ctx.save();
  ctx.globalAlpha = theme === 'dark' ? 0.16 : 0.12;
  ctx.fillStyle = theme === 'sepia' ? '#B45309' : '#4F46E5';
  ctx.beginPath();
  ctx.arc(width - 140, 110, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Inner Zen Frame
  const pad = 64;
  ctx.fillStyle =
    theme === 'dark'
      ? 'rgba(15, 23, 42, 0.78)'
      : theme === 'sepia'
        ? 'rgba(250, 244, 232, 0.88)'
        : 'rgba(255, 255, 255, 0.88)';
  ctx.strokeStyle =
    theme === 'dark'
      ? 'rgba(148, 163, 184, 0.22)'
      : theme === 'sepia'
        ? 'rgba(180, 148, 108, 0.35)'
        : 'rgba(99, 102, 241, 0.18)';
  ctx.lineWidth = 2;

  const r = 24;
  const x = pad;
  const y = pad;
  const w = width - pad * 2;
  const h = height - pad * 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();

  const inkPrimary = theme === 'dark' ? '#F8FAFC' : theme === 'sepia' ? '#2C2219' : '#0F172A';
  const inkSecondary = theme === 'dark' ? '#CBD5E1' : theme === 'sepia' ? '#5C4936' : '#475569';
  const inkAccent = theme === 'dark' ? '#818CF8' : theme === 'sepia' ? '#9A3412' : '#4F46E5';

  // Header metadata
  ctx.fillStyle = inkAccent;
  ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('KotoZen · Thẻ Trích Dẫn Học Tập', x + 48, y + 58);

  ctx.fillStyle = inkSecondary;
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  const metaRight = `${language === 'ja' ? '日本語' : 'English'} · ${formatTime(line.start)}`;
  const metaWidth = ctx.measureText(metaRight).width;
  ctx.fillText(metaRight, x + w - 48 - metaWidth, y + 58);

  // Source Quote
  let cursorY = y + 148;
  ctx.fillStyle = inkPrimary;
  ctx.font =
    language === 'ja'
      ? '700 38px "Noto Sans JP", "Plus Jakarta Sans", sans-serif'
      : '700 36px "Plus Jakarta Sans", sans-serif';

  const sourceLines = wrapCanvasText(ctx, `“${line.text}”`, w - 96);
  for (const sl of sourceLines.slice(0, 3)) {
    ctx.fillText(sl, x + 48, cursorY);
    cursorY += 54;
  }

  // Phonetic line (Furigana reading OR IPA line)
  const phoneticSummary =
    language === 'ja'
      ? line.tokens
          .map((t) => t.furigana || t.surface)
          .join(' ')
          .trim()
      : line.ipaLine ||
        line.tokens
          .filter((t) => t.ipa)
          .map((t) => t.ipa)
          .join(' ');

  if (phoneticSummary) {
    cursorY += 4;
    ctx.fillStyle = inkAccent;
    ctx.font =
      language === 'ja'
        ? '500 21px "Noto Sans JP", sans-serif'
        : '500 20px "IBM Plex Mono", monospace';
    const phonLines = wrapCanvasText(ctx, phoneticSummary, w - 96);
    for (const pl of phonLines.slice(0, 2)) {
      ctx.fillText(pl, x + 48, cursorY);
      cursorY += 30;
    }
  }

  // Vietnamese contextual translation
  if (line.translationVi) {
    cursorY += 18;
    ctx.fillStyle = inkSecondary;
    ctx.font = '500 24px "Plus Jakarta Sans", sans-serif';
    const viLines = wrapCanvasText(ctx, line.translationVi, w - 96);
    for (const vl of viLines.slice(0, 2)) {
      ctx.fillText(vl, x + 48, cursorY);
      cursorY += 34;
    }
  }

  // Grammar note box at bottom if provided
  if (grammarNote) {
    const noteY = Math.min(cursorY + 18, y + h - 115);
    ctx.fillStyle = inkSecondary;
    ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
    const noteLines = wrapCanvasText(ctx, `Ngữ pháp: ${grammarNote}`, w - 96);
    ctx.fillText(noteLines[0] || '', x + 48, noteY);
  }

  // Footer Video Title
  ctx.fillStyle = inkSecondary;
  ctx.font = '500 17px "Plus Jakarta Sans", sans-serif';
  const trimmedTitle =
    videoTitle.length > 72 ? `${videoTitle.slice(0, 72)}...` : videoTitle;
  ctx.fillText(`Nguồn: ${trimmedTitle}`, x + 48, y + h - 38);

  // Trigger instant PNG download
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `kotozen-quote-${Math.floor(line.start)}s.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
