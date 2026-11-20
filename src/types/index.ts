export type Language = 'en' | 'ja';
export type SourceLanguage = 'vi' | 'en' | 'ja';
export type ThemeMode = 'washi' | 'dark' | 'sepia';

export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type ProficiencyLevel = JlptLevel | CefrLevel;

export type SubtitleSourceLayer =
  | 'manual'
  | 'asr_restored'
  | 'vi_to_target'
  | 'stt_ai'
  | 'uploaded'
  | 'curated';

export interface RubySegment {
  base: string;
  reading?: string;
}

export interface PitchMora {
  text: string;
  pitch: 'L' | 'H';
  drop?: boolean;
}

export interface PitchAccent {
  patternName: string;
  downstep: number;
  morae: PitchMora[];
}

export interface ConnectedSpeechMark {
  phrase: string;
  type: 'linking' | 'elision' | 'weak_form' | 'assimilation';
  notation: string;
  explanation: string;
}

export interface SubtitleToken {
  id: string;
  surface: string;
  lemma: string;
  isPunctuation?: boolean;
  isMultiWord?: boolean;
  phraseType?: 'word' | 'phrasal_verb' | 'idiom' | 'collocation' | 'grammar';
  level?: ProficiencyLevel;
  isIeltsAcademic?: boolean;
  furigana?: string;
  ruby?: RubySegment[];
  pitchDownstep?: number;
  ipa?: string;
  linkedToNext?: boolean;
  weakForm?: boolean;
}

export interface SubtitleLine {
  id: string;
  index: number;
  start: number;
  duration: number;
  end: number;
  text: string;
  readingMap?: string;
  inlineRubyText?: string;
  rawText?: string;
  translationVi: string;
  tokens: SubtitleToken[];
  connectedSpeech?: ConnectedSpeechMark[];
  ipaLine?: string;
  enriched?: boolean;
}

export interface RawSourceLine {
  id: string;
  index: number;
  start: number;
  duration: number;
  text: string;
}

export type CollocationTier = 'casual' | 'natural' | 'academic';

export interface CollocationAntiCalque {
  correctForm: string;
  wrongTrap: string;
  particleOrPrepHighlight?: string;
  explanationVi: string;
}

export interface CollocationTierVariant {
  expression: string;
  readingOrIpa: string;
  hanViet?: string;
  level: ProficiencyLevel;
  exampleSentence: string;
  nuanceVi: string;
}

export interface CollocationUpgradeLadder {
  conceptVi: string;
  casual: CollocationTierVariant;
  natural: CollocationTierVariant;
  academic: CollocationTierVariant;
  contextCompareVi: string;
}

export interface DetectedCollocation {
  phrase: string;
  patternFormula: string;
  tier: CollocationTier;
  level: ProficiencyLevel;
  readingOrIpa: string;
  hanViet?: string;
  meaningVi: string;
}

export interface WordFamilyEntry {
  pos: string;
  word: string;
  ipa?: string;
  exampleShort: string;
}

export interface TransitivityPair {
  intransitive: string;
  intransitiveReading: string;
  intransitiveParticle: string;
  transitive: string;
  transitiveReading: string;
  transitiveParticle: string;
  differenceVi: string;
}

export interface JukugoItem {
  word: string;
  reading: string;
  hanViet: string;
  meaningVi: string;
}

export interface MorphemeBreakdown {
  prefix?: string;
  root: string;
  suffix?: string;
  rootMeaningVi: string;
}

export interface WordExtraCollocation {
  expression: string;
  tier: CollocationTier;
  level: ProficiencyLevel;
  readingOrIpa: string;
  hanViet?: string;
  meaningVi: string;
  exampleSentence: string;
}

export type KanjiStructureType = 'Tượng hình' | 'Chỉ sự' | 'Hội ý' | 'Hình thanh' | 'Quốc tự';
export type KanjiComponentRole = 'Nghĩa phù' | 'Thanh phù' | 'Thành phần';

export interface KanjiRadicalInfo {
  symbol: string;
  kangxiNumber?: number;
  nameVi: string;
  meaningVi: string;
  positionNote?: string;
}

export interface KanjiComponentItem {
  char: string;
  role: KanjiComponentRole;
  meaning: string;
}

export interface KanjiConfusableItem {
  kanji: string;
  hanViet: string;
  meaningVi: string;
  diffNote?: string;
}

