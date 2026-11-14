import { CacheEntry, CacheStatus, DriveItem } from '../types/drive';

export type LiveSyncEventType =
  | 'sync:init'
  | 'file:upserted'
  | 'file:deleted'
  | 'sync:turbo_complete'
  | 'sync:heartbeat';

export interface LiveSyncFilePayload {
  fileId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  content: string;
  folderPath: string;
  modifiedTime: string;
  source: 'live_drive' | 'sandbox' | 'harness_rpc';
}

export interface LiveSyncEvent {
  seq: number;
  type: LiveSyncEventType;
  timestamp: string;
  latencyMs: number;
  origin: 'HARNESS_RPC' | 'GOOGLE_DRIVE_DELTA' | 'TURBO_BATCH' | 'SERVER_BUS';
  file?: LiveSyncFilePayload;
  deletedFileId?: string;
  summary?: {
    totalFiles: number;
    hydratedCount: number;
    unchangedHits: number;
    totalBytes: number;
    throughputMbps: number;
  };
}

export interface SyncDiffPlan {
  unchangedHits: DriveItem[];
  toHydrate: DriveItem[];
  removedIds: string[];
  estimatedBytesToTransfer: number;
}

/**
 * Computes an ultra-fast O(N) checksum diff plan between remote Drive metadata
 * and currently hydrated LRU cache entries so unchanged files are served in <0.1ms
 * with zero network transfer.
 */
export function computeSyncDiffPlan(
  remoteItems: DriveItem[],
  cachedEntries: CacheEntry[],
  previousItems: DriveItem[] = []
): SyncDiffPlan {
  const cacheMap = new Map<string, CacheEntry>();
  for (const entry of cachedEntries) {
    cacheMap.set(entry.fileId, entry);
  }

  const remoteIdSet = new Set<string>();
  const unchangedHits: DriveItem[] = [];
  const toHydrate: DriveItem[] = [];
  let estimatedBytesToTransfer = 0;

  for (const item of remoteItems) {
    remoteIdSet.add(item.id);
    const cached = cacheMap.get(item.id);
    if (
      cached &&
      cached.payload &&
      (!item.md5Checksum || cached.checksum === item.md5Checksum)
    ) {
      unchangedHits.push({
        ...item,
        size: cached.byteSize || item.size,
        cacheStatus: CacheStatus.HIT,
        contentPreview: cached.payload,
      });
    } else {
      toHydrate.push({
        ...item,
        cacheStatus: cached ? CacheStatus.STALE : CacheStatus.MISS,
      });
      estimatedBytesToTransfer += Math.max(0, item.size || 0);
    }
  }

  const removedIds: string[] = [];
  for (const prev of previousItems) {
    if (!remoteIdSet.has(prev.id)) {
      removedIds.push(prev.id);
    }
  }

  return {
    unchangedHits,
    toHydrate,
    removedIds,
    estimatedBytesToTransfer,
  };
}

/**
 * Executes an array of async task factories with bounded concurrency (e.g., 4, 8, or 16 parallel streams)
 * for ultra-fast parallel Google Drive + Harness chunk hydration.
 */
export async function runConcurrentPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.min(32, Math.floor(concurrency || 6)));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workerCount = Math.min(safeConcurrency, items.length);
  const runners: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    runners.push(runner());
  }
  await Promise.all(runners);
  return results;
}

/**
 * Idempotently reconciles an incoming real-time server or Drive delta event into the client items list.
 * Follows server-authoritative, idempotent event handling to prevent duplicate entries on reconnect.
 */
export function reconcileLiveSyncEvent(
  currentItems: DriveItem[],
  event: LiveSyncEvent
): { items: DriveItem[]; changed: boolean } {
  if (event.type === 'file:deleted' && event.deletedFileId) {
    const exists = currentItems.some((i) => i.id === event.deletedFileId);
    if (!exists) {
      return { items: currentItems, changed: false };
    }
    return {
      items: currentItems.filter((i) => i.id !== event.deletedFileId),
      changed: true,
    };
  }

  if (event.type === 'file:upserted' && event.file) {
    const f = event.file;
    const existingIndex = currentItems.findIndex((i) => i.id === f.fileId);
    const updatedItem: DriveItem = {
      id: f.fileId,
      name: f.fileName,
      mimeType: f.mimeType || 'text/plain',
      size: f.byteSize,
      modifiedTime: f.modifiedTime || event.timestamp,
      md5Checksum: f.checksum,
      folderPath: f.folderPath || '/Google Drive',
      cacheStatus: CacheStatus.HIT,
      lastLatencyMs: event.latencyMs,
      contentPreview: f.content,
      pinnedForAgent: existingIndex >= 0 ? currentItems[existingIndex].pinnedForAgent : true,
      source: f.source === 'live_drive' ? 'live_drive' : 'sandbox',
    };

    if (existingIndex >= 0) {
      const existing = currentItems[existingIndex];
      if (
        existing.md5Checksum === updatedItem.md5Checksum &&
        existing.name === updatedItem.name &&
        existing.contentPreview === updatedItem.contentPreview
      ) {
        return { items: currentItems, changed: false };
      }
      const next = [...currentItems];
      next[existingIndex] = updatedItem;
      return { items: next, changed: true };
    }

    return {
      items: [updatedItem, ...currentItems],
      changed: true,
    };
  }

  return { items: currentItems, changed: false };
}
