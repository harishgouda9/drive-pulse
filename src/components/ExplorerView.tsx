import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Download,
  Trash2,
  Pin,
  Copy,
  Check,
  Zap,
  ExternalLink,
  Upload,
  Cpu,
  Terminal,
  RefreshCw,
  Link2,
  X,
  Share2,
  Maximize2,
  Eye,
  Columns,
  PanelRightOpen,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { CacheStatus, DriveItem, FileCategory } from '../types/drive';
import {
  computeContentStats,
  detectViewerKind,
  filterAndSortDriveItems,
  formatBytesTabular,
  SearchScopeMode,
  splitFilenameHighlight,
  splitIntoChunks,
} from '../core/chunkStreamer';
import { FileContentRenderer, FileViewerModal } from './FileViewerModal';

interface ExplorerViewProps {
  items: DriveItem[];
  selectedFolder: string;
  selectedFile: DriveItem | null;
  isHydratingFileId?: string | null;
  isRefreshingDrive?: boolean;
  isTurboSyncing?: boolean;
  liveSyncConnected?: boolean;
  liveSyncRttMs?: number;
  liveSyncEnabled?: boolean;
  isPluginEmbedMode?: boolean;
  onSelectFile: (file: DriveItem) => void;
  onDownloadFile: (file: DriveItem) => void;
  onTogglePinForAgent: (fileId: string) => void;
  onUseFileInAgentStudio?: (file: DriveItem) => void;
  onUseFileInHarnessSdk?: (file: DriveItem) => void;
  onEmitFileToHostPlugin?: (file: DriveItem) => void;
  onImportDriveLink?: (urlOrId: string) => Promise<void>;
  onRefreshDriveFiles?: (fileNameQuery?: string) => Promise<void>;
  onTriggerTurboSync?: () => void;
  onToggleLiveSync?: (enabled: boolean) => void;
  onRequestDeleteFile: (file: DriveItem) => void;
  onRequestOverwriteFile: (file: DriveItem, newContent: string) => void;
  onOpenUploadModal: () => void;
  onOpenSettingsModal?: () => void;
  chunkSizeKb?: number;
  lastTransferBanner: string | null;
}