export interface KanjiEtymologyEntry {
  kanji: string;
  hanViet: string;
  strokeCount?: number;
  jlpt?: JlptLevel;
  radical: KanjiRadicalInfo;
  structureType: KanjiStructureType;
  components: KanjiComponentItem[];
  kyujitai?: string;
  etymologyFact: string;
  mnemonicTip?: string;
  onyomi: string[];
  kunyomi: string[];
  activeReading?: string;
  confusables: KanjiConfusableItem[];
}

export interface WordProfile {
  tokenId: string;
  lineId: string;
  surface: string;
  lemma: string;
  partOfSpeech: string;
  contextMeaning: string;
  otherMeanings: string[];
  level: ProficiencyLevel;
  isIeltsAcademic?: boolean;
  usageNote?: string;
  furigana?: string;
  romaji?: string;
  hanViet?: string;
  pitchAccent?: PitchAccent;
  conjugationNote?: string;
  ipaUS?: string;
  ipaUK?: string;
  phraseType?: string;
  connectedSpeechNote?: string;
  collocations?: string[];
  // Layer 2: Memory Anchor (100% Academic Ground-Truth Etymology & Radical Logic)
  kanjiBreakdown?: KanjiEtymologyEntry[];
  radicalAnalysis?: string;
  mnemonicVi?: string;
  morphemeBreakdown?: MorphemeBreakdown;
  // Layer 3: Word Family (EN) & Transitivity Matrix + Jukugo (JA)
  wordFamily?: WordFamilyEntry[];
  transitivityPair?: TransitivityPair;
  topJukugo?: JukugoItem[];
  // Feature 21 & Layer 4/5: Atomic Collocation + 3-Step Upgrade Ladder + Anti-Calque Radar
  detectedCollocation?: DetectedCollocation;
  antiCalque?: CollocationAntiCalque;
  upgradeLadder?: CollocationUpgradeLadder;
  // Dual-Mode Nuance Explanation (Summary 3s + Deep Pragmatic Dossier)
  nuanceDual?: NuanceDualPayload;
}

export interface SyntaxSegment {
  text: string;
  role: string;
  colorKey: 'subject' | 'predicate' | 'clause' | 'particle' | 'modifier' | 'grammar';
  explanation: string;
}

export interface ColloquialItem {
  spoken: string;
  standard: string;
  nuance: string;
}

export interface VerbChainBreakdown {
  surface: string;
  layers: Array<{ part: string; label: string }>;
}

export interface GrammarContrastPair {
  vsPattern: string;
  formula: string;
  coreDifferenceVi: string;
  pairAExample: string;
  pairBExample: string;
}

export interface SentenceGrammarNote {
  pattern: string;
  level: ProficiencyLevel;
  formula: string;
  nuance: string;
  conjugation?: string;
  contrastPairs?: GrammarContrastPair[];
}

export interface RegisterPrismVariant {
  label: string;
  sentence: string;
  readingOrIpa?: string;
  highlights: string[];
  contextNoteVi: string;
}

export interface RegisterPrism {
  casual: RegisterPrismVariant;
  standard: RegisterPrismVariant;
  formal: RegisterPrismVariant;
}

export interface SyntaxXRay {
  lineId: string;
  sentence: string;
  translationVi: string;
  register: string;
  registerReason: string;
  tenseTimelineNote?: string;
  verbChainBreakdowns?: VerbChainBreakdown[];
  segments: SyntaxSegment[];
  colloquialisms: ColloquialItem[];
  grammarPoints: SentenceGrammarNote[];
  registerPrism?: RegisterPrism;
}

export interface CurriculumVocabItem {
  id: string;
  word: string;
  lemma: string;
  readingOrIpa: string;
  hanViet?: string;
  partOfSpeech: string;
  meaningVi: string;
  level: ProficiencyLevel;
  isIeltsAcademic?: boolean;
  occurrences: { lineId: string; start: number; sentence: string }[];
}

export interface CurriculumGrammarItem {
  id: string;
  pattern: string;
  level: ProficiencyLevel;
  formula: string;
  nuance: string;
  conjugation: string;
  exampleSentence: string;
  exampleTranslationVi: string;
  exampleStart: number;
  lineId: string;
}

export interface CurriculumData {
  language: Language;
  targetLevel: ProficiencyLevel;
  vocabulary: CurriculumVocabItem[];
  grammar: CurriculumGrammarItem[];
}

