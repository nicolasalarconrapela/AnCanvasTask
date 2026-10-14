

### 2. Lista de Defectos, Fallos y Mejoras detectadas durante la revisión en navegador

Durante la prueba y auditoría visual en el navegador con la aplicación en vivo (`http://localhost:3000/`), se identificaron las siguientes oportunidades de mejora y detalles de UI/UX:

| # | Área / Componente | Tipo | Descripción |
|---|---|---|---|
| **1** | **Barra de inserción rápida en editor Markdown** | *UX / Responsive* | Al ajustar el panel dividido del editor (*split view*) a un ancho estrecho (30%-35%), la barra secundaria de snippets (`+ Tarea`, `+ Sección`, `Revisar`) genera un ligero scroll horizontal en lugar de compactarse en iconos con tooltip o menú desplegable. |
| **2** | **Cola de notificaciones Toast** | *UX / Visual* | Al encadenar acciones rápidas (por ejemplo: Guardar → Normalizar → Sanitizar orden), las notificaciones se apilan en la esquina inferior derecha sin límite visual superior, lo que puede tapar controles inferiores en pantallas compactas si no se descartan manualmente. Se recomienda un límite de 3 visibles simultáneas. |
| **3** | **Selección con arrastre en el editor CodeMirror** | *Comportamiento* | Al iniciar una selección de texto arrastrando el ratón muy cerca del margen de números de línea (*gutter*), en ocasiones el foco de selección del navegador captura el borde exterior del contenedor antes de centrarse en las líneas de texto. |
| **4** | **Debounce en indicador de problemas (*Issues Badge*)** | *Fluidez* | Al editar manualmente metadatos en Markdown, el contador de problemas parpadea brevemente mientras se completa la sintaxis de las líneas antes del debounce de sincronización con el Canvas. Un retraso mínimo de 250ms antes de marcar estado de error evitaría ese parpadeo transitorio. |