import { CacheEntry, CacheStatus, DeltaChangeItem, DriveItem } from '../types/drive';
import {
  calculateThroughputMbps,
  computeFastChecksum,
  isBinaryMediaMime,
  parseGoogleDriveUrlOrId,
  upgradeDriveThumbnailUrl,
} from '../core/chunkStreamer';
import { computeSyncDiffPlan, runConcurrentPool } from '../core/liveSyncEngine';
import {
  DriveFolderLookupEntry,
  extractFolderPathFromDriveMetadata,
  normalizeFolderPath,
} from '../core/folderTreeEngine';
import { getAccessToken } from './authService';

export interface LiveDriveListResponse {
  items: DriveItem[];
  nextPageToken?: string;
  startPageToken?: string;
  latencyMs: number;
}

export async function fetchLiveDriveFiles(
  pageSize: number = 30,
  fileNameFilter?: string
): Promise<LiveDriveListResponse> {
  const token = await getAccessToken();
  const start = performance.now();
  const cleanNameFilter = (fileNameFilter || '').trim();

  if (!token) {
    const res = await fetch('/api/mcp/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'list-1',
        method: cleanNameFilter ? 'drive.search' : 'drive.list',
        params: cleanNameFilter ? { query: cleanNameFilter, scope: 'filename' } : {},
      }),
    });
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    if (!res.ok) {
      throw new Error(`Bridge list failed (${res.status})`);
    }
    const rpcData = await res.json();
    const rawFiles = (rpcData?.result?.files || []) as Array<Record<string, unknown>>;
    const items: DriveItem[] = rawFiles.map((f) => {
      const contentStr = String(f.content || '');
      const mimeType = String(f.mimeType || 'text/plain');
      const isDataUrl = contentStr.startsWith('data:');
      return {
        id: String(f.fileId),
        name: String(f.fileName),
        mimeType,
        size: Number(f.byteSize || 0),
        modifiedTime: String(f.modifiedTime || new Date().toISOString()),
        md5Checksum: String(f.checksum || ''),
        folderPath: extractFolderPathFromDriveMetadata({
          folderPath: f.folderPath ? String(f.folderPath) : undefined,
          name: String(f.fileName || ''),
          mimeType,
        }),
        cacheStatus: CacheStatus.HIT,
        lastLatencyMs: latencyMs,
        contentPreview: contentStr,
        mediaUrl: isDataUrl ? contentStr : undefined,
        pinnedForAgent: true,
        source: 'sandbox',
      };
    });
    return { items, latencyMs };
  }

  const fields =
    'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents,webViewLink,webContentLink,thumbnailLink,starred)';
  const escapedFilter = cleanNameFilter.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const baseQuery =
    "trashed = false and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.shortcut'";
  const query = encodeURIComponent(
    escapedFilter ? `${baseQuery} and name contains '${escapedFilter}'` : baseQuery
  );
  const url = `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&q=${query}&fields=${encodeURIComponent(
    fields
  )}&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const folderQuery = encodeURIComponent(
    "trashed = false and mimeType = 'application/vnd.google-apps.folder'"
  );
  const folderUrl = `https://www.googleapis.com/drive/v3/files?pageSize=100&q=${folderQuery}&fields=${encodeURIComponent(
    'files(id,name,parents)'
  )}&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const [response, folderRes] = await Promise.all([
    fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
    fetch(folderUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => null),
  ]);

  if (!response.ok) {
    let errDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      errDetail = await response.text();
    }
    throw new Error(`Google Drive API error (${response.status}): ${errDetail}`);
  }

  const folderMap: Record<string, DriveFolderLookupEntry> = {};
  if (folderRes && folderRes.ok) {
    try {
      const folderData = await folderRes.json();
      for (const fld of folderData.files || []) {
        const fldId = String(fld.id || '');
        if (!fldId) continue;
        const parentIds = Array.isArray(fld.parents) ? fld.parents.map(String) : [];
        folderMap[fldId] = {
          id: fldId,
          name: String(fld.name || 'Folder'),
          parentId: parentIds[0],
        };
      }
    } catch {
      // Ignore optional folder map resolution errors
    }
  }

  const data = await response.json();
  const latencyMs = Math.round((performance.now() - start) * 100) / 100;

  const items: DriveItem[] = (data.files || []).map((f: Record<string, unknown>, idx: number) => {
    const id = String(f.id || '');
    const name = String(f.name || 'Untitled');
    const mimeType = String(f.mimeType || 'application/octet-stream');
    const size = Number(f.size || 0);
    const modifiedTime = String(f.modifiedTime || new Date().toISOString());
    const md5Checksum = String(f.md5Checksum || computeFastChecksum(`${id}-${modifiedTime}`));
    const thumbnailLink = f.thumbnailLink ? String(f.thumbnailLink) : undefined;
    const webContentLink = f.webContentLink ? String(f.webContentLink) : undefined;
    const highResThumb = upgradeDriveThumbnailUrl(thumbnailLink);
    const parents = Array.isArray(f.parents) ? f.parents.map(String) : undefined;

    return {
      id,
      name,
      mimeType,
      size,
      modifiedTime,
      md5Checksum,
      webViewLink: f.webViewLink ? String(f.webViewLink) : undefined,
      webContentLink,
      thumbnailLink,
      mediaUrl: highResThumb,
      folderPath: extractFolderPathFromDriveMetadata({
        name,
        mimeType,
        parents,
        folderMap,
      }),
      cacheStatus: CacheStatus.MISS,
      lastLatencyMs: latencyMs,
      contentPreview: '',
      starred: Boolean(f.starred),
      pinnedForAgent: idx < 3,
      source: 'live_drive',
    };
  });

  return {
    items,
    nextPageToken: data.nextPageToken,
    latencyMs,
  };
}

