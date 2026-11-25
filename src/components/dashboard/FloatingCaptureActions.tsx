import { Camera, Mic } from 'lucide-react';
import { t, type AppLanguage } from '../../lib/i18n';

interface FloatingCaptureActionsProps {
  language: AppLanguage;
  onOpenVoice: () => void;
  onOpenCamera: () => void;
}

export function FloatingCaptureActions({
  language,
  onOpenVoice,
  onOpenCamera,
}: FloatingCaptureActionsProps) {
  return (
    <div
      className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-30 flex items-center gap-3"
      role="group"
      aria-label={t(language, 'appName')}
    >
      <button
        type="button"
        data-testid="fab-camera"
        onClick={onOpenCamera}
        aria-label={t(language, 'homeFabCamera')}
        className="min-h-[56px] px-4 sm:px-5 rounded-2xl bg-white hover:bg-slate-50 text-slate-900 border-2 border-slate-900/15 font-semibold text-sm sm:text-base shadow-xl shadow-slate-900/15 flex items-center gap-2.5 transition-transform active:scale-[0.97] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 whitespace-nowrap"
      >
        <Camera className="w-5 h-5 shrink-0 text-slate-800" aria-hidden="true" />
        <span>{t(language, 'homeFabCamera')}</span>
      </button>

      <button
        type="button"
        data-testid="fab-voice"
        onClick={onOpenVoice}
        aria-label={t(language, 'homeFabVoice')}
        className="min-h-[56px] px-5 sm:px-6 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm sm:text-base shadow-lg shadow-emerald-900/25 flex items-center gap-2.5 transition-transform active:scale-[0.97] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 whitespace-nowrap"
      >
        <Mic className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span>{t(language, 'homeFabVoice')}</span>
      </button>
    </div>
  );
}
