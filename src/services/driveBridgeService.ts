import { CacheStatus, DeltaChangeItem, DriveItem } from '../types/drive';
import { computeFastChecksum, parseGoogleDriveUrlOrId } from '../core/chunkStreamer';
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
    const items: DriveItem[] = rawFiles.map((f) => ({
      id: String(f.fileId),
      name: String(f.fileName),
      mimeType: String(f.mimeType || 'text/plain'),
      size: Number(f.byteSize || 0),
      modifiedTime: String(f.modifiedTime || new Date().toISOString()),
      md5Checksum: String(f.checksum || ''),
      folderPath: String(f.folderPath || '/Google Drive'),
      cacheStatus: CacheStatus.HIT,
      lastLatencyMs: latencyMs,
      contentPreview: String(f.content || ''),
      pinnedForAgent: true,
      source: 'sandbox',
    }));
    return { items, latencyMs };
  }

  const fields =
    'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents,webViewLink,starred)';
  const escapedFilter = cleanNameFilter.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const baseQuery =
    "trashed = false and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.shortcut'";
  const query = encodeURIComponent(
    escapedFilter ? `${baseQuery} and name contains '${escapedFilter}'` : baseQuery
  );
  const url = `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&q=${query}&fields=${encodeURIComponent(
    fields
  )}&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

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

  const data = await response.json();
  const latencyMs = Math.round((performance.now() - start) * 100) / 100;

  const items: DriveItem[] = (data.files || []).map((f: Record<string, unknown>, idx: number) => {
    const id = String(f.id || '');
    const name = String(f.name || 'Untitled');
    const mimeType = String(f.mimeType || 'application/octet-stream');
    const size = Number(f.size || 0);
    const modifiedTime = String(f.modifiedTime || new Date().toISOString());
    const md5Checksum = String(f.md5Checksum || computeFastChecksum(`${id}-${modifiedTime}`));

    return {
      id,
      name,
      mimeType,
      size,
      modifiedTime,
      md5Checksum,
      webViewLink: f.webViewLink ? String(f.webViewLink) : undefined,
      folderPath: '/Google Drive',
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

export async function downloadDriveFileContent(file: DriveItem): Promise<{
  content: string;
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
    return {
      content,
      latencyMs,
      bytesRead,
    };
  }

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

  // Mirror hydrated live Google Drive file content into server MCP LRU cache for /api/mcp/rpc consumers
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
        content: text,
      },
    }),
  }).catch(() => {});

  return {
    content: text,
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

  const item: DriveItem = {
    id: String(data.id || parsed.fileId),
    name: String(data.name || `drive-${parsed.fileId.slice(0, 8)}.txt`),
    mimeType: String(data.mimeType || 'text/plain'),
    size,
    modifiedTime: String(data.modifiedTime || new Date().toISOString()),
    md5Checksum: String(data.md5Checksum || computeFastChecksum(content)),
    webViewLink: data.webViewLink ? String(data.webViewLink) : undefined,
    folderPath: '/Google Drive',
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
  const byteSize = new TextEncoder().encode(params.content).byteLength;
  const checksum = computeFastChecksum(params.content);

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
          folderPath: params.folderPath || '/Workspace',
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
      folderPath: params.folderPath || '/Workspace',
      cacheStatus: CacheStatus.HIT,
      lastLatencyMs: latencyMs,
      contentPreview: params.content,
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

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${params.mimeType || 'text/plain'}\r\n\r\n` +
    params.content +
    closeDelimiter;

  const endpoint = params.existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(params.existingFileId)}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink';

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

  const item: DriveItem = {
    id: String(created.id),
    name: String(created.name || params.name),
    mimeType: String(created.mimeType || params.mimeType),
    size: Number(created.size || byteSize),
    modifiedTime: String(created.modifiedTime || new Date().toISOString()),
    md5Checksum: String(created.md5Checksum || checksum),
    webViewLink: created.webViewLink ? String(created.webViewLink) : undefined,
    folderPath: '/Google Drive',
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

async function responseTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return 'Unknown error';
  }
}
