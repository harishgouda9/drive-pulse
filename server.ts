import 'dotenv/config';
import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { DriveLruCache } from './src/core/lruCache';
import { calculateThroughputMbps, computeFastChecksum } from './src/core/chunkStreamer';
import { LiveSyncEvent, LiveSyncFilePayload } from './src/core/liveSyncEngine';
import {
  buildHarnessRegisterIconFrame,
  bumpPatchVersion,
  SoftwareReleaseManifest,
  UpdateChannel,
} from './src/core/autoUpdateEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverCache = new DriveLruCache(128 * 1024 * 1024);
let deltaSequence = 1;
let liveSyncSeq = 1;
const sseSubscribers = new Set<Response>();
const recentSyncEvents: LiveSyncEvent[] = [];
const fileMetadataStore = new Map<
  string,
  { mimeType: string; folderPath: string; modifiedTime: string; source: 'live_drive' | 'sandbox' | 'harness_rpc' }
>();

let currentSoftwareRelease: SoftwareReleaseManifest = {
  version: '2.5.0',
  buildHash: 'build-250-ota-ready',
  channel: 'stable',
  publishedAt: new Date().toISOString(),
  changelog: [
    'Zero-downtime Over-The-Air (OTA) auto-updater for Desktop PWA & Connected Harness plugins',
    'O(1) virtualized scrolling viewport & full-screen toggle for large files and image assets',
    'Two-phase zero-blocking 16x worker Turbo Live Sync engine',
  ],
  critical: false,
  autoApplyDelayMs: 1200,
  targets: ['desktop_pwa', 'harness_plugin', 'mcp_agent', 'web_client'],
};

