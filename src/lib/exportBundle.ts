import type {
  CurriculumData,
  Language,
  ProficiencyLevel,
  SmartChapter,
  StudySheetData,
  SubtitleLine,
  SyntaxXRay,
  TimestampedNote,
} from '../types';
import { formatTime } from './youtube';
import { triggerDownload } from './fsrs';

/**
 * Feature 20: Complete Notion-ready Markdown Bundle Exporter
 * Exports Smart Chapters + Bilingual Transcript + Level Vocabulary & Grammar +
 * Syntax X-Ray breakdowns + Timestamped Notes in 1 click.
 */
export function exportCompleteLessonMarkdown(params: {
  title: string;
  url: string;
  language: Language;
  targetLevel: ProficiencyLevel;
  lines: SubtitleLine[];
  chapters?: SmartChapter[] | null;
  curriculum?: CurriculumData | null;
  studySheet?: StudySheetData | null;
  xrayCache?: Record<string, SyntaxXRay>;
  notes?: TimestampedNote[];
}): void {
  const {
    title,
    url,
    language,
    targetLevel,
    lines,
    chapters,
    curriculum,
    studySheet,
    xrayCache,
    notes,
  } = params;

  const out: string[] = [
    `# ${title}`,
    `> Nguồn: ${url}  `,
    `> Ngôn ngữ: ${language === 'ja' ? 'Tiếng Nhật (日本語)' : 'Tiếng Anh (English)'} · Trình độ mục tiêu: **${targetLevel}**  `,
    `> Xuất từ KotoZen ngày ${new Date().toLocaleDateString('vi-VN')}`,
    '',
  ];

  if (studySheet?.summaryVi) {
    out.push('## 1. Tóm tắt nội dung video', studySheet.summaryVi, '');
    if (studySheet.keyTakeaways.length > 0) {
      out.push(...studySheet.keyTakeaways.map((k) => `- ${k}`), '');
    }
  }

  if (chapters && chapters.length > 0) {
    out.push('## 2. Chương học & Bản đồ ý chính');
    for (const ch of chapters) {
      out.push(
        `### [${formatTime(ch.start)} – ${formatTime(ch.end)}] ${ch.titleVi} (${ch.difficultyLevel})`,
        `_${ch.titleSource}_ — ${ch.summaryVi}`,
        ...ch.mindMapNodes.map((n) => `- ${n}`),
        ''
      );
    }
  }

  if (curriculum && curriculum.vocabulary.length > 0) {
    out.push(`## 3. Từ vựng trọng tâm (${curriculum.targetLevel})`);
    out.push('| Từ / Cụm | Phiên âm / Furigana | Cấp độ | Nghĩa tiếng Việt |');
    out.push('| --- | --- | --- | --- |');
    for (const v of curriculum.vocabulary) {
      const phon = v.hanViet ? `${v.readingOrIpa} (${v.hanViet})` : v.readingOrIpa;
      out.push(`| **${v.word}** | ${phon} | ${v.level} | ${v.meaningVi} |`);
    }
    out.push('');
  }

  if (curriculum && curriculum.grammar.length > 0) {
    out.push('## 4. Ngữ pháp trọng tâm');
    for (const g of curriculum.grammar) {
      out.push(
        `- **${g.pattern}** (${g.level}) — \`${g.formula}\``,
        `  - Sắc thái: ${g.nuance}`,
        `  - Ví dụ (${formatTime(g.exampleStart)}): _"${g.exampleSentence}"_ — ${g.exampleTranslationVi}`
      );
    }
    out.push('');
  }

  const xrays = xrayCache ? Object.values(xrayCache) : [];
  if (xrays.length > 0) {
    out.push('## 5. Các câu đã Giải phẫu Cú pháp (Syntax X-Ray)');
    for (const xr of xrays) {
      out.push(`### ${xr.sentence}`);
      out.push(`- Dịch: ${xr.translationVi}`);
      out.push(`- Sắc thái: ${xr.register} — ${xr.registerReason}`);
      for (const seg of xr.segments) {
        out.push(`  - **${seg.text}** (${seg.role}): ${seg.explanation}`);
      }
      out.push('');
    }
  }

  if (notes && notes.length > 0) {
    out.push('## 6. Ghi chú cá nhân gắn mốc giây');
    for (const n of notes) {
      out.push(`- **[${formatTime(n.timestamp)}]** ${n.content}`);
    }
    out.push('');
  }

  if (lines.length > 0) {
    out.push('## 7. Toàn bộ phụ đề song ngữ');
    for (const l of lines) {
      out.push(`- **[${formatTime(l.start)}]** ${l.text}`);
      if (l.translationVi) {
        out.push(`  - _${l.translationVi}_`);
      }
    }
  }

  const safeSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  triggerDownload(
    `kotozen-lesson-${safeSlug || 'export'}.md`,
    out.join('\n'),
    'text/markdown;charset=utf-8'
  );
}

/**
 * Exports a Tri-Lingual Article Studio session (Original + Target + Vietnamese +
 * Vocabulary + Grammar + Syntax X-Ray + Paragraph Notes) as Notion-ready Markdown.
 */