export const ExplorerView: React.FC<ExplorerViewProps> = ({
  items,
  selectedFolder,
  selectedFile,
  isHydratingFileId = null,
  isRefreshingDrive = false,
  isTurboSyncing = false,
  liveSyncConnected = true,
  liveSyncRttMs = 0.42,
  liveSyncEnabled = true,
  isPluginEmbedMode = false,
  onSelectFile,
  onDownloadFile,
  onTogglePinForAgent,
  onUseFileInAgentStudio,
  onUseFileInHarnessSdk,
  onEmitFileToHostPlugin,
  onImportDriveLink,
  onRefreshDriveFiles,
  onTriggerTurboSync,
  onToggleLiveSync,
  onRequestDeleteFile,
  onRequestOverwriteFile,
  onOpenUploadModal,
  onOpenSettingsModal,
  chunkSizeKb = 64,
  lastTransferBanner,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScopeMode>('filename');
  const [category, setCategory] = useState<FileCategory>(FileCategory.ALL);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modifiedTime' | 'latency'>('modifiedTime');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Viewer layout & full-screen modal controls
  const [layoutMode, setLayoutMode] = useState<'split' | 'wide'>('wide');
  const [isFullViewerOpen, setIsFullViewerOpen] = useState<boolean>(false);
  const [showChunkBreakdown, setShowChunkBreakdown] = useState<boolean>(false);

  const [driveUrlInput, setDriveUrlInput] = useState('');
  const [isImportingLink, setIsImportingLink] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Global keyboard shortcut ('/' or Cmd/Ctrl+K) to focus the real-time filename search bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredItems = filterAndSortDriveItems(
    items,
    searchQuery,
    category,
    selectedFolder,
    sortBy,
    searchScope
  );

  const categoryTabs: Array<{ id: FileCategory; label: string }> = [
    { id: FileCategory.ALL, label: 'All Files' },
    { id: FileCategory.CODE, label: 'Code & Config' },
    { id: FileCategory.DOCUMENTS, label: 'Documents' },
    { id: FileCategory.SPREADSHEETS, label: 'Spreadsheets' },
    { id: FileCategory.MEDIA, label: 'Images & Videos' },
  ];

  const handleCopyContent = (file: DriveItem) => {
    navigator.clipboard?.writeText(file.contentPreview);
    setCopiedId(file.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onImportDriveLink) return;
    if (!driveUrlInput.trim()) {
      setImportError('Paste a Google Drive, Docs, or Sheets URL or File ID first.');
      return;
    }
    setImportError(null);
    setIsImportingLink(true);
    try {
      await onImportDriveLink(driveUrlInput.trim());
      setDriveUrlInput('');
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Failed to fetch Drive file');
    } finally {
      setIsImportingLink(false);
    }
  };

  const activeFile =
    (selectedFile && filteredItems.find((i) => i.id === selectedFile.id)) ||
    filteredItems[0] ||
    (selectedFile ? items.find((i) => i.id === selectedFile.id) || selectedFile : null);

  const chunks = activeFile ? splitIntoChunks(activeFile.contentPreview, chunkSizeKb * 1024) : [];
  const contentStats = activeFile ? computeContentStats(activeFile.contentPreview) : null;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
      {/* Contextual Top Bar / Real-Time Filename Search & Filter Strip */}
      <div className="px-6 py-3.5 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold font-display text-slate-900 dark:text-slate-100">
              {isPluginEmbedMode
                ? 'DrivePulse Harness Plugin — Synchronized Data Plane'
                : 'Google Drive Synchronized Data Plane'}
            </h1>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <span>Scope: {selectedFolder === 'ALL' ? 'All Mounted Directories' : selectedFolder}</span>
              <span aria-hidden="true" className="mx-1.5">·</span>
              <span className="font-mono tabular-nums">
                {searchQuery.trim()
                  ? `${filteredItems.length} of ${items.length} file(s) matched`
                  : `${filteredItems.length} visible`}
              </span>
              {lastTransferBanner && (
                <>
                  <span aria-hidden="true" className="mx-1.5">·</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {lastTransferBanner}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Live Sync, Turbo Sync, Viewer Layout & Sort Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Viewer Width / Full Screen Switcher */}
            <div
              role="group"
              aria-label="Viewer Layout Size"
              className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <button
                type="button"
                onClick={() => setLayoutMode('split')}
                aria-pressed={layoutMode === 'split'}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  layoutMode === 'split'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Columns className="w-3.5 h-3.5" />
                <span>Split</span>
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('wide')}
                aria-pressed={layoutMode === 'wide'}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  layoutMode === 'wide'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <PanelRightOpen className="w-3.5 h-3.5" />
                <span>Wide Viewer</span>
              </button>
              {activeFile && (
                <button
                  type="button"
                  onClick={() => setIsFullViewerOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-md transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Full Screen</span>
                </button>
              )}
            </div>

            {onToggleLiveSync && (
              <button
                type="button"
                onClick={() => onToggleLiveSync(!liveSyncEnabled)}
                title="Toggle continuous ultra-low-latency real-time sync between Google Drive and Harness"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg border transition-colors cursor-pointer ${
                  liveSyncEnabled && liveSyncConnected
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    liveSyncEnabled && liveSyncConnected
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-slate-400'
                  }`}
                />
                <span>
                  {liveSyncEnabled
                    ? `LIVE SYNC · ${liveSyncRttMs.toFixed(2)} ms`
                    : 'LIVE SYNC PAUSED'}
                </span>
              </button>
            )}

            {onTriggerTurboSync && (
              <button
                type="button"
                onClick={onTriggerTurboSync}
                disabled={isTurboSyncing}
                title="Run Two-Phase Zero-Blocking 16x Worker Turbo Sync"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <Zap className={`w-3.5 h-3.5 ${isTurboSyncing ? 'animate-bounce' : ''}`} />
                <span>{isTurboSyncing ? 'Turbo Syncing...' : 'Turbo Live Sync'}</span>
              </button>
            )}

            {onRefreshDriveFiles && (
              <button
                type="button"
                onClick={() => void onRefreshDriveFiles()}
                disabled={isRefreshingDrive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingDrive ? 'animate-spin' : ''}`} />
                <span>{isRefreshingDrive ? 'Syncing Drive...' : 'Refresh'}</span>
              </button>
            )}

            <div className="flex items-center gap-1.5">
              <label htmlFor="drive-sort-select" className="text-xs text-slate-500 dark:text-slate-400">
                Sort:
              </label>
              <select
                id="drive-sort-select"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as 'name' | 'size' | 'modifiedTime' | 'latency')
                }
                className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-600"
              >
                <option value="modifiedTime">Latest Modified</option>
                <option value="latency">Fastest Latency</option>
                <option value="size">Largest Size</option>
                <option value="name">Alphabetical</option>
              </select>
            </div>
          </div>
        </div>

        {/* Dedicated Real-Time Filename Search Bar for Large Google Drive Repositories */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-blue-600 dark:text-blue-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <label htmlFor="drive-search-input" className="sr-only">
              Filter Google Drive files by filename in real-time
            </label>
            <input
              ref={searchInputRef}
              id="drive-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                }
              }}
              placeholder={
                searchScope === 'filename'
                  ? 'Instant real-time filename filter across Google Drive repository (Press / or Ctrl+K)...'
                  : 'Search filenames, file contents, and MIME types in real-time...'
              }
              className="w-full pl-9 pr-20 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-950 transition-colors [&::-webkit-search-cancel-button]:hidden"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear filename search"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-200/70 dark:bg-slate-800 rounded cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              ) : (
                <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 pointer-events-none">
                  / to search
                </span>
              )}
            </div>
          </div>

          {/* Search Scope Selector: Filename Only vs Filename + Content */}
          <div
            role="group"
            aria-label="Search Scope Mode"
            className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shrink-0"
          >
            <button
              type="button"
              onClick={() => setSearchScope('filename')}
              aria-pressed={searchScope === 'filename'}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                searchScope === 'filename'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Filename Only
            </button>
            <button
              type="button"
              onClick={() => setSearchScope('all')}
              aria-pressed={searchScope === 'all'}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                searchScope === 'all'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Filename + Content
            </button>
          </div>

          {searchQuery.trim() && onRefreshDriveFiles && (
            <button
              type="button"
              onClick={() => void onRefreshDriveFiles(searchQuery.trim())}
              disabled={isRefreshingDrive}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/70 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-950/70 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Query Remote Drive Index</span>
            </button>
          )}
        </div>

        {/* Interactive Segmented Filter Controls + Direct Google Drive Link/ID Fetcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Filter files by category"
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg overflow-x-auto"
          >
            {categoryTabs.map((tab) => {
              const active = category === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategory(tab.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {onImportDriveLink && (
            <form onSubmit={handleImportSubmit} className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <label htmlFor="drive-link-import-input" className="sr-only">
                  Fetch Google Drive, Docs, or Sheets by URL or File ID
                </label>
                <input
                  id="drive-link-import-input"
                  type="text"
                  value={driveUrlInput}
                  onChange={(e) => {
                    setDriveUrlInput(e.target.value);
                    if (importError) setImportError(null);
                  }}
                  placeholder="Paste Google Drive / Docs / Sheets URL or File ID..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
                />
              </div>
              <button
                type="submit"
                disabled={isImportingLink}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                {isImportingLink ? 'Fetching...' : 'Fetch Drive File'}
              </button>
            </form>
          )}
        </div>

        {importError && (
          <div role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
            {importError}
          </div>
        )}
      </div>

      {/* Main Split Workspace: File Repository List + Wide Universal File & Media Viewer */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
        {/* Left Columns: High-Density File Table */}
        <div
          className={`${
            layoutMode === 'wide' ? 'lg:col-span-5' : 'lg:col-span-6'
          } border-r border-slate-200 dark:border-slate-800 overflow-y-auto bg-white dark:bg-[#0B0F19]`}
        >
          {filteredItems.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {searchQuery.trim()
                  ? `No filenames matching "${searchQuery.trim()}" in mounted cache`
                  : 'No Google Drive files match the active filter'}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                {searchQuery.trim()
                  ? 'Clear your filename filter, switch to Filename + Content mode, or query the remote Google Drive index directly.'
                  : 'Connect your Google Drive account, paste a Google Drive / Docs / Sheets link above, or upload a new file, image, or video directly into the synchronized folder.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                {searchQuery || category !== FileCategory.ALL ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setCategory(FileCategory.ALL);
                    }}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    Reset Filters
                  </button>
                ) : null}
                {searchQuery.trim() && onRefreshDriveFiles && (
                  <button
                    type="button"
                    onClick={() => void onRefreshDriveFiles(searchQuery.trim())}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>Search Remote Google Drive for "{searchQuery.trim()}"</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenUploadModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload File / Media</span>
                </button>
                {onOpenSettingsModal && (
                  <button
                    type="button"
                    onClick={onOpenSettingsModal}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    <span>Fix Google 403 / Auth Settings</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50">
                  <th className="py-2.5 pl-5 pr-3">File Name & Type</th>
                  <th className="py-2.5 px-2">Cache</th>
                  <th className="py-2.5 px-2 text-right">Size</th>
                  <th className="py-2.5 px-2 text-right">Latency</th>
                  <th className="py-2.5 pl-2 pr-5 text-right">Open / Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-xs">
                {filteredItems.map((item) => {
                  const isSelected = activeFile?.id === item.id;
                  const hasContent = Boolean(item.contentPreview || item.mediaUrl);
                  const nameSegments = splitFilenameHighlight(item.name, searchQuery);
                  const kind = detectViewerKind(item.mimeType, item.name);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelectFile(item)}
                      onDoubleClick={() => {
                        onSelectFile(item);
                        setIsFullViewerOpen(true);
                      }}
                      title="Click to inspect · Double-click to open Full-Screen Viewer"
                      className={`h-11 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/90 dark:bg-blue-950/35'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                      }`}
                    >
                      <td className="py-2 pl-5 pr-3 max-w-[230px]">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {nameSegments.map((seg, idx) =>
                            seg.matched ? (
                              <mark
                                key={idx}
                                className="bg-amber-200/80 dark:bg-amber-500/30 text-slate-900 dark:text-amber-200 rounded-xs px-0.5"
                              >
                                {seg.text}
                              </mark>
                            ) : (
                              <span key={idx}>{seg.text}</span>
                            )
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          <span className="uppercase font-mono text-[10px] text-blue-600 dark:text-blue-400 font-semibold">
                            {kind}
                          </span>
                          <span aria-hidden="true" className="mx-1">·</span>
                          <span>{item.mimeType.replace('application/vnd.google-apps.', 'gsuite/')}</span>
                          <span aria-hidden="true" className="mx-1">·</span>
                          <span
                            className={
                              hasContent
                                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                : 'text-slate-400'
                            }
                          >
                            {hasContent ? 'Ready' : 'Stream on Click'}
                          </span>
                        </div>
                      </td>

                      {/* Zero-Pill Unboxed Cache State */}
                      <td className="py-2 px-2 whitespace-nowrap font-mono text-[11px]">
                        {item.cacheStatus === CacheStatus.HIT ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            HIT
                          </span>
                        ) : item.cacheStatus === CacheStatus.STALE ? (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            STALE
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            MISS
                          </span>
                        )}
                      </td>

                      <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatBytesTabular(item.size)}
                      </td>

                      <td className="py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={
                            item.lastLatencyMs <= 1.0
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-slate-600 dark:text-slate-300'
                          }
                        >
                          {item.lastLatencyMs.toFixed(1)} ms
                        </span>
                      </td>

                      <td
                        className="py-2 pl-2 pr-5 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectFile(item);
                              setIsFullViewerOpen(true);
                            }}
                            aria-label={`Open ${item.name} in full-screen viewer`}
                            title="Open Full-Screen File & Media Viewer"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-md transition-colors cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View</span>
                          </button>

                          {onEmitFileToHostPlugin && (
                            <button
                              type="button"
                              onClick={() => onEmitFileToHostPlugin(item)}
                              aria-label={`Send ${item.name} to Host Harness Plugin`}
                              title="Emit File Payload to Host Software / Harness via Plugin Bridge"
                              className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-md transition-colors cursor-pointer"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {onUseFileInAgentStudio && (
                            <button
                              type="button"
                              onClick={() => onUseFileInAgentStudio(item)}
                              aria-label={`Use ${item.name} content in Agent Studio`}
                              title="Use File Content in High-Thinking Agent Studio"
                              className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-md transition-colors cursor-pointer"
                            >
                              <Cpu className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onTogglePinForAgent(item.id)}
                            aria-label={`${
                              item.pinnedForAgent ? 'Unpin' : 'Pin'
                            } ${item.name} for AI Agent`}
                            title="Toggle AI Agent Context Pin"
                            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                              item.pinnedForAgent
                                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60'
                                : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onDownloadFile(item)}
                            aria-label={`Download ${item.name}`}
                            title="Stream Download"
                            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onRequestDeleteFile(item)}
                            aria-label={`Delete ${item.name}`}
                            title="Delete from Google Drive"
                            className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right Columns: Wide Universal File, Image, Video & Code Viewer */}
        <div
          className={`${
            layoutMode === 'wide' ? 'lg:col-span-7' : 'lg:col-span-6'
          } bg-slate-50/60 dark:bg-[#111827] flex flex-col min-h-0 overflow-y-auto p-5`}
        >
          {!activeFile ? (
            <div className="m-auto text-center text-xs text-slate-500 dark:text-slate-400">
              Select any Google Drive file, image, or video to open its instant stream viewer.
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 space-y-3.5">
              {/* File Header & Prominent Full-Screen Viewer Button */}
              <div className="space-y-1.5 pb-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-bold font-display text-slate-900 dark:text-slate-100 break-all">
                    {activeFile.name}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsFullViewerOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-xs transition-colors cursor-pointer"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Open Full Screen Viewer</span>
                    </button>

                    {activeFile.webViewLink && (
                      <a
                        href={activeFile.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 rounded-lg hover:underline shrink-0"
                      >
                        <span>Drive</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Unboxed Metadata Line (Zero-Pill Discipline) */}
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>{activeFile.mimeType}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatBytesTabular(activeFile.size)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{contentStats?.lineCount || 0} lines</span>
                  <span aria-hidden="true">·</span>
                  <span>{activeFile.lastLatencyMs.toFixed(1)} ms read</span>
                  <span aria-hidden="true">·</span>
                  <span>md5 {activeFile.md5Checksum.slice(0, 10)}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      activeFile.cacheStatus === CacheStatus.HIT
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-amber-600 dark:text-amber-400'
                    }
                  >
                    {activeFile.cacheStatus}
                  </span>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {onEmitFileToHostPlugin && (
                    <button
                      type="button"
                      onClick={() => onEmitFileToHostPlugin(activeFile)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Emit to Plugin</span>
                    </button>
                  )}

                  {onUseFileInAgentStudio && (
                    <button
                      type="button"
                      onClick={() => onUseFileInAgentStudio(activeFile)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <Cpu className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Agent Studio</span>
                    </button>
                  )}

                  {onUseFileInHarnessSdk && (
                    <button
                      type="button"
                      onClick={() => onUseFileInHarnessSdk(activeFile)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Harness SDK</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onSelectFile(activeFile)}
                    disabled={isHydratingFileId === activeFile.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>
                      {isHydratingFileId === activeFile.id
                        ? 'Streaming...'
                        : 'Hydrate Content Stream'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDownloadFile(activeFile)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyContent(activeFile)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  >
                    {copiedId === activeFile.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onRequestDeleteFile(activeFile)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>

                {/* Collapsible Chunk Diagnostics Toggle */}
                <button
                  type="button"
                  onClick={() => setShowChunkBreakdown((s) => !s)}
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                >
                  <span>{chunks.length} chunk frame(s)</span>
                  {showChunkBreakdown ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {/* Optional Collapsible Chunked Stream Frame Breakdown */}
              {showChunkBreakdown && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 shrink-0">
                  {chunks.slice(0, 4).map((c) => (
                    <div
                      key={c.index}
                      className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-[11px] font-mono tabular-nums flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-700 dark:text-slate-300">
                        Chunk #{c.index} · {formatBytesTabular(c.byteLength)}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        crc:{c.checksum}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Universal Rich Content & Media Renderer (Images, Videos, Audio, PDF, CSV Grid, Code/Text) */}
              <FileContentRenderer
                file={activeFile}
                isHydrating={isHydratingFileId === activeFile.id}
                onHydrate={onSelectFile}
                onRequestOverwriteFile={onRequestOverwriteFile}
                onOpenFullScreen={() => setIsFullViewerOpen(true)}
                isFullScreenModal={false}
              />
            </div>
          )}
        </div>
      </div>

      {/* Dedicated Full-Screen / Theater Universal File & Media Viewer Modal */}
      <FileViewerModal
        file={isFullViewerOpen ? activeFile : null}
        items={filteredItems.length > 0 ? filteredItems : items}
        isHydratingFileId={isHydratingFileId}
        onClose={() => setIsFullViewerOpen(false)}
        onSelectFile={onSelectFile}
        onDownloadFile={onDownloadFile}
        onRequestOverwriteFile={onRequestOverwriteFile}
        onUseFileInAgentStudio={onUseFileInAgentStudio}
        onUseFileInHarnessSdk={onUseFileInHarnessSdk}
        onEmitFileToHostPlugin={onEmitFileToHostPlugin}
      />
    </div>
  );
};
