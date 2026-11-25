import type { AppLanguage } from './i18n';

export interface ShopProfileData {
  uid: string;
  shopName: string;
  ownerName?: string;
  phone?: string;
  language: AppLanguage;
  onboarded: boolean;
  updatedAtIso?: string;
}

export type AppRoute = 'loading' | 'onboarding' | 'dashboard';

export interface RouteGuardInput {
  authReady: boolean;
  profileLoading: boolean;
  profile: ShopProfileData | null;
  forceOnboarding?: boolean;
  autostart?: boolean;
}

/**
 * Pure route guard resolver:
 * - If ?autostart=1 is present (e.g. direct launch / automated QA), resolves straight to 'dashboard'.
 * - While auth or Firestore profile is loading (and no cached profile is present), returns 'loading'.
 * - If forceOnboarding is true (e.g. user clicked Restart Onboarding in Settings), returns 'onboarding'.
 * - If profile.onboarded === true, skips onboarding and routes to 'dashboard'.
 * - Otherwise routes to 'onboarding'.
 */
export function resolveAppRoute(input: RouteGuardInput): AppRoute {
  if (input.autostart && !input.forceOnboarding) {
    return 'dashboard';
  }
  if (input.forceOnboarding) {
    return 'onboarding';
  }
  if (!input.authReady || (input.profileLoading && !input.profile)) {
    return 'loading';
  }
  if (input.profile && input.profile.onboarded === true) {
    return 'dashboard';
  }
  return 'onboarding';
}

export function hasAutostartParam(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return params.get('autostart') === '1';
  } catch {
    return false;
  }
}
