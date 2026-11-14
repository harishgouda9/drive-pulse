import firebaseConfig from '../../firebase-applet-config.json';

export type AuthChannelMode =
  | 'GIS_DIRECT'
  | 'FIREBASE_POPUP'
  | 'IDENTITY_ONLY_BYPASS'
  | 'SERVICE_ACCOUNT'
  | 'OAUTH_TOKEN';

export type DriveScopeOption =
  | 'https://www.googleapis.com/auth/drive'
  | 'https://www.googleapis.com/auth/drive.file'
  | 'https://www.googleapis.com/auth/drive.readonly'
  | 'profile_only';

export interface PluginSettings {
  authChannel: AuthChannelMode;
  oauthScope: DriveScopeOption;
  loginHint: string;
  customOAuthClientId: string;
  chunkSizeKb: 16 | 32 | 64 | 128 | 256;
  lruCacheMaxMb: 32 | 64 | 128 | 256 | 512 | 1024;
  autoSyncIntervalSec: 0 | 15 | 30 | 60;
  pageSize: 15 | 30 | 50 | 100;
  defaultFolderPath: string;
  requireDestructiveConfirm: boolean;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  authChannel: 'FIREBASE_POPUP',
  oauthScope: 'https://www.googleapis.com/auth/drive',
  loginHint: 'harishgouda9916@gmail.com',
  customOAuthClientId: firebaseConfig.oAuthClientId || '',
  chunkSizeKb: 64,
  lruCacheMaxMb: 128,
  autoSyncIntervalSec: 0,
  pageSize: 30,
  defaultFolderPath: '/Google Drive',
  requireDestructiveConfirm: true,
};
