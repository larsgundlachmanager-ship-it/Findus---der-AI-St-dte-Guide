/**
 * Supabase Auth — Google / Apple / Magic Link + Session Persist.
 */

import { Platform } from 'react-native';
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

export type AuthSignInResult = {
  ok: boolean;
  user?: AuthSessionUser;
  error?: string;
  cancelled?: boolean;
};

/** In-App-Browser OAuth (Google überall, Apple-Fallback). */
export async function signInWithOAuthInApp(
  provider: 'google' | 'apple',
): Promise<AuthSignInResult> {
  const res = await signInWithOAuthProvider(provider);
  if (!res.ok || !res.url) {
    return { ok: false, error: res.error ?? 'Login nicht verfügbar' };
  }
  const redirect = getAuthRedirectUrl();
  const result = await WebBrowser.openAuthSessionAsync(res.url, redirect);
  if (result.type !== 'success' || !result.url) {
    return {
      ok: false,
      cancelled: result.type === 'cancel' || result.type === 'dismiss',
      error: 'Anmeldung abgebrochen oder fehlgeschlagen.',
    };
  }
  const user = await handleAuthRedirectUrl(result.url);
  if (!user) {
    return { ok: false, error: 'Anmeldung abgebrochen oder fehlgeschlagen.' };
  }
  return { ok: true, user };
}

export async function signInWithGoogle(): Promise<AuthSignInResult> {
  return signInWithOAuthInApp('google');
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  try {
    const Crypto = await import('expo-crypto');
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  } catch {
    return value;
  }
}

/** iOS: natives Sign in with Apple. Sonst / bei Fehler: OAuth wie Google. */
export async function signInWithApple(): Promise<AuthSignInResult> {
  if (Platform.OS === 'ios') {
    try {
      const AppleAuthentication = await import('expo-apple-authentication');
      const available = await AppleAuthentication.isAvailableAsync();
      if (available) {
        const rawNonce = randomNonce();
        const hashedNonce = await sha256Hex(rawNonce);
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashedNonce,
        });
        const sb = getSupabase();
        if (!sb || !credential.identityToken) {
          return { ok: false, error: 'Apple-Login fehlgeschlagen.' };
        }
        const { data, error } = await sb.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
          nonce: rawNonce,
        });
        if (!error && data.user) {
          lastSessionUser = mapUser(data.user);
          const given = credential.fullName?.givenName?.trim();
          const family = credential.fullName?.familyName?.trim();
          const fullName = [given, family].filter(Boolean).join(' ');
          if (fullName) {
            await sb.auth.updateUser({
              data: {
                full_name: fullName,
                given_name: given,
                family_name: family,
              },
            });
            lastSessionUser = { ...lastSessionUser, fullName };
          }
          return { ok: true, user: lastSessionUser };
        }
        console.warn('[auth] apple native failed:', error?.message);
      }
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      if (code === 'ERR_REQUEST_CANCELED') {
        return {
          ok: false,
          cancelled: true,
          error: 'Anmeldung abgebrochen oder fehlgeschlagen.',
        };
      }
      console.warn('[auth] apple native error:', err);
    }
  }
  return signInWithOAuthInApp('apple');
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
