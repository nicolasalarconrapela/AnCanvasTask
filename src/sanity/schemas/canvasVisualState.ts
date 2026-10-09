/**
 * Schema definition for Sanity Studio: CanvasVisualState
 * Type: 'canvasVisualState'
 */
export const canvasVisualStateSchema = {
  name: 'canvasVisualState',
  title: 'Canvas Visual State',
  type: 'document',
  fields: [
    { name: 'syncOwner', type: 'string', hidden: true, readOnly: true, initialValue: (_params: any, context: any) => context.currentUser?.id },
    { name: 'syncDeleted', type: 'boolean', hidden: true, readOnly: true },
    {
      name: 'projectId',
      title: 'Project ID',
      type: 'string',
      description: 'Identificador del proyecto o archivo de canvas',
      initialValue: 'default',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'tasks',
      title: 'Coordenadas de Tareas',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'taskId', title: 'Task ID', type: 'string', validation: (Rule: any) => Rule.required() },
            { name: 'x', title: 'X', type: 'number', validation: (Rule: any) => Rule.required() },
            { name: 'y', title: 'Y', type: 'number', validation: (Rule: any) => Rule.required() },
            { name: 'width', title: 'Width', type: 'number', initialValue: 320 },
            { name: 'height', title: 'Height', type: 'number', initialValue: 110 },
          ],
          preview: {
            select: {
              taskId: 'taskId',
              x: 'x',
              y: 'y',
            },
            prepare({ taskId, x, y }: any) {
              return {
                title: `Task #${taskId}`,
                subtitle: `Posición: (${Math.round(x || 0)}, ${Math.round(y || 0)})`,
              };
            },
          },
        },
      ],
    },
    {
      name: 'groups',
      title: 'Coordenadas de Secciones / Grupos',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'groupTitle', title: 'Título del Grupo', type: 'string', validation: (Rule: any) => Rule.required() },
            { name: 'x', title: 'X', type: 'number', validation: (Rule: any) => Rule.required() },
            { name: 'y', title: 'Y', type: 'number', validation: (Rule: any) => Rule.required() },
            { name: 'width', title: 'Width', type: 'number', initialValue: 360 },
            { name: 'height', title: 'Height', type: 'number', initialValue: 240 },
            { name: 'isCollapsed', title: 'Colapsado', type: 'boolean', initialValue: false },
          ],
          preview: {
            select: {
              groupTitle: 'groupTitle',
              x: 'x',
              y: 'y',
            },
            prepare({ groupTitle, x, y }: any) {
              return {
                title: `Grupo: ${groupTitle}`,
                subtitle: `Posición: (${Math.round(x || 0)}, ${Math.round(y || 0)})`,
              };
            },
          },
        },
      ],
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
      projectId: 'projectId',
      updatedAt: 'updatedAt',
      tasks: 'tasks',
    },
    prepare(selection: any) {
      const { projectId, updatedAt, tasks } = selection;
      const count = Array.isArray(tasks) ? tasks.length : 0;
      return {
        title: `Canvas: ${projectId || 'default'}`,
        subtitle: `${count} posiciones registradas · ${updatedAt ? new Date(updatedAt).toLocaleTimeString() : ''}`,
      };
    },
  },
};

export default canvasVisualStateSchema;
