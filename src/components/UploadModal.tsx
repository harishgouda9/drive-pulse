import React, { useState } from 'react';
import { Upload, X, Image as ImageIcon, Film, FileText } from 'lucide-react';
import {
  computeFastChecksum,
  formatBytesTabular,
  isBinaryMediaMime,
  splitIntoChunks,
} from '../core/chunkStreamer';

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read local binary file'));
    reader.readAsDataURL(file);
  });
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onUpload }) => {
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('text/plain');
  const [folderPath, setFolderPath] = useState('/Google Drive');
  const [content, setContent] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  if (!isOpen) return null;

  const isBinaryDataUrl = content.startsWith('data:');
  const byteSize = new TextEncoder().encode(content).byteLength;
  const chunks = splitIntoChunks(content, 16384);
  const checksum = computeFastChecksum(content);

  const handleLocalFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const detectedMime = file.type || 'text/plain';
    setFileName(file.name);
    setMimeType(detectedMime);

    try {
      if (isBinaryMediaMime(detectedMime, file.name)) {
        const dataUrl = await readFileAsDataUrl(file);
        setContent(dataUrl);
      } else {
        const text = await file.text();
        setContent(text);
      }
      setErrorMsg(null);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to read selected file');
    }
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
      <div className="w-full max-w-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2
              id="upload-modal-title"
              className="text-base font-bold font-display text-slate-900 dark:text-slate-100"
            >
              Chunked Multipart Upload to Google Drive (Files, Images, Videos & Code)
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
              <label
                htmlFor="upload-file-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
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
                placeholder="Enter file name with extension (e.g. diagram.png, demo.mp4, config.yaml)"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="upload-mime-type"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                MIME Type
              </label>
              <select
                id="upload-mime-type"
                value={mimeType}
                onChange={(e) => setMimeType(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              >
                <option value="text/plain">text/plain (Text / Logs)</option>
                <option value="application/json">application/json (JSON)</option>
                <option value="application/yaml">application/yaml (YAML Pipeline)</option>
                <option value="text/markdown">text/markdown (Markdown Doc)</option>
                <option value="text/csv">text/csv (CSV Spreadsheet)</option>
                <option value="application/sql">application/sql (SQL Schema)</option>
                <option value="image/png">image/png (PNG Image)</option>
                <option value="image/jpeg">image/jpeg (JPEG Image)</option>
                <option value="image/webp">image/webp (WebP Image)</option>
                <option value="image/svg+xml">image/svg+xml (SVG Vector)</option>
                <option value="video/mp4">video/mp4 (MP4 Video)</option>
                <option value="video/webm">video/webm (WebM Video)</option>
                <option value="audio/mpeg">audio/mpeg (MP3 Audio)</option>
                <option value="application/pdf">application/pdf (PDF Document)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="upload-folder-path"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
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
              <label
                htmlFor="local-file-picker"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Select Local File (Text, Code, Image, Video, PDF)
              </label>
              <input
                id="local-file-picker"
                type="file"
                accept="*/*"
                onChange={handleLocalFilePick}
                className="w-full text-xs text-slate-600 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-slate-200 dark:file:bg-slate-800 file:text-slate-800 dark:file:text-slate-200 cursor-pointer"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="upload-content-area"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
              >
                {mimeType.startsWith('image/') ? (
                  <ImageIcon className="w-3.5 h-3.5 text-blue-600" />
                ) : mimeType.startsWith('video/') ? (
                  <Film className="w-3.5 h-3.5 text-purple-600" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-emerald-600" />
                )}
                <span>Stream Payload Content</span>
              </label>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>{formatBytesTabular(byteSize)}</span>
                <span aria-hidden="true" className="mx-1.5">
                  ·
                </span>
                <span>{chunks.length} chunk(s)</span>
                <span aria-hidden="true" className="mx-1.5">
                  ·
                </span>
                <span>crc {checksum}</span>
              </div>
            </div>

            {isBinaryDataUrl && mimeType.startsWith('image/') ? (
              <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg flex flex-col items-center gap-2">
                <img
                  src={content}
                  alt={fileName || 'Upload preview'}
                  className="max-h-44 object-contain rounded border border-slate-200 dark:border-slate-800"
                />
                <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  Binary Image Stream Ready ({formatBytesTabular(byteSize)})
                </span>
              </div>
            ) : isBinaryDataUrl && mimeType.startsWith('video/') ? (
              <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg flex flex-col items-center gap-2">
                <video
                  src={content}
                  controls
                  className="max-h-44 rounded border border-slate-200 dark:border-slate-800"
                />
                <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  Binary Video Stream Ready ({formatBytesTabular(byteSize)})
                </span>
              </div>
            ) : (
              <textarea
                id="upload-content-area"
                rows={6}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="Paste or type file content, or select a local text, code, image, video, or PDF file above..."
                className="w-full p-3 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
              />
            )}
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
