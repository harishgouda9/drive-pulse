import React from 'react';
import { DriveAuthUser } from '../services/authService';
import { WorkspaceView } from '../types/drive';

interface TopBarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  user: DriveAuthUser | null;
  needsAuth: boolean;
  isLoggingIn: boolean;
  onGoogleLogin: () => void;
  onLogout: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onSelectView,
  user,
  needsAuth,
  isLoggingIn,
  onGoogleLogin,
  onLogout,
}) => {
  const navItems: Array<{ id: WorkspaceView; label: string }> = [
    { id: WorkspaceView.EXPLORER, label: 'Explorer' },
    { id: WorkspaceView.SYNC_CACHE, label: 'Sync & Cache' },
    { id: WorkspaceView.AGENT_STUDIO, label: 'Agent Studio' },
    { id: WorkspaceView.HARNESS_SDK, label: 'Harness SDK' },
  ];

  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="#explorer"
        onClick={(e) => {
          e.preventDefault();
          onSelectView(WorkspaceView.EXPLORER);
        }}
        className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
      >
        DrivePulse
      </a>

      {/* Zone 2: 4 concise single-line text navigation links */}
      <nav aria-label="Primary Workspace Navigation" className="flex items-center gap-6 text-sm font-medium">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                onSelectView(item.id);
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`whitespace-nowrap shrink-0 transition-colors py-1 border-b-2 ${
                isActive
                  ? 'border-blue-600 text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center shrink-0">
        {needsAuth || !user ? (
          <button
            type="button"
            onClick={onGoogleLogin}
            disabled={isLoggingIn}
            className="gsi-material-button"
          >
            <div className="gsi-material-button-state"></div>
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  style={{ display: 'block' }}
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  ></path>
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  ></path>
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  ></path>
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  ></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span className="gsi-material-button-contents">
                {isLoggingIn ? 'Connecting Drive...' : 'Sign in with Google'}
              </span>
              <span style={{ display: 'none' }}>Sign in with Google</span>
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            Sign Out ({user.email?.split('@')[0] || 'Drive Connected'})
          </button>
        )}
      </div>
    </header>
  );
};
