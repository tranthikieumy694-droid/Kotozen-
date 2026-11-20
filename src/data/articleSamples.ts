import type { ArticleLanguage } from '../types';

export interface CuratedArticleSample {
  id: string;
  sourceLanguage: ArticleLanguage;
  badge: string;
  sourceName: string;
  title: string;
  subtitleVi: string;
  url: string;
  suggestedTarget: 'en' | 'ja';
}

/**
 * Verified publicly accessible starter articles across all 3 languages (VI · EN · JA)
 * for instant 1-click onboarding in the Universal Web Article Studio.
 */
export const CURATED_ARTICLE_SAMPLES: CuratedArticleSample[] = [
  {
    id: 'sample_vi_coffee',
    sourceLanguage: 'vi',
    badge: '🇻🇳 Bài Tiếng Việt ➔ Anh / Nhật',
    sourceName: 'Wikipedia Tiếng Việt',
    title: 'Cà phê — Lịch sử & Văn hóa Thưởng thức',
    subtitleVi: 'Đọc bài tiếng Việt quen thuộc, chuyển mượt sang Tiếng Anh (B2/C1) hoặc Tiếng Nhật (N3/N2)',
    url: 'https://vi.wikipedia.org/wiki/C%C3%A0_ph%C3%AA',
    suggestedTarget: 'en',
  },
  {
    id: 'sample_en_ikigai',
    sourceLanguage: 'en',
    badge: '🇬🇧 Bài Tiếng Anh ➔ Việt / Nhật',
    sourceName: 'Wikipedia English',
    title: 'Ikigai — The Japanese Concept of Purpose',
    subtitleVi: 'Luyện đọc hiểu tiếng Anh học thuật (CEFR B2–C1) với IPA, Collocations & tra từ 1 chạm',
    url: 'https://en.wikipedia.org/wiki/Ikigai',
    suggestedTarget: 'en',
  },
  {
    id: 'sample_ja_wabisabi',
    sourceLanguage: 'ja',
    badge: '🇯🇵 Bài Tiếng Nhật ➔ Việt / Anh',
    sourceName: 'Wikipedia 日本語',
    title: '侘び寂び（わび・さび）— Mỹ học Nhật Bản',
    subtitleVi: 'Đọc văn bản Nhật nguyên bản kèm Furigana theo ngữ cảnh, 214 Bộ Thủ & dịch đa ngữ',
    url: 'https://ja.wikipedia.org/wiki/%E4%BE%98%E3%81%B3%E3%83%BB%E5%AF%82%E3%81%B3',
    suggestedTarget: 'ja',
  },
];
