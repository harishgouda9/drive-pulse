import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/drive'];

export interface DriveAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  authMethod?:
    | 'FIREBASE_POPUP'
    | 'GIS_TOKEN_CLIENT'
    | 'SERVICE_ACCOUNT'
    | 'REFRESH_TOKEN'
    | 'DIRECT_OAUTH_TOKEN'
    | 'IDENTITY_ONLY';
  activeScope?: string;
}

export interface AuthErrorDetails {
  code: string;
  title: string;
  message: string;
  remediationSteps: string[];
  gcpAudienceUrl: string;
  gcpConsentUrl: string;
  gcpDriveApiUrl: string;
  oauthPlaygroundUrl: string;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            hint?: string;
            callback: (response: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
          };
        };
      };
    };
  }
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token strictly in volatile memory (never localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let cachedAuthUser: DriveAuthUser | null = null;

function createGoogleProvider(options?: {
  scopeOverride?: string;
  loginHint?: string;
}): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  const targetScope = options?.scopeOverride;

  if (targetScope === 'profile_only') {
    provider.addScope('email');
    provider.addScope('profile');
  } else if (targetScope) {
    provider.addScope(targetScope);
  } else {
    for (const scope of SCOPES) {
      provider.addScope(scope);
    }
  }

  const customParams: Record<string, string> = {
    prompt: 'select_account',
  };
  if (options?.loginHint && options.loginHint.trim()) {
    customParams.login_hint = options.loginHint.trim();
  }
  provider.setCustomParameters(customParams);
  return provider;
}

export const initAuth = (
  onAuthSuccess?: (user: DriveAuthUser, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        const mappedUser: DriveAuthUser = cachedAuthUser || {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          authMethod: 'FIREBASE_POPUP',
          activeScope: SCOPES[0],
        };
        cachedAuthUser = mappedUser;
        if (onAuthSuccess) onAuthSuccess(mappedUser, cachedAccessToken);
      } else if (!isSigningIn && !cachedAuthUser) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else if (!cachedAccessToken && !cachedAuthUser && !isSigningIn) {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

function isLocalhostOrUnlistedOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * Primary Google Sign-In using Firebase Auth signInWithPopup or GIS Token Client
 * based on user settings (scope, loginHint, customOAuthClientId).
 */
export const googleSignIn = async (options?: {
  scopeOverride?: string;
  loginHint?: string;
  customClientId?: string;
}): Promise<{ user: DriveAuthUser; accessToken: string } | null> => {
  const targetScope = options?.scopeOverride || SCOPES[0];

  if (isLocalhostOrUnlistedOrigin() && window.google?.accounts?.oauth2) {
    return signInWithGisTokenClient({
      scopeOverride: targetScope,
      loginHint: options?.loginHint,
      customClientId: options?.customClientId,
    });
  }

  try {
    isSigningIn = true;
    const provider = createGoogleProvider({
      scopeOverride: targetScope,
      loginHint: options?.loginHint,
    });
    const result = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    // If profile_only mode was chosen, allow sign-in even if Drive scope wasn't requested
    const token = credential?.accessToken || (await result.user.getIdToken());
    if (targetScope !== 'profile_only') {
      cachedAccessToken = credential?.accessToken || null;
    } else {
      cachedAccessToken = null;
    }

    const mappedUser: DriveAuthUser = {
      uid: result.user.uid,
      email: result.user.email,
      displayName: result.user.displayName,
      photoURL: result.user.photoURL,
      authMethod: targetScope === 'profile_only' ? 'IDENTITY_ONLY' : 'FIREBASE_POPUP',
      activeScope: targetScope,
    };
    cachedAuthUser = mappedUser;
    return { user: mappedUser, accessToken: token };
  } catch (error: unknown) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Direct Google Identity Services (GIS) OAuth 2.0 Token Client Sign-In.
 */
export const signInWithGisTokenClient = async (options?: {
  scopeOverride?: string;
  loginHint?: string;
  customClientId?: string;
}): Promise<{ user: DriveAuthUser; accessToken: string }> => {
  const clientId = options?.customClientId?.trim() || firebaseConfig.oAuthClientId;
  if (!clientId) {
    throw new Error('Missing OAuth Client ID in Settings or firebase-applet-config.json');
  }
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error(
      'Google Identity Services script is still loading or blocked by an ad-blocker. Please try again in a moment.'
    );
  }

  const targetScope = options?.scopeOverride || SCOPES[0];
  const scopeString =
    targetScope === 'profile_only'
      ? 'openid email profile'
      : `${targetScope} openid email profile`;

  isSigningIn = true;

  try {
    const token = await new Promise<string>((resolve, reject) => {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: scopeString,
        prompt: 'select_account',
        ...(options?.loginHint?.trim() ? { hint: options.loginHint.trim() } : {}),
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(
              new Error(
                response.error_description ||
                  response.error ||
                  'Google OAuth failed to return an access token.'
              )
            );
            return;
          }
          resolve(response.access_token);
        },
        error_callback: (err) => {
          reject(
            new Error(
              err?.message ||
                err?.type ||
                'Google OAuth popup was closed or blocked by the browser.'
            )
          );
        },
      });

      tokenClient.requestAccessToken({
        prompt: 'select_account',
        ...(options?.loginHint?.trim() ? { hint: options.loginHint.trim() } : {}),
      });
    });

    if (targetScope === 'profile_only') {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profile = userRes.ok ? await userRes.json() : {};
      cachedAccessToken = null;
      const mappedUser: DriveAuthUser = {
        uid: String(profile.sub || `usr-${Date.now()}`),
        email: profile.email ? String(profile.email) : options?.loginHint || 'Authenticated User',
        displayName: profile.name ? String(profile.name) : 'Google User',
        photoURL: profile.picture ? String(profile.picture) : null,
        authMethod: 'IDENTITY_ONLY',
        activeScope: 'profile_only',
      };
      cachedAuthUser = mappedUser;
      return { user: mappedUser, accessToken: token };
    }

    return await verifyAndSetAccessToken(token, 'GIS_TOKEN_CLIENT', targetScope);
  } finally {
    isSigningIn = false;
  }
};