export function exportArticleMarkdown(params: {
  title: string;
  url: string;
  domain: string;
  sourceLanguage: 'vi' | 'en' | 'ja';
  activeLanguage: 'vi' | 'en' | 'ja';
  targetLevel: ProficiencyLevel;
  paragraphs: Array<{ id: string; blockType: string; sentenceIds: string[] }>;
  sentencesById: Map<
    string,
    {
      id: string;
      originalText: string;
      variants: Partial<Record<'vi' | 'en' | 'ja', { text: string; translationVi: string }>>;
    }
  >;
  curriculum?: CurriculumData | null;
  xrayCache?: Record<string, SyntaxXRay>;
  notes?: Array<{ paragraphId: string; content: string }>;
}): void {
  const {
    title,
    url,
    domain,
    sourceLanguage,
    activeLanguage,
    targetLevel,
    paragraphs,
    sentencesById,
    curriculum,
    xrayCache,
    notes,
  } = params;

  const langLabel = (l: 'vi' | 'en' | 'ja') =>
    l === 'ja' ? 'Tiếng Nhật (日本語)' : l === 'en' ? 'Tiếng Anh (English)' : 'Tiếng Việt';

  const out: string[] = [
    `# ${title}`,
    `> Nguồn: [${domain}](${url})  `,
    `> Ngôn ngữ gốc: ${langLabel(sourceLanguage)} · Đang học: **${langLabel(activeLanguage)} (${targetLevel})**  `,
    `> Xuất từ KotoZen Article Studio ngày ${new Date().toLocaleDateString('vi-VN')}`,
    '',
    '## 1. Nội dung bài viết song ngữ / đa ngữ',
    '',
  ];

  for (const p of paragraphs) {
    const sents = p.sentenceIds
      .map((id) => sentencesById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (sents.length === 0) continue;

    const targetJoined = sents
      .map((s) => s.variants[activeLanguage]?.text || s.originalText)
      .join(activeLanguage === 'ja' ? '' : ' ');
    const viJoined = sents
      .map(
        (s) =>
          s.variants[activeLanguage]?.translationVi ||
          s.variants.vi?.text ||
          (sourceLanguage === 'vi' ? s.originalText : '')
      )
      .filter(Boolean)
      .join(' ');

    if (p.blockType === 'h2') {
      out.push(`### ${targetJoined}`);
    } else if (p.blockType === 'h3') {
      out.push(`#### ${targetJoined}`);
    } else if (p.blockType === 'blockquote') {
      out.push(`> ${targetJoined}`);
    } else if (p.blockType === 'li') {
      out.push(`- ${targetJoined}`);
    } else {
      out.push(targetJoined);
    }

    if (viJoined && activeLanguage !== 'vi') {
      out.push(`_${viJoined}_`);
    }
    out.push('');
  }

  if (curriculum && curriculum.vocabulary.length > 0) {
    out.push(`## 2. Từ vựng trọng tâm (${curriculum.targetLevel})`);
    out.push('| Từ / Cụm | Phiên âm / Furigana | Cấp độ | Nghĩa tiếng Việt |');
    out.push('| --- | --- | --- | --- |');
    for (const v of curriculum.vocabulary) {
      const phon = v.hanViet ? `${v.readingOrIpa} (${v.hanViet})` : v.readingOrIpa;
      out.push(`| **${v.word}** | ${phon} | ${v.level} | ${v.meaningVi} |`);
    }
    out.push('');
  }

  if (curriculum && curriculum.grammar.length > 0) {
    out.push('## 3. Ngữ pháp trọng tâm');
    for (const g of curriculum.grammar) {
      out.push(
        `- **${g.pattern}** (${g.level}) — \`${g.formula}\``,
        `  - Sắc thái: ${g.nuance}`,
        `  - Ví dụ: _"${g.exampleSentence}"_ — ${g.exampleTranslationVi}`
      );
    }
    out.push('');
  }

  const xrays = xrayCache ? Object.values(xrayCache) : [];
  if (xrays.length > 0) {
    out.push('## 4. Các câu đã Giải phẫu Cú pháp (Syntax X-Ray)');
    for (const xr of xrays) {
      out.push(`### ${xr.sentence}`);
      out.push(`- Dịch: ${xr.translationVi}`);
      out.push(`- Sắc thái: ${xr.register} — ${xr.registerReason}`);
      for (const seg of xr.segments) {
        out.push(`  - **${seg.text}** (${seg.role}): ${seg.explanation}`);
      }
      out.push('');
    }
  }

  if (notes && notes.length > 0) {
    out.push('## 5. Ghi chú cá nhân theo đoạn');
    for (const n of notes) {
      out.push(`- **[${n.paragraphId.toUpperCase()}]** ${n.content}`);
    }
    out.push('');
  }

  const safeSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 42);

  triggerDownload(
    `kotozen-article-${safeSlug || 'export'}.md`,
    out.join('\n'),
    'text/markdown;charset=utf-8'
  );
}

