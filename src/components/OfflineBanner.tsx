import { WifiOff } from 'lucide-react';
import { t, type AppLanguage } from '../lib/i18n';

interface OfflineBannerProps {
  language: AppLanguage;
  isOffline: boolean;
}

export function OfflineBanner({ language, isOffline }: OfflineBannerProps) {
  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-amber-950"
    >
      <div className="max-w-5xl mx-auto flex items-center gap-3 text-sm">
        <WifiOff className="w-4 h-4 shrink-0 text-amber-800" aria-hidden="true" />
        <p className="leading-snug">
          <strong className="font-semibold">{t(language, 'offlineBannerTitle')}</strong>
          <span className="mx-1.5 text-amber-700" aria-hidden="true">
            ·
          </span>
          <span className="text-amber-900">{t(language, 'offlineBannerDesc')}</span>
        </p>
      </div>
    </div>
  );
}
