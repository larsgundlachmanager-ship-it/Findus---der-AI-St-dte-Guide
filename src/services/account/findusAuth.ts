/**
 * Supabase Auth — Google / Apple / Magic Link + Session Persist.
 */

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { UserProfile } from '../../types/userProfile';

// Schließt Auth-Browser-Session sauber (verhindert schwarzen Screen nach Redirect)
WebBrowser.maybeCompleteAuthSession();

/** Muss in AndroidManifest + Supabase Auth → Redirect URLs stehen. */
export const AUTH_SCHEME = 'findus';
export const AUTH_CALLBACK_PATH = 'auth/callback';

export type AuthSessionUser = {
  id: string;
  email: string | null;
  fullName: string | null;
};

let lastSessionUser: AuthSessionUser | null = null;

export function getLastAuthUser(): AuthSessionUser | null {
  return lastSessionUser;
}

export function isAuthConfigured(): boolean {
  return isSupabaseConfigured();
}

/** Feste Callback-URL für Magic Link + OAuth (kein Expo-Go/exp+ Drift). */
export function getAuthRedirectUrl(): string {
  return Linking.createURL(AUTH_CALLBACK_PATH, { scheme: AUTH_SCHEME });
}

export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith(`${AUTH_SCHEME}://`) ||
    lower.includes('://auth/callback') ||
    lower.includes('://auth?') ||
    /[?&#](access_token|refresh_token|code)=/i.test(url)
  );
}

function mapUser(u: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): AuthSessionUser {
  const meta = u.user_metadata ?? {};
  const fullName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    null;
  return {
    id: u.id,
    email: u.email ?? null,
    fullName,
  };
}

/** Merge Auth-Profil in UserProfile (nur leere Felder). */
export function mergeAuthIntoProfile(
  profile: UserProfile,
  auth: AuthSessionUser,
): Partial<UserProfile> {
  const patch: Partial<UserProfile> = {
    accountMode: 'registered',
  };
  if (!profile.email?.trim() && auth.email) patch.email = auth.email;
  if (!profile.firstName?.trim() && auth.fullName) {
    const parts = auth.fullName.trim().split(/\s+/);
    patch.firstName = parts[0] ?? '';
    if (!profile.lastName?.trim() && parts.length > 1) {
      patch.lastName = parts.slice(1).join(' ');
    }
  }
  return patch;
}

export async function refreshAuthSession(): Promise<AuthSessionUser | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session?.user) {
    lastSessionUser = null;
    return null;
  }
  lastSessionUser = mapUser(data.session.user);
  return lastSessionUser;
}

export async function signOutAuth(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
  lastSessionUser = null;
}

export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Supabase nicht konfiguriert' };
  // Feste Scheme-URL — muss in Supabase Auth → URL Configuration stehen
  const redirectTo = getAuthRedirectUrl();
  console.log('[auth] magic-link redirectTo=', redirectTo);
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function signInWithOAuthProvider(
  provider: 'google' | 'apple',
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Supabase nicht konfiguriert' };
  const redirectTo = getAuthRedirectUrl();
  console.log('[auth] oauth redirectTo=', redirectTo);
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: data.url };
}

function dismissAuthBrowserSoft() {
  try {
    WebBrowser.dismissBrowser();
  } catch {
    /* soft */
  }
  try {
    WebBrowser.maybeCompleteAuthSession();
  } catch {
    /* soft */
  }
}

export async function handleAuthRedirectUrl(
  url: string,
): Promise<AuthSessionUser | null> {
  const sb = getSupabase();
  if (!sb) return null;
  if (!isAuthCallbackUrl(url) && !/[?&#](access_token|code)=/i.test(url)) {
    return null;
  }
  console.log('[auth] handleRedirect', url.slice(0, 120));
  try {
    // Hash- und Query-Tokens (Supabase Magic Link / OAuth)
    // Manche Clients liefern findus://auth/callback#access_token=…&refresh_token=…
    const normalized = url.includes('#')
      ? url.replace('#', '?')
      : url;
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      // Custom schemes ohne gültigen Host: findus://auth/callback?…
      parsed = new URL(normalized.replace(/^([^:]+):\/\//, 'https://'));
    }
    const access_token =
      parsed.searchParams.get('access_token') ??
      parsed.searchParams.get('accessToken');
    const refresh_token =
      parsed.searchParams.get('refresh_token') ??
      parsed.searchParams.get('refreshToken');
    const code = parsed.searchParams.get('code');

    if (access_token && refresh_token) {
      const { data, error } = await sb.auth.setSession({
        access_token,
        refresh_token,
      });
      dismissAuthBrowserSoft();
      if (error || !data.user) {
        console.warn('[auth] setSession failed:', error?.message);
        return null;
      }
      lastSessionUser = mapUser(data.user);
      return lastSessionUser;
    }

    // PKCE / code exchange (neuere Supabase-Redirects)
    if (code) {
      const { data, error } = await sb.auth.exchangeCodeForSession(code);
      dismissAuthBrowserSoft();
      if (error || !data.user) {
        console.warn('[auth] exchangeCode failed:', error?.message);
        return null;
      }
      lastSessionUser = mapUser(data.user);
      return lastSessionUser;
    }
  } catch (err) {
    console.warn('[auth] handleRedirect error:', err);
  }
  return refreshAuthSession();
}

/** Initial-URL + laufende Deep-Links für Magic-Link / OAuth. */
export function subscribeAuthRedirects(
  onUser: (user: AuthSessionUser) => void,
): () => void {
  let alive = true;
  void Linking.getInitialURL().then((url) => {
    if (!alive || !url) return;
    void handleAuthRedirectUrl(url).then((u) => {
      if (u && alive) onUser(u);
    });
  });
  const sub = Linking.addEventListener('url', ({ url }) => {
    void handleAuthRedirectUrl(url).then((u) => {
      if (u && alive) onUser(u);
    });
  });
  return () => {
    alive = false;
    sub.remove();
  };
}