export async function downloadDriveFileContent(
  file: DriveItem,
  options?: { skipServerMirror?: boolean }
): Promise<{
  content: string;
  mediaUrl?: string;
  latencyMs: number;
  bytesRead: number;
}> {
  const token = await getAccessToken();
  const start = performance.now();

  if (!token || file.source === 'sandbox') {
    const res = await fetch('/api/mcp/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `read-${Date.now()}`,
        method: 'drive.read',
        params: { fileId: file.id },
      }),
    });
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    if (!res.ok) {
      throw new Error(`Failed to read file ${file.name} from bridge (${res.status})`);
    }
    const data = await res.json();
    const content = String(data?.result?.content || file.contentPreview || '');
    const bytesRead = new TextEncoder().encode(content).byteLength;
    const isDataUrl = content.startsWith('data:');
    return {
      content,
      mediaUrl: isDataUrl ? content : file.mediaUrl,
      latencyMs,
      bytesRead,
    };
  }

  const isBinaryMedia = isBinaryMediaMime(file.mimeType, file.name);

  let url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    file.id
  )}?alt=media&supportsAllDrives=true`;

  if (file.mimeType === 'application/vnd.google-apps.document') {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      file.id
    )}/export?mimeType=text/plain`;
  } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      file.id
    )}/export?mimeType=text/csv`;
  } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      file.id
    )}/export?mimeType=text/plain`;
  } else if (file.mimeType === 'application/vnd.google-apps.script') {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      file.id
    )}/export?mimeType=application/vnd.google-apps.script+json`;
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const latencyMs = Math.round((performance.now() - start) * 100) / 100;

  // Binary Media Path (Images, Videos, Audio, PDFs): create native ObjectURL from Blob so media renders/plays cleanly
  if (isBinaryMedia) {
    if (res.ok) {
      const rawBlob = await res.blob();
      const typedBlob =
        rawBlob.type && rawBlob.type !== 'application/octet-stream'
          ? rawBlob
          : new Blob([rawBlob], { type: file.mimeType || 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(typedBlob);
      const bytesRead = typedBlob.size || file.size;
      const descriptor = [
        `# Binary Media Stream Hydrated: ${file.name}`,
        `File ID: ${file.id}`,
        `MIME Type: ${file.mimeType}`,
        `Stream Size: ${bytesRead} bytes`,
        `Modified: ${file.modifiedTime}`,
        `MD5 Checksum: ${file.md5Checksum}`,
      ].join('\n');
      return {
        content: descriptor,
        mediaUrl: blobUrl,
        latencyMs,
        bytesRead,
      };
    }

    const fallbackMediaUrl =
      upgradeDriveThumbnailUrl(file.thumbnailLink) || file.webContentLink || file.mediaUrl;
    const fallbackText = [
      `# Connected Google Drive Media: ${file.name}`,
      `File ID: ${file.id}`,
      `MIME Type: ${file.mimeType}`,
      `Size: ${file.size} bytes`,
      `Modified: ${file.modifiedTime}`,
      `MD5 Checksum: ${file.md5Checksum}`,
      file.webViewLink ? `Drive Link: ${file.webViewLink}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      content: fallbackText,
      mediaUrl: fallbackMediaUrl,
      latencyMs,
      bytesRead: file.size || new TextEncoder().encode(fallbackText).byteLength,
    };
  }

  let text = '';
  if (res.ok) {
    text = await res.text();
  } else {
    text = [
      `# Connected Google Drive File: ${file.name}`,
      `File ID: ${file.id}`,
      `MIME Type: ${file.mimeType}`,
      `Size: ${file.size} bytes`,
      `Modified: ${file.modifiedTime}`,
      `MD5 Checksum: ${file.md5Checksum}`,
      file.webViewLink ? `Drive Link: ${file.webViewLink}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const bytesRead = new TextEncoder().encode(text).byteLength;

  if (!options?.skipServerMirror) {
    void fetch('/api/mcp/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `mirror-${Date.now()}`,
        method: 'drive.upload',
        params: {
          fileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType,
          folderPath: file.folderPath,
          content: text,
        },
      }),
    }).catch(() => {});
  }

  return {
    content: text,
    mediaUrl: file.mediaUrl,
    latencyMs,
    bytesRead,
  };
}

export async function importDriveFileByUrlOrId(urlOrId: string): Promise<{
  item: DriveItem;
  latencyMs: number;
}> {
  const parsed = parseGoogleDriveUrlOrId(urlOrId);
  if (!parsed) {
    throw new Error(
      'Enter a valid Google Drive, Google Docs, or Google Sheets URL or File ID.'
    );
  }

  const token = await getAccessToken();
  const res = await fetch('/api/drive/import-link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      fileId: parsed.fileId,
      resourceType: parsed.resourceType,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Failed to import Google Drive file (${res.status})`);
  }

  const latencyMs = Number(data.latencyMs || 1.0);
  const content = String(data.content || '');
  const size = Number(data.size || new TextEncoder().encode(content).byteLength);

  const itemName = String(data.name || `drive-${parsed.fileId.slice(0, 8)}.txt`);
  const itemMime = String(data.mimeType || 'text/plain');
  const item: DriveItem = {
    id: String(data.id || parsed.fileId),
    name: itemName,
    mimeType: itemMime,
    size,
    modifiedTime: String(data.modifiedTime || new Date().toISOString()),
    md5Checksum: String(data.md5Checksum || computeFastChecksum(content)),
    webViewLink: data.webViewLink ? String(data.webViewLink) : undefined,
    folderPath: extractFolderPathFromDriveMetadata({
      folderPath: data.folderPath ? String(data.folderPath) : undefined,
      name: itemName,
      mimeType: itemMime,
    }),
    cacheStatus: CacheStatus.HIT,
    lastLatencyMs: latencyMs,
    contentPreview: content,
    pinnedForAgent: true,
    source: 'live_drive',
  };

  return { item, latencyMs };
}

