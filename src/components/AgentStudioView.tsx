import React, { useState } from 'react';
import { Cpu, Pin, Send, UploadCloud, AlertCircle, FileText, Eye } from 'lucide-react';
import { AgentReasoningResult, DriveItem } from '../types/drive';
import { computeContentStats, formatBytesTabular } from '../core/chunkStreamer';

interface AgentStudioViewProps {
  items: DriveItem[];
  onTogglePin: (fileId: string) => void;
  results: AgentReasoningResult[];
  isAnalyzing: boolean;
  agentError: string | null;
  onRunHighThinkingQuery: (query: string) => Promise<void>;
  onSaveAgentArtifactToDrive: (fileName: string, content: string) => Promise<void>;
}

export const AgentStudioView: React.FC<AgentStudioViewProps> = ({
  items,
  onTogglePin,
  results,
  isAnalyzing,
  agentError,
  onRunHighThinkingQuery,
  onSaveAgentArtifactToDrive,
}) => {
  const [query, setQuery] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [inspectedFileId, setInspectedFileId] = useState<string | null>(null);

  const pinnedFiles = items.filter((i) => i.pinnedForAgent);
  const inspectedFile =
    items.find((i) => i.id === inspectedFileId) || pinnedFiles[0] || items[0] || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setValidationError('Please enter a query for the High-Thinking Architect.');
      return;
    }
    setValidationError(null);
    await onRunHighThinkingQuery(query.trim());
  };

  const handleSaveArtifact = async (fileName: string, content: string) => {
    await onSaveAgentArtifactToDrive(fileName, content);
    setSavedNotice(`Saved "${fileName}" to Google Drive & hydrated LRU cache.`);
    setTimeout(() => setSavedNotice(null), 3500);
  };

  const handleUseFilePrompt = (file: DriveItem) => {
    if (!file.pinnedForAgent) {
      onTogglePin(file.id);
    }
    setInspectedFileId(file.id);
    setQuery(
      `Analyze the connected Google Drive file "${file.name}" (${file.mimeType}), summarize its key contents and structure, and generate an actionable artifact or improvement plan based on its contents.`
    );
    if (validationError) setValidationError(null);
  };

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden bg-slate-50 dark:bg-[#0B0F19]">
      {/* Left 4 Columns: Pinned Drive Context Selector & Live Content Preview */}
      <div className="lg:col-span-4 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 overflow-y-auto space-y-5">
        <div>
          <h1 className="text-base font-bold font-display text-slate-900 dark:text-slate-100">
            Synchronized Drive Context
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Select which connected Google Drive files and their live contents are injected from the in-memory LRU cache into the high-thinking model context.
          </p>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 pb-3 border-b border-slate-200 dark:border-slate-800">
          <span>{pinnedFiles.length} file(s) pinned</span>
          <span aria-hidden="true" className="mx-1.5">·</span>
          <span>
            {formatBytesTabular(pinnedFiles.reduce((acc, f) => acc + f.size, 0))} hydrated
          </span>
        </div>

        {items.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
            No files mounted yet. Sign in with Google Drive, fetch a Drive link, or upload a file to pin and use its contents for high-thinking analysis.
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => {
              const stats = computeContentStats(item.contentPreview);
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setInspectedFileId(item.id);
                    onTogglePin(item.id);
                  }}
                  className={`p-3 rounded-lg border transition-colors cursor-pointer space-y-2 ${
                    item.pinnedForAgent
                      ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800'
                      : 'bg-slate-50/60 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                        <span>{formatBytesTabular(item.size)}</span>
                        <span aria-hidden="true" className="mx-1">·</span>
                        <span>{stats.lineCount} lines</span>
                        <span aria-hidden="true" className="mx-1">·</span>
                        <span>{item.lastLatencyMs.toFixed(2)} ms</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(item.id);
                      }}
                      aria-label={`${item.pinnedForAgent ? 'Unpin' : 'Pin'} ${item.name}`}
                      className={`p-1 rounded-md shrink-0 cursor-pointer ${
                        item.pinnedForAgent
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {item.contentPreview ? (
                    <div className="p-2 rounded bg-white/80 dark:bg-slate-950/80 border border-slate-200/80 dark:border-slate-800 font-mono text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2 whitespace-pre-wrap">
                      {item.contentPreview.slice(0, 180)}
                    </div>
                  ) : (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400">
                      Click to stream & hydrate content from Google Drive
                    </div>
                  )}

                  <div
                    className="flex items-center justify-between gap-2 pt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setInspectedFileId(item.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Inspect Content</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUseFilePrompt(item)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      <FileText className="w-3 h-3" />
                      <span>Use Content in Prompt</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right 8 Columns: High-Thinking Prompt Studio, Connected Content Viewer & Reasoning Trace */}
      <div className="lg:col-span-8 p-6 overflow-y-auto space-y-6">
        {/* Active Connected Google Drive File Content Preview Card */}
        {inspectedFile && (
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Connected File Content Active in Context: {inspectedFile.name}</span>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                  <span>{inspectedFile.mimeType}</span>
                  <span aria-hidden="true" className="mx-1.5">·</span>
                  <span>{formatBytesTabular(inspectedFile.size)}</span>
                  <span aria-hidden="true" className="mx-1.5">·</span>
                  <span>
                    {inspectedFile.pinnedForAgent ? 'Injected into Prompt Context' : 'Unpinned'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleUseFilePrompt(inspectedFile)}
                className="px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/70 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
              >
                Load into Query Box
              </button>
            </div>
            <pre className="max-h-36 overflow-y-auto p-3 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
              {inspectedFile.contentPreview ||
                'Streaming content from Google Drive into in-memory LRU cache...'}
            </pre>
          </div>
        )}

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>High-Thinking Agentic Orchestrator</span>
              </h2>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                <span>Model: gemini-4-carbon</span>
                <span aria-hidden="true" className="mx-1.5">·</span>
                <span>ThinkingLevel.HIGH</span>
                <span aria-hidden="true" className="mx-1.5">·</span>
                <span>Unbounded Reasoning Tokens</span>
              </div>
            </div>

            {savedNotice && (
              <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {savedNotice}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="agent-query-input" className="sr-only">
                High-thinking architectural query
              </label>
              <textarea
                id="agent-query-input"
                rows={3}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="Enter a complex architectural or data analysis query across your pinned Google Drive files..."
                className="w-full p-3.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            </div>

            {validationError && (
              <div role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                {validationError}
              </div>
            )}

            {agentError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 flex items-start gap-2 text-xs text-red-700 dark:text-red-300"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{agentError}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Context injected via zero-copy memory bridge ({pinnedFiles.length} files active)
              </div>
              <button
                type="submit"
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {isAnalyzing
                    ? 'Reasoning with gemini-4-carbon (HIGH)...'
                    : 'Run High-Thinking Synthesis'}
                </span>
              </button>
            </div>
          </form>
        </div>

        {/* Reasoning Trace & Synthesis Output */}
        {results.length === 0 ? (
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No high-thinking queries executed in this session yet. Submit a query above to run live analysis with <code className="font-mono">gemini-4-carbon</code> (<code className="font-mono">ThinkingLevel.HIGH</code>).
          </div>
        ) : (
          <div className="space-y-4">
            {results.map((res) => (
              <div
                key={res.id}
                className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {res.query}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    <span>{res.model}</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>Thinking: {res.thinkingLevel}</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>{res.latencyMs.toFixed(2)} ms</span>
                  </div>
                </div>

                {/* Deep Thinking Trace Section */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Deep Reasoning Trace (ThinkingLevel.HIGH)
                  </div>
                  <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
                    {res.thinkingSummary}
                  </pre>
                </div>

                {/* Synthesized Output Section */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Architectural Synthesis & Output
                  </div>
                  <div className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed font-sans space-y-1.5">
                    {res.answerMarkdown
                      .replace(/^###\s+/gm, '')
                      .replace(/\*\*(.*?)\*\*/g, '$1')}
                  </div>
                </div>

                {/* Executable Drive Write-Back Actions */}
                {res.suggestedActions.length > 0 && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
                    {res.suggestedActions.map((act, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSaveArtifact(act.fileName, act.contentToSave)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>
                          {act.label} ({act.fileName})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
