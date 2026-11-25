import { AlertTriangle, ArrowDownRight, ArrowUpRight, TrendingUp } from 'lucide-react';
import { t, type AppLanguage } from '../../lib/i18n';
import { formatINR, type TodayDashboardTotals } from '../../lib/finance';

interface TodaySummaryCardsProps {
  language: AppLanguage;
  totals: TodayDashboardTotals;
  loading: boolean;
  onOpenMissingAmountExpenses: () => void;
}

export function TodaySummaryCards({
  language,
  totals,
  loading,
  onOpenMissingAmountExpenses,
}: TodaySummaryCardsProps) {
  if (loading) {
    return (
      <section
        aria-label={t(language, 'homeTodayHeading')}
        aria-busy="true"
        data-testid="today-summary-skeleton"
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        {[1, 2, 3].map((idx) => (
          <div
            key={idx}
            className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3"
          >
            <div className="h-4 w-28 rounded bg-slate-200 animate-pulse" />
            <div className="h-9 w-36 rounded bg-slate-200 animate-pulse" />
            <div className="h-3.5 w-44 rounded bg-slate-100 animate-pulse" />
          </div>
        ))}
      </section>
    );
  }

  const isNegativeProfit = totals.estimatedProfitPaise < 0;

  return (
    <section
      aria-label={t(language, 'homeTodayHeading')}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {/* Card 1: Today's Sales */}
        <article className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-600">
              {t(language, 'homeTodaySales')}
            </h2>
            <ArrowUpRight className="w-5 h-5 text-emerald-700 shrink-0" aria-hidden="true" />
          </div>

          <div
            data-testid="card-today-sales"
            className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-800 tracking-tight"
          >
            {formatINR(totals.todaySalesPaise)}
          </div>

          <p className="text-xs text-slate-500">
            {t(language, 'homeEntriesCount', { count: totals.confirmedSalesCount })}
          </p>
        </article>

        {/* Card 2: Today's Expenses (+ Missing Amount Warning Action) */}
        <article className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-600">
              {t(language, 'homeTodayExpenses')}
            </h2>
            <ArrowDownRight className="w-5 h-5 text-red-700 shrink-0" aria-hidden="true" />
          </div>

          <div
            data-testid="card-today-expenses"
            className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-red-700 tracking-tight"
          >
            {formatINR(totals.todayExpensesPaise)}
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              {t(language, 'homeEntriesCount', { count: totals.confirmedExpensesCount })}
            </p>

            {totals.missingAmountExpensesCount > 0 && (
              <button
                type="button"
                data-testid="missing-expense-warning"
                onClick={onOpenMissingAmountExpenses}
                className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 text-xs font-semibold flex items-center gap-2 text-left transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
                <span className="leading-snug">
                  {t(language, 'homeMissingAmountWarning', {
                    count: totals.missingAmountExpensesCount,
                  })}
                </span>
              </button>
            )}
          </div>
        </article>

        {/* Card 3: Estimated Profit (= Sales - Expenses) */}
        <article className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200 tracking-wide">
              {t(language, 'homeEstimatedProfit')}
            </h2>
            <TrendingUp
              className={`w-5 h-5 shrink-0 ${
                isNegativeProfit ? 'text-amber-300' : 'text-emerald-400'
              }`}
              aria-hidden="true"
            />
          </div>

          <div
            data-testid="card-estimated-profit"
            className={`text-2xl sm:text-3xl font-bold font-mono tabular-nums tracking-tight ${
              isNegativeProfit ? 'text-amber-300' : 'text-white'
            }`}
          >
            {formatINR(totals.estimatedProfitPaise)}
          </div>

          <p className="text-xs text-slate-300">{t(language, 'homeProfitFormula')}</p>
        </article>
      </div>
    </section>
  );
}
