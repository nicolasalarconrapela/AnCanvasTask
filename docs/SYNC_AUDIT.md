# Correcciones adicionales - 15/10/2026

Se reprodujeron y corrigieron fallos que las pruebas anteriores no cubrian:

- Las proyecciones remotas reactivaban tareas comentadas; editar, borrar o actualizar subtareas podia alterar comentarios y sus metadatos. Se conservan los comentarios abiertos/cerrados y se permite restauracion manual explicita.
- La asignacion automatica fallaba ante una BASE sin IDs. Para una unica tarea anonima compartida, las ediciones concurrentes derivan su ID de la misma BASE; se deduplican metadatos compatibles y se rechazan identidades incompatibles.
- Una pestana nueva reutilizaba el writer heredado en sessionStorage. Ahora recibe otro; una recarga conserva el existente para continuar su journal.
- Seguir escribiendo durante un guardado pendiente podia duplicar texto al fusionar su propio eco. La confirmacion se reconcilia contra el snapshot enviado antes de avanzar la BASE, tambien al reproducir operaciones propias. Se conserva la seleccion local de rama/documento.

Validacion: 120/120 pruebas de sincronizacion, verificaciones del nucleo, TypeScript/lint y build; Edge y Chrome, incluidas dos pestanas del mismo perfil, identidad heredada, recarga, respuesta de guardado retrasada, comentarios y preservacion de conflictos reales. Servidor simulado; sin escrituras en el dataset real.

---

# Estado de la correccion - 11/10/2026

Corregidos los casos F01-F15 del diagnostico siguiente y los defectos de UI asociados. Restauracion manual permitida; restauracion automatica bloqueada. Sin cambios de schemas ni dependencias.

- BASE original y revision seleccionada en push/delete; una eleccion manual rechaza cambios posteriores a su vista.
- Resoluciones parciales limitadas al elemento elegido. Conservan otros cambios locales y remotos, y rebasan sus operaciones pendientes tras guardar el resultado.
- Lecturas directas de documentos, tareas y marcadores antes de hidratar; las revisiones historicas conocidas no reemplazan una confirmada mas reciente.
- Conflictos independientes por documento/workspace; otros envios y descargas continuan. Sin BASE compartida no se decide por reloj.
- Borrado local persistido como ocultacion local; autosave y sync inteligente conservan el elemento remoto y sus metadatos. Deshacer restaura solo el elemento afectado.
- El texto vivo se asocia a la clave del editor, incluso si la seleccion del store cambia durante una importacion/descarga.
- Editor vivo persistido al salir o cambiar de documento. El editor recibe la reconciliacion antes del checkpoint; la navegacion local no cuenta como cambio de contenido.
- Arranque: normalizar el Markdown vacio del placeholder no lo convierte en un workspace real ni lo sube a la nube.
- Scope, cuenta, ciclo de restauracion y revision original conservados en acciones diferidas. Los estados de UI y los errores reflejan pendientes y conflictos reales.

Validacion: `npm test` (verificaciones del nucleo y 102/102 pruebas de sincronizacion), TypeScript/lint y build. Las suites de Edge/Chrome cubren tiempo real bidireccional, cambios compatibles e incompatibles, preservacion de ambas versiones, descarga independiente durante conflicto, cursor, archivos y ramas y guardado inmediato en pagehide. Los servidores son simulados; no se ha escrito en el dataset real ni se declara cobertura de todas las condiciones de produccion.

