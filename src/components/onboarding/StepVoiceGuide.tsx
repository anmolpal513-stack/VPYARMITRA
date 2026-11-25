import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
  BookOpen,
} from 'lucide-react';
import { t, type AppLanguage, type TranslationKey } from '../../lib/i18n';
import { isSpeechSynthesisSupported, speakText, stopSpeaking } from '../../lib/tts';

interface GuideSlide {
  id: number;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  speechKey: TranslationKey;
  imageSrc: string;
}

const GUIDE_SLIDES: GuideSlide[] = [
  {
    id: 1,
    titleKey: 'slide1Title',
    bodyKey: 'slide1Body',
    speechKey: 'slide1Speech',
    imageSrc: '/src/assets/images/guide_kirana_welcome_1795584946794.jpg',
  },
  {
    id: 2,
    titleKey: 'slide2Title',
    bodyKey: 'slide2Body',
    speechKey: 'slide2Speech',
    imageSrc: '/src/assets/images/guide_digital_ledger_1795584947302.jpg',
  },
  {
    id: 3,
    titleKey: 'slide3Title',
    bodyKey: 'slide3Body',
    speechKey: 'slide3Speech',
    imageSrc: '/src/assets/images/guide_digital_ledger_1795584947302.jpg',
  },
  {
    id: 4,
    titleKey: 'slide4Title',
    bodyKey: 'slide4Body',
    speechKey: 'slide4Speech',
    imageSrc: '/src/assets/images/guide_whatsapp_reminder_1795584949520.jpg',
  },
  {
    id: 5,
    titleKey: 'slide5Title',
    bodyKey: 'slide5Body',
    speechKey: 'slide5Speech',
    imageSrc: '/src/assets/images/guide_kirana_welcome_1795584946794.jpg',
  },
];

