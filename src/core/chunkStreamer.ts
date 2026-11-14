import { DriveItem, FileCategory } from '../types/drive';

export interface ChunkDescriptor {
  index: number;
  totalChunks: number;
  byteOffset: number;
  byteLength: number;
  checksum: string;
  payloadSlice: string;
}

export function computeFastChecksum(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function splitIntoChunks(content: string, chunkSizeChars: number = 65536): ChunkDescriptor[] {
  const safeChunkSize = Math.max(256, chunkSizeChars);
  if (content.length === 0) {
    return [
      {
        index: 0,
        totalChunks: 1,
        byteOffset: 0,
        byteLength: 0,
        checksum: computeFastChecksum(''),
        payloadSlice: '',
      },
    ];
  }

  const totalChunks = Math.ceil(content.length / safeChunkSize);
  const chunks: ChunkDescriptor[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * safeChunkSize;
    const slice = content.slice(start, start + safeChunkSize);
    chunks.push({
      index: i,
      totalChunks,
      byteOffset: start,
      byteLength: slice.length,
      checksum: computeFastChecksum(slice),
      payloadSlice: slice,
    });
  }

  return chunks;
}

export function calculateThroughputMbps(bytes: number, durationMs: number): number {
  if (bytes <= 0 || durationMs <= 0) return 0;
  const megabytes = bytes / (1024 * 1024);
  const seconds = durationMs / 1000;
  return Math.round((megabytes / seconds) * 10) / 10;
}

export function formatBytesTabular(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function classifyFileCategory(mimeType: string, fileName: string): FileCategory {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();

  if (
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('csv') ||
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.xlsx')
  ) {
    return FileCategory.SPREADSHEETS;
  }

  if (
    lowerMime.includes('json') ||
    lowerMime.includes('javascript') ||
    lowerMime.includes('typescript') ||
    lowerMime.includes('yaml') ||
    lowerMime.includes('sql') ||
    lowerName.endsWith('.ts') ||
    lowerName.endsWith('.tsx') ||
    lowerName.endsWith('.py') ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.yaml') ||
    lowerName.endsWith('.yml') ||
    lowerName.endsWith('.sql')
  ) {
    return FileCategory.CODE;
  }

  if (lowerMime.startsWith('image/') || lowerMime.startsWith('video/') || lowerMime.startsWith('audio/')) {
    return FileCategory.MEDIA;
  }

  return FileCategory.DOCUMENTS;
}

export type SearchScopeMode = 'filename' | 'all';

export function filterAndSortDriveItems(
  items: DriveItem[],
  query: string,
  category: FileCategory,
  folderFilter: string | null,
  sortBy: 'name' | 'size' | 'modifiedTime' | 'latency',
  searchScope: SearchScopeMode = 'filename'
): DriveItem[] {
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (folderFilter && folderFilter !== 'ALL' && item.folderPath !== folderFilter) {
      return false;
    }
    if (category !== FileCategory.ALL && classifyFileCategory(item.mimeType, item.name) !== category) {
      return false;
    }
    if (!normalizedQuery) return true;

    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    if (searchScope === 'filename') {
      const lowerName = item.name.toLowerCase();
      return tokens.every((tok) => lowerName.includes(tok));
    }

    return tokens.every(
      (tok) =>
        item.name.toLowerCase().includes(tok) ||
        item.mimeType.toLowerCase().includes(tok) ||
        item.folderPath.toLowerCase().includes(tok) ||
        item.contentPreview.toLowerCase().includes(tok)
    );
  });

  return filtered.sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'size') return b.size - a.size;
    if (sortBy === 'latency') return a.lastLatencyMs - b.lastLatencyMs;
    return new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime();
  });
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

export function splitFilenameHighlight(fileName: string, query: string): HighlightSegment[] {
  const cleanQuery = query.trim();
  if (!cleanQuery || !fileName) {
    return [{ text: fileName, matched: false }];
  }
  const firstToken = cleanQuery.split(/\s+/).filter(Boolean)[0] || cleanQuery;
  const lowerName = fileName.toLowerCase();
  const lowerToken = firstToken.toLowerCase();
  const idx = lowerName.indexOf(lowerToken);

  if (idx === -1) {
    return [{ text: fileName, matched: false }];
  }

  const segments: HighlightSegment[] = [];
  if (idx > 0) {
    segments.push({ text: fileName.slice(0, idx), matched: false });
  }
  segments.push({
    text: fileName.slice(idx, idx + firstToken.length),
    matched: true,
  });
  if (idx + firstToken.length < fileName.length) {
    segments.push({ text: fileName.slice(idx + firstToken.length), matched: false });
  }
  return segments;
}

export interface ParsedDriveResource {
  fileId: string;
  resourceType: 'document' | 'spreadsheet' | 'presentation' | 'file';
}

export function parseGoogleDriveUrlOrId(input: string): ParsedDriveResource | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const docMatch = trimmed.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]{10,})/);
  if (docMatch) {
    return { fileId: docMatch[1], resourceType: 'document' };
  }

  const sheetMatch = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  if (sheetMatch) {
    return { fileId: sheetMatch[1], resourceType: 'spreadsheet' };
  }

  const slideMatch = trimmed.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]{10,})/);
  if (slideMatch) {
    return { fileId: slideMatch[1], resourceType: 'presentation' };
  }

  const driveFileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (driveFileMatch) {
    return { fileId: driveFileMatch[1], resourceType: 'file' };
  }

  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idParamMatch) {
    return { fileId: idParamMatch[1], resourceType: 'file' };
  }

  if (/^[a-zA-Z0-9_-]{10,64}$/.test(trimmed)) {
    return { fileId: trimmed, resourceType: 'file' };
  }

  return null;
}

export interface ContentStats {
  lineCount: number;
  wordCount: number;
  charCount: number;
  byteCount: number;
}

export function computeContentStats(content: string): ContentStats {
  if (!content) {
    return { lineCount: 0, wordCount: 0, charCount: 0, byteCount: 0 };
  }
  const lineCount = content.split(/\r\n|\r|\n/).length;
  const words = content.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const charCount = content.length;
  const byteCount = new TextEncoder().encode(content).byteLength;
  return { lineCount, wordCount, charCount, byteCount };
}