Criterios de referencia: control de revisiones y cambios de colaboradores en [Google Docs](https://developers.google.com/workspace/docs/api/how-tos/best-practices); eliminaciones explicitas y avance de checkpoint en [OneDrive/Graph](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0); consistencia y transacciones en [Sanity](https://www.sanity.io/docs/content-lake/transactions).

El diagnostico de abajo describe el estado anterior en `b50942c`; sus resultados fallidos y numeros de linea son historicos.

---

# Auditoría de sincronización — 11/10/2026

Revisión de `b50942c`. Prioridad: seguridad de datos. Se mantiene la regla acordada: restauración manual permitida; restauración automática bloqueada. No se ha modificado código funcional, schemas ni dependencias.

## Causa raíz y primera divergencia

El control de `_rev` existe, pero varias rutas cambian la BASE antes de comprobar la intención original. `DocumentSync.resolve` lee REMOTE actual y lo utiliza como BASE para escribir el snapshot local completo (`src/services/documentSyncService.ts:256`). `resolveSyncItem` utiliza esa ruta incluso para sincronización inteligente (`src/services/syncEngineService.ts:515`). El CAS protege cambios posteriores a esa lectura; no protege los cambios que acaba de incorporar artificialmente a la BASE.

Cadena reproducida: BASE W → LOCAL renombrado → análisis LOCAL_ONLY → otro dispositivo renombra REMOTE → `resolve` adopta REMOTE como BASE → push LOCAL → desaparece el renombrado remoto. No aparece conflicto.

Otras divergencias: BASE normalizada distinta del documento que proporciona `_rev`; una intención rechazada pasa a ser BASE de la siguiente escritura; operaciones de una sola tarea/documento afectan snapshots de mayor alcance; un conflicto detiene la reconciliación global.

## Fallos reproducidos

Cada prueba comprueba el comportamiento seguro esperado y falla en la versión auditada. Los snapshots mixtos y las carreras se inyectan en servidores simulados; no se ha medido su frecuencia en producción.

| ID | Prioridad | Evento y resultado observado | Evidencia de código | Prueba |
|---|---|---|---|---|
| F01 | P0 | Sincronización inteligente sobrescribe una edición remota posterior al análisis. | `syncEngineService.ts:515`; `documentSyncService.ts:256` | `smart push must preserve...` |
| F02 | P0 | Subir un Markdown sobrescribe el nombre remoto del workspace, fuera del documento seleccionado. | `syncEngineService.ts:639` | `uploading one Markdown file...` |
| F03 | P0 | Workspace actual + tarea antigua: hydration sustituye el título nuevo por el antiguo. Un autosave posterior guarda ese título antiguo usando la revisión actual. | `sanityService.ts:1286`; `sanityService.ts:1184` | `raw workspace revision...` |
| F04 | P0 | Elegir remoto para una tarea elimina la operación pendiente del workspace; la reconciliación posterior falla y la operación ya no está en el journal. El store aún puede conservar parte del texto, pero la operación durable ha desaparecido. | `syncEngineService.ts:566`; `syncEngineService.ts:657` | `failed partial resolution...` |
| F05 | P1 | Un conflicto en el primer documento de la cola impide subir otro documento independiente. App ejecuta esa cola antes de descargar, por lo que también bloquea el pull. | `documentSyncService.ts:585`; `App.tsx:947` | `one offline conflict...` |
| F06 | P1 | Tras rechazar un título local, revertir ese título y cambiar solo el checkbox vuelve a producir conflicto. La BASE elegida es la intención rechazada. | `documentSyncService.ts:359` | `abandoning a rejected title...` |
| F07 | P0 | Sin BASE compartida, el reloj local determina el ganador. La sincronización inteligente sustituye contenido remoto diferente sin una resolución explícita. | `syncEngineService.ts:105`, `:269`, `:393` | `absence of a shared base...` |
| F08 | P1 | Cambiar solo la descripción del repositorio se presenta como SYNCED. La clasificación depende de una lista parcial de campos antes de ejecutar el comparador completo. | `syncEngineService.ts:209` | `changing only workspace metadata...` |
| F09 | P1 | Borrar un Markdown solo en remoto informa éxito, pero vuelve a escribir las ramas locales con el documento incluido. | `syncEngineService.ts:937` | `remote-only Markdown deletion...` |
| F10 | P0 | Borrar un Markdown en ambos lados sobrescribe un renombrado remoto concurrente del workspace. | `syncEngineService.ts:941` | `deletion of one Markdown file...` |
| F11 | P1 | Un documento PRESENTE en una query antigua puede sustituir una revisión ya confirmada. La lectura directa solo verifica ausencias. | `documentSyncService.ts:234`, `:250` | `stale present snapshot...` |
| F12 | P0 | Una eliminación de tarea con store de A y configuración vigente de B puede eliminar el documento de B con el mismo ID. El owner remoto es válido para B; falta validar el scope de la intención de A en esa rama. | `syncEngineService.ts:827`; `SyncOverrideModal.tsx:155` | `old account task deletion...` |
| F13 | P0 | Borrar un workspace descarga y observa una revisión nueva antes de borrarlo; pierde la revisión que seleccionó el usuario. Se elimina una edición remota realizada durante la espera. | `sanityService.ts:1346`; `sanityService.ts:968` | `workspace deletion must retain...` |
| F14 | P0 | «Eliminar solo local» modifica Markdown; el autosave interpreta esa modificación como borrado remoto y escribe tombstone. El alcance seleccionado no se conserva. | `syncEngineService.ts:835`; `App.tsx:3703`; `documentSyncService.ts:526` | `deleting only locally...` |
| F15 | P0 | `pagehide` antes del debounce: el último contenido del editor no aparece en almacenamiento durable. Reproducido en Edge y Chrome. | `App.tsx:1440`, `:1479` | `sync.audit.browser.mjs:137` |

Rutas relacionadas de F01/F02/F10 comparten una causa, pero las pruebas cubren acciones distintas. F12 exige colisión de ID en el destino de B; no implica que todas las operaciones normales entre cuentas estén contaminadas.

## Defectos adicionales confirmados por lectura

| Prioridad | Defecto | Evidencia | Consecuencia |
|---|---|---|---|
| P0 | La eliminación individual y masiva de tareas recorre todos los workspaces, ramas y documentos sin filtrar el contexto seleccionado. | `SyncOverrideModal.tsx:376`, `:534` | Un ID repetido en otra rama/documento también se elimina. Autosave puede propagarlo. |
| P0 | Deshacer un borrado repone el store completo anterior. | `SyncOverrideModal.tsx:264`, `:295` | Desaparecen cambios locales realizados después del borrado en otros elementos. |
| P1 | Borrado individual remoto utiliza `deletionConfig` antes de declararlo. | `SyncOverrideModal.tsx:566`, `:582` | La acción falla antes de llegar al borrado protegido. También detectado por TypeScript. |
| P1 | El botón de análisis entrega su evento a un parámetro que espera un store. | `SyncOverrideModal.tsx:1742`; `:179` | Reanalizar manualmente puede ejecutar el analizador con un objeto incorrecto. También detectado por TypeScript. |
| P1 | Estado global «synced» después de pull o guardado visual no comprueba todas las diferencias pendientes. | `App.tsx:998`, `:1396` | El indicador puede anunciar sincronización completa con cambios locales aún sin confirmar. |

PROBABLE, sin reproducción aislada: la navegación preservada localmente sigue formando parte del workspace comparable y persistido. Dispositivos en ramas/documentos distintos pueden mantener escrituras recurrentes de selección (`App.tsx:971`, `:3710`). No se atribuye a esto el fallo intermitente de concurrencia observado en navegador.

## Contraste con aplicaciones de referencia

- **Google Docs:** su API distingue una revisión requerida de una revisión objetivo contra la que el servidor incorpora cambios de colaboradores. Leer una revisión nueva no convierte automáticamente el snapshot viejo en una intención segura. [WriteControl](https://developers.google.com/workspace/docs/api/how-tos/best-practices).
- **Google Docs offline:** el guardado local precede al envío cuando vuelve la conexión. Aquí el último texto puede seguir únicamente en memoria durante el debounce. [Guardado de documentos](https://support.google.com/docs/answer/49114?hl=en).
- **OneDrive:** la documentación de conflictos para archivos no Office describe conservar ambas versiones. Esto sirve como criterio de preservación; no demuestra cómo funciona internamente cada cliente actual. [Resolución de conflictos](https://learn.microsoft.com/en-us/troubleshoot/sharepoint/sync/troubleshoot-sync-issues).
- **OneDrive/Graph:** delta representa eliminaciones explícitas y entrega un checkpoint para recuperar cambios posteriores; la resincronización distingue cambios locales desconocidos por el servidor. [driveItem delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0).
- **Sanity:** las queries son eventualmente consistentes. Una query presente tampoco garantiza una revisión actual. El bloqueo optimista protege la revisión que se presenta, no la procedencia del contenido asociado. [Transacciones](https://www.sanity.io/docs/content-lake/transactions).

Estos criterios no requieren sustituir el motor por CRDT ni copiar una arquitectura no documentada. Requieren preservar intención, revisión, contexto y confirmación de cada operación.

## Corrección mínima, por orden

1. Validar sesión/scope en TODAS las ramas de resolución y borrado, incluida la limpieza de operaciones pendientes al desmontar.
2. Mantener la BASE original en sync automático y borrados. Reservar overwrite explícito al alcance que seleccionó el usuario; revalidar si REMOTE cambió después de la vista de resolución.
3. Resolver por tarea/documento sin sustituir otros campos del workspace; deshacer solo el elemento afectado. Conservar el alcance local/remoto/both hasta autosave y reconciliación.
4. Asegurar coherencia entre contenido hidratado y documentos/revisiones utilizados como BASE. Verificar registros presentes que puedan estar atrasados antes de avanzar checkpoints.
5. Preparar y comprobar la reconciliación antes de eliminar pendientes. No utilizar propuestas rechazadas como BASE; continuar otros documentos cuando uno está en conflicto.
6. Persistir el editor vivo al salir o cambiar de documento. Aplazar solo las escrituras remotas, no la única copia durable.
7. Sin BASE: preservar ambas versiones y pedir decisión explícita. Clasificar todos los campos sincronizados; publicar «synced» solo tras confirmación y ausencia de cambios pendientes.
8. Corregir las dos rutas de UI detectadas por TypeScript y verificar navegación independiente entre dispositivos.

## Validación y límites

- `npx tsx --test tests/sync.test.ts`: **74/74 pasan**.
- `npx tsx --test tests/sync.audit.test.ts`: **14/14 fallan**, reproduciendo F01–F14 con aserciones de seguridad.
- `node tests/sync.audit.browser.mjs`: **falla**; persistencia inmediata en `pagehide`: `[false, false]` en Edge/Chrome, frente a `[true, true]` esperado.
- Suite de navegador original: una ejecución falla en «Concurrent title edits did not converge»; una ejecución posterior pasa. **Intermitente; causa concreta no aislada.**
- Build: pasa. Typecheck: falla en errores de los modales, incluidos `deletionConfig` y el handler de análisis. Lint ejecuta el mismo `tsc --noEmit`.
- Pruebas de auditoría separadas de los scripts habituales. Usan fixtures/servidores simulados; no escriben en el dataset real. La prueba de navegador requiere build y Edge/Chrome en Windows; ejecutar las suites de navegador por separado porque comparten puertos.
- No se han probado caídas reales del servidor, suspensión prolongada de dispositivos ni rendimiento con datasets grandes. No se han considerado resueltos por la revisión.

**Veredicto: RIESGO DE PÉRDIDA DE DATOS. Causas raíz confirmadas.** El paso previo de 74 pruebas demuestra sus casos concretos; no justifica declarar segura toda la sincronización.
