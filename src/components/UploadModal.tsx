import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { computeFastChecksum, formatBytesTabular, splitIntoChunks } from '../core/chunkStreamer';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (params: {
    name: string;
    mimeType: string;
    content: string;
    folderPath: string;
  }) => Promise<void>;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onUpload }) => {
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('text/plain');
  const [folderPath, setFolderPath] = useState('/Google Drive');
  const [content, setContent] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  if (!isOpen) return null;

  const byteSize = new TextEncoder().encode(content).byteLength;
  const chunks = splitIntoChunks(content, 16384);
  const checksum = computeFastChecksum(content);

  const handleLocalFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setMimeType(file.type || 'text/plain');
    const text = await file.text();
    setContent(text);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) {
      setErrorMsg('Please enter a valid file name before uploading.');
      return;
    }
    if (!content.trim()) {
      setErrorMsg('File payload cannot be empty.');
      return;
    }

    setErrorMsg(null);
    setIsUploading(true);
    try {
      await onUpload({
        name: fileName.trim(),
        mimeType,
        content,
        folderPath: folderPath.trim() || '/Google Drive',
      });
      setFileName('');
      setContent('');
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 id="upload-modal-title" className="text-base font-bold font-display text-slate-900 dark:text-slate-100">
              Chunked Multipart Upload to Google Drive
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload modal"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="upload-file-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                File Name
              </label>
              <input
                id="upload-file-name"
                type="text"
                value={fileName}
                onChange={(e) => {
                  setFileName(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="Enter file name with extension"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label htmlFor="upload-mime-type" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                MIME Type
              </label>
              <select
                id="upload-mime-type"
                value={mimeType}
                onChange={(e) => setMimeType(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              >
                <option value="text/plain">text/plain</option>
                <option value="application/json">application/json</option>
                <option value="application/yaml">application/yaml</option>
                <option value="text/markdown">text/markdown</option>
                <option value="text/csv">text/csv</option>
                <option value="application/sql">application/sql</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="upload-folder-path" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Target Mount Path
              </label>
              <input
                id="upload-folder-path"
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label htmlFor="local-file-picker" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Select Local File
              </label>
              <input
                id="local-file-picker"
                type="file"
                onChange={handleLocalFilePick}
                className="w-full text-xs text-slate-600 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-slate-200 dark:file:bg-slate-800 file:text-slate-800 dark:file:text-slate-200 cursor-pointer"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="upload-content-area" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Stream Payload Content
              </label>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>{formatBytesTabular(byteSize)}</span>
                <span aria-hidden="true" className="mx-1.5">·</span>
                <span>{chunks.length} chunk(s)</span>
                <span aria-hidden="true" className="mx-1.5">·</span>
                <span>crc {checksum}</span>
              </div>
            </div>
            <textarea
              id="upload-content-area"
              rows={6}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="Paste or type file content, or select a file from disk above..."
              className="w-full p-3 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
            />
          </div>

          {errorMsg && (
            <div role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
            >
              {isUploading ? 'Streaming Chunks...' : 'Upload & Hydrate Cache'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
