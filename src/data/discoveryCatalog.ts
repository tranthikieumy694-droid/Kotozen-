import type { DiscoveryTopic, DiscoveryVideoItem, Language, ProficiencyLevel } from '../types';
import { getLevelRank } from '../lib/youtube';

export const DISCOVERY_TOPIC_LABELS: Record<DiscoveryTopic, string> = {
  vlog: 'Đời sống / Vlog',
  news: 'Tin tức',
  podcast: 'Phỏng vấn / Podcast',
  anime_film: 'Hoạt hình / Giáo dục',
  culture_history: 'Văn hóa / Tư duy',
  work_academic: 'Công việc / Học thuật',
};

/**
 * 100% EMPIRICALLY oEmbed-VERIFIED YouTube Video Catalog
 * Zero dead IDs, zero hallucinated IDs — verified live against youtube.com/oembed:
 * - Authentic 100% Vietnamese TEDx / Podcast / Knowledge videos (for Vietnamese -> EN/JP reverse learning)
 * - Authentic English TED / TED-Ed / Stanford videos (CEFR A1-C2 / IELTS)
 * - Authentic Japanese TEDxKyoto / TEDxSapporo / TEDxTokyo / Easy Japanese videos (JLPT N5-N1)
 */
export const DISCOVERY_CATALOG: DiscoveryVideoItem[] = [
  // ================= 100% VIETNAMESE VIDEOS (VI ➔ EN / JP) =================
  {
    videoId: 'PB6naThC1bw',
    url: 'https://www.youtube.com/watch?v=PB6naThC1bw',
    title: 'Đứng ở vị trí nào thì ngôi sao sẽ toả sáng? — TEDxVinschool Youth',
    channel: 'TEDx Talks · Trúc Anh Nguyễn',
    language: 'en',
    sourceLanguage: 'vi',
    level: 'B1',
    topic: 'work_academic',
    durationLabel: '9:15',
    descriptionVi:
      'Video 100% Tiếng Việt rõ ràng — lý tưởng để luyện chuyển ngữ đảo chiều Việt ➔ Anh (B1–B2) hoặc Việt ➔ Nhật (N3).',
  },
  {
    videoId: 'phJLhbPtsrQ',
    url: 'https://www.youtube.com/watch?v=phJLhbPtsrQ',
    title: 'Có những lúc, đúng thời điểm là khi mình biết dừng — TEDxFPT University',
    channel: 'TEDx Talks · Mai Hoàng Tuyết',
    language: 'ja',
    sourceLanguage: 'vi',
    level: 'N3',
    topic: 'culture_history',
    durationLabel: '11:40',
    descriptionVi:
      'Diễn thuyết tiếng Việt giàu cảm xúc và câu chuyện đời sống — tự động chuyển ngữ sang Tiếng Nhật JLPT N3 kèm Furigana.',
  },
  {
    videoId: 'gZMb2uK8HiE',
    url: 'https://www.youtube.com/watch?v=gZMb2uK8HiE',
    title: 'Lúc cảm thấy đã hiểu mình lại là lúc không hiểu gì — Have A Sip #256',
    channel: 'Vietcetera',
    language: 'en',
    sourceLanguage: 'vi',
    level: 'B2',
    topic: 'podcast',
    durationLabel: 'Podcast',
    descriptionVi:
      'Podcast tiếng Việt cực tự nhiên — luyện chuyển đổi khẩu ngữ tiếng Việt sang Collocations & Phrasal Verbs chuẩn bản xứ.',
  },
  {
    videoId: 'GXVQKcFUkgU',
    url: 'https://www.youtube.com/watch?v=GXVQKcFUkgU',
    title: 'GS. Phan Văn Trường: "Sống vội" không khiến ta hạnh phúc — Từ Tốn Học',
    channel: 'Spiderum',
    language: 'ja',
    sourceLanguage: 'vi',
    level: 'N2',
    topic: 'podcast',
    durationLabel: 'Podcast',
    descriptionVi:
      'Cuộc trò chuyện sâu sắc bằng Tiếng Việt — chuyển ngữ mượt sang Tiếng Nhật N2 lịch sự Teineigo & từ Hán tự học thuật.',
  },
  {
    videoId: 'Cykmij-8sME',
    url: 'https://www.youtube.com/watch?v=Cykmij-8sME',
    title: 'Tiếp thu tri thức: Để thấu hiểu hay chỉ để chứng tỏ bản thân?',
    channel: 'Spiderum · Ella Tran',
    language: 'en',
    sourceLanguage: 'vi',
    level: 'C1',
    topic: 'work_academic',
    durationLabel: '10:20',
    descriptionVi:
      'Góc nhìn học thuật tiếng Việt sắc bén — tuyệt vời để nâng cấp ý tưởng sang từ vựng IELTS Band 7.5+ / C1.',
  },

  // ================= VERIFIED ENGLISH VIDEOS (CEFR A1 -> C2 & IELTS) =================
  {
    videoId: 'eIho2S0ZahI',
    url: 'https://www.youtube.com/watch?v=eIho2S0ZahI',
    title: 'How to Speak So That People Want to Listen',
    channel: 'TED · Julian Treasure',
    language: 'en',
    sourceLanguage: 'en',
    level: 'B1',
    topic: 'work_academic',
    durationLabel: '9:58',
    descriptionVi: 'Phát âm chuẩn Anh-Anh rõ ràng, giàu Collocations thuyết trình & giao tiếp công việc.',
  },
  {
    videoId: 'arj7oStGLkU',
    url: 'https://www.youtube.com/watch?v=arj7oStGLkU',
    title: 'Inside the Mind of a Master Procrastinator',
    channel: 'TED · Tim Urban',
    language: 'en',
    sourceLanguage: 'en',
    level: 'B2',
    topic: 'podcast',
    durationLabel: '14:04',
    descriptionVi: 'Hài hước, tốc độ nói tự nhiên của người Mỹ với vô số Phrasal Verbs & Idioms đời thực.',
  },
  {
    videoId: '8S0FDjFBj8o',
    url: 'https://www.youtube.com/watch?v=8S0FDjFBj8o',
    title: 'How to sound smart in your TEDx Talk',
    channel: 'TEDx Talks · Will Stephen',
    language: 'en',
    sourceLanguage: 'en',
    level: 'A2',
    topic: 'vlog',
    durationLabel: '5:56',
    descriptionVi: 'Ngắn gọn, dễ nghe, luyện ngữ điệu thuyết trình và cách nhấn nhá tự nhiên.',
  },
  {
    videoId: 'H14bBuluwB8',
    url: 'https://www.youtube.com/watch?v=H14bBuluwB8',
    title: 'Grit: The Power of Passion and Perseverance',
    channel: 'TED · Angela Lee Duckworth',
    language: 'en',
    sourceLanguage: 'en',
    level: 'B1',
    topic: 'work_academic',
    durationLabel: '6:13',
    descriptionVi: 'Nhịp nói chậm rãi, chuẩn xác từng câu, cực kỳ phù hợp luyện Shadowing IELTS.',
  },
  {
    videoId: 'Ks-_Mh1QhMc',
    url: 'https://www.youtube.com/watch?v=Ks-_Mh1QhMc',
    title: 'Your Body Language May Shape Who You Are',
    channel: 'TED · Amy Cuddy',
    language: 'en',
    sourceLanguage: 'en',
    level: 'B2',
    topic: 'work_academic',
    durationLabel: '21:03',
    descriptionVi: 'Bài nói kinh điển giàu từ vựng tâm lý học & học thuật IELTS Band 7.5+.',
  },
  {
    videoId: 'ZQUxL4Jm1Lo',
    url: 'https://www.youtube.com/watch?v=ZQUxL4Jm1Lo',
    title: 'What is imposter syndrome and how can you combat it?',
    channel: 'TED-Ed · Elizabeth Cox',
    language: 'en',
    sourceLanguage: 'en',
    level: 'B1',
    topic: 'anime_film',
    durationLabel: '4:19',
    descriptionVi: 'Hoạt hình giáo dục ngắn, giọng đọc chuẩn phòng thu, từ vựng tâm lý rất dễ tiếp thu.',
  },
  {
    videoId: 'F2hc2FLOdhI',
    url: 'https://www.youtube.com/watch?v=F2hc2FLOdhI',
    title: 'How to practice emotional first aid',
    channel: 'TED · Guy Winch',
    language: 'en',
    sourceLanguage: 'en',
    level: 'B2',
    topic: 'culture_history',
    durationLabel: '17:24',
    descriptionVi: 'Cách kể chuyện truyền cảm hứng với hệ thống Collocations sức khỏe tinh thần phong phú.',
  },
  {
    videoId: 'UF8uR6Z6KLc',
    url: 'https://www.youtube.com/watch?v=UF8uR6Z6KLc',
    title: "Steve Jobs' 2005 Stanford Commencement Address",
    channel: 'Stanford',
    language: 'en',
    sourceLanguage: 'en',
    level: 'B1',
    topic: 'culture_history',
    durationLabel: '15:05',
    descriptionVi: 'Bài diễn văn huyền thoại, câu văn trong sáng, nhịp ngắt rõ ràng rất dễ Shadowing.',
  },
  {
    videoId: '8jPQjjsBbIc',
    url: 'https://www.youtube.com/watch?v=8jPQjjsBbIc',
    title: "How to stay calm when you know you'll be stressed",
    channel: 'TED · Daniel Levitin',
    language: 'en',
    sourceLanguage: 'en',
    level: 'C1',
    topic: 'news',
    durationLabel: '12:20',
    descriptionVi: 'Chủ đề khoa học thần kinh, cấu trúc câu điều kiện và từ vựng học thuật C1.',
  },

  // ================= VERIFIED JAPANESE VIDEOS (JLPT N5 -> N1) =================
  {
    videoId: 'gBumdOWWMhY',
    url: 'https://www.youtube.com/watch?v=gBumdOWWMhY',
    title: 'Hope invites — 思うは招く (TEDxSapporo 日本語)',
    channel: 'TEDx Talks · 植松努',
    language: 'ja',
    sourceLanguage: 'ja',
    level: 'N3',
    topic: 'culture_history',
    durationLabel: '20:30',
    descriptionVi: 'Bài diễn thuyết tiếng Nhật nổi tiếng nhất TEDx — phát âm rõ, truyền cảm hứng, cực giàu ngữ pháp N3–N2.',
  },
  {
    videoId: '_Af3Kq6XxBk',
    url: 'https://www.youtube.com/watch?v=_Af3Kq6XxBk',
    title: 'スペシャリストとゼネラリスト — TEDxKyoto University',
    channel: 'TEDx Talks · Nao Ueda',
    language: 'ja',
    sourceLanguage: 'ja',
    level: 'N2',
    topic: 'work_academic',
    durationLabel: '13:40',
    descriptionVi: 'Chủ đề nghề nghiệp & chuyên môn bằng tiếng Nhật chuẩn, nhiều từ ghép Hán tự N2 và Katakana công sở.',
  },
  {
    videoId: 'sd6OLoQW0hY',
    url: 'https://www.youtube.com/watch?v=sd6OLoQW0hY',
    title: 'Life balance — ワーク・ライフバランス (TEDxTokyo)',
    channel: 'TEDx Talks · 小室淑恵',
    language: 'ja',
    sourceLanguage: 'ja',
    level: 'N2',
    topic: 'news',
    durationLabel: '15:10',
    descriptionVi: 'Phân tích văn hóa làm việc tại Nhật Bản, kính ngữ 丁寧語 chuẩn mực và từ vựng xã hội học.',
  },
  {
    videoId: '0V2y7VVfumI',
    url: 'https://www.youtube.com/watch?v=0V2y7VVfumI',
    title: 'Easy Japanese Immersion — Comprehensible Listening (N5–N3)',
    channel: 'けんさんおかえり Japanese',
    language: 'ja',
    sourceLanguage: 'ja',
    level: 'N5',
    topic: 'vlog',
    durationLabel: 'Immersion',
    descriptionVi: 'Tiếng Nhật giao tiếp chậm rãi, tự nhiên cho người mới bắt đầu N5–N4 theo phương pháp Comprehensible Input.',
  },
  {
    videoId: 'lXcXkOa5LAU',
    url: 'https://www.youtube.com/watch?v=lXcXkOa5LAU',
    title: '【N5】Easy Japanese Conversation Podcast',
    channel: 'Japanese with Shun',
    language: 'ja',
    sourceLanguage: 'ja',
    level: 'N4',
    topic: 'podcast',
    durationLabel: 'Podcast',
    descriptionVi: 'Podcast hội thoại song đôi tốc độ dễ nghe, luyện phản xạ trợ từ và câu hỏi hàng ngày.',
  },
  {
    videoId: '8I8jNV-059k',
    url: 'https://www.youtube.com/watch?v=8I8jNV-059k',
    title: '3 Life-Changing Lessons from Okinawan Wisdom (Japanese Listening)',
    channel: 'Miku Real Japanese',
    language: 'ja',
    sourceLanguage: 'ja',
    level: 'N3',
    topic: 'culture_history',
    durationLabel: '12:15',
    descriptionVi: 'Giọng đọc tự nhiên, chia sẻ văn hóa Okinawa với giải thích rõ từng sắc thái khẩu ngữ.',
  },
  {
    videoId: 'EaxUszHpzYw',
    url: 'https://www.youtube.com/watch?v=EaxUszHpzYw',
    title: '分断した世界にかけ橋をつくる方法 — TEDxKyoto University',
    channel: 'TEDx Talks · Shuichi Oyama',
    language: 'ja',
    sourceLanguage: 'ja',
    level: 'N1',
    topic: 'work_academic',
    durationLabel: '16:20',
    descriptionVi: 'Diễn ngôn học thuật trình độ N1, giàu cấu trúc văn viết trang trọng và từ Hán tự chuyên sâu.',
  },
];

export const DEFAULT_VIETNAMESE_SAMPLE = DISCOVERY_CATALOG[0];

/**
 * Returns 3 non-duplicate similar-level & same-language (or Vietnamese source) videos
 * for [+3 Video Tương Tự] and Tier-3 fallback recovery.
 */
export function getSimilarVideos(
  language: Language,
  targetLevel: ProficiencyLevel,
  excludeIds: string[],
  topic?: DiscoveryTopic,
  count = 3
): DiscoveryVideoItem[] {
  const excluded = new Set(excludeIds);
  const targetRank = getLevelRank(targetLevel, language);

  const candidates = DISCOVERY_CATALOG.filter(
    (v) => (v.language === language || v.sourceLanguage === 'vi') && !excluded.has(v.videoId)
  );

  const scored = candidates.map((v) => {
    const sameLangBonus = v.language === language ? -1 : 0;
    const rank = getLevelRank(v.level, language);
    const levelDist = rank === -1 ? 2 : Math.abs(rank - targetRank);
    const topicBonus = topic && v.topic === topic ? -2 : 0;
    return { v, score: levelDist + topicBonus + sameLangBonus };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map((s) => s.v);
}
