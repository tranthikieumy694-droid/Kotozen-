import type {
  Language,
  NuanceAxisScore,
  NuanceContrastRow,
  NuanceDualPayload,
  NuanceExtraScenario,
  ProficiencyLevel,
  RubySegment,
} from '../src/types';

function cleanStr(val: unknown, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  return val
    .normalize('NFC')
    .replace(/[\uFFFD\u25A1□]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampScore(val: unknown, fallback = 3): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(5, n));
}

function sanitizeRuby(raw: unknown): RubySegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned: RubySegment[] = [];
  for (const seg of raw) {
    if (!seg || typeof seg !== 'object') continue;
    const base = cleanStr((seg as Record<string, unknown>).base);
    if (!base) continue;
    const reading = cleanStr((seg as Record<string, unknown>).reading);
    cleaned.push(reading && reading !== base ? { base, reading } : { base });
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

function classifyFormalityText(text: string): 'casual' | 'neutral' | 'formal' | null {
  const lower = text.toLowerCase();
  if (
    /suồng sã|thân mật|futsukei|tameguchi|casual|khẩu ngữ|bình dân|thể thường|普通体/.test(lower)
  ) {
    return 'casual';
  }
  if (
    /trang trọng|học thuật|keigo|kính ngữ|sonkeigo|kenjougo|formal|academic|công sở|nghiêm túc|敬語/.test(
      lower
    )
  ) {
    return 'formal';
  }
  if (/trung tính|lịch sự|teineigo|neutral|chuẩn mực|phổ thông|丁寧語/.test(lower)) {
    return 'neutral';
  }
  return null;
}

function classifyAttitudeText(text: string): 'positive' | 'neutral' | 'negative' | null {
  const lower = text.toLowerCase();
  if (/tiêu cực|\(–\)|\(-\)|chê|mỉa mai|bóng gió|châm biếm|tiếc nuối|phê phán|khó chịu/.test(lower)) {
    return 'negative';
  }
  if (/tích cực|\(\+\)|khen|trân trọng|tự hào|ấm áp|lịch thiệp|đánh giá cao/.test(lower)) {
    return 'positive';
  }
  if (/khách quan|\(○\)|trung lập|trung tính|mô tả/.test(lower)) {
    return 'neutral';
  }
  return null;
}

function formalityBadgeFromScore(score: number, lang: Language): string {
  if (score <= 2) return lang === 'ja' ? 'Suồng sã (Futsukei)' : 'Suồng sã · Thân mật';
  if (score === 3) return lang === 'ja' ? 'Lịch sự (Teineigo)' : 'Trung tính · Chuẩn mực';
  return lang === 'ja' ? 'Trang trọng (Keigo / Văn viết)' : 'Trang trọng · Học thuật';
}

function attitudeBadgeFromScore(score: number): string {
  if (score >= 4) return 'Tích cực (+)';
  if (score <= 2) return 'Tiêu cực (–)';
  return 'Khách quan (○)';
}

function formalityAxisLabel(score: number, lang: Language): string {
  if (score <= 1) return lang === 'ja' ? 'Rất thân mật (Uchi · Tameguchi)' : 'Rất suồng sã';
  if (score === 2) return lang === 'ja' ? 'Thân mật (Futsukei)' : 'Thân mật đời thường';
  if (score === 3) return lang === 'ja' ? 'Lịch sự chuẩn (Teineigo)' : 'Trung tính xã giao';
  if (score === 4) return lang === 'ja' ? 'Công sở trang trọng (Soto)' : 'Trang trọng chuyên nghiệp';
  return lang === 'ja' ? 'Kính ngữ / Học thuật cao (Keigo)' : 'Rất trang trọng · Học thuật';
}

function connotationAxisLabel(score: number): string {
  if (score <= 1) return 'Chê bai / Tiêu cực mạnh';
  if (score === 2) return 'Hơi tiêu cực / Rào đón nhạy cảm';
  if (score === 3) return 'Trung lập khách quan';
  if (score === 4) return 'Tích cực / Lịch thiệp';
  return 'Khen ngợi / Trân trọng cao';
}

function normalizeAxis(
  raw: unknown,
  defaults: NuanceAxisScore
): NuanceAxisScore {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    score: clampScore(obj.score, defaults.score),
    label: cleanStr(obj.label, defaults.label),
    leftEnd: cleanStr(obj.leftEnd, defaults.leftEnd),
    rightEnd: cleanStr(obj.rightEnd, defaults.rightEnd),
  };
}

