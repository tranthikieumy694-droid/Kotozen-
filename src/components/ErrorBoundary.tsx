import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  sectionName?: string;
  inline?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

function sanitizeUiCrashMessage(raw?: string): string {
  if (!raw) return 'Phân hệ này gặp sự cố hiển thị tạm thời. Các phần khác vẫn hoạt động bình thường.';
  const looksTechnical =
    /\{[\s\S]*["']error["']|status|code|TypeError|ReferenceError|undefined|null|Cannot read|at\s+\w+/i.test(
      raw
    );
  return looksTechnical
    ? 'Phân hệ này gặp sự cố hiển thị tạm thời. Bấm tải lại khung để tiếp tục học.'
    : raw;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: sanitizeUiCrashMessage(error?.message),
    };
  }

  componentDidCatch(error: Error): void {
    console.warn(`[KotoZen ErrorBoundary:${this.props.sectionName || 'Root'}]`, error?.message);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.inline) {
        return (
          <div className="rounded-2xl zen-surface border p-5 text-center space-y-3 min-w-0 max-w-full">
            <AlertTriangle className="w-7 h-7 text-amber-500 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold">
                Khung {this.props.sectionName || 'chức năng'} đang tạm nghỉ
              </h3>
              <p className="text-xs opacity-70 max-w-sm mx-auto leading-relaxed">
                {this.state.message}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="h-8 px-3.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Tải lại khung này</span>
            </button>
          </div>
        );
      }

      return (
        <div className="min-h-screen zen-canvas flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl zen-surface border p-6 text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <div className="space-y-1">
              <h2 className="text-base font-bold">
                KotoZen đã kích hoạt chế độ bảo vệ
              </h2>
              <p className="text-xs opacity-70 leading-relaxed">
                {this.state.message}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="h-9 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Tải lại khung này</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

