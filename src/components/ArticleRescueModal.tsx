import React, { useRef, useState } from 'react';
import {
  FileText,
  FileUp,
  Loader2,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { parseRawArticleApi, type ExtractedArticleApiResponse } from '../lib/api';

interface ArticleRescueModalProps {
  isOpen: boolean;
  blockedUrl?: string;
  blockedDomain?: string;
  reasonVi?: string;
  onClose: () => void;
  onArticleParsed: (article: ExtractedArticleApiResponse) => void;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp đã chọn.'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc nội dung tệp văn bản.'));
    reader.readAsText(file, 'utf-8');
  });
}

export const ArticleRescueModal: React.FC<ArticleRescueModalProps> = ({
  isOpen,
  blockedUrl,
  blockedDomain,
  reasonVi,
  onClose,
  onArticleParsed,
}) => {
  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    setError(null);
    const name = file.name || 'article';
    const lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) {
      if (file.size > 14 * 1024 * 1024) {
        setError('Tệp PDF vượt quá 14MB. Vui lòng chọn tệp gọn hơn hoặc dán văn bản.');
        return;
      }
      try {
        const b64 = await readFileAsBase64(file);
        setPdfBase64(b64);
        setPdfFileName(name);
        if (!title.trim()) setTitle(name.replace(/\.pdf$/i, ''));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể đọc tệp PDF.');
      }
      return;
    }

    if (lower.endsWith('.txt') || lower.endsWith('.md') || file.type.startsWith('text/')) {
      try {
        const txt = await readFileAsText(file);
        setPdfBase64(null);
        setPdfFileName(null);
        setRawText(txt);
        if (!title.trim()) setTitle(name.replace(/\.(txt|md)$/i, ''));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể đọc tệp văn bản.');
      }
      return;
    }

    setError('Hỗ trợ tệp .txt, .md hoặc .pdf. Bạn cũng có thể copy–paste trực tiếp văn bản bài viết.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfBase64 && rawText.trim().length < 20) {
      setError('Vui lòng dán nội dung bài viết (ít nhất 1 đoạn) hoặc thả tệp .txt / .md / .pdf.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const parsed = await parseRawArticleApi({
        rawText: pdfBase64 ? undefined : rawText.trim(),
        pdfBase64: pdfBase64 || undefined,
        title: title.trim() || undefined,
        sourceUrl: blockedUrl || undefined,
      });
      setTitle('');
      setRawText('');
      setPdfBase64(null);
      setPdfFileName(null);
      onArticleParsed(parsed);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Chưa thể phân tích nội dung bài viết lúc này. Vui lòng thử lại.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto zen-scroll rounded-2xl zen-surface border shadow-2xl p-5 sm:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Nhập nội dung bài viết hoặc tải tệp đọc học ngoại ngữ"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h3 className="text-base sm:text-lg font-bold leading-snug flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>
                {blockedDomain
                  ? `Trang ${blockedDomain} đang khóa đọc tự động`
                  : 'Dán bài viết hoặc tải tệp (.TXT · .MD · .PDF)'}
              </span>
            </h3>
            <p className="text-xs opacity-75 leading-relaxed">
              {reasonVi ||
                'Dán trực tiếp bài báo, tài liệu học thuật, email hoặc thả tệp Tiếng Việt / Tiếng Anh / Tiếng Nhật. Hệ thống sẽ tự nhận diện ngôn ngữ và mở Phòng Đọc 3 Ngôn Ngữ ngay lập tức.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-8 h-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {blockedDomain && (
          <div className="rounded-xl zen-surface-subtle border p-3 flex items-start gap-2.5 text-xs">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <div className="font-semibold">
                Gợi ý 5 giây để đọc bài từ {blockedDomain}:
              </div>
              <div className="opacity-75">
                Mở bài viết trên trình duyệt của bạn, nhấn <kbd className="px-1 py-0.5 rounded border text-[11px] font-mono-tabular">Ctrl+A</kbd>{' '}
                rồi <kbd className="px-1 py-0.5 rounded border text-[11px] font-mono-tabular">Ctrl+C</kbd> và dán vào ô dưới đây — hệ thống sẽ tự lọc sạch rác và chuyển ngữ Việt ↔ Anh ↔ Nhật trọn vẹn 100%.
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* File Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-xl border-2 border-dashed p-3.5 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-indigo-500 bg-indigo-500/5'
                : 'border-black/15 dark:border-white/15 hover:border-indigo-500/60 zen-surface-subtle'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            {pdfFileName ? (
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                <FileUp className="w-4 h-4" />
                <span className="truncate max-w-xs">Đã nạp tệp PDF: {pdfFileName}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPdfBase64(null);
                    setPdfFileName(null);
                  }}
                  className="text-rose-500 hover:underline ml-1 cursor-pointer"
                >
                  Gỡ tệp
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-xs opacity-75">
                <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>
                  Kéo thả hoặc bấm chọn tệp <strong>.TXT</strong>, <strong>.MD</strong> hoặc{' '}
                  <strong>.PDF</strong> (tối đa 14MB)
                </span>
              </div>
            )}
          </div>

          {/* Optional Title */}
          <div>
            <label className="block text-xs font-semibold mb-1 opacity-80">
              Tiêu đề bài viết (tuỳ chọn — hệ thống tự nhận diện nếu để trống)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Cách người Nhật rèn luyện tư duy Kaizen mỗi ngày..."
              className="w-full h-9 px-3 text-xs sm:text-sm rounded-lg zen-surface-subtle border focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Raw Article Textarea */}
          {!pdfBase64 && (
            <div>
              <label className="block text-xs font-semibold mb-1 opacity-80">
                Nội dung bài viết (Tiếng Việt · Tiếng Anh · Tiếng Nhật)
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={8}
                placeholder="Dán toàn bộ nội dung bài báo, blog hoặc tài liệu vào đây. Không giới hạn độ dài..."
                className="w-full p-3 text-xs sm:text-sm rounded-xl zen-surface-subtle border focus:outline-none focus:border-indigo-500 leading-relaxed resize-y"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">{error}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 text-xs font-semibold rounded-lg zen-surface-subtle border hover:opacity-90 cursor-pointer"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (!pdfBase64 && rawText.trim().length < 20)}
              className="h-9 px-5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 sepia:bg-amber-800 sepia:hover:bg-amber-900 disabled:opacity-45 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang phân tích bài viết...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Mở Phòng Đọc 3 Ngôn Ngữ</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
