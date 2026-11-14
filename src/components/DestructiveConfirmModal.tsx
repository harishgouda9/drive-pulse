import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { DestructiveActionRequest } from '../types/drive';
import { formatBytesTabular } from '../core/chunkStreamer';

interface DestructiveConfirmModalProps {
  request: DestructiveActionRequest | null;
  onCancel: () => void;
}

export const DestructiveConfirmModal: React.FC<DestructiveConfirmModalProps> = ({
  request,
  onCancel,
}) => {
  const [isExecuting, setIsExecuting] = useState(false);

  if (!request) return null;

  const handleConfirm = async () => {
    setIsExecuting(true);
    try {
      await request.onConfirm();
      onCancel();
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="destructive-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h2 id="destructive-modal-title" className="text-base font-bold font-display text-slate-900 dark:text-slate-100">
              {request.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {request.description}
        </p>

        <div className="bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Affected Google Drive Item(s) ({request.affectedFiles.length}):
          </div>
          {request.affectedFiles.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between text-xs text-slate-800 dark:text-slate-200 py-1 border-b border-slate-200/60 dark:border-slate-800/60 last:border-0"
            >
              <span className="font-medium truncate pr-3">{file.name}</span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                {formatBytesTabular(file.size)}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isExecuting}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isExecuting}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
          >
            {isExecuting
              ? 'Processing...'
              : request.actionType === 'DELETE'
              ? 'Confirm Delete'
              : 'Confirm Overwrite'}
          </button>
        </div>
      </div>
    </div>
  );
};
