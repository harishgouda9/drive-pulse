export enum CacheStatus {
  HIT = 'HIT',
  MISS = 'MISS',
  STALE = 'STALE',
}

export enum FileCategory {
  ALL = 'all',
  DOCUMENTS = 'documents',
  SPREADSHEETS = 'spreadsheets',
  CODE = 'code',
  MEDIA = 'media',
}

export enum WorkspaceView {
  EXPLORER = 'explorer',
  SYNC_CACHE = 'sync_cache',
  AGENT_STUDIO = 'agent_studio',
  HARNESS_SDK = 'harness_sdk',
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  md5Checksum: string;
  parents?: string[];
  webViewLink?: string;
  folderPath: string;
  cacheStatus: CacheStatus;
  lastLatencyMs: number;
  contentPreview: string;
  starred?: boolean;
  pinnedForAgent?: boolean;
  source: 'live_drive' | 'sandbox';
}

export interface CacheEntry {
  key: string;
  fileId: string;
  fileName: string;
  checksum: string;
  payload: string;
  byteSize: number;
  createdAt: number;
  lastAccessed: number;
  hitCount: number;
  ttlMs: number;
}

export interface CacheTelemetry {
  totalEntries: number;
  usedBytes: number;
  maxBytes: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  hitRatioPercent: number;
  avgHitLatencyMs: number;
  avgMissLatencyMs: number;
}

export interface DeltaChangeItem {
  fileId: string;
  removed: boolean;
  file?: {
    id: string;
    name: string;
    mimeType: string;
    size?: number;
    modifiedTime: string;
    md5Checksum?: string;
    contentPreview?: string;
  };
  timestamp: string;
}

export interface TransferJob {
  id: string;
  fileName: string;
  direction: 'UPLOAD' | 'DOWNLOAD' | 'SYNC';
  totalBytes: number;
  transferredBytes: number;
  totalChunks: number;
  completedChunks: number;
  throughputMbps: number;
  latencyMs: number;
  status: 'STREAMING' | 'COMPLETED' | 'FAILED';
  startedAt: string;
}

export interface HarnessRpcLog {
  id: string;
  timestamp: string;
  transport: 'POSTMESSAGE_SDK' | 'REST_MCP';
  method: string;
  paramsSummary: string;
  status: 'OK' | 'ERROR';
  latencyMs: number;
  cacheHit: boolean;
  requestPayload: string;
  responsePayload: string;
}

export interface DestructiveActionRequest {
  actionType: 'DELETE' | 'OVERWRITE' | 'CLEAR_DRIVE_FOLDER';
  title: string;
  description: string;
  affectedFiles: Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
  }>;
  onConfirm: () => Promise<void>;
}

export interface AgentReasoningResult {
  id: string;
  query: string;
  model: string;
  thinkingLevel: string;
  thinkingSummary: string;
  answerMarkdown: string;
  referencedFiles: string[];
  suggestedActions: Array<{
    label: string;
    fileName: string;
    contentToSave: string;
  }>;
  latencyMs: number;
  timestamp: string;
}