/**
 * Summary-to-DeepDive Parity Enforcement Gate:
 * Guarantees 100% consistency between summary.badges and deepDive.axes,
 * removes broken IPA glyphs, validates quiz indices, and ensures clean fallbacks.
 */
export function enforceNuanceParity(
  raw: Record<string, unknown>,
  meta: {
    term: string;
    lemma: string;
    language: Language;
    targetLevel: ProficiencyLevel;
    kind: NuanceDualPayload['kind'];
    fallbackSentence: string;
  }
): NuanceDualPayload {
  const rawSummary =
    raw.summary && typeof raw.summary === 'object'
      ? (raw.summary as Record<string, unknown>)
      : {};
  const rawDeep =
    raw.deepDive && typeof raw.deepDive === 'object'
      ? (raw.deepDive as Record<string, unknown>)
      : {};

  const rawBadges =
    rawSummary.badges && typeof rawSummary.badges === 'object'
      ? (rawSummary.badges as Record<string, unknown>)
      : {};
  const rawQuickContrast =
    rawSummary.quickContrast && typeof rawSummary.quickContrast === 'object'
      ? (rawSummary.quickContrast as Record<string, unknown>)
      : {};
  const rawAnchor =
    rawSummary.anchorExample && typeof rawSummary.anchorExample === 'object'
      ? (rawSummary.anchorExample as Record<string, unknown>)
      : {};

  const rawAxes =
    rawDeep.axes && typeof rawDeep.axes === 'object'
      ? (rawDeep.axes as Record<string, unknown>)
      : {};

  const intensity = normalizeAxis(rawAxes.intensity, {
    score: 3,
    label: 'Trung bình',
    leftEnd: 'Rất nhẹ',
    rightEnd: 'Rất mạnh',
  });
  const formality = normalizeAxis(rawAxes.formality, {
    score: 3,
    label: formalityAxisLabel(3, meta.language),
    leftEnd: meta.language === 'ja' ? 'Thân mật (Uchi)' : 'Suồng sã',
    rightEnd: meta.language === 'ja' ? 'Kính ngữ (Soto)' : 'Trang trọng · Học thuật',
  });
  const connotation = normalizeAxis(rawAxes.connotation, {
    score: 3,
    label: 'Trung lập khách quan',
    leftEnd: 'Tiêu cực / Chê',
    rightEnd: 'Khen / Trân trọng',
  });
  const frequency = normalizeAxis(rawAxes.frequency, {
    score: 4,
    label: 'Dùng hằng ngày',
    leftEnd: 'Văn chương / Hiếm',
    rightEnd: 'Dùng hằng ngày',
  });

  // --- PARITY CHECK 1: Formality Badge <-> Formality Axis Score ---
  let formalityBadge = cleanStr(rawBadges.formality);
  const badgeFormClass = classifyFormalityText(formalityBadge);
  if (!formalityBadge) {
    formalityBadge = formalityBadgeFromScore(formality.score, meta.language);
  } else if (badgeFormClass === 'casual' && formality.score >= 4) {
    formality.score = 2;
    formality.label = formalityAxisLabel(2, meta.language);
  } else if (badgeFormClass === 'formal' && formality.score <= 2) {
    formality.score = 4;
    formality.label = formalityAxisLabel(4, meta.language);
  } else if (badgeFormClass === 'neutral' && (formality.score <= 1 || formality.score >= 5)) {
    formality.score = 3;
    formality.label = formalityAxisLabel(3, meta.language);
  }

  // --- PARITY CHECK 2: Attitude Badge <-> Connotation Axis Score ---
  let attitudeBadge = cleanStr(rawBadges.attitude);
  const badgeAttClass = classifyAttitudeText(attitudeBadge);
  if (!attitudeBadge) {
    attitudeBadge = attitudeBadgeFromScore(connotation.score);
  } else if (badgeAttClass === 'positive' && connotation.score <= 3) {
    connotation.score = 4;
    connotation.label = connotationAxisLabel(4);
  } else if (badgeAttClass === 'negative' && connotation.score >= 3) {
    connotation.score = 2;
    connotation.label = connotationAxisLabel(2);
  } else if (badgeAttClass === 'neutral' && connotation.score !== 3) {
    connotation.score = 3;
    connotation.label = connotationAxisLabel(3);
  }

  const channelBadge = cleanStr(rawBadges.channel, 'Văn nói · Giao tiếp');

  const rawPrag =
    rawDeep.inVideoPragmatics && typeof rawDeep.inVideoPragmatics === 'object'
      ? (rawDeep.inVideoPragmatics as Record<string, unknown>)
      : {};

  const rawMatrix = Array.isArray(rawDeep.contrastMatrix) ? rawDeep.contrastMatrix : [];
  const contrastMatrix: NuanceContrastRow[] = rawMatrix
    .map((item): NuanceContrastRow | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const term = cleanStr(obj.term);
      if (!term) return null;
      const verdictRaw = cleanStr(obj.minimalPairVerdict).toLowerCase();
      const minimalPairVerdict: NuanceContrastRow['minimalPairVerdict'] =
        verdictRaw === 'wrong'
          ? 'wrong'
          : verdictRaw === 'awkward'
            ? 'awkward'
            : 'natural';
      return {
        term,
        readingOrIpa: cleanStr(obj.readingOrIpa),
        hanViet: cleanStr(obj.hanViet) || undefined,
        pitchAccent: cleanStr(obj.pitchAccent) || undefined,
        coreNuanceVi: cleanStr(obj.coreNuanceVi),
        whenToUseVi: cleanStr(obj.whenToUseVi),
        minimalPairSentence: cleanStr(obj.minimalPairSentence),
        minimalPairVerdict,
        minimalPairNoteVi: cleanStr(obj.minimalPairNoteVi),
      };
    })
    .filter((x): x is NuanceContrastRow => x !== null)
    .slice(0, 5);

  const rawSwap =
    rawDeep.minimalPairSwap && typeof rawDeep.minimalPairSwap === 'object'
      ? (rawDeep.minimalPairSwap as Record<string, unknown>)
      : {};

  const rawTraps =
    rawDeep.collocationAndTraps && typeof rawDeep.collocationAndTraps === 'object'
      ? (rawDeep.collocationAndTraps as Record<string, unknown>)
      : {};

  const rawTransform =
    rawDeep.threeTierTransform && typeof rawDeep.threeTierTransform === 'object'
      ? (rawDeep.threeTierTransform as Record<string, unknown>)
      : {};

  const normalizeTier = (
    node: unknown,
    fallbackLabel: string
  ): {
    label: string;
    sentence: string;
    ruby?: RubySegment[];
    readingOrIpa?: string;
    translationVi?: string;
    listenerFeelingVi: string;
  } => {
    const obj = node && typeof node === 'object' ? (node as Record<string, unknown>) : {};
    return {
      label: cleanStr(obj.label || obj.levelTag, fallbackLabel),
      sentence: cleanStr(obj.sentence, meta.fallbackSentence),
      ruby: meta.language === 'ja' ? sanitizeRuby(obj.ruby) : undefined,
      readingOrIpa: cleanStr(obj.readingOrIpa) || undefined,
      translationVi: cleanStr(obj.translationVi) || undefined,
      listenerFeelingVi: cleanStr(obj.listenerFeelingVi),
    };
  };

  const rawQuiz =
    rawDeep.microQuiz && typeof rawDeep.microQuiz === 'object'
      ? (rawDeep.microQuiz as Record<string, unknown>)
      : {};
  const quizOptions = Array.isArray(rawQuiz.options)
    ? rawQuiz.options.map((o) => cleanStr(o)).filter(Boolean).slice(0, 4)
    : [];
  const safeOptions =
    quizOptions.length >= 2
      ? quizOptions
      : [meta.term, contrastMatrix[1]?.term || 'Phương án khác'];
  const rawCorrectIdx = Number(rawQuiz.correctIndex);
  const safeCorrectIdx =
    Number.isInteger(rawCorrectIdx) && rawCorrectIdx >= 0 && rawCorrectIdx < safeOptions.length
      ? rawCorrectIdx
      : 0;

  return {
    term: meta.term,
    lemma: meta.lemma || meta.term,
    language: meta.language,
    targetLevel: meta.targetLevel,
    kind: meta.kind,
    summary: {
      coreRule: cleanStr(
        rawSummary.coreRule,
        `Dùng "${meta.term}" để diễn đạt đúng sắc thái ngữ cảnh trong câu đang xem.`
      ),
      badges: {
        formality: formalityBadge,
        attitude: attitudeBadge,
        channel: channelBadge,
      },
      quickContrast: {
        do: cleanStr(rawQuickContrast.do),
        dont: cleanStr(rawQuickContrast.dont),
      },
      anchorExample: {
        sentence: cleanStr(rawAnchor.sentence, meta.fallbackSentence),
        ruby: meta.language === 'ja' ? sanitizeRuby(rawAnchor.ruby) : undefined,
        readingOrIpa: cleanStr(rawAnchor.readingOrIpa) || undefined,
        pitchAccent: cleanStr(rawAnchor.pitchAccent) || undefined,
        highlightTerm: cleanStr(rawAnchor.highlightTerm, meta.term),
        translationVi: cleanStr(rawAnchor.translationVi),
      },
    },
    deepDive: {
      axes: {
        intensity,
        formality,
        connotation,
        frequency,
      },
      inVideoPragmatics: {
        whyChosenHereVi: cleanStr(rawPrag.whyChosenHereVi),
        culturalSubtextLabel: cleanStr(
          rawPrag.culturalSubtextLabel,
          meta.language === 'ja' ? 'Sắc thái giao tiếp Nhật Bản' : 'Hàm ý ngữ dụng bản xứ'
        ),
        culturalSubtextVi: cleanStr(rawPrag.culturalSubtextVi),
      },
      contrastMatrix,
      minimalPairSwap: {
        frameSentence: cleanStr(rawSwap.frameSentence, meta.fallbackSentence),
        insightVi: cleanStr(rawSwap.insightVi || rawSwap.explanationVi),
      },
      collocationAndTraps: {
        mustPairWith: Array.isArray(rawTraps.mustPairWith)
          ? rawTraps.mustPairWith.map((x) => cleanStr(x)).filter(Boolean).slice(0, 5)
          : [],
        neverPairWith: Array.isArray(rawTraps.neverPairWith)
          ? rawTraps.neverPairWith.map((x) => cleanStr(x)).filter(Boolean).slice(0, 5)
          : [],
        vietnameseCultureTrapVi: cleanStr(
          rawTraps.vietnameseCultureTrapVi || rawTraps.vietnameseTrapVi
        ),
        socialConsequenceVi: cleanStr(rawTraps.socialConsequenceVi),
      },
      threeTierTransform: {
        casual: normalizeTier(
          rawTransform.casual,
          meta.language === 'ja' ? 'Thân mật (Tameguchi)' : 'Đời thường (Casual)'
        ),
        standard: normalizeTier(
          rawTransform.standard,
          meta.language === 'ja' ? 'Chuẩn mực (Teineigo)' : 'Chuyên nghiệp (Standard)'
        ),
        formal: normalizeTier(
          rawTransform.formal,
          meta.language === 'ja' ? 'Trang trọng (Keigo)' : 'Học thuật (Academic · IELTS 8+)'
        ),
      },
      microQuiz: {
        situationVi: cleanStr(rawQuiz.situationVi),
        questionVi: cleanStr(rawQuiz.questionVi, 'Chọn phương án tự nhiên nhất trong tình huống trên:'),
        options: safeOptions,
        correctIndex: safeCorrectIdx,
        explanationVi: cleanStr(rawQuiz.explanationVi),
      },
    },
  };
}

export function sanitizeExtraScenarios(rawList: unknown): NuanceExtraScenario[] {
  if (!Array.isArray(rawList)) return [];
  const stamp = Date.now().toString(36).slice(-4);
  return rawList
    .map((item, idx): NuanceExtraScenario | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const situationVi = cleanStr(obj.situationVi);
      const recommendedExpression = cleanStr(
        obj.recommendedExpression || obj.sentence || obj.recommendedTerm
      );
      if (!situationVi || !recommendedExpression) return null;
      return {
        id: `nsc_${stamp}_${idx}`,
        situationVi,
        recommendedExpression,
        readingOrIpa: cleanStr(obj.readingOrIpa) || undefined,
        avoidExpression: cleanStr(obj.avoidExpression || obj.avoidTerm),
        whyVi: cleanStr(obj.whyVi || obj.whyNaturalVi || obj.whyAvoidVi),
        translationVi: cleanStr(obj.translationVi),
      };
    })
    .filter((x): x is NuanceExtraScenario => x !== null)
    .slice(0, 3);
}