// --- Feature 21: 3-Tier Collocations (Đời thường -> Tự nhiên -> Học thuật) + Dual Drills ---
export interface Collocation3TierItem {
  id: string;
  vietnameseConcept: string;
  patternFormula?: string;
  contextCompareVi?: string;
  timestamp: number;
  antiCalqueTrap: string; // ❌ Vietlish / literal translation mistake to avoid
  antiCalqueCorrect?: string; // ✅ Native correct form
  antiCalqueParticleNote?: string; // Highlighted preposition / particle rule
  casual: CollocationTierVariant; // 🟢 Đời thường
  natural: CollocationTierVariant; // 🔵 Tự nhiên bản xứ
  academic: CollocationTierVariant; // 🟣 Học thuật / IELTS / N1-N2
  // Mode 1 Drill: Partner Cloze (Tìm Nửa Kia)
  quickDrillQuestion: string;
  quickDrillOptions: string[];
  quickDrillCorrectIndex: number;
  // Mode 2 Drill: Style Upgrade (Đổi Tầng Văn Phong)
  styleUpgradePromptVi?: string;
  styleUpgradeCasualSentence?: string;
  styleUpgradeOptions?: string[];
  styleUpgradeCorrectIndex?: number;
}

export interface CollocationWebBranchItem {
  id: string;
  expression: string;
  patternFormula: string;
  readingOrIpa: string;
  hanViet?: string;
  tier: CollocationTier;
  level: ProficiencyLevel;
  meaningVi: string;
  exampleSentence: string;
  antiCalque?: CollocationAntiCalque;
}

export interface CollocationWebData {
  coreWord: string;
  language: Language;
  readingOrIpa: string;
  hanViet?: string;
  meaningVi: string;
  verbNoun: CollocationWebBranchItem[];
  adjNoun: CollocationWebBranchItem[];
  advVerbAdj: CollocationWebBranchItem[];
}

export type CollocationTopicBranch = 'everyday' | 'academic';

export interface CollocationTopicMeta {
  id: string;
  branch: CollocationTopicBranch;
  titleVi: string;
  subtitleVi: string;
}

export interface ThematicCollocationEntry {
  id: string;
  topicId: string;
  branch: CollocationTopicBranch;
  language: Language;
  tier: CollocationTier;
  level: ProficiencyLevel;
  expression: string;
  patternFormula: string;
  readingOrIpa: string;
  hanViet?: string;
  meaningVi: string;
  exampleSentence: string;
  exampleTranslationVi: string;
  antiCalque: CollocationAntiCalque;
  upgradeLadder?: {
    casual: string;
    natural: string;
    academic: string;
    contextCompareVi: string;
  };
}

export interface StudySheetVocab {
  term: string;
  readingOrIpa: string;
  hanViet?: string;
  level: ProficiencyLevel;
  meaningVi: string;
  exampleFromVideo: string;
  timestamp: number;
}

export interface StudySheetGrammar {
  pattern: string;
  level: ProficiencyLevel;
  formula: string;
  explanation: string;
  exampleFromVideo: string;
  timestamp: number;
}

export interface QuizQuestion {
  id: string;
  type: 'listening_comprehension' | 'cloze_fill' | 'grammar_fix';
  prompt: string;
  sentenceContext: string;
  timestamp: number;
  options: string[];
  correctIndex: number;
  explanationVi: string;
}

export interface StudySheetData {
  generatedAt: number;
  summaryVi: string;
  keyTakeaways: string[];
  topVocabulary: StudySheetVocab[];
  coreGrammar: StudySheetGrammar[];
  quiz: QuizQuestion[];
}

// --- Feature 11: Real-Time AI Pronunciation & Intonation Scorer ---
export interface PronunciationWordResult {
  word: string;
  status: 'correct' | 'warning' | 'error';
  score: number;
  issue?: string;
  articulatoryTip?: string;
}

export interface PronunciationAssessment {
  overallScore: number;
  fluencyScore: number;
  intonationScore: number;
  transcriptHeard: string;
  summaryVi: string;
  words: PronunciationWordResult[];
  endingSoundsNote?: string;
  linkingAndStressNote?: string;
  moraRhythmNote?: string;
  referencePitch?: PitchMora[];
  userPitch?: PitchMora[];
}

// --- Feature 12: Video-Context AI Roleplay Studio ---
export interface RoleplayMissionItem {
  term: string;
  meaningVi: string;
  used: boolean;
}

export interface RoleplayMessage {
  id: string;
  role: 'ai' | 'user';
  text: string;
  translationVi?: string;
  correctionVi?: string;
  naturalAlternative?: string;
  usedTerms?: string[];
}