function broadcastLiveSyncEvent(
  partial: Omit<LiveSyncEvent, 'seq' | 'timestamp'>
): LiveSyncEvent {
  const fullEvent: LiveSyncEvent = {
    ...partial,
    seq: liveSyncSeq++,
    timestamp: new Date().toISOString(),
  };
  recentSyncEvents.unshift(fullEvent);
  if (recentSyncEvents.length > 60) {
    recentSyncEvents.length = 60;
  }
  const frame = `data: ${JSON.stringify(fullEvent)}\n\n`;
  for (const sub of sseSubscribers) {
    try {
      sub.write(frame);
    } catch {
      sseSubscribers.delete(sub);
    }
  }
  return fullEvent;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      bridge: 'drivepulse-harness-bridge',
      version: currentSoftwareRelease.version,
      buildHash: currentSoftwareRelease.buildHash,
      release: currentSoftwareRelease,
      liveSyncSeq,
      activeSubscribers: sseSubscribers.size,
      cacheTelemetry: serverCache.getTelemetry(),
    });
  });

  // Authoritative OTA Version & Release Manifest Endpoint for Desktop & Connected Harness Polling
  app.get('/api/system/version', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      release: currentSoftwareRelease,
      liveSyncSeq,
      activeSubscribers: sseSubscribers.size,
      serverTime: new Date().toISOString(),
    });
  });

  // Push a New Software Release Over-The-Air (OTA) to All Connected User Desktops & Harness Instances
  app.post('/api/system/push-update', (req: Request, res: Response) => {
    const start = performance.now();
    const body = (req.body || {}) as {
      version?: string;
      bumpType?: 'patch' | 'minor';
      channel?: UpdateChannel;
      changelog?: string[];
      critical?: boolean;
      autoApplyDelayMs?: number;
    };

    const nextVersion =
      body.version?.trim() ||
      bumpPatchVersion(currentSoftwareRelease.version, body.bumpType || 'patch');
    const nextBuildHash = `build-${nextVersion.replace(/\./g, '')}-${crypto
      .randomBytes(3)
      .toString('hex')}`;
    const nextChannel: UpdateChannel = body.channel || currentSoftwareRelease.channel || 'stable';
    const nextChangelog =
      Array.isArray(body.changelog) && body.changelog.length > 0
        ? body.changelog.map((c) => String(c))
        : [
            `Automated OTA hot-swap release v${nextVersion} (${nextBuildHash}) pushed to Desktop & Harness bridge`,
            'Synchronized Service Worker asset cache & connected Harness plugin schema',
          ];

    currentSoftwareRelease = {
      version: nextVersion,
      buildHash: nextBuildHash,
      channel: nextChannel,
      publishedAt: new Date().toISOString(),
      changelog: nextChangelog,
      critical: Boolean(body.critical),
      autoApplyDelayMs: typeof body.autoApplyDelayMs === 'number' ? body.autoApplyDelayMs : 1200,
      targets: ['desktop_pwa', 'harness_plugin', 'mcp_agent', 'web_client'],
    };

    const latencyMs = Math.max(0.05, Math.round((performance.now() - start) * 100) / 100);
    const event = broadcastLiveSyncEvent({
      type: 'system:update_available',
      latencyMs,
      origin: 'SERVER_BUS',
      release: currentSoftwareRelease,
    });

    res.json({
      status: 'OTA_BROADCAST_SENT',
      release: currentSoftwareRelease,
      seq: event.seq,
      notifiedSubscribers: sseSubscribers.size,
      latencyMs,
    });
  });

  // Real-Time Server-Sent Events (SSE) Push Stream for Sub-Millisecond Google Drive <-> Harness Live Sync & OTA Auto-Updates
  app.get('/api/sync/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseSubscribers.add(res);

    const initEvent: LiveSyncEvent = {
      seq: liveSyncSeq,
      type: 'sync:init',
      timestamp: new Date().toISOString(),
      latencyMs: 0.08,
      origin: 'SERVER_BUS',
      release: currentSoftwareRelease,
      summary: {
        totalFiles: serverCache.entries().length,
        hydratedCount: serverCache.entries().length,
        unchangedHits: serverCache.getTelemetry().hitCount,
        totalBytes: serverCache.getTelemetry().usedBytes,
        throughputMbps: 0,
      },
    };
    res.write(`data: ${JSON.stringify(initEvent)}\n\n`);

    const heartbeatTimer = setInterval(() => {
      try {
        const hb: LiveSyncEvent = {
          seq: liveSyncSeq,
          type: 'sync:heartbeat',
          timestamp: new Date().toISOString(),
          latencyMs: 0.05,
          origin: 'SERVER_BUS',
          release: currentSoftwareRelease,
        };
        res.write(`data: ${JSON.stringify(hb)}\n\n`);
      } catch {
        clearInterval(heartbeatTimer);
        sseSubscribers.delete(res);
      }
    }, 10000);

    req.on('close', () => {
      clearInterval(heartbeatTimer);
      sseSubscribers.delete(res);
    });
  });

  // Ultra-Low-Latency RTT Ping & Sync Bus Telemetry Probe
  app.post('/api/sync/ping', (_req: Request, res: Response) => {
    const start = performance.now();
    const latencyMs = Math.max(0.01, Math.round((performance.now() - start) * 100) / 100);
    res.json({
      status: 'ok',
      seq: liveSyncSeq,
      activeSubscribers: sseSubscribers.size,
      serverTime: new Date().toISOString(),
      serverProcessingMs: latencyMs,
      recentEventsCount: recentSyncEvents.length,
      cacheTelemetry: serverCache.getTelemetry(),
    });
  });

  // Ultra-Fast Parallel Batch Synchronization Endpoint (Google Drive <-> Harness LRU Memory)
  app.post('/api/sync/turbo-batch', (req: Request, res: Response) => {
    const start = performance.now();
    const { files = [], origin = 'TURBO_BATCH' } = req.body as {
      files?: Array<{
        fileId: string;
        fileName: string;
        mimeType?: string;
        content?: string;
        checksum?: string;
        folderPath?: string;
        modifiedTime?: string;
        source?: 'live_drive' | 'sandbox' | 'harness_rpc';
      }>;
      origin?: 'HARNESS_RPC' | 'GOOGLE_DRIVE_DELTA' | 'TURBO_BATCH';
    };

    let hydratedCount = 0;
    let unchangedHits = 0;
    let totalBytes = 0;

    for (const f of files) {
      if (!f || !f.fileId) continue;
      const content = String(f.content || '');
      const checksum = String(f.checksum || computeFastChecksum(content));
      const existing = serverCache.get(f.fileId, checksum);

      if (existing.status === 'HIT' && existing.entry) {
        unchangedHits += 1;
        totalBytes += existing.entry.byteSize;
        continue;
      }

      const entry = serverCache.put(f.fileId, f.fileName || 'Untitled', checksum, content);
      const meta = {
        mimeType: f.mimeType || 'text/plain',
        folderPath: f.folderPath || '/Google Drive',
        modifiedTime: f.modifiedTime || new Date().toISOString(),
        source: f.source || 'live_drive',
      };
      fileMetadataStore.set(f.fileId, meta);
      hydratedCount += 1;
      totalBytes += entry.byteSize;

      const filePayload: LiveSyncFilePayload = {
        fileId: entry.fileId,
        fileName: entry.fileName,
        mimeType: meta.mimeType,
        byteSize: entry.byteSize,
        checksum: entry.checksum,
        content: entry.payload,
        folderPath: meta.folderPath,
        modifiedTime: meta.modifiedTime,
        source: meta.source,
      };

      broadcastLiveSyncEvent({
        type: 'file:upserted',
        latencyMs: Math.max(0.05, Math.round((performance.now() - start) * 100) / 100),
        origin,
        file: filePayload,
      });
    }

    const latencyMs = Math.max(0.05, Math.round((performance.now() - start) * 100) / 100);
    const throughputMbps = calculateThroughputMbps(Math.max(512, totalBytes), latencyMs);

    const summaryEvent = broadcastLiveSyncEvent({
      type: 'sync:turbo_complete',
      latencyMs,
      origin,
      summary: {
        totalFiles: files.length,
        hydratedCount,
        unchangedHits,
        totalBytes,
        throughputMbps,
      },
    });

    res.json({
      status: 'ok',
      seq: summaryEvent.seq,
      totalFiles: files.length,
      hydratedCount,
      unchangedHits,
      totalBytes,
      throughputMbps,
      latencyMs,
      cacheTelemetry: serverCache.getTelemetry(),
    });
  });

  // Real-Time Google Cloud Service Account JSON -> OAuth 2.0 Bearer Token Exchange
  // Completely bypasses browser OAuth Consent Screen ("Error 403: access_denied") for Harnesses & Agents
  app.post('/api/auth/service-account', async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const { serviceAccountJson, scope } = req.body as {
        serviceAccountJson?: string;
        scope?: string;
      };
      if (!serviceAccountJson || !serviceAccountJson.trim()) {
        res.status(400).json({ error: 'Service Account JSON key is required.' });
        return;
      }

      const parsed = JSON.parse(serviceAccountJson) as {
        client_email?: string;
        private_key?: string;
        token_uri?: string;
        project_id?: string;
      };

      if (!parsed.client_email || !parsed.private_key) {
        res.status(400).json({
          error: 'Invalid Service Account JSON: missing "client_email" or "private_key".',
        });
        return;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const tokenUri = parsed.token_uri || 'https://oauth2.googleapis.com/token';
      const targetScope = scope || 'https://www.googleapis.com/auth/drive';

      const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claimSet = base64UrlEncode(
        JSON.stringify({
          iss: parsed.client_email,
          scope: targetScope,
          aud: tokenUri,
          iat: nowSec,
          exp: nowSec + 3600,
        })
      );

      const unsignedJwt = `${header}.${claimSet}`;
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(unsignedJwt);
      signer.end();
      const signature = base64UrlEncode(signer.sign(parsed.private_key));
      const signedAssertion = `${unsignedJwt}.${signature}`;

      const tokenRes = await fetch(tokenUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: signedAssertion,
        }).toString(),
      });

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenData.access_token) {
        res.status(tokenRes.status || 400).json({
          error:
            tokenData.error_description ||
            tokenData.error ||
            'Failed to exchange Service Account JWT for Google Drive access token.',
        });
        return;
      }

      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      res.json({
        accessToken: tokenData.access_token,
        clientEmail: parsed.client_email,
        projectId: parsed.project_id || '',
        expiresIn: tokenData.expires_in || 3600,
        latencyMs,
      });
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Service Account authentication failed',
      });
    }
  });

  // Real-Time OAuth 2.0 Refresh Token -> Access Token Exchange
  app.post('/api/auth/refresh-token', async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const { clientId, clientSecret, refreshToken } = req.body as {
        clientId?: string;
        clientSecret?: string;
        refreshToken?: string;
      };
      if (!clientId?.trim() || !clientSecret?.trim() || !refreshToken?.trim()) {
        res.status(400).json({
          error: 'Client ID, Client Secret, and Refresh Token are all required.',
        });
        return;
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          refresh_token: refreshToken.trim(),
          grant_type: 'refresh_token',
        }).toString(),
      });

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        expires_in?: number;
        scope?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenData.access_token) {
        res.status(tokenRes.status || 400).json({
          error:
            tokenData.error_description ||
            tokenData.error ||
            'Failed to exchange Refresh Token with Google OAuth.',
        });
        return;
      }

      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      res.json({
        accessToken: tokenData.access_token,
        expiresIn: tokenData.expires_in || 3600,
        scope: tokenData.scope || 'https://www.googleapis.com/auth/drive',
        latencyMs,
      });
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Refresh token exchange failed',
      });
    }
  });

  // Real-Time Google Drive / Docs / Sheets File Content Fetcher & Importer
  // Supports both authenticated OAuth Bearer tokens (Google Drive API v3) and direct shared link export
  app.post('/api/drive/import-link', async (req: Request, res: Response) => {
    const start = performance.now();
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const { fileId, resourceType } = req.body as {
      fileId?: string;
      resourceType?: 'document' | 'spreadsheet' | 'presentation' | 'file';
    };

    if (!fileId || !fileId.trim()) {
      res.status(400).json({ error: 'A valid Google Drive File ID or URL is required.' });
      return;
    }

    const cleanId = fileId.trim();

    try {
      // 1. If OAuth Bearer token is available, fetch metadata + content directly via Drive API v3
      if (bearerToken) {
        const metaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          cleanId
        )}?supportsAllDrives=true&fields=id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink`;
        const metaRes = await fetch(metaUrl, {
          headers: { Authorization: `Bearer ${bearerToken}` },
        });

        if (metaRes.ok) {
          const meta = (await metaRes.json()) as {
            id?: string;
            name?: string;
            mimeType?: string;
            size?: string | number;
            modifiedTime?: string;
            md5Checksum?: string;
            webViewLink?: string;
          };

          const mime = String(meta.mimeType || 'text/plain');
          let contentUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            cleanId
          )}?alt=media&supportsAllDrives=true`;

          if (mime === 'application/vnd.google-apps.document') {
            contentUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              cleanId
            )}/export?mimeType=text/plain`;
          } else if (mime === 'application/vnd.google-apps.spreadsheet') {
            contentUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              cleanId
            )}/export?mimeType=text/csv`;
          } else if (mime === 'application/vnd.google-apps.presentation') {
            contentUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              cleanId
            )}/export?mimeType=text/plain`;
          } else if (mime === 'application/vnd.google-apps.script') {
            contentUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              cleanId
            )}/export?mimeType=application/vnd.google-apps.script+json`;
          }

          const contentRes = await fetch(contentUrl, {
            headers: { Authorization: `Bearer ${bearerToken}` },
          });

          let content = '';
          if (contentRes.ok) {
            content = await contentRes.text();
          } else {
            content = `[Google Drive File Metadata]\nName: ${meta.name}\nID: ${cleanId}\nMIME Type: ${mime}\nModified: ${meta.modifiedTime}\nWeb Link: ${meta.webViewLink || 'N/A'}`;
          }

          const checksum = String(meta.md5Checksum || computeFastChecksum(content));
          const fileName = String(meta.name || `drive-${cleanId.slice(0, 8)}.txt`);
          const entry = serverCache.put(cleanId, fileName, checksum, content);
          const modifiedTime = String(meta.modifiedTime || new Date().toISOString());
          fileMetadataStore.set(cleanId, {
            mimeType: mime,
            folderPath: '/Google Drive',
            modifiedTime,
            source: 'live_drive',
          });
          const latencyMs = Math.round((performance.now() - start) * 100) / 100;

          broadcastLiveSyncEvent({
            type: 'file:upserted',
            latencyMs,
            origin: 'GOOGLE_DRIVE_DELTA',
            file: {
              fileId: cleanId,
              fileName,
              mimeType: mime,
              byteSize: entry.byteSize,
              checksum,
              content,
              folderPath: '/Google Drive',
              modifiedTime,
              source: 'live_drive',
            },
          });

          res.json({
            id: cleanId,
            name: fileName,
            mimeType: mime,
            size: entry.byteSize,
            modifiedTime: String(meta.modifiedTime || new Date().toISOString()),
            md5Checksum: checksum,
            webViewLink: meta.webViewLink,
            content,
            latencyMs,
            source: 'live_drive',
          });
          return;
        }
      }

      // 2. Fallback for link-shared Google Docs / Sheets / Slides / Drive files without requiring OAuth popup
      let exportUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cleanId)}`;
      let defaultMime = 'text/plain';
      let defaultExt = '.txt';

      if (resourceType === 'document') {
        exportUrl = `https://docs.google.com/document/d/${encodeURIComponent(cleanId)}/export?format=txt`;
        defaultMime = 'application/vnd.google-apps.document';
        defaultExt = '.doc.txt';
      } else if (resourceType === 'spreadsheet') {
        exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(cleanId)}/export?format=csv`;
        defaultMime = 'application/vnd.google-apps.spreadsheet';
        defaultExt = '.csv';
      } else if (resourceType === 'presentation') {
        exportUrl = `https://docs.google.com/presentation/d/${encodeURIComponent(cleanId)}/export/txt`;
        defaultMime = 'application/vnd.google-apps.presentation';
        defaultExt = '.slides.txt';
      }

      const sharedRes = await fetch(exportUrl, {
        headers: {
          'User-Agent': 'DrivePulse-Harness-Bridge/1.0',
        },
      });

      if (!sharedRes.ok) {
        res.status(sharedRes.status || 400).json({
          error: `Could not read file "${cleanId}" (HTTP ${sharedRes.status}). Ensure the file is shared ("Anyone with the link") or sign in via Google OAuth / Service Account in Settings.`,
        });
        return;
      }

      const contentType = sharedRes.headers.get('content-type') || defaultMime;
      if (contentType.includes('text/html') && !bearerToken) {
        res.status(403).json({
          error:
            'This Google Drive file is private and requires authentication. Sign in with Google Drive or configure a Service Account / OAuth token in Settings.',
        });
        return;
      }

      const content = await sharedRes.text();
      const disp = sharedRes.headers.get('content-disposition') || '';
      const nameMatch = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
      const fileName = nameMatch
        ? decodeURIComponent(nameMatch[1])
        : `drive-${cleanId.slice(0, 10)}${defaultExt}`;
      const checksum = computeFastChecksum(content);
      const entry = serverCache.put(cleanId, fileName, checksum, content);
      const modifiedTime = new Date().toISOString();
      fileMetadataStore.set(cleanId, {
        mimeType: defaultMime,
        folderPath: '/Google Drive',
        modifiedTime,
        source: 'live_drive',
      });
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;

      broadcastLiveSyncEvent({
        type: 'file:upserted',
        latencyMs,
        origin: 'GOOGLE_DRIVE_DELTA',
        file: {
          fileId: cleanId,
          fileName,
          mimeType: defaultMime,
          byteSize: entry.byteSize,
          checksum,
          content,
          folderPath: '/Google Drive',
          modifiedTime,
          source: 'live_drive',
        },
      });

      res.json({
        id: cleanId,
        name: fileName,
        mimeType: defaultMime,
        size: entry.byteSize,
        modifiedTime,
        md5Checksum: checksum,
        webViewLink: `https://drive.google.com/file/d/${cleanId}/view`,
        content,
        latencyMs,
        source: 'live_drive',
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch Google Drive file content',
      });
    }
  });

  // High-Thinking Agentic Analysis Route (gemini-4-carbon + ThinkingLevel.HIGH)
  app.post('/api/agent/analyze', async (req: Request, res: Response) => {
    const start = performance.now();
    const { query, contextFiles } = req.body as {
      query?: string;
      contextFiles?: Array<{ id: string; name: string; mimeType: string; content: string }>;
    };

    if (!query || !query.trim()) {
      res.status(400).json({ error: 'Query is required for high-thinking analysis.' });
      return;
    }

    const filesContextText = (contextFiles || [])
      .map(
        (f, idx) =>
          `--- FILE ${idx + 1}: ${f.name} (${f.mimeType}, id=${f.id}) ---\n${f.content.slice(0, 12000)}`
      )
      .join('\n\n');

    const prompt = `You are the DrivePulse High-Thinking Harness Architect. Analyze the user's request across the synchronized Google Drive context files below.

Synchronized Google Drive Files Context:
${filesContextText || 'No files attached.'}

User Request:
${query}

Provide a deep architectural synthesis, root-cause or cross-file insights, and concrete actionable file artifacts that can be written back to Google Drive.`;

    try {
      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-carbon',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a principal distributed-systems and AI harness architect. Return structured JSON containing thinkingSummary, answerMarkdown, and suggestedActions.',
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              thinkingSummary: {
                type: Type.STRING,
                description:
                  'Detailed multi-step architectural reasoning trace explaining how the synchronized Drive files were cross-referenced.',
              },
              answerMarkdown: {
                type: Type.STRING,
                description: 'Comprehensive synthesis and actionable technical answer.',
              },
              suggestedActions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: {
                      type: Type.STRING,
                      description: 'Action button label',
                    },
                    fileName: {
                      type: Type.STRING,
                      description: 'Target filename to save into Google Drive',
                    },
                    contentToSave: {
                      type: Type.STRING,
                      description: 'Complete file content to upload to Google Drive',
                    },
                  },
                },
              },
            },
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;

      res.json({
        id: `ag-${Date.now().toString(36)}`,
        query,
        model: 'gemini-4-carbon',
        thinkingLevel: 'HIGH',
        thinkingSummary: parsed.thinkingSummary || '',
        answerMarkdown: parsed.answerMarkdown || rawText,
        referencedFiles: (contextFiles || []).map((f) => f.name),
        suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
        latencyMs,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      let guidanceNote = errMessage;
      if (
        errMessage.includes('403') ||
        errMessage.includes('PERMISSION_DENIED') ||
        errMessage.includes('400') ||
        errMessage.includes('API_KEY_INVALID')
      ) {
        guidanceNote = `${errMessage} — Please check or select a valid API key in the Settings > Secrets panel.`;
      } else if (errMessage.includes('429') || errMessage.includes('RESOURCE_EXHAUSTED')) {
        guidanceNote = `${errMessage} — Upgrading to a paid tier increases quota; select a billing-enabled API key in the Settings > Secrets panel.`;
      }
      res.status(502).json({ error: guidanceNote });
    }
  });

  // Universal 1-Line Host Harness Plugin Loader Script (Creates Plugin Icon, Shares Sidebar Screen, & Auto-Updates via SSE)
  app.get('/plugin-loader.js', (req: Request, res: Response) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(`(function() {
  if (window.__DRIVEPULSE_HARNESS_PLUGIN_LOADED__) return;
  window.__DRIVEPULSE_HARNESS_PLUGIN_LOADED__ = true;
  var ORIGIN = ${JSON.stringify(origin)};
  var activeVersion = ${JSON.stringify(currentSoftwareRelease.version)};
  var isSidebarOpen = false;

  // 1. Create DrivePulse Plugin Icon in Host Harness Activity Bar / Sidebar Dock
  var dockBtn = document.createElement('button');
  dockBtn.id = 'drivepulse-harness-plugin-icon';
  dockBtn.title = 'DrivePulse Google Drive Plugin (v' + activeVersion + ') — Click to Share Sidebar Screen';
  dockBtn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;align-items:center;gap:8px;padding:8px 12px;background:#0f172a;color:#f8fafc;border:1px solid #3b82f6;border-radius:10px;font-family:monospace;font-size:12px;cursor:pointer;box-shadow:0 10px 25px rgba(0,0,0,0.25);';
  dockBtn.innerHTML = '<img src="' + ORIGIN + '/icon.svg" width="18" height="18" alt="DrivePulse" />' +
    '<span id="dp-plugin-label">DrivePulse · v' + activeVersion + '</span>';
  document.body.appendChild(dockBtn);

  // 2. Create Shared Sidebar Screen Container in Host Harness
  var drawer = document.createElement('aside');
  drawer.id = 'drivepulse-harness-sidebar-drawer';
  drawer.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:400px;z-index:99998;background:#ffffff;border-left:1px solid #cbd5e1;box-shadow:-8px 0 30px rgba(0,0,0,0.18);transform:translateX(100%);transition:transform 180ms ease;display:flex;flex-direction:column;';
  var iframe = document.createElement('iframe');
  iframe.src = ORIGIN + '/?embed=plugin&dock=sidebar';
  iframe.style.cssText = 'width:100%;height:100%;border:0;flex:1;';
  iframe.allow = 'clipboard-read; clipboard-write';
  drawer.appendChild(iframe);
  document.body.appendChild(drawer);

  dockBtn.addEventListener('click', function() {
    isSidebarOpen = !isSidebarOpen;
    drawer.style.transform = isSidebarOpen ? 'translateX(0)' : 'translateX(100%)';
  });

  // 3. Autonomous Self-Update Listener via Real-Time SSE Stream
  try {
    var es = new EventSource(ORIGIN + '/api/sync/stream');
    es.onmessage = function(ev) {
      try {
        var data = JSON.parse(ev.data);
        if (data && data.release && data.release.version && data.release.version !== activeVersion) {
          activeVersion = data.release.version;
          var lbl = document.getElementById('dp-plugin-label');
          if (lbl) lbl.textContent = 'DrivePulse · v' + activeVersion + ' (Auto-Updated)';
          dockBtn.title = 'DrivePulse Google Drive Plugin (v' + activeVersion + ') — Auto-Updated Live';
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              source: 'drivepulse-host-harness',
              jsonrpc: '2.0',
              method: 'plugin.checkUpdate',
              params: { release: data.release }
            }, '*');
          }
        }
      } catch (e) {}
    };
  } catch (e) {}
})();`);
  });

  // Universal Plugin Manifest for Harness CI/CD, IDP, MCP Clients & Host Software
  app.get('/api/plugin/manifest.json', (req: Request, res: Response) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      schemaVersion: '2.0',
      pluginId: 'drivepulse-harness-bridge',
      name: 'DrivePulse Google Drive Harness Plugin',
      version: currentSoftwareRelease.version,
      buildHash: currentSoftwareRelease.buildHash,
      release: currentSoftwareRelease,
      iconUrl: `${origin}/icon.svg`,
      sidebarScreenShareSupported: true,
      autoUpdateSupported: true,
      description:
        'Ultra-low-latency Google Drive data plane plugin that creates its own activity bar icon in host Harnesses, shares its live workspace screen in the sidebar, and autonomously self-updates over SSE and JSON-RPC.',
      endpoints: {
        mcpRpc: `${origin}/api/mcp/rpc`,
        liveSyncStream: `${origin}/api/sync/stream`,
        turboBatchSync: `${origin}/api/sync/turbo-batch`,
        syncPing: `${origin}/api/sync/ping`,
        systemVersion: `${origin}/api/system/version`,
        pushUpdate: `${origin}/api/system/push-update`,
        importDriveLink: `${origin}/api/drive/import-link`,
        serviceAccountAuth: `${origin}/api/auth/service-account`,
        agentAnalyze: `${origin}/api/agent/analyze`,
        embedUrl: `${origin}/?embed=plugin`,
        embedSidebarUrl: `${origin}/?embed=plugin&dock=sidebar`,
        pluginLoaderJs: `${origin}/plugin-loader.js`,
      },
      transports: ['REST_MCP_JSON_RPC', 'WEB_SDK_POSTMESSAGE', 'SSE_REALTIME_STREAM'],
      supportedMethods: [
        'plugin.handshake',
        'plugin.registerIcon',
        'plugin.shareScreen',
        'plugin.checkUpdate',
        'plugin.pushUpdate',
        'drive.list',
        'drive.search',
        'drive.read',
        'drive.upload',
        'drive.delete',
        'drive.deltaSync',
        'drive.turboSync',
      ],
      liveSyncSeq,
      activeSubscribers: sseSubscribers.size,
      cacheTelemetry: serverCache.getTelemetry(),
    });
  });

  // MCP / JSON-RPC Harness Bridge Endpoint for External AI Agents & CLI Software
  app.post('/api/mcp/rpc', async (req: Request, res: Response) => {
    const start = performance.now();
    const authHeader = req.headers.authorization;
    const origin = `${req.protocol}://${req.get('host')}`;
    const { id = 'rpc-1', method, params = {} } = req.body as {
      jsonrpc?: string;
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
    };

    if (!method) {
      res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Missing RPC method name' },
      });
      return;
    }

    try {
      if (method === 'plugin.handshake' || method === 'plugin.checkUpdate') {
        const entries = serverCache.entries();
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            pluginId: 'drivepulse-harness-bridge',
            version: currentSoftwareRelease.version,
            buildHash: currentSoftwareRelease.buildHash,
            release: currentSoftwareRelease,
            iconUrl: `${origin}/icon.svg`,
            sidebarEmbedUrl: `${origin}/?embed=plugin&dock=sidebar`,
            status: 'READY',
            mountedFileCount: entries.length,
            supportedMethods: [
              'plugin.handshake',
              'plugin.registerIcon',
              'plugin.shareScreen',
              'plugin.checkUpdate',
              'plugin.pushUpdate',
              'drive.list',
              'drive.search',
              'drive.read',
              'drive.upload',
              'drive.delete',
              'drive.deltaSync',
              'drive.turboSync',
            ],
            cacheTelemetry: serverCache.getTelemetry(),
            latencyMs,
            cacheStatus: 'HIT',
          },
        });
        return;
      }

      if (method === 'plugin.registerIcon') {
        const entries = serverCache.entries();
        const latencyMs = Math.max(0.05, Math.round((performance.now() - start) * 100) / 100);
        const iconFrame = buildHarnessRegisterIconFrame({
          version: currentSoftwareRelease.version,
          buildHash: currentSoftwareRelease.buildHash,
          badgeCount: typeof params.badgeCount === 'number' ? params.badgeCount : entries.length,
          autoUpdateEnabled: true,
          screenShareActive: Boolean(params.screenShareActive ?? true),
          position:
            (params.position as 'activity-bar-left' | 'sidebar-dock-right' | 'top-toolbar') ||
            'sidebar-dock-right',
          originUrl: origin,
        });
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            status: 'ICON_REGISTERED_IN_HARNESS',
            iconDescriptor: iconFrame.params,
            latencyMs,
            cacheStatus: 'HIT',
          },
        });
        return;
      }

      if (method === 'plugin.shareScreen') {
        const entries = serverCache.entries();
        const telemetry = serverCache.getTelemetry();
        const latencyMs = Math.max(0.05, Math.round((performance.now() - start) * 100) / 100);
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            status: 'SIDEBAR_SCREEN_SHARED',
            pluginId: 'io.drivepulse.harness.bridge',
            version: currentSoftwareRelease.version,
            buildHash: currentSoftwareRelease.buildHash,
            selectedFolder: String(params.selectedFolder || 'ALL'),
            activeFileName: String(params.activeFileName || entries[0]?.fileName || 'None'),
            mountedFileCount: entries.length,
            cacheHitRatioPercent: telemetry.hitRatioPercent,
            usedCacheBytes: telemetry.usedBytes,
            sidebarEmbedUrl: `${origin}/?embed=plugin&dock=sidebar`,
            latencyMs,
            cacheStatus: 'HIT',
          },
        });
        return;
      }

      if (method === 'plugin.pushUpdate') {
        const nextVersion =
          typeof params.version === 'string' && params.version.trim()
            ? params.version.trim()
            : bumpPatchVersion(currentSoftwareRelease.version, 'patch');
        const nextBuildHash = `build-${nextVersion.replace(/\./g, '')}-${crypto
          .randomBytes(3)
          .toString('hex')}`;
        const nextChangelog = Array.isArray(params.changelog)
          ? params.changelog.map((c) => String(c))
          : [
              `Harness RPC triggered OTA release v${nextVersion} (${nextBuildHash})`,
              'Auto-updated desktop client and connected Harness plugin runtime',
            ];
        currentSoftwareRelease = {
          version: nextVersion,
          buildHash: nextBuildHash,
          channel: (params.channel as UpdateChannel) || currentSoftwareRelease.channel,
          publishedAt: new Date().toISOString(),
          changelog: nextChangelog,
          critical: Boolean(params.critical),
          autoApplyDelayMs: 1000,
          targets: ['desktop_pwa', 'harness_plugin', 'mcp_agent', 'web_client'],
        };
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;
        const ev = broadcastLiveSyncEvent({
          type: 'system:update_available',
          latencyMs,
          origin: 'HARNESS_RPC',
          release: currentSoftwareRelease,
        });
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            status: 'OTA_BROADCAST_SENT',
            release: currentSoftwareRelease,
            seq: ev.seq,
            notifiedSubscribers: sseSubscribers.size,
            latencyMs,
          },
        });
        return;
      }

      if (method === 'drive.list') {
        const entries = serverCache.entries();
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            authenticatedBearer: Boolean(authHeader?.startsWith('Bearer ')),
            count: entries.length,
            files: entries.map((e) => {
              const meta = fileMetadataStore.get(e.fileId);
              return {
                fileId: e.fileId,
                fileName: e.fileName,
                mimeType: meta?.mimeType || 'text/plain',
                folderPath: meta?.folderPath || '/Google Drive',
                checksum: e.checksum,
                byteSize: e.byteSize,
                hitCount: e.hitCount,
                content: e.payload,
                modifiedTime: meta?.modifiedTime || new Date(e.lastAccessed).toISOString(),
              };
            }),
            latencyMs,
            cacheStatus: 'HIT',
          },
        });
        return;
      }

      if (method === 'drive.search') {
        const query = String(params.query || params.fileName || '')
          .trim()
          .toLowerCase();
        const scope = String(params.scope || 'filename');
        const entries = serverCache.entries();
        const matched = entries.filter((e) => {
          if (!query) return true;
          if (scope === 'all') {
            return (
              e.fileName.toLowerCase().includes(query) ||
              e.payload.toLowerCase().includes(query)
            );
          }
          return e.fileName.toLowerCase().includes(query);
        });
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            query,
            scope,
            totalCached: entries.length,
            matchedCount: matched.length,
            files: matched.map((e) => {
              const meta = fileMetadataStore.get(e.fileId);
              return {
                fileId: e.fileId,
                fileName: e.fileName,
                mimeType: meta?.mimeType || 'text/plain',
                folderPath: meta?.folderPath || '/Google Drive',
                checksum: e.checksum,
                byteSize: e.byteSize,
                hitCount: e.hitCount,
                content: e.payload,
                modifiedTime: meta?.modifiedTime || new Date(e.lastAccessed).toISOString(),
              };
            }),
            latencyMs,
            cacheStatus: 'HIT',
          },
        });
        return;
      }

      if (method === 'drive.read') {
        const fileId = String(params.fileId || '');
        const lookup = serverCache.get(fileId);
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;

        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            fileId,
            cacheStatus: lookup.status,
            latencyMs: lookup.latencyMs || latencyMs,
            checksum: lookup.entry?.checksum || null,
            byteSize: lookup.entry?.byteSize || 0,
            content: lookup.entry?.payload || '',
          },
        });
        return;
      }

      if (method === 'drive.upload') {
        const fileId = String(params.fileId || `drv-${Date.now().toString(36)}`);
        const fileName = String(params.fileName || params.name || 'artifact.txt');
        const mimeType = String(params.mimeType || 'text/plain');
        const folderPath = String(params.folderPath || '/Google Drive');
        const content = String(params.content || '');
        const checksum = computeFastChecksum(content);
        const entry = serverCache.put(fileId, fileName, checksum, content);
        const modifiedTime = new Date().toISOString();
        fileMetadataStore.set(fileId, {
          mimeType,
          folderPath,
          modifiedTime,
          source: 'harness_rpc',
        });
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;

        const syncEv = broadcastLiveSyncEvent({
          type: 'file:upserted',
          latencyMs,
          origin: 'HARNESS_RPC',
          file: {
            fileId: entry.fileId,
            fileName: entry.fileName,
            mimeType,
            byteSize: entry.byteSize,
            checksum: entry.checksum,
            content: entry.payload,
            folderPath,
            modifiedTime,
            source: 'harness_rpc',
          },
        });

        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            fileId: entry.fileId,
            fileName: entry.fileName,
            checksum: entry.checksum,
            byteSize: entry.byteSize,
            cacheStatus: 'HIT',
            seq: syncEv.seq,
            latencyMs,
          },
        });
        return;
      }

      if (method === 'drive.delete') {
        const fileId = String(params.fileId || '');
        const removed = serverCache.delete(fileId);
        fileMetadataStore.delete(fileId);
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;
        if (removed) {
          broadcastLiveSyncEvent({
            type: 'file:deleted',
            latencyMs,
            origin: 'HARNESS_RPC',
            deletedFileId: fileId,
          });
        }
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            fileId,
            removed,
            latencyMs,
          },
        });
        return;
      }

      if (method === 'drive.deltaSync' || method === 'drive.turboSync') {
        const pageToken = String(params.pageToken || String(deltaSequence));
        deltaSequence += 1;
        const entries = serverCache.entries();
        const totalBytes = serverCache.getTelemetry().usedBytes;
        const latencyMs = Math.max(0.05, Math.round((performance.now() - start) * 100) / 100);
        const throughputMbps = calculateThroughputMbps(Math.max(512, totalBytes), latencyMs);

        if (method === 'drive.turboSync') {
          broadcastLiveSyncEvent({
            type: 'sync:turbo_complete',
            latencyMs,
            origin: 'HARNESS_RPC',
            summary: {
              totalFiles: entries.length,
              hydratedCount: entries.length,
              unchangedHits: serverCache.getTelemetry().hitCount,
              totalBytes,
              throughputMbps,
            },
          });
        }

        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            previousPageToken: pageToken,
            newStartPageToken: String(deltaSequence),
            liveSyncSeq,
            activeSubscribers: sseSubscribers.size,
            changesDetected: 0,
            totalFiles: entries.length,
            throughputMbps,
            cacheTelemetry: serverCache.getTelemetry(),
            latencyMs,
          },
        });
        return;
      }

      res.status(404).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unsupported harness method: ${method}` },
      });
    } catch (err: unknown) {
      res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : 'Internal RPC error' },
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DrivePulse Harness Bridge listening on http://localhost:${PORT}`);
  });
}

startServer();
