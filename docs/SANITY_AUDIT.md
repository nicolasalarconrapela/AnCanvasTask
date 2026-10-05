# Auditoría Técnica de Sanity en AnTaskCanvas

A continuación, se detalla el papel actual de Sanity en el repositorio, basándonos única y exclusivamente en la evidencia encontrada en el código.

## Configuración

```text
SANITY_PROJECT_ID=Configurable por el usuario (via import.meta.env.VITE_SANITY_PROJECT_ID o interfaz)
SANITY_DATASET=production (via import.meta.env.VITE_SANITY_DATASET o interfaz)
SANITY_API_VERSION=2024-03-01
SANITY_VERSION=v6.17.0 (y @sanity/client v8.7.0)
```

## Schemas

| Schema | Tipo | Propósito | Campos principales | Referencias |
|---|---|---|---|---|
| `workspace` | document | Gestiona workspaces multi-repositorio y ramas con sus documentos de tareas | `workspaceId`, `name`, `githubRepo`, `branches`, `tasks` | A `task` |
| `task` | document | Representación estructurada individual de una tarea del Kanban/MD | `taskId`, `workspace`, `title`, `status`, `priority`, `subtasks` | A `workspace` |
| `canvasVisualState` | document | Persiste el layout espacial y agrupación visual (Tldraw) sin afectar el contenido base | `projectId`, `tasks` (x,y,w,h), `groups` (x,y,w,h) | *Ninguna* |

## Persistencia

- **Qué se guarda en Sanity:** Los documentos estructurados correspondientes a los esquemas: tareas como entidades independientes (`task`), workspaces (`workspace`), y el estado de la disposición visual del canvas (`canvasVisualState`).
- **Qué no se guarda en Sanity:** El texto bruto del archivo `TASKS.md` como fuente de verdad monolítica, credenciales (tokens PAT de GitHub, tokens API de Sanity), configuración de temas (dark/light) o preferencias de idioma.
- **Qué vive solo en memoria:** El estado interno e interactivo de `tldraw` (selecciones, cursores), las consultas de búsqueda activas, los filtros del Kanban y el estado efímero de los modales.
- **Qué vive en localStorage/IndexedDB:** No se usa IndexedDB. `localStorage` maneja el caché de Sanity config (`antaskcanvas_sanity_config`) y proporciona un caché offline rápido (fallback) del layout del canvas (`antaskcanvas_visual_state_v1`).
- **Qué ocurre al recargar la aplicación:** `sanityService.ts` intenta recuperar inmediatamente el estado visual remoto de Sanity; si falla, toma más de 1800ms o no hay credenciales, cae elegantemente en el fallback del `localStorage`. El Sanity Studio Embebido recarga su configuración.

## Flujo de datos

El flujo implementado es bidireccional y reactivo:

```text
UI → estado → Sanity
Sanity → realtime/listener → UI
```

*Evidencia*: 
1. Escritura: Acciones en UI disparan mutaciones directas mediante el SDK (`client.createOrReplace` y `client.transaction()`).
2. Lectura: Se hace uso explícito de `client.listen()` en `subscribeToSanityLiveChanges` para reaccionar a transiciones (`appear`, `update`, `disappear`) del Content Lake en tiempo real e inyectarlas al estado local de la app.

## Features de Sanity

```text
SANITY_STUDIO=USED
SANITY_REALTIME=USED
SANITY_APP_SDK=USED
SANITY_WORKFLOWS=NOT VERIFIED
SANITY_VISUAL_EDITING=NOT USED
SANITY_PRESENTATION=NOT USED
SANITY_CONTENT_RELEASES=NOT USED
```

## Qué cambió Sanity en el proyecto

#### Confirmado por código
- Integración nativa de **Sanity Studio v6** (`SanityStudioEmbed.tsx`) directamente embebido como parte de la SPA.
- Desacoplamiento del guardado monolítico de Markdown: Ahora existe una **traducción de Tareas a Documentos Estructurados** en la nube.
- Incorporación de sincronización viva (**Realtime**) mediante el SDK, permitiendo que ediciones en la nube se reflejen instantáneamente en la interfaz de React.

#### Inferencia razonable
- Se introdujo para preparar a la aplicación como un gestor de proyectos colaborativo tipo Headless CMS, separando los "datos visuales" (Canvas) de los "datos de contenido" (Task/Workspace).

#### No demostrable
- Aprobaciones o flujos de trabajo editoriales complejos (Workflows).
- Uso del Presentation Tool oficial de Sanity; en su lugar, se dibuja todo dentro de Tldraw y React estándar leyendo los documentos directamente.

## Claims seguros

Puedes usar estas afirmaciones para la submission con total confianza en que están respaldadas por el código:

- "AnTaskCanvas embebe Sanity Studio de manera nativa permitiendo la gestión y auditoría del contenido sin salir de la plataforma."
- "Las tareas del Markdown se estructuran dinámicamente en documentos enlazables dentro de Sanity, divididos de manera relacional (Workspaces -> Tasks)."
- "El proyecto cuenta con sincronización bidireccional en tiempo real gracias al API de streaming del Sanity Client (`listen`)."
- "Ofrece una estrategia híbrida robusta de persistencia: la disposición infinita del Canvas se guarda en Sanity Content Lake, pero asegura su carga inicial rápida haciendo fallback a un caché en LocalStorage."