export interface RoleplaySession {
  personaName: string;
  scenarioVi: string;
  turnCount: number;
  maxTurns: number;
  missions: RoleplayMissionItem[];
  messages: RoleplayMessage[];
}

// --- Feature 13: AI Smart Chapters & Mind-Map ---
export interface SmartChapter {
  id: string;
  index: number;
  start: number;
  end: number;
  titleSource: string;
  titleVi: string;
  summaryVi: string;
  difficultyLevel: ProficiencyLevel;
  mindMapNodes: string[];
}

// --- Feature 14: Curated Discovery Hub ---
export type DiscoveryTopic =
  | 'vlog'
  | 'news'
  | 'podcast'
  | 'anime_film'
  | 'culture_history'
  | 'work_academic';

export interface DiscoveryVideoItem {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  language: Language;
  sourceLanguage?: SourceLanguage;
  level: ProficiencyLevel;
  topic: DiscoveryTopic;
  durationLabel: string;
  descriptionVi: string;
}

// --- Feature 15 + Super-System 2: Nuance, Synonym & Homophone Spectrum ---
export interface NuanceCompareItem {
  term: string;
  readingOrIpa: string;
  radicalOrRegisterNote: string;
  meaningVi: string;
  intensityScore?: number; // 1 (nhẹ) .. 5 (mạnh)
  formalityLevel?: string; // Suồng sã | Trung tính | Công sở / Học thuật
  sentiment?: 'positive' | 'neutral' | 'negative';
  coreDifferenceVi?: string;
  signatureCollocation?: string;
  correctExample: string;
  trapWarning: string;
}

export interface NuanceMatrixGroup {
  id: string;
  title: string;
  category: 'homophone' | 'near_synonym' | 'collocation' | 'register_trap';
  timestamp: number;
  summaryVi: string;
  items: NuanceCompareItem[];
  collocationPairs?: string[];
}

// --- Dual-Mode Nuance Explanation (⚡ 3-Second Snapshot <-> 🔬 6-Dimension Pragmatic Dossier) ---
export type NuanceDisplayMode = 'summary' | 'deep';

export interface NuanceSummaryBranch {
  coreRule: string;
  badges: {
    formality: string;
    attitude: string;
    channel: string;
  };
  quickContrast: {
    do: string;
    dont: string;
  };
  anchorExample: {
    sentence: string;
    ruby?: RubySegment[];
    readingOrIpa?: string;
    pitchAccent?: string;
    highlightTerm: string;
    translationVi: string;
  };
}

export interface NuanceAxisScore {
  score: number; // 1..5
  label: string;
  leftEnd: string;
  rightEnd: string;
}

export interface NuanceContrastRow {
  term: string;
  readingOrIpa: string;
  hanViet?: string;
  pitchAccent?: string;
  coreNuanceVi: string;
  whenToUseVi: string;
  minimalPairSentence: string;
  minimalPairVerdict: 'natural' | 'awkward' | 'wrong';
  minimalPairNoteVi: string;
}

export interface NuanceToneTier {
  label: string;
  sentence: string;
  ruby?: RubySegment[];
  readingOrIpa?: string;
  translationVi?: string;
  listenerFeelingVi: string;
}

export interface NuanceExtraScenario {
  id: string;
  situationVi: string;
  recommendedExpression: string;
  readingOrIpa?: string;
  avoidExpression: string;
  whyVi: string;
  translationVi: string;
}

export interface NuanceMicroQuiz {
  situationVi: string;
  questionVi: string;
  options: string[];
  correctIndex: number;
  explanationVi: string;
}

export interface NuanceDeepDiveBranch {
  axes: {
    intensity: NuanceAxisScore;
    formality: NuanceAxisScore;
    connotation: NuanceAxisScore;
    frequency: NuanceAxisScore;
  };
  inVideoPragmatics: {
    whyChosenHereVi: string;
    culturalSubtextLabel: string;
    culturalSubtextVi: string;
  };
  contrastMatrix: NuanceContrastRow[];
  minimalPairSwap: {
    frameSentence: string;
    insightVi: string;
  };
  collocationAndTraps: {
    mustPairWith: string[];
    neverPairWith: string[];
    vietnameseCultureTrapVi: string;
    socialConsequenceVi: string;
  };
  threeTierTransform: {
    casual: NuanceToneTier;
    standard: NuanceToneTier;
    formal: NuanceToneTier;
  };
  microQuiz: NuanceMicroQuiz;
  extraScenarios?: NuanceExtraScenario[];
}

