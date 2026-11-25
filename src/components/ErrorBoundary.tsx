import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { t, type AppLanguage } from '../lib/i18n';

interface ErrorBoundaryProps {
  language: AppLanguage;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.error('VyaparMitra UI ErrorBoundary caught error:', error);
  }

  handleReload = (): void => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      const lang = this.props.language;
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-5">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 text-red-700 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-bold text-slate-900">{t(lang, 'errorBoundaryTitle')}</h1>
              <p className="text-base text-slate-600 leading-relaxed">
                {t(lang, 'errorBoundaryDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full min-h-[52px] px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-5 h-5" aria-hidden="true" />
              <span>{t(lang, 'errorBoundaryReload')}</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
