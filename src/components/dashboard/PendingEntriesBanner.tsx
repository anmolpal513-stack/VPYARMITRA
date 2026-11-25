import { ChevronRight, Clock } from 'lucide-react';
import { t, type AppLanguage } from '../../lib/i18n';

interface PendingEntriesBannerProps {
  language: AppLanguage;
  pendingCount: number;
  loading: boolean;
  onOpenConfirmation: () => void;
}

export function PendingEntriesBanner({
  language,
  pendingCount,
  loading,
  onOpenConfirmation,
}: PendingEntriesBannerProps) {
  if (loading) {
    return (
      <div
        aria-busy="true"
        className="h-20 rounded-2xl bg-slate-200/70 animate-pulse"
      />
    );
  }

  if (pendingCount <= 0) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="pending-entries-banner"
      onClick={onOpenConfirmation}
      className="w-full min-h-[68px] p-4 sm:px-5 rounded-2xl bg-amber-50 hover:bg-amber-100/80 border border-amber-300 text-left flex items-center justify-between gap-4 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 active:scale-[0.995]"
    >
      <div className="flex items-start gap-3.5 min-w-0">
        <span className="w-11 h-11 rounded-xl bg-amber-700 text-white font-mono font-bold text-lg tabular-nums flex items-center justify-center shrink-0">
          {pendingCount}
        </span>

        <div className="min-w-0 space-y-0.5">
          <div className="text-base font-bold text-amber-950 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-800 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {t(language, 'homePendingBannerTitle', { count: pendingCount })}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-amber-900 leading-snug">
            {t(language, 'homePendingBannerSub')}
          </p>
        </div>
      </div>

      <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-950 whitespace-nowrap shrink-0">
        <span className="hidden sm:inline">{t(language, 'homePendingBannerAction')}</span>
        <ChevronRight className="w-5 h-5" aria-hidden="true" />
      </span>
    </button>
  );
}