export interface NuanceDualPayload {
  term: string;
  lemma: string;
  language: Language;
  targetLevel: ProficiencyLevel;
  kind: 'word' | 'grammar' | 'collocation' | 'nuance_group';
  summary: NuanceSummaryBranch;
  deepDive: NuanceDeepDiveBranch;
}

// --- Super-System 5: 4-Mode Active Production Lab & Instant Output Coach ---
export interface ContextClozeDrill {
  id: string;
  timestamp: number;
  sentenceWithBlank: string;
  missingAnswer: string;
  acceptedAnswers: string[];
  translationVi: string;
  hintVi: string;
  targetCategory: 'vocab' | 'collocation' | 'particle' | 'tense' | 'grammar';
  explanationVi: string;
}

export interface SentenceBuilderDrill {
  id: string;
  timestamp: number;
  translationVi: string;
  correctChunks: string[];
  shuffledChunks: string[];
  orderRuleVi: string;
}

export interface RedPenErrorDrill {
  id: string;
  timestamp: number;
  tokens: string[];
  errorTokenIndex: number;
  wrongFragment: string;
  fixedFragment: string;
  fixedSentence: string;
  errorCategory: 'particle' | 'transitivity' | 'tense' | 'preposition' | 'calque';
  explanationVi: string;
}

export interface ActiveProductionPack {
  generatedAt: number;
  clozeDrills: ContextClozeDrill[];
  builderDrills: SentenceBuilderDrill[];
  redPenDrills: RedPenErrorDrill[];
  suggestedPrompts: Array<{ targetTerm: string; meaningVi: string; kind: 'vocab' | 'grammar' }>;
}

export interface SentenceCoachFeedback {
  naturalnessTier: 'needs_fix' | 'correct_but_stiff' | 'native_natural';
  naturalnessLabelVi: string;
  redPenCorrections: Array<{
    wrongSegment: string;
    fixedSegment: string;
    reasonVi: string;
  }>;
  nativeUpgrade: string;
  nativeUpgradeReadingOrIpa?: string;
  upgradeNoteVi: string;
  encouragementVi: string;
}

// --- Super-System 6: Personal Weakness Radar (Cross-Video IndexedDB Tracking) ---
export interface WeaknessEntry {
  id: string; // `${language}::${kind}::${normalizedTerm}`
  language: Language;
  kind: 'vocab' | 'grammar' | 'particle' | 'tense';
  term: string;
  lemma: string;
  categoryLabel: string;
  errorCount: number;
  resolvedCount: number;
  lastMissedAt: number;
  lastExample?: string;
  meaningVi?: string;
}

// --- Feature 16: Smart Clip Bookmarks ---
export interface SmartClip {
  id: string;
  videoId: string;
  videoTitle: string;
  language: Language;
  start: number;
  end: number;
  text: string;
  translationVi: string;
  createdAt: number;
}

// --- Feature 18: Timestamped Notes ---
export interface TimestampedNote {
  id: string;
  videoId: string;
  timestamp: number;
  content: string;
  createdAt: number;
}

// --- Feature 19: Comprehensible Input (i+1) & Activity Analytics ---
export interface InputCompatibilityReport {
  knownPercent: number;
  totalUniqueWords: number;
  knownWordsCount: number;
  stretchWordsCount: number;
  verdictLabel: string;
  recommendationVi: string;
}

export interface DailyActivityLog {
  dateKey: string;
  listeningMinutes: number;
  shadowedSentences: number;
  wordsReviewed: number;
  roleplayTurns: number;
}

// --- FSRS Flashcards ---
export type FsrsState = 'new' | 'learning' | 'review' | 'relearning';
export type FsrsRating = 1 | 2 | 3 | 4;

export interface Flashcard {
  id: string;
  kind: 'vocab' | 'grammar';
  language: Language;
  term: string;
  lemma?: string;
  readingOrIpa?: string;
  hanViet?: string;
  level: ProficiencyLevel;
  meaningVi: string;
  extraNotes?: string;
  kanjiBreakdown?: KanjiEtymologyEntry[];
  nuanceDual?: NuanceDualPayload;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  timestamp: number;
  // Optional Article Studio anchoring (100% parity with YouTube timestamp anchors)
  sourceKind?: 'video' | 'article';
  articleId?: string;
  articleUrl?: string;
  paragraphId?: string;
  sentenceId?: string;
  sentence: string;
  sentenceVi: string;
  userNote?: string;
  createdAt: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: FsrsState;
  due: number;
  lastReview?: number;
}