/**
 * Authenticates via a Google Cloud Service Account JSON Key (RS256 JWT assertion -> OAuth 2.0 Bearer token).
 * Completely bypasses the browser OAuth Consent Screen ("Error 403: access_denied").
 */
export const authenticateWithServiceAccount = async (
  serviceAccountJson: string,
  scope: string = SCOPES[0]
): Promise<{ user: DriveAuthUser; accessToken: string }> => {
  isSigningIn = true;
  try {
    const res = await fetch('/api/auth/service-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceAccountJson, scope }),
    });
    const data = await res.json();
    if (!res.ok || !data.accessToken) {
      throw new Error(data.error || `Service Account token exchange failed (${res.status})`);
    }
    return await verifyAndSetAccessToken(
      String(data.accessToken),
      'SERVICE_ACCOUNT',
      scope,
      String(data.clientEmail || 'service-account')
    );
  } finally {
    isSigningIn = false;
  }
};

/**
 * Authenticates via OAuth 2.0 Client ID + Client Secret + Refresh Token exchange.
 */
export const authenticateWithRefreshToken = async (params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ user: DriveAuthUser; accessToken: string }> => {
  isSigningIn = true;
  try {
    const res = await fetch('/api/auth/refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok || !data.accessToken) {
      throw new Error(data.error || `Refresh token exchange failed (${res.status})`);
    }
    return await verifyAndSetAccessToken(
      String(data.accessToken),
      'REFRESH_TOKEN',
      String(data.scope || SCOPES[0])
    );
  } finally {
    isSigningIn = false;
  }
};

/**
 * Verifies an OAuth 2.0 access token directly against Google Drive v3 About API
 * (or OAuth2 userinfo fallback) and stores it in volatile memory.
 */
