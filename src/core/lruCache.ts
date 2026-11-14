import { CacheEntry, CacheStatus, CacheTelemetry, DeltaChangeItem, DriveItem } from '../types/drive';

export class DriveLruCache {
  private map: Map<string, CacheEntry> = new Map();
  private maxBytes: number;
  private usedBytes = 0;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private totalHitLatencyMs = 0;
  private totalMissLatencyMs = 0;
  private defaultTtlMs: number;

  constructor(maxBytes: number = 64 * 1024 * 1024, defaultTtlMs: number = 15 * 60 * 1000) {
    this.maxBytes = Math.max(1024, maxBytes);
    this.defaultTtlMs = defaultTtlMs;
  }

  public setMaxBytes(newMaxBytes: number): void {
    this.maxBytes = Math.max(1024, newMaxBytes);
    this.evictIfNeeded(0);
  }

  public getMaxBytes(): number {
    return this.maxBytes;
  }

  public recordMissLatency(measuredMs: number): void {
    this.totalMissLatencyMs += Math.max(0, measuredMs);
  }

  public get(fileId: string, expectedChecksum?: string): { entry: CacheEntry | null; status: CacheStatus; latencyMs: number } {
    const start = performance.now();
    const existing = this.map.get(fileId);
    if (!existing) {
      const elapsed = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
      this.missCount += 1;
      return { entry: null, status: CacheStatus.MISS, latencyMs: elapsed };
    }

    const now = Date.now();
    if (now - existing.createdAt > existing.ttlMs) {
      this.delete(fileId);
      const elapsed = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
      this.missCount += 1;
      return { entry: null, status: CacheStatus.STALE, latencyMs: elapsed };
    }

    if (expectedChecksum && existing.checksum !== expectedChecksum) {
      this.delete(fileId);
      const elapsed = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
      this.missCount += 1;
      return { entry: null, status: CacheStatus.STALE, latencyMs: elapsed };
    }

    // Refresh LRU order by deleting and re-inserting
    this.map.delete(fileId);
    const updated: CacheEntry = {
      ...existing,
      lastAccessed: now,
      hitCount: existing.hitCount + 1,
    };
    this.map.set(fileId, updated);
    const elapsed = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
    this.hitCount += 1;
    this.totalHitLatencyMs += elapsed;

    return { entry: updated, status: CacheStatus.HIT, latencyMs: elapsed };
  }

  public put(fileId: string, fileName: string, checksum: string, payload: string, explicitByteSize?: number): CacheEntry {
    const computedBytes =
      explicitByteSize ??
      (typeof Buffer !== 'undefined' && Buffer.byteLength
        ? Buffer.byteLength(payload, 'utf8')
        : new TextEncoder().encode(payload).byteLength);

    if (this.map.has(fileId)) {
      this.delete(fileId);
    }

    this.evictIfNeeded(computedBytes);

    const now = Date.now();
    const entry: CacheEntry = {
      key: `${fileId}:${checksum.slice(0, 8)}`,
      fileId,
      fileName,
      checksum,
      payload,
      byteSize: computedBytes,
      createdAt: now,
      lastAccessed: now,
      hitCount: 0,
      ttlMs: this.defaultTtlMs,
    };

    if (computedBytes <= this.maxBytes) {
      this.map.set(fileId, entry);
      this.usedBytes += computedBytes;
    }

    return entry;
  }

  public delete(fileId: string): boolean {
    const existing = this.map.get(fileId);
    if (!existing) return false;
    this.usedBytes = Math.max(0, this.usedBytes - existing.byteSize);
    return this.map.delete(fileId);
  }

  public clear(): void {
    this.map.clear();
    this.usedBytes = 0;
  }

  public entries(): CacheEntry[] {
    return Array.from(this.map.values()).reverse();
  }

  public hasValid(fileId: string, checksum?: string): boolean {
    const existing = this.map.get(fileId);
    if (!existing) return false;
    if (Date.now() - existing.createdAt > existing.ttlMs) return false;
    if (checksum && existing.checksum !== checksum) return false;
    return true;
  }

  public getTelemetry(): CacheTelemetry {
    const totalOps = this.hitCount + this.missCount;
    const hitRatioPercent = totalOps === 0 ? 0 : Math.round((this.hitCount / totalOps) * 1000) / 10;
    const avgHitLatencyMs =
      this.hitCount === 0
        ? 0
        : Math.max(0.01, Math.round((this.totalHitLatencyMs / this.hitCount) * 100) / 100);
    const avgMissLatencyMs =
      this.missCount === 0
        ? 0
        : Math.round((this.totalMissLatencyMs / this.missCount) * 100) / 100;

    return {
      totalEntries: this.map.size,
      usedBytes: this.usedBytes,
      maxBytes: this.maxBytes,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
      hitRatioPercent,
      avgHitLatencyMs,
      avgMissLatencyMs,
    };
  }

  public applyDeltaChanges(items: DriveItem[], changes: DeltaChangeItem[]): {
    updatedItems: DriveItem[];
    invalidatedIds: string[];
  } {
    const invalidatedIds: string[] = [];
    const itemMap = new Map<string, DriveItem>(items.map((item) => [item.id, { ...item }]));

    for (const change of changes) {
      if (change.removed) {
        if (this.delete(change.fileId)) {
          invalidatedIds.push(change.fileId);
        }
        itemMap.delete(change.fileId);
      } else if (change.file) {
        const existingCache = this.map.get(change.fileId);
        const newChecksum = change.file.md5Checksum || `md5-${change.file.modifiedTime}`;
        if (existingCache && existingCache.checksum !== newChecksum) {
          this.delete(change.fileId);
          invalidatedIds.push(change.fileId);
        }
        const prev = itemMap.get(change.fileId);
        const updatedItem: DriveItem = {
          id: change.file.id,
          name: change.file.name,
          mimeType: change.file.mimeType,
          size: change.file.size ?? prev?.size ?? 0,
          modifiedTime: change.file.modifiedTime,
          md5Checksum: newChecksum,
          folderPath: prev?.folderPath ?? '/Google Drive',
          cacheStatus: invalidatedIds.includes(change.fileId)
            ? CacheStatus.STALE
            : prev?.cacheStatus ?? CacheStatus.MISS,
          lastLatencyMs: prev?.lastLatencyMs ?? 0,
          contentPreview: change.file.contentPreview ?? prev?.contentPreview ?? '',
          pinnedForAgent: prev?.pinnedForAgent ?? false,
          source: prev?.source ?? 'live_drive',
        };
        itemMap.set(change.fileId, updatedItem);
      }
    }

    return {
      updatedItems: Array.from(itemMap.values()),
      invalidatedIds,
    };
  }

  private evictIfNeeded(incomingBytes: number): void {
    if (incomingBytes > this.maxBytes) {
      return;
    }
    while (this.usedBytes + incomingBytes > this.maxBytes && this.map.size > 0) {
      const oldestKey = this.map.keys().next().value;
      if (!oldestKey) break;
      this.delete(oldestKey);
      this.evictionCount += 1;
    }
  }
}
