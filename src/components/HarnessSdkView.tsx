import React, { useEffect, useState } from 'react';
import { Terminal, Play, Copy, Check, ExternalLink, Layers } from 'lucide-react';
import { DriveItem, HarnessRpcLog } from '../types/drive';

export type PluginRpcMethod =
  | 'plugin.handshake'
  | 'drive.list'
  | 'drive.search'
  | 'drive.read'
  | 'drive.upload'
  | 'drive.deltaSync';

interface HarnessSdkViewProps {
  items: DriveItem[];
  selectedFileId?: string;
  isPluginEmbedMode?: boolean;
  onTogglePluginEmbedMode?: () => void;
  rpcLogs: HarnessRpcLog[];
  onDispatchRpc: (
    transport: 'POSTMESSAGE_SDK' | 'REST_MCP',
    method: PluginRpcMethod,
    params: Record<string, unknown>
  ) => Promise<void>;
}

export const HarnessSdkView: React.FC<HarnessSdkViewProps> = ({
  items,
  selectedFileId,
  isPluginEmbedMode = false,
  onTogglePluginEmbedMode,
  rpcLogs,
  onDispatchRpc,
}) => {
  const [transport, setTransport] = useState<'POSTMESSAGE_SDK' | 'REST_MCP'>('REST_MCP');
  const [method, setMethod] = useState<PluginRpcMethod>(
    selectedFileId ? 'drive.read' : 'drive.search'
  );
  const [targetFileId, setTargetFileId] = useState<string>(selectedFileId || items[0]?.id || '');
  const [searchQueryParam, setSearchQueryParam] = useState<string>('');
  const [integrationTab, setIntegrationTab] = useState<'HARNESS_PIPELINE' | 'WEB_SDK_IFRAME' | 'MCP_AGENT'>('HARNESS_PIPELINE');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFileId) {
      setTargetFileId(selectedFileId);
      setMethod('drive.read');
    }
  }, [selectedFileId]);

  const effectiveFileId = targetFileId || items[0]?.id || '';
  const activeLog = selectedLogId
    ? rpcLogs.find((l) => l.id === selectedLogId) || rpcLogs[0]
    : rpcLogs[0];

  const handleInvoke = async () => {
    const params: Record<string, unknown> =
      method === 'drive.read'
        ? { fileId: effectiveFileId, preferCache: true }
        : method === 'drive.search'
        ? { query: searchQueryParam.trim(), scope: 'filename' }
        : method === 'drive.upload'
        ? {
            fileName: `rpc-upload-${Date.now().toString(36)}.json`,
            content: JSON.stringify({ timestamp: new Date().toISOString() }, null, 2),
          }
        : method === 'drive.deltaSync'
        ? { pageToken: '1' }
        : {};

    setSelectedLogId(null);
    await onDispatchRpc(transport, method, params);
  };

  const sampleParams =
    method === 'drive.read'
      ? { fileId: effectiveFileId, preferCache: true }
      : method === 'drive.search'
      ? { query: searchQueryParam.trim() || 'spec', scope: 'filename' }
      : method === 'drive.deltaSync'
      ? { pageToken: '1' }
      : {};

  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const integrationBlueprint =
    integrationTab === 'HARNESS_PIPELINE'
      ? `# Harness CI/CD & IDP Pipeline Step Plugin Configuration
- step:
    type: Http
    name: DrivePulse_Google_Drive_Bridge
    identifier: drivepulse_plugin_step
    spec:
      url: ${originUrl}/api/mcp/rpc
      method: POST
      headers:
        - key: Content-Type
          value: application/json
        - key: Authorization
          value: Bearer <+secrets.getValue("google_drive_oauth_token")>
      inputVariables:
        jsonrpc: "2.0"
        id: "harness-step-01"
        method: "${method}"
        params: '${JSON.stringify(sampleParams)}'
      outputVariables:
        - name: DRIVE_FILE_CONTENT
          value: <+json.select("result", httpResponseBody)>`
      : integrationTab === 'WEB_SDK_IFRAME'
      ? `<!-- 1. Embed DrivePulse Plugin inside any Host Software / Harness Dashboard -->
<iframe
  id="drivepulse-plugin-frame"
  src="${originUrl}/?embed=plugin"
  style="width: 100%; height: 640px; border: 1px solid #e2e8f0; border-radius: 12px;"
  allow="clipboard-read; clipboard-write"
></iframe>

<script>
  // 2. Listen for 1-Click "Emit to Host Plugin" file events or RPC responses
  window.addEventListener('message', (event) => {
    if (event.data?.source === 'drivepulse-plugin-bridge') {
      console.log('Received Google Drive file from DrivePulse Plugin:', event.data);
    }
  });

  // 3. Programmatically invoke ${method} from Host Software
  const frame = document.getElementById('drivepulse-plugin-frame');
  frame.contentWindow.postMessage({
    source: 'drivepulse-host-harness',
    jsonrpc: '2.0',
    id: 'req-01',
    method: '${method}',
    params: ${JSON.stringify(sampleParams)}
  }, '${originUrl}');
</script>`
      : `// Model Context Protocol (MCP) & AI Agent Harness Plugin Configuration
{
  "mcpServers": {
    "drivepulse-google-drive": {
      "url": "${originUrl}/api/mcp/rpc",
      "manifestUrl": "${originUrl}/api/plugin/manifest.json",
      "transport": "http-jsonrpc",
      "capabilities": [
        "plugin.handshake",
        "drive.list",
        "drive.search",
        "drive.read",
        "drive.upload",
        "drive.deltaSync"
      ]
    }
  }
}`;

  const handleCopySnippet = () => {
    navigator.clipboard?.writeText(integrationBlueprint);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 1500);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50 dark:bg-[#0B0F19]">
      {/* Header & Interactive RPC Dispatcher */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold font-display text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Harness & External Software Plugin SDK + MCP Bridge</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Embed DrivePulse directly as a plugin inside Harness CI/CD, IDP portals, Cursor/Claude MCP agents, or any host software via Web SDK PostMessage and HTTP JSON-RPC.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href="/api/plugin/manifest.json"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <span>Plugin Manifest JSON</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            {onTogglePluginEmbedMode && (
              <button
                type="button"
                onClick={onTogglePluginEmbedMode}
                aria-pressed={isPluginEmbedMode}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  isPluginEmbedMode
                    ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>
                  {isPluginEmbedMode ? 'Exit Compact Plugin Mode' : 'Preview Compact Plugin Mode'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleInvoke}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Dispatch Live RPC Call</span>
            </button>
          </div>
        </div>

        {/* Controls Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div>
            <label htmlFor="sdk-transport-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Bridge Transport Protocol
            </label>
            <select
              id="sdk-transport-select"
              value={transport}
              onChange={(e) => setTransport(e.target.value as 'POSTMESSAGE_SDK' | 'REST_MCP')}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="REST_MCP">REST MCP Endpoint (POST /api/mcp/rpc)</option>
              <option value="POSTMESSAGE_SDK">Web SDK (window.postMessage)</option>
            </select>
          </div>

          <div>
            <label htmlFor="sdk-method-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Plugin RPC Method
            </label>
            <select
              id="sdk-method-select"
              value={method}
              onChange={(e) => setMethod(e.target.value as PluginRpcMethod)}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            >
              <option value="plugin.handshake">plugin.handshake (Verify Plugin Status)</option>
              <option value="drive.search">drive.search (Instant Filename Search)</option>
              <option value="drive.list">drive.list (List Mounted Metadata)</option>
              <option value="drive.read">drive.read (Sub-ms LRU Read)</option>
              <option value="drive.upload">drive.upload (Chunked Agent Write)</option>
              <option value="drive.deltaSync">drive.deltaSync (Incremental Poll)</option>
            </select>
          </div>

          <div>
            {method === 'drive.search' ? (
              <>
                <label htmlFor="sdk-search-param" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Filename Search Query Parameter
                </label>
                <input
                  id="sdk-search-param"
                  type="text"
                  value={searchQueryParam}
                  onChange={(e) => setSearchQueryParam(e.target.value)}
                  placeholder="Enter filename substring (or leave blank for all)..."
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </>
            ) : (
              <>
                <label htmlFor="sdk-target-file" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Target Drive File ID
                </label>
                <select
                  id="sdk-target-file"
                  value={effectiveFileId}
                  onChange={(e) => setTargetFileId(e.target.value)}
                  disabled={method !== 'drive.read' || items.length === 0}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 disabled:opacity-50"
                >
                  {items.length === 0 ? (
                    <option value="">No files mounted</option>
                  ) : (
                    items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.id})
                      </option>
                    ))
                  )}
                </select>
              </>
            )}
          </div>
        </div>

        {/* Universal Plugin Integration Blueprints (Harness Pipeline / Host Iframe / MCP Server) */}
        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="Plugin Integration Blueprints"
              className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg"
            >
              <button
                type="button"
                role="tab"
                aria-selected={integrationTab === 'HARNESS_PIPELINE'}
                onClick={() => setIntegrationTab('HARNESS_PIPELINE')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  integrationTab === 'HARNESS_PIPELINE'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Harness CI/CD Pipeline Step
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={integrationTab === 'WEB_SDK_IFRAME'}
                onClick={() => setIntegrationTab('WEB_SDK_IFRAME')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  integrationTab === 'WEB_SDK_IFRAME'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Host Software Iframe + PostMessage SDK
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={integrationTab === 'MCP_AGENT'}
                onClick={() => setIntegrationTab('MCP_AGENT')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  integrationTab === 'MCP_AGENT'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                MCP Server Config (Claude / Cursor / Agents)
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopySnippet}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              {copiedSnippet ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSnippet ? 'Copied Integration Config' : 'Copy Integration Config'}</span>
            </button>
          </div>
          <pre className="p-3.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto leading-relaxed">
            {integrationBlueprint}
          </pre>
        </div>
      </div>

      {/* Live RPC Event Stream & JSON-RPC Payload Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100">
              Live Harness RPC Call Ledger ({rpcLogs.length})
            </h2>
          </div>

          {rpcLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No RPC calls dispatched yet. Click "Dispatch Live RPC Call" above to execute a real-time bridge request.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50">
                  <th className="py-2.5 pl-6 pr-3">Timestamp</th>
                  <th className="py-2.5 px-3">Transport</th>
                  <th className="py-2.5 px-3">Method</th>
                  <th className="py-2.5 px-3">Cache</th>
                  <th className="py-2.5 pl-3 pr-6 text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-xs font-mono tabular-nums">
                {rpcLogs.map((log) => {
                  const isSelected = activeLog?.id === log.id;
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLogId(log.id)}
                      className={`h-10 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/80 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                      }`}
                    >
                      <td className="py-2 pl-6 pr-3 text-slate-500 dark:text-slate-400">
                        {log.timestamp}
                      </td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                        {log.transport === 'POSTMESSAGE_SDK' ? 'postMessage' : 'HTTP MCP'}
                      </td>
                      <td className="py-2 px-3 font-semibold text-blue-600 dark:text-blue-400">
                        {log.method}
                      </td>
                      <td className="py-2 px-3">
                        {log.cacheHit ? (
                          <span className="text-emerald-600 dark:text-emerald-400">HIT</span>
                        ) : (
                          <span className="text-slate-500">STREAM</span>
                        )}
                      </td>
                      <td className="py-2 pl-3 pr-6 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                        {log.latencyMs.toFixed(2)} ms
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right 5 Columns: Request/Response JSON Inspector */}
        <div className="lg:col-span-5 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100">
            JSON-RPC Frame Inspector
          </h2>
          {activeLog ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Request Payload ({activeLog.method})
                </div>
                <pre className="p-3 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto text-slate-800 dark:text-slate-200">
                  {activeLog.requestPayload}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Response Frame ({activeLog.latencyMs.toFixed(2)} ms)
                </div>
                <pre className="p-3 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto text-emerald-700 dark:text-emerald-400">
                  {activeLog.responsePayload}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Select or dispatch an RPC call to inspect its JSON-RPC request and response frames.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

