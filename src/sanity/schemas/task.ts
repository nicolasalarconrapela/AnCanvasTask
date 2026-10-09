/**
 * Schema definition for Sanity Studio: Task
 * Type: 'task'
 */
export const taskSchema = {
  name: 'task',
  title: 'Task',
  type: 'document',
  fields: [
    { name: 'documentKey', type: 'string', hidden: true },
    { name: 'branchName', type: 'string' },
    { name: 'documentPath', type: 'string' },
    { name: 'syncOwner', type: 'string', hidden: true, readOnly: true, initialValue: (_params: any, context: any) => context.currentUser?.id },
    { name: 'syncDeleted', type: 'boolean', hidden: true, readOnly: true },
    {
      name: 'taskId',
      title: 'Task ID',
      type: 'string',
      description: 'Identificador único de la tarea (ej. "oauth", "session", "task-1")',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'workspace',
      title: 'Workspace Asociado',
      type: 'reference',
      to: [{ type: 'workspace' }],
      description: 'Workspace o repositorio al que pertenece esta tarea',
    },
    {
      name: 'workspaceId',
      title: 'Workspace ID',
      type: 'string',
      description: 'Identificador del workspace padre (ej. "ws_antask_monorepo")',
    },
    {
      name: 'title',
      title: 'Título',
      type: 'string',
      description: 'Nombre o descripción breve de la tarea',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'completed',
      title: 'Completada',
      type: 'boolean',
      initialValue: false,
    },
    {
      name: 'status',
      title: 'Estado Kanban',
      type: 'string',
      options: {
        list: [
          { title: 'Por hacer (Todo)', value: 'todo' },
          { title: 'En progreso (In Progress)', value: 'in_progress' },
          { title: 'Bloqueada (Blocked)', value: 'blocked' },
          { title: 'Completada (Done)', value: 'done' },
        ],
        layout: 'radio',
      },
      initialValue: 'todo',
    },
    {
      name: 'priority',
      title: 'Prioridad',
      type: 'string',
      options: {
        list: [
          { title: 'P0 - Crítica / Bloqueante', value: 'P0' },
          { title: 'P1 - Alta', value: 'P1' },
          { title: 'P2 - Media', value: 'P2' },
          { title: 'P3 - Baja', value: 'P3' },
        ],
      },
      initialValue: 'P1',
    },
    {
      name: 'groupTitle',
      title: 'Sección / Grupo',
      type: 'string',
      description: 'Sección del Markdown TASKS.md a la que pertenece (ej. "Autenticación")',
      initialValue: 'General',
    },
    {
      name: 'blockedBy',
      title: 'Bloqueada Por (Task ID)',
      type: 'string',
      description: 'ID de la tarea que debe completarse antes (DAG dependency)',
    },
    {
      name: 'tags',
      title: 'Etiquetas (#tags)',
      type: 'array',
      of: [{ type: 'string' }],
      options: {
        layout: 'tags',
      },
    },
    {
      name: 'subtasks',
      title: 'Subtareas (Checklist)',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'title', title: 'Título', type: 'string' },
            { name: 'completed', title: 'Completada', type: 'boolean', initialValue: false },
          ],
        },
      ],
    },
    {
      name: 'description',
      title: 'Notas / Descripción',
      type: 'text',
      rows: 3,
    },
    {
      name: 'updatedAt',
      title: 'Última actualización',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
    },
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'groupTitle',
      priority: 'priority',
      completed: 'completed',
    },
    prepare(selection: any) {
      const { title, subtitle, priority, completed } = selection;
      const statusIcon = completed ? '✅' : '⏳';
      return {
        title: `${statusIcon} [${priority || 'P1'}] ${title || 'Sin título'}`,
        subtitle: `Sección: ${subtitle || 'General'}`,
      };
    },
  },
};

export default taskSchema;