export interface VideoContextAnchor {
  summaryVi: string;
  registerPolicy: string;
  glossary: Array<{ sourceTerm: string; targetTerm: string }>;
}

export interface VideoSession {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  videoDurationSec?: number;
  language: Language;
  sourceLanguage?: SourceLanguage;
  sourceLayer: SubtitleSourceLayer;
  targetLevel: ProficiencyLevel;
  lines: SubtitleLine[];
  sourceViLines?: RawSourceLine[];
  contextAnchor?: VideoContextAnchor;
  isFullyTranslated?: boolean;
  completedLineCount?: number;
  hasMoreStt?: boolean;
  nextSttOffsetSec?: number;
  syncOffsetSec?: number;
  collocations3Tier?: Collocation3TierItem[];
  curriculum?: CurriculumData;
  studySheet?: StudySheetData;
  productionPack?: ActiveProductionPack;
  chapters?: SmartChapter[];
  nuanceMatrix?: NuanceMatrixGroup[];
  xrayCache: Record<string, SyntaxXRay>;
  lastPosition: number;
  updatedAt: number;
  notes?: string;
}

export type RightTab = 'transcript' | 'collocations' | 'curriculum' | 'xray' | 'practice';

export type WorkspaceMode = 'home' | 'video' | 'article';

// ===========================================================================
// UNIVERSAL WEB ARTICLE STUDIO TYPES (Tri-Lingual VI <-> EN <-> JA)
// ===========================================================================
export type ArticleLanguage = 'vi' | 'en' | 'ja';
export type ArticleBlockType = 'lead' | 'h2' | 'h3' | 'p' | 'blockquote' | 'li';
export type ArticleViewMode = 'focus' | 'interlinear' | 'split';

export interface ArticleTranslatedVariant {
  text: string;
  translationVi: string;
  ipaLine?: string;
  tokens: SubtitleToken[];
  enriched: boolean;
}

export interface ArticleSentence {
  id: string; // e.g. "p0_s0"
  index: number; // global 0..N-1
  paragraphId: string;
  sentenceIndexInParagraph: number;
  blockType: ArticleBlockType;
  originalText: string;
  nativeRuby?: RubySegment[];
  variants: Partial<Record<ArticleLanguage, ArticleTranslatedVariant>>;
}

export interface ArticleParagraph {
  id: string; // e.g. "p0"
  index: number;
  blockType: ArticleBlockType;
  text: string;
  sentenceIds: string[];
}

export interface ArticleNote {
  id: string;
  articleId: string;
  paragraphId: string;
  sentenceId?: string;
  content: string;
  createdAt: number;
}

export interface ReadingQuizQuestion {
  id: string;
  skill: 'main_idea' | 'detail' | 'vocab_in_context' | 'inference' | 'author_tone';
  skillLabelVi: string;
  question: string;
  questionVi: string;
  options: string[];
  correctIndex: number;
  evidenceParagraphId: string;
  evidenceQuote: string;
  explanationVi: string;
}

export interface ArticleSession {
  id: string; // `article_${urlHash}`
  url: string;
  domain: string;
  title: string;
  author?: string;
  siteName?: string;
  publishedDate?: string;
  lead?: string;
  sourceLanguage: ArticleLanguage;
  activeLanguage: ArticleLanguage;
  targetLevel: ProficiencyLevel;
  wordCount: number;
  estimatedReadMinutes: number;
  extractionTier?: 'readability_direct' | 'jsonld_fallback' | 'jina_reader' | 'raw_input';
  paragraphs: ArticleParagraph[];
  sentences: ArticleSentence[];
  contextAnchors?: Partial<Record<ArticleLanguage, VideoContextAnchor>>;
  collocations3Tier?: Partial<Record<Language, Collocation3TierItem[]>>;
  curriculum?: Partial<Record<Language, CurriculumData>>;
  studySheet?: Partial<Record<Language, StudySheetData>>;
  productionPack?: Partial<Record<Language, ActiveProductionPack>>;
  nuanceMatrix?: Partial<Record<Language, NuanceMatrixGroup[]>>;
  readingQuiz?: Partial<Record<Language, ReadingQuizQuestion[]>>;
  xrayCache: Record<string, SyntaxXRay>;
  lastSentenceIndex: number;
  updatedAt: number;
}

