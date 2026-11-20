import React, { useRef, useState } from 'react';
import { AlertCircle, FileUp, Languages, X } from 'lucide-react';
import type { Language, SourceLanguage, SubtitleLine } from '../types';
import { parseSubtitleFile } from '../lib/youtube';

interface SubtitleUploadModalProps {
  isOpen: boolean;
  noticeMessage?: string | null;
  videoTitle?: string;
  language: Language;
  onClose: () => void;
  onConfirmSubtitles: (lines: SubtitleLine[], sourceLang: SourceLanguage) => void;
}

export const SubtitleUploadModal: React.FC<SubtitleUploadModalProps> = ({
  isOpen,
  noticeMessage,
  videoTitle,
  language,
  onClose,
  onConfirmSubtitles,
}) => {
  const [pastedText, setPastedText] = useState('');
  const [sourceLang, setSourceLang] = useState<SourceLanguage>('vi');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const processRawContent = (raw: string) => {
    setError(null);
    const parsed = parseSubtitleFile(raw);
    if (parsed.length === 0) {
      setError(
        'Vui lòng dán ít nhất 1 câu thoại (chấp nhận file .srt/.vtt, transcript có mốc [MM:SS] hoặc văn bản Tiếng Việt/Anh/Nhật thuần túy).'
      );
      return;
    }
    setPastedText('');
    onConfirmSubtitles(parsed, sourceLang);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      processRawContent(content);
    } catch {
      setError('Không thể đọc file phụ đề này.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl zen-surface border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto zen-scroll"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Hộp Cứu Hộ Phụ Đề — Tải .SRT/.VTT hoặc Dán Văn Bản"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">
              Hộp Cứu Hộ Phụ Đề (Tầng 4 — Không Bế Tắc)
            </h3>
            <p className="text-xs opacity-70 mt-0.5">
              {videoTitle
                ? `Video: ${videoTitle}`
                : 'Tải .srt/.vtt hoặc dán thẳng đoạn thoại Tiếng Việt / Anh / Nhật để học ngay.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-8 h-8 flex items-center justify-center rounded-lg opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {noticeMessage && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs leading-relaxed">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>{noticeMessage}</span>
          </div>
        )}

        {/* Source Language Toggle */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold flex items-center gap-1.5 opacity-80">
            <Languages className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>Ngôn ngữ của nội dung bạn sắp nạp:</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSourceLang('vi')}
              className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                sourceLang === 'vi'
                  ? 'bg-indigo-500/10 border-indigo-500'
                  : 'zen-surface-subtle opacity-80 hover:opacity-100'
              }`}
            >
              <div className="text-xs font-bold">Tiếng Việt gốc</div>
              <div className="text-[11px] opacity-70 mt-0.5">
                Tự chuyển ngữ sang {language === 'ja' ? 'Tiếng Nhật (日本語)' : 'Tiếng Anh (English)'}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSourceLang(language)}
              className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                sourceLang !== 'vi'
                  ? 'bg-indigo-500/10 border-indigo-500'
                  : 'zen-surface-subtle opacity-80 hover:opacity-100'
              }`}
            >
              <div className="text-xs font-bold">
                {language === 'ja' ? 'Tiếng Nhật gốc (日本語)' : 'Tiếng Anh gốc (English)'}
              </div>
              <div className="text-[11px] opacity-70 mt-0.5">
                Tự thêm {language === 'ja' ? 'Furigana' : 'IPA'} &amp; dịch Tiếng Việt
              </div>
            </button>
          </div>
        </div>

        {/* File Picker Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-black/15 dark:border-white/15 hover:border-indigo-500 rounded-xl p-5 text-center cursor-pointer transition-colors"
        >
          <FileUp
            className="w-7 h-7 text-indigo-600 dark:text-indigo-400 mx-auto mb-1.5"
            strokeWidth={1.6}
          />
          <p className="text-xs sm:text-sm font-semibold">
            Chọn file .srt, .vtt hoặc .txt từ máy tính
          </p>
          <p className="text-[11px] opacity-65 mt-0.5">
            Giữ nguyên mốc thời gian nếu có, hoặc tự động chia nhịp đồng bộ nếu là văn bản thuần
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt,.vtt,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Or Paste Directly */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold opacity-80">
            Hoặc dán trực tiếp văn bản Tiếng Việt / Transcript YouTube / SRT vào đây:
          </label>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={5}
            placeholder={
              sourceLang === 'vi'
                ? 'Ví dụ: Xin chào các bạn, hôm nay chúng ta sẽ cùng bàn về cách xây dựng thói quen học ngoại ngữ bền vững mỗi ngày...'
                : 'Dán nội dung .SRT / .VTT hoặc đoạn thoại gốc vào đây...'
            }
            className="w-full p-3 text-xs rounded-xl zen-surface-subtle border focus:outline-none focus:border-indigo-500"
          />
        </div>

        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 text-xs font-medium rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            disabled={!pastedText.trim()}
            onClick={() => processRawContent(pastedText)}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 cursor-pointer"
          >
            Nạp nội dung &amp; Học ngay
          </button>
        </div>
      </div>
    </div>
  );
};