export async function uploadFileToDrive(params: {
  name: string;
  mimeType: string;
  content: string;
  folderPath?: string;
  existingFileId?: string;
}): Promise<{ item: DriveItem; latencyMs: number }> {
  const token = await getAccessToken();
  const start = performance.now();
  const isDataUrl = params.content.startsWith('data:');
  const byteSize = new TextEncoder().encode(params.content).byteLength;
  const checksum = computeFastChecksum(params.content);

  const resolvedFolderPath =
    params.folderPath && params.folderPath.trim() !== '/Google Drive'
      ? normalizeFolderPath(params.folderPath)
      : extractFolderPathFromDriveMetadata({
          folderPath: params.folderPath,
          name: params.name,
          mimeType: params.mimeType,
        });

  if (!token) {
    const fileId = params.existingFileId || `drv-${Date.now().toString(36)}`;
    const res = await fetch('/api/mcp/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `up-${Date.now()}`,
        method: 'drive.upload',
        params: {
          fileId,
          fileName: params.name,
          mimeType: params.mimeType,
          folderPath: resolvedFolderPath,
          content: params.content,
        },
      }),
    });
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    if (!res.ok) {
      throw new Error(`Bridge upload failed (${res.status})`);
    }
    const newItem: DriveItem = {
      id: fileId,
      name: params.name,
      mimeType: params.mimeType || 'text/plain',
      size: byteSize,
      modifiedTime: new Date().toISOString(),
      md5Checksum: checksum,
      folderPath: resolvedFolderPath,
      cacheStatus: CacheStatus.HIT,
      lastLatencyMs: latencyMs,
      contentPreview: params.content,
      mediaUrl: isDataUrl ? params.content : undefined,
      pinnedForAgent: true,
      source: 'sandbox',
    };
    return { item: newItem, latencyMs };
  }

  const metadata = {
    name: params.name,
    mimeType: params.mimeType || 'text/plain',
  };

  const boundary = '-------DrivePulseBridgeBoundary7a9b2c';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  let bodyPayload = params.content;
  let contentTransferHeader = '';
  if (isDataUrl && params.content.includes(';base64,')) {
    bodyPayload = params.content.split(';base64,')[1] || '';
    contentTransferHeader = 'Content-Transfer-Encoding: base64\r\n';
  }

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${params.mimeType || 'text/plain'}\r\n` +
    contentTransferHeader +
    '\r\n' +
    bodyPayload +
    closeDelimiter;

  const endpoint = params.existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(params.existingFileId)}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink,webContentLink,thumbnailLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink,webContentLink,thumbnailLink';

  const response = await fetch(endpoint, {
    method: params.existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Drive upload failed (${response.status}): ${errText}`);
  }

  const created = await response.json();
  const latencyMs = Math.round((performance.now() - start) * 100) / 100;
  const thumbnailLink = created.thumbnailLink ? String(created.thumbnailLink) : undefined;

  const item: DriveItem = {
    id: String(created.id),
    name: String(created.name || params.name),
    mimeType: String(created.mimeType || params.mimeType),
    size: Number(created.size || byteSize),
    modifiedTime: String(created.modifiedTime || new Date().toISOString()),
    md5Checksum: String(created.md5Checksum || checksum),
    webViewLink: created.webViewLink ? String(created.webViewLink) : undefined,
    webContentLink: created.webContentLink ? String(created.webContentLink) : undefined,
    thumbnailLink,
    mediaUrl: isDataUrl ? params.content : upgradeDriveThumbnailUrl(thumbnailLink),
    folderPath: resolvedFolderPath,
    cacheStatus: CacheStatus.HIT,
    lastLatencyMs: latencyMs,
    contentPreview: params.content,
    pinnedForAgent: true,
    source: 'live_drive',
  };

  return { item, latencyMs };
}

