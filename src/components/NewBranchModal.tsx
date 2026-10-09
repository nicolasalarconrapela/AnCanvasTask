import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import React, { useEffect, useState } from 'react';
import { BranchConfig } from '../services/workspaceService';

interface NewBranchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBranch: BranchConfig;
  allBranches: BranchConfig[];
  onCreateBranch: (branchName: string, sourceBranchName: string | null) => void;
  onShowToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const NewBranchModal: React.FC<NewBranchModalProps> = ({
  isOpen,
  onClose,
  currentBranch,
  allBranches,
  onCreateBranch,
  onShowToast,
}) => {
  const { _ } = useLingui();
  const [branchName, setBranchName] = useState('');
  const [sourceBranch, setSourceBranch] = useState('main');
  useEffect(() => {
    if (isOpen) {
      setBranchName('');
      setSourceBranch(allBranches.some(branch => branch.name === 'main') ? 'main' : currentBranch.name);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = branchName.trim().replace(/\s+/g, '-');
    if (!cleanName) {
      onShowToast(_(msg`Por favor introduce un nombre válido de rama`), 'warning');
      return;
    }

    if (allBranches.some((b) => b.name.toLowerCase() === cleanName.toLowerCase())) {
      onShowToast(_(msg`Ya existe una rama con el nombre "${cleanName}"`), 'error');
      return;
    }

    onCreateBranch(cleanName, sourceBranch || null);
    onClose();
  };

  return (
    <div
      id="modal-new-branch-overlay"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 animate-fade-in"
      onClick={onClose}
    >
      <div
        id="modal-new-branch-dialog"
        className="w-full sm:max-w-md bg-[var(--surface-container)] border-t sm:border border-[var(--outline)] rounded-t-md sm:rounded-md shadow-md flex flex-col overflow-hidden pb-safe sm:pb-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-branch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="div-newbranchmodal-1" className="px-4 py-3 border-b border-[var(--outline)] flex items-center justify-between">
          <div id="div-newbranchmodal-2" className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-[var(--primary)]">fork_right</span>
            <h2 id="new-branch-title" className="text-sm font-semibold text-[var(--on-surface)] font-sans">
              {_(msg`Crear Nueva Rama de Git`)}
            </h2>
          </div>
          <button id="btn-newbranchmodal-1" type="button" onClick={onClose} className="btn-m3-icon w-7 h-7 cursor-pointer">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3.5">
          <div id="div-newbranchmodal-3" className="flex flex-col gap-1">
            <label htmlFor="new-branch-name" className="text-xs font-medium text-[var(--on-surface)]">
              {_(msg`Nombre de la nueva rama`)}
            </label>
            <input
              id="new-branch-name"
              type="text"
              required
              autoFocus
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder={_(msg`ej. feature/auth-passkey, bugfix/canvas-zoom...`)}
              className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2.5 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none"
            />
          </div>

          <div id="div-newbranchmodal-4" className="flex flex-col gap-1">
            <label htmlFor="new-branch-source" className="text-xs font-medium text-[var(--on-surface)]">
              {_(msg`Crear a partir de la rama`)}
            </label>
            <select
              id="new-branch-source"
              value={sourceBranch}
              onChange={(e) => setSourceBranch(e.target.value)}
              className="w-full bg-[var(--surface)] border border-[var(--outline)] focus:border-[var(--primary)] rounded px-2 py-1.5 text-xs font-mono text-[var(--on-surface)] focus:outline-none cursor-pointer"
            >
              <option value="">{_(msg`Empezar desde cero`)}</option>
              {allBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} ({b.taskDocuments.length} {_(msg`archivos Task MD`)})
                </option>
              ))}
            </select>
          </div>

          <div id="div-newbranchmodal-5" className="p-2.5 rounded bg-[var(--surface)] border border-[var(--outline)] text-[11px] text-[var(--on-surface-variant)] leading-relaxed">
            {sourceBranch ? _(msg`Se clonarán todos los archivos Task MD (raíz, frontend, backend, etc.) y su distribución visual hacia la nueva rama.`)
              : _(msg`Se creará TASKS.md sin tareas.`)}
          </div>

          <div id="div-newbranchmodal-6" className="pt-2.5 flex items-center justify-end gap-2 border-t border-[var(--outline)]">
            <button
              id="btn-cancel-new-branch"
              type="button"
              onClick={onClose}
              className="btn-m3-text px-3 py-1 text-xs cursor-pointer"
            >
              {_(msg`Cancelar`)}
            </button>
            <button
              id="btn-submit-new-branch"
              type="submit"
              disabled={!branchName.trim()}
              className="btn-m3-primary px-4 py-1 text-xs cursor-pointer shadow-sm"
            >
              {_(msg`Crear Rama`)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
