/**
 * Schema definition for Sanity Studio: Workspace
 * Type: 'workspace'
 * 
 * Manages full multi-repository and branch workspaces with distributed
 * Task MD documents, GitHub metadata, and branches.
 */
export const workspaceSchema = {
  name: 'workspace',
  title: 'Workspace',
  type: 'document',
  fields: [
    { name: 'syncOwner', type: 'string', hidden: true, readOnly: true, initialValue: (_params: any, context: any) => context.currentUser?.id },
    { name: 'syncDeleted', type: 'boolean', hidden: true, readOnly: true },
    {
      name: 'workspaceId',
      title: 'Workspace ID',
      type: 'string',
      description: 'Identificador único del workspace (ej. "ws_antask_monorepo", "ws_1720000000000")',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'name',
      title: 'Nombre del Workspace',
      type: 'string',
      description: 'Nombre descriptivo del espacio de trabajo o proyecto',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'githubRepo',
      title: 'Repositorio GitHub',
      type: 'object',
      fields: [
        {
          name: 'owner',
          title: 'Owner / Organización',
          type: 'string',
          validation: (Rule: any) => Rule.required(),
        },
        {
          name: 'repo',
          title: 'Nombre del Repositorio',
          type: 'string',
          validation: (Rule: any) => Rule.required(),
        },
        {
          name: 'fullName',
          title: 'Nombre Completo (owner/repo)',
          type: 'string',
          description: 'ej. "antask-org/antask-platform"',
        },
        {
          name: 'url',
          title: 'URL de GitHub',
          type: 'url',
        },
        {
          name: 'defaultBranch',
          title: 'Rama por Defecto',
          type: 'string',
          initialValue: 'main',
        },
        {
          name: 'isPrivate',
          title: 'Repositorio Privado',
          type: 'boolean',
          initialValue: false,
        },
        {
          name: 'description',
          title: 'Descripción del Repositorio',
          type: 'text',
          rows: 2,
        },
      ],
    },
    {
      name: 'activeBranchName',
      title: 'Rama Activa',
      type: 'string',
      description: 'Nombre de la rama Git actualmente seleccionada',
      initialValue: 'main',
    },
    {
      name: 'branches',
      title: 'Ramas Git & Documentos Task MD',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            {
              name: 'name',
              title: 'Nombre de la Rama',
              type: 'string',
              validation: (Rule: any) => Rule.required(),
            },
            {
              name: 'isProtected',
              title: 'Rama Protegida',
              type: 'boolean',
              initialValue: false,
            },
            {
              name: 'activeDocumentId',
              title: 'ID del Documento Activo',
              type: 'string',
            },
            {
              name: 'lastCommit',
              title: 'Último Commit',
              type: 'object',
              fields: [
                { name: 'hash', title: 'Commit Hash', type: 'string' },
                { name: 'message', title: 'Mensaje', type: 'string' },
                { name: 'author', title: 'Autor', type: 'string' },
                { name: 'timestamp', title: 'Fecha/Hora', type: 'datetime' },
              ],
            },
            {
              name: 'taskDocuments',
              title: 'Documentos TASKS.md',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    {
                      name: 'id',
                      title: 'ID del Documento',
                      type: 'string',
                      validation: (Rule: any) => Rule.required(),
                    },
                    {
                      name: 'name',
                      title: 'Nombre de Archivo',
                      type: 'string',
                      initialValue: 'TASKS.md',
                    },
                    {
                      name: 'folder',
                      title: 'Carpeta / Directorio',
                      type: 'string',
                      description: 'ej. "" (raíz), "frontend", "backend"',
                    },
                    {
                      name: 'path',
                      title: 'Ruta Completa',
                      type: 'string',
                      description: 'ej. "TASKS.md", "frontend/TASKS.md"',
                    },
                    {
                      name: 'content',
                      title: 'Contenido Markdown',
                      type: 'text',
                      rows: 8,
                    },
                    {
                      name: 'lastSavedContent',
                      title: 'Último Contenido Guardado',
                      type: 'text',
                      rows: 4,
                    },
                    {
                      name: 'updatedAt',
                      title: 'Fecha de Actualización',
                      type: 'datetime',
                    },
                  ],
                  preview: {
                    select: {
                      title: 'path',
                      subtitle: 'name',
                    },
                  },
                },
              ],
            },
          ],
          preview: {
            select: {
              title: 'name',
              isProtected: 'isProtected',
              docCount: 'taskDocuments.length',
            },
            prepare(selection: any) {
              const { title, isProtected, docCount } = selection;
              const prot = isProtected ? '🔒 ' : '🌿 ';
              return {
                title: `${prot}${title || 'rama'}`,
                subtitle: `${docCount || 0} archivos Task MD`,
              };
            },
          },
        },
      ],
    },
    {
      name: 'tasks',
      title: 'Tareas Directas del Workspace (Tasks)',
      type: 'array',
      description: 'Tareas asociadas directamente a este workspace',
      of: [{ type: 'reference', to: [{ type: 'task' }] }],
    },
    {
      name: 'createdAt',
      title: 'Fecha de Creación',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
    },
    {
      name: 'updatedAt',
      title: 'Última Actualización',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
    },
  ],
  preview: {
    select: {
      title: 'name',
      repoName: 'githubRepo.fullName',
      activeBranch: 'activeBranchName',
      branches: 'branches',
    },
    prepare(selection: any) {
      const { title, repoName, activeBranch, branches } = selection;
      const count = Array.isArray(branches) ? branches.length : 0;
      return {
        title: `🏢 ${title || 'Sin nombre'}`,
        subtitle: `${repoName || 'Sin repositorio'} · ${count} rama(s) [activa: ${activeBranch || 'main'}]`,
      };
    },
  },
};

export default workspaceSchema;
