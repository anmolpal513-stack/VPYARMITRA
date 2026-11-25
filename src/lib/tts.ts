import type { AppLanguage } from './i18n';

export interface TtsSpeakOptions {
  text: string;
  language: AppLanguage;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Ignore browser speech cancellation edge cases
  }
}

function pickBestVoice(language: AppLanguage): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const targetPrefix = language === 'hi' ? 'hi' : 'en-in';
  const fallbackPrefix = language === 'hi' ? 'hi-in' : 'en';

  const exact = voices.find((v) => v.lang.toLowerCase() === (language === 'hi' ? 'hi-in' : 'en-in'));
  if (exact) return exact;

  const primary = voices.find((v) => v.lang.toLowerCase().startsWith(targetPrefix));
  if (primary) return primary;

  const secondary = voices.find((v) => v.lang.toLowerCase().startsWith(fallbackPrefix));
  return secondary ?? null;
}

export function speakText(options: TtsSpeakOptions): boolean {
  if (!isSpeechSynthesisSupported()) {
    options.onError?.();
    return false;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(options.text);
    utterance.lang = options.language === 'hi' ? 'hi-IN' : 'en-IN';
    utterance.rate = options.rate ?? (options.language === 'hi' ? 0.94 : 0.98);
    utterance.pitch = 1;

    const voice = pickBestVoice(options.language);
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = () => options.onError?.();

    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    options.onError?.();
    return false;
  }
}
