import { ArrowRight, Check } from 'lucide-react';
import { t, type AppLanguage } from '../../lib/i18n';

interface StepLanguageProps {
  language: AppLanguage;
  onSelectLanguage: (lang: AppLanguage) => void;
  onContinue: () => void;
}

export function StepLanguage({
  language,
  onSelectLanguage,
  onContinue,
}: StepLanguageProps) {
  const options: Array<{
    code: AppLanguage;
    glyph: string;
    title: string;
    subtitle: string;
  }> = [
    {
      code: 'hi',
      glyph: 'अ',
      title: t(language, 'langHindiTitle'),
      subtitle: t(language, 'langHindiSubtitle'),
    },
    {
      code: 'en',
      glyph: 'Aa',
      title: t(language, 'langEnglishTitle'),
      subtitle: t(language, 'langEnglishSubtitle'),
    },
  ];

  return (
    <section aria-labelledby="onboarding-lang-heading" className="space-y-6">
      <div className="space-y-2">
        <h1
          id="onboarding-lang-heading"
          className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
        >
          {t(language, 'langTitle')}
        </h1>
        <p className="text-base text-slate-600 leading-relaxed">
          {t(language, 'langSubtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" role="radiogroup" aria-label={t(language, 'langTitle')}>
        {options.map((opt) => {
          const isSelected = language === opt.code;
          return (
            <button
              key={opt.code}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelectLanguage(opt.code)}
              className={`group relative w-full min-h-[144px] p-5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 active:scale-[0.99] ${
                isSelected
                  ? 'border-emerald-700 bg-emerald-50/60'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
              }`}
            >
              <div className="flex items-start justify-between gap-3 w-full">
                <span
                  aria-hidden="true"
                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold transition-colors ${
                    isSelected
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-800 group-hover:bg-slate-200'
                  }`}
                >
                  {opt.glyph}
                </span>

                {isSelected && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800">
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>{t(language, 'langSelected')}</span>
                  </span>
                )}
              </div>

              <div className="pt-4 space-y-1">
                <div className="text-xl font-bold text-slate-900">{opt.title}</div>
                <div className="text-sm text-slate-600 leading-snug">{opt.subtitle}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={onContinue}
          className="w-full min-h-[56px] px-6 py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-lg flex items-center justify-center gap-2.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 active:scale-[0.99]"
        >
          <span>{t(language, 'langContinue')}</span>
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
