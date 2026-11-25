import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppRoute, hasAutostartParam } from './routeGuard';

test('resolveAppRoute returns loading while auth or profile is loading without cache', () => {
  assert.equal(
    resolveAppRoute({ authReady: false, profileLoading: true, profile: null }),
    'loading'
  );
  assert.equal(
    resolveAppRoute({ authReady: true, profileLoading: true, profile: null }),
    'loading'
  );
});

test('resolveAppRoute routes to onboarding when profile is missing or onboarded=false', () => {
  assert.equal(
    resolveAppRoute({ authReady: true, profileLoading: false, profile: null }),
    'onboarding'
  );
  assert.equal(
    resolveAppRoute({
      authReady: true,
      profileLoading: false,
      profile: { uid: 'u1', shopName: 'Test', language: 'hi', onboarded: false },
    }),
    'onboarding'
  );
});

test('resolveAppRoute skips onboarding when onboarded=true', () => {
  assert.equal(
    resolveAppRoute({
      authReady: true,
      profileLoading: false,
      profile: { uid: 'u1', shopName: 'Sharma Kirana', language: 'hi', onboarded: true },
    }),
    'dashboard'
  );
});

test('resolveAppRoute honors forceOnboarding and autostart query parameter', () => {
  assert.equal(
    resolveAppRoute({ authReady: false, profileLoading: true, profile: null, autostart: true }),
    'dashboard'
  );
  assert.equal(
    resolveAppRoute({
      authReady: true,
      profileLoading: false,
      profile: { uid: 'u1', shopName: 'Sharma Kirana', language: 'hi', onboarded: true },
      forceOnboarding: true,
    }),
    'onboarding'
  );
  assert.equal(hasAutostartParam('?autostart=1'), true);
  assert.equal(hasAutostartParam('?autostart=0'), false);
});