export const verifyAndSetAccessToken = async (
  rawToken: string,
  method: DriveAuthUser['authMethod'] = 'DIRECT_OAUTH_TOKEN',
  activeScope: string = SCOPES[0],
  fallbackEmail?: string
): Promise<{ user: DriveAuthUser; accessToken: string }> => {
  const cleanToken = rawToken.trim().replace(/^Bearer\s+/i, '');
  if (!cleanToken) {
    throw new Error('Please provide a non-empty OAuth 2.0 access token.');
  }

  const aboutRes = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink,permissionId)',
    {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
      },
    }
  );

  if (!aboutRes.ok) {
    let detail = `HTTP ${aboutRes.status}`;
    try {
      const errJson = await aboutRes.json();
      detail = errJson?.error?.message || detail;
    } catch {
      // ignore json parse error
    }
    throw new Error(`Google Drive token verification failed: ${detail}`);
  }

  const aboutData = await aboutRes.json();
  const driveUser = aboutData?.user || {};

  cachedAccessToken = cleanToken;
  const mappedUser: DriveAuthUser = {
    uid: String(driveUser.permissionId || `drv-user-${Date.now()}`),
    email: driveUser.emailAddress
      ? String(driveUser.emailAddress)
      : fallbackEmail || 'Connected Drive User',
    displayName: driveUser.displayName ? String(driveUser.displayName) : 'Drive User',
    photoURL: driveUser.photoLink ? String(driveUser.photoLink) : null,
    authMethod: method,
    activeScope,
  };
  cachedAuthUser = mappedUser;

  return { user: mappedUser, accessToken: cleanToken };
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async (): Promise<void> => {
  try {
    await auth.signOut();
  } catch {
    // Ignore Firebase signOut error if authenticated via GIS or Service Account
  }
  cachedAccessToken = null;
  cachedAuthUser = null;
};

export function formatAuthErrorDetails(err: unknown): AuthErrorDetails {
  const projectId = firebaseConfig.projectId || 'gen-lang-client-0526103837';
  const gcpAudienceUrl = `https://console.cloud.google.com/auth/audience?project=${projectId}`;
  const gcpConsentUrl = `https://console.cloud.google.com/apis/credentials/consent?project=${projectId}`;
  const gcpDriveApiUrl = `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${projectId}`;
  const oauthPlaygroundUrl =
    'https://developers.google.com/oauthplayground/#step1&apisSelect=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive&url=https%3A%2F%2F&content_type=application%2Fjson&http_method=GET&useDefaultOauthCred=unchecked';

  const rawMsg = err instanceof Error ? err.message : String(err || 'Unknown authentication error');

  return {
    code: 'Error 403: access_denied (Testing Consent Screen)',
    title: 'Google OAuth Blocked (Error 403: access_denied)',
    message:
      rawMsg.includes('popup-closed') || rawMsg.includes('access_denied')
        ? `Google blocked the popup with "Error 403: access_denied" because project "${projectId}" is in "Testing" mode and the selected email (e.g. harishgouda0001@gmail.com) is not listed in Test Users.`
        : rawMsg,
    remediationSteps: [
      `Fix in GCP Console (Permanent): Open "GCP Audience & Test Users" below -> Either click "Publish App" (recommended so any Gmail account can sign in), OR click "+ Add users" under Test users and add harishgouda0001@gmail.com & harishgouda9916@gmail.com.`,
      'Instant Workaround #1 (Zero GCP Changes): Open the "Tokens & Service Account" tab in Settings to generate a token in 2 clicks via Google OAuth Playground or paste a Service Account JSON key.',
      'Instant Workaround #2 (Account Hint): Switch the Account Hint below to harishgouda9916@gmail.com (Project Owner) or use "Sign In (Identity Mode)" to sign in without restricted Drive scope blocks.',
    ],
    gcpAudienceUrl,
    gcpConsentUrl,
    gcpDriveApiUrl,
    oauthPlaygroundUrl,
  };
}
