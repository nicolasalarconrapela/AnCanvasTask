import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TaskDocument, BranchConfig, Workspace, logWorkspaceTrace } from '../services/workspaceService';
import { scanTaskBlocks } from '../utils/markdownSync';

interface TaskDocumentExplorerProps {
  workspace: Workspace;
  allWorkspaces: Workspace[];
  activeBranch: BranchConfig;
  activeDocumentId: string;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectBranch: (branchName: string) => void;
  onOpenWorkspaceManager: () => void;
  onOpenCreateBranch: () => void;
  onOpenGitHubSync?: () => void;
  onSelectDocument: (docId: string) => void;
  onOpenNewDocumentModal: (presetFolder?: string) => void;
  onOpenNewFolderModal: () => void;
  onOpenRenameFolderModal: (folder: string, count: number) => void;
  onRenameDocument: (docId: string, currentName: string, currentFolder: string) => void;
  onDuplicateDocument: (docId: string) => void;
  onDeleteDocument: (docId: string, docPath: string) => void;
  onExportDocument: (doc: TaskDocument) => void;
}

export const TaskDocumentExplorer: React.FC<TaskDocumentExplorerProps> = ({
  workspace,
  allWorkspaces = [],
  activeBranch,
  activeDocumentId,
  onSelectWorkspace,
  onSelectBranch,
  onOpenWorkspaceManager,
  onOpenCreateBranch,
  onOpenGitHubSync,
  onSelectDocument,
  onOpenNewDocumentModal,
  onOpenNewFolderModal,
  onOpenRenameFolderModal,
  onRenameDocument,
  onDuplicateDocument,
  onDeleteDocument,
  onExportDocument,
}) => {
  const { i18n } = useLingui();
  const branch = activeBranch;
  const safeTaskDocuments = branch?.taskDocuments || [];
  const safeBranches = workspace?.branches || [];

  // Dropdown menus for Workspace and Branch
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);

  const wsDropdownRef = useRef<HTMLDivElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const wsMenuRef = useRef<HTMLDivElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click safely (guarding against unmounting during mousedown)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideWs =
        (wsDropdownRef.current && wsDropdownRef.current.contains(target)) ||
        (wsMenuRef.current && wsMenuRef.current.contains(target));

      if (!isInsideWs && isWorkspaceMenuOpen) {
        logWorkspaceTrace('Cerrando menú desplegable de Workspaces por clic exterior');
        setIsWorkspaceMenuOpen(false);
      }

      const isInsideBranch =
        (branchDropdownRef.current && branchDropdownRef.current.contains(target)) ||
        (branchMenuRef.current && branchMenuRef.current.contains(target));

      if (!isInsideBranch && isBranchMenuOpen) {
        logWorkspaceTrace('Cerrando menú desplegable de Ramas por clic exterior');
        setIsBranchMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isWorkspaceMenuOpen, isBranchMenuOpen]);

  // Collapsed folders state (all open by default)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [activeMenuDocId, setActiveMenuDocId] = useState<string | null>(null);
  const [activeMenuFolder, setActiveMenuFolder] = useState<string | null>(null);

  // Separate root documents and folder-based documents
  const { rootDocuments, folderGroups } = useMemo(() => {
    const rootDocs: TaskDocument[] = [];
    const folderMap: Record<string, TaskDocument[]> = {};

    safeTaskDocuments.forEach((doc) => {
      if (!doc) return;
      const isRoot = !doc.folder || doc.folder === 'root' || doc.folder === '/' || doc.folder === '.';
      if (isRoot) {
        rootDocs.push(doc);
      } else {
        if (!folderMap[doc.folder]) {
          folderMap[doc.folder] = [];
        }
        folderMap[doc.folder].push(doc);
      }
    });

    const sortedFolderKeys = Object.keys(folderMap).sort((a, b) => a.localeCompare(b));
    return {
      rootDocuments: rootDocs,
      folderGroups: sortedFolderKeys.map((key) => ({
        folder: key,
        documents: folderMap[key] || [],
      })),
    };
  }, [safeTaskDocuments]);

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folder]: !prev[folder],
    }));
  };

  const renderDocumentRow = (doc: TaskDocument, isInFolder: boolean = false) => {
    if (!doc) return null;
    const isActive = doc.id === activeDocumentId;
    const { taskBlocks } = scanTaskBlocks(doc.content || '');
    const totalTasks = taskBlocks.length;
    const completedTasks = taskBlocks.filter(
      (b) => b.rawTaskLine.includes('[x]') || b.rawTaskLine.includes('[X]')
    ).length;
    const hasUnsaved = doc.content !== doc.lastSavedContent;

    return (
      <div
        id={`div-doc-item-${doc.id}`}
        key={doc.id}
        className={`group relative flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
          isActive
            ? 'bg-[var(--primary-container)]/35 text-[var(--primary)] font-medium border border-[var(--primary)]/30'
            : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
        }`}
        onClick={() => onSelectDocument(doc.id)}
      >
        <div id="div-taskdocumentexplorer-1" className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="material-symbols-outlined text-[14px] shrink-0 text-sky-400">
            description
          </span>
          <span className="font-mono text-[11px] truncate">{doc.name}</span>
          {hasUnsaved && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
              title={i18n._(msg`Cambios sin guardar`)}
            />
          )}
        </div>

        {/* Task Count Badge & Context Menu */}
        <div id="div-taskdocumentexplorer-2" className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-mono opacity-80 bg-[var(--surface)] px-1 rounded border border-[var(--outline)]">
            {completedTasks}/{totalTasks}
          </span>

          <div id="div-taskdocumentexplorer-3" className="relative">
            <button
              id={`btn-doc-menu-${doc.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuDocId(activeMenuDocId === doc.id ? null : doc.id);
              }}
              className="btn-m3-icon w-5 h-5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:text-[var(--on-surface)] cursor-pointer"
              title={i18n._(msg`Opciones de archivo`)}
            >
              <span className="material-symbols-outlined text-[13px]">more_vert</span>
            </button>

            {/* Dropdown Options */}
            {activeMenuDocId === doc.id && (
              <div
                id={`div-doc-dropdown-${doc.id}`}
                className="absolute right-0 top-full mt-1 w-44 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md py-1 z-50 animate-fade-in"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  id={`btn-doc-rename-${doc.id}`}
                  type="button"
                  onClick={() => {
                    setActiveMenuDocId(null);
                    onRenameDocument(doc.id, doc.name, doc.folder);
                  }}
                  className="w-full px-2.5 py-1 text-left text-xs text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">edit</span>
                  <span>{i18n._(msg`Renombrar / Mover`)}</span>
                </button>

                <button
                  id={`btn-doc-duplicate-${doc.id}`}
                  type="button"
                  onClick={() => {
                    setActiveMenuDocId(null);
                    onDuplicateDocument(doc.id);
                  }}
                  className="w-full px-2.5 py-1 text-left text-xs text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  <span>{i18n._(msg`Duplicar`)}</span>
                </button>

                <button
                  id={`btn-doc-export-${doc.id}`}
                  type="button"
                  onClick={() => {
                    setActiveMenuDocId(null);
                    onExportDocument(doc);
                  }}
                  className="w-full px-2.5 py-1 text-left text-xs text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">download</span>
                  <span>{i18n._(msg`Descargar .md`)}</span>
                </button>

                {safeTaskDocuments.length > 1 && (
                  <button
                    id={`btn-doc-delete-${doc.id}`}
                    type="button"
                    onClick={() => {
                      setActiveMenuDocId(null);
                      onDeleteDocument(doc.id, doc.path);
                    }}
                    className="w-full px-2.5 py-1 text-left text-xs text-[var(--error)] hover:bg-rose-950/30 flex items-center gap-1.5 border-t border-[var(--outline)] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    <span>{i18n._(msg`Eliminar`)}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div id="div-taskdocumentexplorer-4" className="flex flex-col gap-1.5 select-none">
      {/* 1. Integrated Workspace & Branch Bar */}
      <div id="div-taskdocumentexplorer-5" className="relative flex items-center gap-1 pb-2 border-b border-[var(--outline)]">
        {/* Workspace Dropdown */}
        <div id="div-taskdocumentexplorer-6" className="flex-1 min-w-0" ref={wsDropdownRef}>
          <button
            id="btn-explorer-workspace-dropdown"
            type="button"
            onClick={() => {
              logWorkspaceTrace(`Alternando menú desplegable de Workspaces (actualmente ${isWorkspaceMenuOpen ? 'abierto' : 'cerrado'})`);
              setIsWorkspaceMenuOpen((prev) => !prev);
              setIsBranchMenuOpen(false);
            }}
            className="w-full flex items-center justify-between gap-1 px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] border border-[var(--outline)] text-xs text-[var(--on-surface)] transition-colors cursor-pointer"
            title={`Workspace: ${workspace?.name || 'Principal'}`}
          >
            <div id="div-taskdocumentexplorer-7" className="flex items-center gap-1.5 min-w-0 truncate">
              <svg className="w-3.5 h-3.5 fill-current shrink-0 opacity-80" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span className="font-semibold truncate">{workspace?.name || 'Principal'}</span>
            </div>
            <span className="material-symbols-outlined text-[14px] text-[var(--on-surface-variant)] shrink-0">
              arrow_drop_down
            </span>
          </button>
        </div>

        {/* Branch Dropdown */}
        <div id="div-taskdocumentexplorer-8" className="flex-1 min-w-0" ref={branchDropdownRef}>
          <button
            id="btn-explorer-branch-dropdown"
            type="button"
            onClick={() => {
              logWorkspaceTrace(`Alternando menú desplegable de Ramas (actualmente ${isBranchMenuOpen ? 'abierto' : 'cerrado'})`);
              setIsBranchMenuOpen((prev) => !prev);
              setIsWorkspaceMenuOpen(false);
            }}
            className="w-full flex items-center justify-between gap-1 px-2 py-1 rounded bg-[var(--surface-container)] hover:bg-[var(--surface-container-high)] border border-[var(--outline)] text-xs font-mono text-[var(--on-surface)] transition-colors cursor-pointer"
            title={`Rama actual: ${branch?.name || 'main'}`}
          >
            <div id="div-taskdocumentexplorer-9" className="flex items-center gap-1 min-w-0 truncate">
              <span className="material-symbols-outlined text-[13px] text-sky-400 shrink-0">
                fork_right
              </span>
              <span className="font-medium truncate">{branch?.name || 'main'}</span>
            </div>
            <span className="material-symbols-outlined text-[14px] text-[var(--on-surface-variant)] shrink-0">
              arrow_drop_down
            </span>
          </button>
        </div>

        {/* Workspace Dropdown Menu (Full Width of Header to Prevent Any Text Clipping) */}
        {isWorkspaceMenuOpen && (
          <div id="div-taskdocumentexplorer-10" ref={wsMenuRef} className="absolute left-0 right-0 top-full mt-1.5 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md py-1 z-50 animate-fade-in select-none">
            <div id="div-taskdocumentexplorer-11" className="px-3 py-1.5 border-b border-[var(--outline)] flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">
                {i18n._(msg`Workspaces`)} ({allWorkspaces.length})
              </span>
              <button
                id="btn-explorer-manage-workspaces"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  logWorkspaceTrace('Clic en botón Administrar desde Explorador -> ejecutando onOpenWorkspaceManager()');
                  setIsWorkspaceMenuOpen(false);
                  onOpenWorkspaceManager();
                }}
                className="text-[10px] text-[var(--primary)] hover:underline cursor-pointer font-medium"
              >
                {i18n._(msg`Administrar`)}
              </button>
            </div>

            <div id="div-taskdocumentexplorer-12" className="max-h-52 overflow-y-auto py-1">
              {allWorkspaces.map((ws) => {
                const isCurrent = ws.id === workspace?.id;
                return (
                  <button
                    id={`btn-explorer-select-ws-${ws.id}`}
                    key={ws.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      logWorkspaceTrace(`Clic para seleccionar Workspace: "${ws.name}" (${ws.id})`, {
                        id: ws.id,
                        name: ws.name,
                        esActual: isCurrent,
                      });
                      onSelectWorkspace(ws.id);
                      setIsWorkspaceMenuOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-[var(--primary-container)]/30 text-[var(--primary)] font-medium'
                        : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                    }`}
                  >
                    <div id="div-taskdocumentexplorer-13" className="flex flex-col min-w-0">
                      <span className="font-semibold truncate">{ws.name}</span>
                      <span className="text-[10px] font-sans text-[var(--on-surface-variant)] truncate">
                        {ws.githubRepo?.description || `${(ws.branches || []).length} ramas`}
                      </span>
                    </div>
                    {isCurrent && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            <div id="div-taskdocumentexplorer-14" className="pt-1 border-t border-[var(--outline)] px-2 py-1">
              <button
                id="btn-explorer-new-workspace"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  logWorkspaceTrace('Clic en + Nuevo Workspace desde Explorador -> ejecutando onOpenWorkspaceManager()');
                  setIsWorkspaceMenuOpen(false);
                  onOpenWorkspaceManager();
                }}
                className="btn-m3-secondary w-full py-1 text-xs justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                <span>+ {i18n._(msg`Nuevo Workspace`)}</span>
              </button>
            </div>
          </div>
        )}

        {/* Branch Dropdown Menu (Full Width of Header to Prevent Any Text Clipping) */}
        {isBranchMenuOpen && (
          <div id="div-taskdocumentexplorer-15" ref={branchMenuRef} className="absolute left-0 right-0 top-full mt-1.5 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md py-1 z-50 animate-fade-in select-none">
            <div id="div-taskdocumentexplorer-16" className="px-3 py-1.5 border-b border-[var(--outline)] flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">
                {i18n._(msg`Ramas`)} ({safeBranches.length})
              </span>
            </div>

            <div id="div-taskdocumentexplorer-17" className="max-h-52 overflow-y-auto py-1">
              {safeBranches.map((b) => {
                const isCurrent = b.name === branch?.name;
                const docCount = b.taskDocuments?.length || 0;
                return (
                  <button
                    id={`btn-explorer-select-branch-${b.name}`}
                    key={b.name}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      logWorkspaceTrace(`Clic para seleccionar Rama: "${b.name}"`, {
                        name: b.name,
                        esActual: isCurrent,
                      });
                      onSelectBranch(b.name);
                      setIsBranchMenuOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-[var(--primary-container)]/30 text-[var(--primary)] font-medium'
                        : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
                    }`}
                  >
                    <div id="div-taskdocumentexplorer-18" className="flex items-center gap-1.5 min-w-0 truncate font-mono">
                      <span className="material-symbols-outlined text-[13px] text-sky-400 shrink-0">
                        fork_right
                      </span>
                      <span className="truncate">{b.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--on-surface-variant)] shrink-0">
                      {docCount} {i18n._(msg`doc`)}{docCount !== 1 ? 's' : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            <div id="div-taskdocumentexplorer-19" className="pt-1 border-t border-[var(--outline)] px-2 py-1 flex items-center gap-1">
              <button
                id="btn-explorer-new-branch"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  logWorkspaceTrace('Clic en + Nueva Rama desde Explorador -> abriendo NewBranchModal');
                  setIsBranchMenuOpen(false);
                  onOpenCreateBranch();
                }}
                className="btn-m3-secondary flex-1 py-1 text-xs justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[13px]">add</span>
                <span>+ {i18n._(msg`Nueva rama`)}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Files & Folders Header with Title and Quick Add Buttons */}
      <div id="div-taskdocumentexplorer-20" className="flex items-center justify-between px-1 py-1">
        <div id="div-taskdocumentexplorer-21" className="flex items-center gap-1.5 min-w-0">
          <span className="material-symbols-outlined text-[15px] text-[var(--primary)] shrink-0">
            folder_special
          </span>
          <span className="text-[11px] font-semibold text-[var(--on-surface-variant)] uppercase tracking-wider truncate">
            {i18n._(msg`Documentos de Tareas`)} ({safeTaskDocuments.length})
          </span>
        </div>

        <div id="div-taskdocumentexplorer-22" className="flex items-center gap-0.5 shrink-0">
          <button
            id="btn-explorer-new-folder"
            type="button"
            onClick={onOpenNewFolderModal}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer transition-colors"
            title={i18n._(msg`Crear una nueva carpeta`)}
            aria-label={i18n._(msg`Crear una nueva carpeta`)}
          >
            <span className="material-symbols-outlined text-[15px]">create_new_folder</span>
          </button>

          <button
            id="btn-explorer-new-doc"
            type="button"
            onClick={() => onOpenNewDocumentModal('')}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] cursor-pointer transition-colors"
            title={i18n._(msg`Crear un nuevo archivo Task MD`)}
            aria-label={i18n._(msg`Crear un nuevo archivo Task MD`)}
          >
            <span className="material-symbols-outlined text-[15px]">note_add</span>
          </button>
        </div>
      </div>

      {/* 3. Document and Folder Tree */}
      <div id="div-taskdocumentexplorer-23" className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
        {/* Root documents */}
        {rootDocuments.length > 0 && (
          <div id="div-taskdocumentexplorer-24" className="flex flex-col gap-0.5">
            {rootDocuments.map((doc) => renderDocumentRow(doc, false))}
          </div>
        )}

        {/* Folder groups */}
        {folderGroups.map(({ folder, documents }) => {
          const isCollapsed = Boolean(collapsedFolders[folder]);
          const folderLabel = `${folder}/`;

          return (
            <div id="div-taskdocumentexplorer-25" key={folder} className="flex flex-col mt-1">
              {/* Folder Heading */}
              <div id="div-taskdocumentexplorer-26" className="flex items-center justify-between px-2 py-1 rounded hover:bg-[var(--surface-container-high)] text-xs text-[var(--on-surface-variant)] group cursor-pointer">
                <button
                  id={`btn-explorer-toggle-folder-${folder}`}
                  type="button"
                  onClick={() => toggleFolder(folder)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left font-mono font-medium text-[11px] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px] text-[var(--on-surface-variant)]">
                    {isCollapsed ? 'chevron_right' : 'expand_more'}
                  </span>
                  <span className="material-symbols-outlined text-[14px] text-amber-400">
                    folder
                  </span>
                  <span className="truncate text-[var(--on-surface)]">{folderLabel}</span>
                </button>

                <div id="div-taskdocumentexplorer-27" className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    id={`btn-explorer-add-doc-to-folder-${folder}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenNewDocumentModal(folder);
                    }}
                    className="btn-m3-icon w-5 h-5 text-[var(--on-surface-variant)] hover:text-[var(--primary)] cursor-pointer"
                    title={i18n._(msg`Añadir Task MD dentro de "${folderLabel}"`)}
                  >
                    <span className="material-symbols-outlined text-[13px]">add</span>
                  </button>

                  <div id="div-taskdocumentexplorer-28" className="relative">
                    <button
                      id={`btn-explorer-folder-menu-${folder}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuFolder(activeMenuFolder === folder ? null : folder);
                      }}
                      className="btn-m3-icon w-5 h-5 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] cursor-pointer"
                      title={i18n._(msg`Opciones de carpeta`)}
                    >
                      <span className="material-symbols-outlined text-[13px]">more_horiz</span>
                    </button>

                    {activeMenuFolder === folder && (
                      <div
                        id={`div-explorer-folder-dropdown-${folder}`}
                        className="absolute right-0 top-full mt-1 w-44 bg-[var(--surface-container)] border border-[var(--outline)] rounded-md shadow-md py-1 z-50 animate-fade-in"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          id={`btn-explorer-rename-folder-${folder}`}
                          type="button"
                          onClick={() => {
                            setActiveMenuFolder(null);
                            onOpenRenameFolderModal(folder, documents.length);
                          }}
                          className="w-full px-2.5 py-1 text-left text-xs text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] flex items-center gap-1.5 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[14px]">drive_file_rename_outline</span>
                          <span>{i18n._(msg`Renombrar carpeta`)}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Document List in Folder */}
              {!isCollapsed && (
                <div id="div-taskdocumentexplorer-29" className="flex flex-col gap-0.5 pl-4 border-l border-[var(--outline)] ml-3 my-0.5">
                  {documents.map((doc) => renderDocumentRow(doc, true))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