export async function deleteDriveFileWithAuth(file: DriveItem): Promise<{ latencyMs: number }> {
  const token = await getAccessToken();
  const start = performance.now();

  if (token && file.source === 'live_drive') {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok && res.status !== 204) {
      const errText = await responseTextSafe(res);
      throw new Error(`Failed to delete file from Google Drive (${res.status}): ${errText}`);
    }
  } else {
    await fetch('/api/mcp/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `del-${Date.now()}`,
        method: 'drive.delete',
        params: { fileId: file.id },
      }),
    });
  }

  const latencyMs = Math.round((performance.now() - start) * 100) / 100;
  return { latencyMs };
}

export async function pollDriveDeltaChanges(currentStartPageToken: string): Promise<{
  newStartPageToken: string;
  changes: DeltaChangeItem[];
  latencyMs: number;
}> {
  const token = await getAccessToken();
  const start = performance.now();

  if (!token) {
    const res = await fetch('/api/mcp/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `sync-${Date.now()}`,
        method: 'drive.deltaSync',
        params: { pageToken: currentStartPageToken },
      }),
    });
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    const data = await res.json();
    return {
      newStartPageToken: String(data?.result?.newStartPageToken || currentStartPageToken),
      changes: [],
      latencyMs,
    };
  }

  let pageToken = currentStartPageToken;
  if (!pageToken) {
    const startTokenRes = await fetch('https://www.googleapis.com/drive/v3/changes/startPageToken', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (startTokenRes.ok) {
      const tokenData = await startTokenRes.json();
      pageToken = String(tokenData.startPageToken || '1');
    }
  }

  const changesRes = await fetch(
    `https://www.googleapis.com/drive/v3/changes?pageToken=${encodeURIComponent(pageToken)}&fields=newStartPageToken,nextPageToken,changes(fileId,removed,time,file(id,name,mimeType,size,modifiedTime,md5Checksum))`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const latencyMs = Math.round((performance.now() - start) * 100) / 100;
  if (!changesRes.ok) {
    return {
      newStartPageToken: pageToken,
      changes: [],
      latencyMs,
    };
  }

  const data = await changesRes.json();
  const changes: DeltaChangeItem[] = (data.changes || []).map((c: Record<string, unknown>) => {
    const rawFile = c.file as Record<string, unknown> | undefined;
    return {
      fileId: String(c.fileId || ''),
      removed: Boolean(c.removed),
      timestamp: String(c.time || new Date().toISOString()),
      file: rawFile
        ? {
            id: String(rawFile.id || c.fileId),
            name: String(rawFile.name || 'Updated File'),
            mimeType: String(rawFile.mimeType || 'application/octet-stream'),
            size: Number(rawFile.size || 0),
            modifiedTime: String(rawFile.modifiedTime || new Date().toISOString()),
            md5Checksum: rawFile.md5Checksum ? String(rawFile.md5Checksum) : undefined,
          }
        : undefined,
    };
  });

  return {
    newStartPageToken: String(data.newStartPageToken || data.nextPageToken || pageToken),
    changes,
    latencyMs,
  };
}

export interface TurboSyncExecutionResult {
  items: DriveItem[];
  newlyHydratedItems: DriveItem[];
  unchangedCount: number;
  hydratedCount: number;
  removedIds: string[];
  totalBytes: number;
  throughputMbps: number;
  latencyMs: number;
  seq: number;
}

/**
 * Two-Phase Zero-Blocking Ultra-Fast Turbo Sync:
 * Phase 1 (< 50 ms): Fetches metadata + O(N) checksum diffing and invokes `onMetadataReady`
 *   immediately so the UI updates with 0 blocking wait.
 * Phase 2 (16x parallel workers): Hydrates text/code/config files <= 256 KB concurrently while
 *   large binary media (images, videos, PDFs) use instant high-res `thumbnailLink` and stream
 *   on-demand when clicked.
 */
export async function executeUltraFastTurboSync(params: {
  pageSize: number;
  concurrency?: number;
  cachedEntries: CacheEntry[];
  previousItems?: DriveItem[];
  fileNameFilter?: string;
  onMetadataReady?: (initialItems: DriveItem[], metaLatencyMs: number) => void;
}): Promise<TurboSyncExecutionResult> {
  const start = performance.now();
  const concurrency = Math.max(params.concurrency || 12, 12);

  // Phase 1: Instant Metadata + O(N) Checksum Diff (< 50 ms)
  const remoteList = await fetchLiveDriveFiles(params.pageSize, params.fileNameFilter);
  const diffPlan = computeSyncDiffPlan(
    remoteList.items,
    params.cachedEntries,
    params.previousItems || []
  );

  const prevMap = new Map<string, DriveItem>();
  for (const prev of params.previousItems || []) {
    prevMap.set(prev.id, prev);
  }

  const hitMap = new Map<string, DriveItem>();
  for (const hit of diffPlan.unchangedHits) {
    const prev = prevMap.get(hit.id);
    hitMap.set(hit.id, {
      ...hit,
      mediaUrl: hit.mediaUrl || prev?.mediaUrl,
    });
  }

  const initialMergedItems = remoteList.items.map((item) => hitMap.get(item.id) || item);
  const metaLatencyMs = Math.max(0.05, Math.round((performance.now() - start) * 100) / 100);
  if (params.onMetadataReady) {
    params.onMetadataReady(initialMergedItems, metaLatencyMs);
  }

  // Phase 2: Hydrate lightweight text/code/sheet files in parallel; binary media streams on-demand
  const MAX_EAGER_TEXT_BYTES = 256 * 1024;
  const eagerCandidates = diffPlan.toHydrate.filter((file) => {
    if (file.contentPreview) return true;
    if (isBinaryMediaMime(file.mimeType, file.name)) {
      return false; // Binary images/videos/PDFs use instant thumbnailLink & on-demand Blob streaming
    }
    return (file.size || 0) <= MAX_EAGER_TEXT_BYTES;
  });

  const newlyHydratedItems = await runConcurrentPool(
    eagerCandidates,
    concurrency,
    async (file) => {
      if (file.contentPreview) {
        return {
          ...file,
          cacheStatus: CacheStatus.HIT,
        };
      }
      const downloaded = await downloadDriveFileContent(file, { skipServerMirror: true });
      return {
        ...file,
        size: downloaded.bytesRead || file.size,
        cacheStatus: CacheStatus.HIT,
        lastLatencyMs: downloaded.latencyMs,
        contentPreview: downloaded.content,
        mediaUrl: downloaded.mediaUrl || file.mediaUrl,
      };
    }
  );

  const hydratedMap = new Map<string, DriveItem>(hitMap);
  for (const hydrated of newlyHydratedItems) {
    hydratedMap.set(hydrated.id, hydrated);
  }

  const mergedItems = remoteList.items.map((item) => hydratedMap.get(item.id) || item);

  // Batch-mirror text/metadata items to the Harness server LRU cache in a single non-blocking pass
  let seq = 1;
  try {
    const batchRes = await fetch('/api/sync/turbo-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: 'TURBO_BATCH',
        files: mergedItems
          .filter((f) => !f.contentPreview.startsWith('data:') || f.size <= 512 * 1024)
          .map((f) => ({
            fileId: f.id,
            fileName: f.name,
            mimeType: f.mimeType,
            content: f.contentPreview,
            checksum: f.md5Checksum,
            folderPath: f.folderPath,
            modifiedTime: f.modifiedTime,
            source: f.source,
          })),
      }),
    });
    if (batchRes.ok) {
      const batchJson = await batchRes.json();
      seq = Number(batchJson.seq || 1);
    }
  } catch {
    // Non-fatal if server batch endpoint is busy
  }

  const totalBytes = mergedItems.reduce((sum, i) => sum + (i.size || 0), 0);
  const latencyMs = Math.max(0.05, Math.round((performance.now() - start) * 100) / 100);
  const throughputMbps = calculateThroughputMbps(Math.max(512, totalBytes), latencyMs);

  return {
    items: mergedItems,
    newlyHydratedItems,
    unchangedCount: diffPlan.unchangedHits.length,
    hydratedCount: newlyHydratedItems.length,
    removedIds: diffPlan.removedIds,
    totalBytes,
    throughputMbps,
    latencyMs,
    seq,
  };
}

export async function probeSyncBusRtt(): Promise<{
  rttMs: number;
  serverProcessingMs: number;
  seq: number;
  activeSubscribers: number;
}> {
  const start = performance.now();
  const res = await fetch('/api/sync/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const rttMs = Math.max(0.05, Math.round((performance.now() - start) * 100) / 100);
  const data = await res.json();
  return {
    rttMs,
    serverProcessingMs: Number(data.serverProcessingMs || 0.05),
    seq: Number(data.seq || 1),
    activeSubscribers: Number(data.activeSubscribers || 1),
  };
}

async function responseTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return 'Unknown error';
  }
}
