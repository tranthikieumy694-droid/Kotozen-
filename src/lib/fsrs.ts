import type { Flashcard, FsrsRating, FsrsState } from '../types';

// FSRS-4.5 calibrated default parameters
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
  2.9898, 0.51655, 0.6621,
];

const REQUEST_RETENTION = 0.9;
const FACTOR = 19 / 81;
const DECAY = -0.5;
const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

function initStability(rating: FsrsRating): number {
  return Math.max(0.1, W[rating - 1]);
}

function initDifficulty(rating: FsrsRating): number {
  return clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10);
}

function nextDifficulty(d: number, rating: FsrsRating): number {
  const nextD = d - W[6] * (rating - 3);
  return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * nextD, 1, 10);
}

function forgettingCurve(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * elapsedDays) / Math.max(stability, 0.1), DECAY);
}

function nextIntervalDays(stability: number): number {
  const raw = (stability / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
  return Math.max(1, Math.min(3650, Math.round(raw)));
}

function nextRecallStability(d: number, s: number, r: number, rating: FsrsRating): number {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus = rating === 4 ? W[16] : 1;
  return (
    s *
    (1 +
      Math.exp(W[8]) *
        (11 - d) *
        Math.pow(s, -W[9]) *
        (Math.exp((1 - r) * W[10]) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function nextForgetStability(d: number, s: number, r: number): number {
  return (
    W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp((1 - r) * W[14])
  );
}

export function createInitialFsrsState(now = Date.now()) {
  return {
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 'new' as FsrsState,
    due: now,
  };
}

export function scheduleFsrsCard(
  card: Flashcard,
  rating: FsrsRating,
  now = Date.now()
): { updated: Flashcard; intervalLabel: string } {
  const elapsedDays = card.lastReview ? Math.max(0, (now - card.lastReview) / DAY_MS) : 0;

  let stability = card.stability;
  let difficulty = card.difficulty;
  let state: FsrsState = card.state;
  let lapses = card.lapses;
  const reps = card.reps + 1;
  let scheduledDays = 0;
  let due = now;
  let intervalLabel = '';

  if (card.state === 'new') {
    stability = initStability(rating);
    difficulty = initDifficulty(rating);

    if (rating === 1) {
      state = 'learning';
      scheduledDays = 0;
      due = now + 5 * 60 * 1000;
      intervalLabel = '5 phút';
    } else if (rating === 2) {
      state = 'learning';
      scheduledDays = 0;
      due = now + 12 * 60 * 1000;
      intervalLabel = '12 phút';
    } else if (rating === 3) {
      state = 'review';
      scheduledDays = Math.max(1, nextIntervalDays(stability));
      due = now + scheduledDays * DAY_MS;
      intervalLabel = formatIntervalLabel(scheduledDays);
    } else {
      state = 'review';
      scheduledDays = Math.max(4, nextIntervalDays(stability));
      due = now + scheduledDays * DAY_MS;
      intervalLabel = formatIntervalLabel(scheduledDays);
    }
  } else {
    const r = forgettingCurve(elapsedDays, Math.max(0.1, stability));
    difficulty = nextDifficulty(difficulty || 5, rating);

    if (rating === 1) {
      lapses += 1;
      state = 'relearning';
      stability = Math.max(0.1, nextForgetStability(difficulty, Math.max(0.1, stability), r));
      scheduledDays = 0;
      due = now + 10 * 60 * 1000;
      intervalLabel = '10 phút';
    } else {
      state = 'review';
      stability = Math.max(0.2, nextRecallStability(difficulty, Math.max(0.2, stability), r, rating));
      scheduledDays = nextIntervalDays(stability);
      if (rating === 2) scheduledDays = Math.max(1, Math.round(scheduledDays * 0.8));
      if (rating === 4) scheduledDays = Math.max(scheduledDays + 1, Math.round(scheduledDays * 1.3));
      due = now + scheduledDays * DAY_MS;
      intervalLabel = formatIntervalLabel(scheduledDays);
    }
  }

  return {
    updated: {
      ...card,
      stability: Number(stability.toFixed(3)),
      difficulty: Number(difficulty.toFixed(3)),
      elapsedDays: Number(elapsedDays.toFixed(2)),
      scheduledDays,
      reps,
      lapses,
      state,
      due,
      lastReview: now,
    },
    intervalLabel,
  };
}

export function previewFsrsIntervals(card: Flashcard, now = Date.now()): Record<FsrsRating, string> {
  return {
    1: scheduleFsrsCard(card, 1, now).intervalLabel,
    2: scheduleFsrsCard(card, 2, now).intervalLabel,
    3: scheduleFsrsCard(card, 3, now).intervalLabel,
    4: scheduleFsrsCard(card, 4, now).intervalLabel,
  };
}

function formatIntervalLabel(days: number): string {
  if (days < 1) return '< 1 ngày';
  if (days < 30) return `${days} ngày`;
  if (days < 365) {
    const months = (days / 30).toFixed(1).replace(/\.0$/, '');
    return `${months} tháng`;
  }
  const years = (days / 365).toFixed(1).replace(/\.0$/, '');
  return `${years} năm`;
}

function escapeCsvCell(value: string): string {
  const safe = (value || '').replace(/\r?\n/g, '<br>');
  if (/[",]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Generates an Anki-ready UTF-8 CSV file with Front, Back, Context, Video Link, Tags.
 */
export function exportFlashcardsToAnkiCsv(cards: Flashcard[]): string {
  const header = ['Front', 'Reading_IPA', 'Meaning_VI', 'Context_Sentence', 'Video_Anchor', 'Tags'];
  const rows = cards.map((c) => {
    const front = c.term + (c.hanViet ? ` [${c.hanViet}]` : '');
    const reading = c.readingOrIpa || '';
    const meaning = c.meaningVi + (c.userNote ? ` — Ghi chú: ${c.userNote}` : '');
    const context = `${c.sentence} — ${c.sentenceVi}`;
    const anchor = `${c.videoTitle} (${c.videoUrl})`;
    const tags = `kotozen ${c.language} ${c.level} ${c.kind}`;
    return [front, reading, meaning, context, anchor, tags].map(escapeCsvCell).join(',');
  });
  return '\uFEFF' + [header.join(','), ...rows].join('\n');
}

export function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