interface StepVoiceGuideProps {
  language: AppLanguage;
  saving: boolean;
  saveError: string | null;
  onBack?: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

export function StepVoiceGuide({
  language,
  saving,
  saveError,
  onBack,
  onSkip,
  onComplete,
}: StepVoiceGuideProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const ttsSupported = isSpeechSynthesisSupported();

  const currentSlide = GUIDE_SLIDES[slideIndex];
  const isFirst = slideIndex === 0;
  const isLast = slideIndex === GUIDE_SLIDES.length - 1;

  const playSlideAudio = useCallback(
    (idx: number) => {
      const slide = GUIDE_SLIDES[idx];
      if (!slide || !ttsSupported) return;

      speakText({
        text: t(language, slide.speechKey),
        language,
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    },
    [language, ttsSupported]
  );

  useEffect(() => {
    playSlideAudio(slideIndex);
    return () => {
      stopSpeaking();
    };
  }, [slideIndex, playSlideAudio]);

  const handleReplay = () => {
    playSlideAudio(slideIndex);
  };

  const handleToggleSpeech = () => {
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
    } else {
      playSlideAudio(slideIndex);
    }
  };

  const handleNext = () => {
    stopSpeaking();
    if (isLast) {
      onComplete();
    } else {
      setSlideIndex((prev) => Math.min(prev + 1, GUIDE_SLIDES.length - 1));
    }
  };

  const handlePrev = () => {
    stopSpeaking();
    if (isFirst) {
      onBack?.();
    } else {
      setSlideIndex((prev) => Math.max(prev - 1, 0));
    }
  };

  const handleSkipClick = () => {
    stopSpeaking();
    onSkip();
  };

  return (
    <section aria-labelledby="voice-guide-heading" className="space-y-5">
      {/* Header Row */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1
            id="voice-guide-heading"
            className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
          >
            {t(language, 'guideTitle')}
          </h1>
          <p className="text-sm sm:text-base text-slate-600">
            {t(language, 'guideSubtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSkipClick}
          disabled={saving}
          className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-50"
        >
          <span>{t(language, 'guideSkip')}</span>
          <SkipForward className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* 5-Slide Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
          <span>
            {t(language, 'guideSlideCount', {
              current: slideIndex + 1,
              total: GUIDE_SLIDES.length,
            })}
          </span>
          {isSpeaking && (
            <span className="text-emerald-700 font-semibold flex items-center gap-1">
              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t(language, 'guideSpeaking')}</span>
            </span>
          )}
        </div>
        <div className="grid grid-cols-5 gap-2" role="tablist" aria-label={t(language, 'guideTitle')}>
          {GUIDE_SLIDES.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={index === slideIndex}
              aria-label={t(language, 'guideSlideCount', {
                current: index + 1,
                total: GUIDE_SLIDES.length,
              })}
              onClick={() => setSlideIndex(index)}
              className="py-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded"
            >
              <span
                className={`block h-2 rounded-full transition-colors ${
                  index <= slideIndex ? 'bg-emerald-700' : 'bg-slate-200'
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Slide Content Card */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-12 items-stretch">
          {/* Illustration Panel */}
          <div className="md:col-span-5 bg-slate-100 aspect-[4/3] md:aspect-auto relative overflow-hidden">
            {!failedImages[currentSlide.id] ? (
              <img
                src={currentSlide.imageSrc}
                alt={t(language, currentSlide.titleKey)}
                referrerPolicy="no-referrer"
                onError={() =>
                  setFailedImages((prev) => ({ ...prev, [currentSlide.id]: true }))
                }
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full min-h-[200px] bg-gradient-to-br from-emerald-50 to-slate-100 flex flex-col items-center justify-center p-6 text-center gap-3">
                <BookOpen className="w-10 h-10 text-emerald-700" aria-hidden="true" />
                <span className="text-sm font-semibold text-slate-700">
                  {t(language, currentSlide.titleKey)}
                </span>
              </div>
            )}
          </div>

          {/* Slide Narration Copy + Audio Controls */}
          <div className="md:col-span-7 p-5 sm:p-6 flex flex-col justify-between gap-5">
            <div className="space-y-3">
              <div className="text-xs font-semibold text-emerald-800">
                {String(slideIndex + 1).padStart(2, '0')}. {t(language, 'step3Label')}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-snug">
                {t(language, currentSlide.titleKey)}
              </h2>
              <p className="text-base text-slate-700 leading-relaxed">
                {t(language, currentSlide.bodyKey)}
              </p>
            </div>

            {/* TTS Controls */}
            <div className="space-y-2 pt-3 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleReplay}
                  disabled={!ttsSupported}
                  className="min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 font-semibold text-sm flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  <span>{t(language, 'guideReplay')}</span>
                </button>

                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  disabled={!ttsSupported}
                  className="min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  {isSpeaking ? (
                    <>
                      <VolumeX className="w-4 h-4 text-slate-600" aria-hidden="true" />
                      <span>{t(language, 'guidePause')}</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                      <span>{t(language, 'guidePlay')}</span>
                    </>
                  )}
                </button>
              </div>

              {!ttsSupported && (
                <p className="text-xs text-slate-500">{t(language, 'guideTtsUnsupported')}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {saveError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm font-medium text-red-800"
        >
          {saveError}
        </div>
      )}

      {/* Slide Navigation Footer */}
      <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
        <button
          type="button"
          onClick={handlePrev}
          disabled={saving || (isFirst && !onBack)}
          className="sm:w-40 min-h-[54px] px-5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-800 font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          <span>{isFirst ? t(language, 'back') : t(language, 'guidePrevSlide')}</span>
        </button>

        <button
          type="button"
          onClick={handleNext}
          disabled={saving}
          className="flex-1 min-h-[54px] px-6 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold text-base sm:text-lg flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 active:scale-[0.99]"
        >
          {saving ? (
            <span>{t(language, 'saving')}</span>
          ) : isLast ? (
            <>
              <Check className="w-5 h-5" aria-hidden="true" />
              <span>{t(language, 'guideStartApp')}</span>
            </>
          ) : (
            <>
              <span>{t(language, 'guideNextSlide')}</span>
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    </section>
  );
}
