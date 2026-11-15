import { DriveItem } from '../types/drive';

export interface FolderTreeNode {
  id: string;
  name: string;
  fullPath: string;
  depth: number;
  directFileCount: number;
  totalFileCount: number;
  totalBytes: number;
  files: DriveItem[];
  children: FolderTreeNode[];
}

export interface DriveFolderLookupEntry {
  id: string;
  name: string;
  parentId?: string;
}

/**
 * Normalizes any raw folder path into a canonical leading-slash path without trailing slash.
 * Example: "Engineering/Pipelines/" -> "/Engineering/Pipelines"
 */
export function normalizeFolderPath(rawPath?: string | null): string {
  if (!rawPath) return '/Google Drive';
  const cleaned = String(rawPath)
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');

  if (!cleaned || cleaned === '/') {
    return '/Google Drive';
  }

  const withLeading = cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
  const withoutTrailing =
    withLeading.length > 1 && withLeading.endsWith('/')
      ? withLeading.slice(0, -1)
      : withLeading;

  return withoutTrailing || '/Google Drive';
}

/**
 * Splits a normalized folder path into its hierarchy segments.
 * Example: "/Engineering/Pipelines/Prod" -> ["Engineering", "Pipelines", "Prod"]
 */
export function splitFolderPathSegments(rawPath?: string | null): string[] {
  const normalized = normalizeFolderPath(rawPath);
  return normalized
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Returns all ancestor folder paths from root down to the given folder path.
 * Example: "/Engineering/Pipelines/Prod" -> ["/Engineering", "/Engineering/Pipelines", "/Engineering/Pipelines/Prod"]
 */
export function collectAncestorPaths(rawPath?: string | null): string[] {
  if (!rawPath || rawPath === 'ALL') return [];
  const segments = splitFolderPathSegments(rawPath);
  const paths: string[] = [];
  let current = '';
  for (const seg of segments) {
    current = `${current}/${seg}`;
    paths.push(current);
  }
  return paths;
}

/**
 * Checks whether an item's folderPath belongs to the selected folder or any of its nested subdirectories.
 */
export function matchesFolderHierarchy(
  itemFolderPath: string,
  selectedFolder: string | null | undefined
): boolean {
  if (!selectedFolder || selectedFolder === 'ALL' || selectedFolder === '/') {
    return true;
  }
  const normalizedItem = normalizeFolderPath(itemFolderPath);
  const normalizedSelected = normalizeFolderPath(selectedFolder);
  return (
    normalizedItem === normalizedSelected ||
    normalizedItem.startsWith(`${normalizedSelected}/`)
  );
}

/**
 * Extracts a structured multi-level folder path from Google Drive file metadata.
 * Resolves parent folder chains when available, extracts slash-delimited prefixes in filenames,
 * or organizes by Drive MIME type hierarchy.
 */
export function extractFolderPathFromDriveMetadata(meta: {
  folderPath?: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  folderMap?: Record<string, DriveFolderLookupEntry>;
}): string {
  // 1. If a real parent folder chain can be resolved from Google Drive folder metadata, use it
  if (meta.parents && meta.parents.length > 0 && meta.folderMap) {
    const chain: string[] = [];
    let currentId: string | undefined = meta.parents[0];
    const visited = new Set<string>();
    while (currentId && meta.folderMap[currentId] && !visited.has(currentId)) {
      visited.add(currentId);
      const entry: DriveFolderLookupEntry = meta.folderMap[currentId];
      if (entry.name && entry.name.toLowerCase() !== 'my drive') {
        chain.unshift(entry.name.replace(/\//g, '-').trim());
      }
      currentId = entry.parentId;
    }
    if (chain.length > 0) {
      return normalizeFolderPath(`/Google Drive/${chain.join('/')}`);
    }
  }

  // 2. If an explicit non-default hierarchical folderPath is already present, preserve it
  if (
    meta.folderPath &&
    meta.folderPath.trim() !== '' &&
    meta.folderPath.trim() !== '/Google Drive'
  ) {
    return normalizeFolderPath(meta.folderPath);
  }

  // 3. If the file name embeds relative directory segments (e.g. "infra/k8s/deployment.yaml")
  const rawName = (meta.name || '').trim().replace(/\\/g, '/');
  if (rawName.includes('/')) {
    const parts = rawName
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      const dirSegments = parts.slice(0, -1).join('/');
      return normalizeFolderPath(`/Google Drive/${dirSegments}`);
    }
  }

  // 4. Derive a multi-level folder path from Google Drive MIME metadata & file type
  const lowerMime = (meta.mimeType || '').toLowerCase();
  const lowerName = rawName.toLowerCase();

  if (
    lowerMime.includes('json') ||
    lowerName.endsWith('.json')
  ) {
    return '/Google Drive/Engineering/JSON Configs';
  }
  if (
    lowerMime.includes('yaml') ||
    lowerMime.includes('yml') ||
    lowerName.endsWith('.yaml') ||
    lowerName.endsWith('.yml')
  ) {
    return '/Google Drive/Engineering/Pipelines';
  }
  if (
    lowerMime.includes('javascript') ||
    lowerMime.includes('typescript') ||
    lowerMime.includes('sql') ||
    /\.(ts|tsx|js|jsx|py|sql|sh|go|rs)$/i.test(lowerName)
  ) {
    return '/Google Drive/Engineering/Source Code';
  }
  if (
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('csv') ||
    /\.(csv|tsv|xlsx|xls)$/i.test(lowerName)
  ) {
    return '/Google Drive/Analytics/Spreadsheets';
  }
  if (lowerMime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(lowerName)) {
    return '/Google Drive/Media Assets/Images';
  }
  if (lowerMime.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(lowerName)) {
    return '/Google Drive/Media Assets/Videos';
  }
  if (lowerMime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(lowerName)) {
    return '/Google Drive/Media Assets/Audio';
  }
  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return '/Google Drive/Documents/PDF Reports';
  }
  if (lowerMime.includes('document') || lowerName.endsWith('.md') || lowerName.endsWith('.txt')) {
    return '/Google Drive/Documents/Specs & Notes';
  }

  return '/Google Drive/Workspace';
}

interface InternalMutableNode {
  id: string;
  name: string;
  fullPath: string;
  depth: number;
  files: DriveItem[];
  childrenMap: Map<string, InternalMutableNode>;
}

/**
 * Dynamically builds a sorted hierarchical folder tree from a flat list of DriveItems.
 * Automatically creates intermediate parent directory nodes and aggregates recursive file counts and bytes.
 */
export function buildFolderTree(items: DriveItem[]): FolderTreeNode[] {
  const rootMap = new Map<string, InternalMutableNode>();

  for (const item of items) {
    const segments = splitFolderPathSegments(item.folderPath);
    if (segments.length === 0) continue;

    let currentMap = rootMap;
    let currentPath = '';
    let currentNode: InternalMutableNode | null = null;

    for (let depth = 0; depth < segments.length; depth++) {
      const seg = segments[depth];
      currentPath = `${currentPath}/${seg}`;

      let existing = currentMap.get(seg);
      if (!existing) {
        existing = {
          id: currentPath,
          name: seg,
          fullPath: currentPath,
          depth,
          files: [],
          childrenMap: new Map<string, InternalMutableNode>(),
        };
        currentMap.set(seg, existing);
      }
      currentNode = existing;
      currentMap = existing.childrenMap;
    }

    if (currentNode) {
      currentNode.files.push(item);
    }
  }

  const finalizeNode = (node: InternalMutableNode): FolderTreeNode => {
    const sortedChildren = Array.from(node.childrenMap.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(finalizeNode);

    const sortedFiles = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    const directFileCount = sortedFiles.length;
    const directBytes = sortedFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0);

    const childrenFileCount = sortedChildren.reduce((acc, c) => acc + c.totalFileCount, 0);
    const childrenBytes = sortedChildren.reduce((acc, c) => acc + c.totalBytes, 0);

    return {
      id: node.id,
      name: node.name,
      fullPath: node.fullPath,
      depth: node.depth,
      directFileCount,
      totalFileCount: directFileCount + childrenFileCount,
      totalBytes: directBytes + childrenBytes,
      files: sortedFiles,
      children: sortedChildren,
    };
  };

  return Array.from(rootMap.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(finalizeNode);
}

/**
 * Collects all folder paths present in a FolderTreeNode hierarchy (useful for Expand All).
 */
export function collectAllTreeFolderPaths(nodes: FolderTreeNode[]): string[] {
  const result: string[] = [];
  const walk = (list: FolderTreeNode[]) => {
    for (const node of list) {
      result.push(node.fullPath);
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return result;
}
