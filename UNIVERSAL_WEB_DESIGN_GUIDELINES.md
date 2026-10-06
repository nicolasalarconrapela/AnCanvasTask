# UNIVERSAL\_WEB\_DESIGN\_GUIDELINES.md

> Guía universal de diseño, UX e implementación para aplicaciones web profesionales.
>
> Diseñada para humanos y agentes de IA (Codex, Claude, Gemini, Cursor, etc.).
>
> Objetivo: producir interfaces \*\*sobrias, profesionales, legibles, eficientes, accesibles, rápidas y consistentes\*\*, evitando la estética genérica de aplicaciones generadas por IA, la creación innecesaria de componentes y la sobreinformación visual.

\---

# 1\. Principio rector

La interfaz debe parecer un **producto profesional diseñado para trabajar durante horas**, no una landing page, una demo de IA, una startup promocional o una plantilla visual.

Prioridad:

1. Claridad
2. Legibilidad
3. Jerarquía
4. Densidad adecuada
5. Consistencia
6. Accesibilidad
7. Rendimiento
8. Personalidad visual controlada

La decoración nunca debe competir con el contenido.

\---

# 2\. Estética visual por defecto

Cuando no exista un diseño específico proporcionado por el proyecto, usar una estética:

* profesional;
* sobria;
* limpia;
* madura;
* funcional;
* orientada a trabajo prolongado;
* adecuada para aplicaciones de productividad;
* usable en sesiones largas;
* compatible con tema claro y oscuro;
* con contraste suficiente;
* con color reservado para significado y jerarquía.

La interfaz debe poder encajar en:

* herramientas internas;
* dashboards;
* software empresarial;
* editores;
* gestores;
* aplicaciones técnicas;
* sistemas administrativos;
* productos SaaS;
* aplicaciones educativas;
* herramientas de análisis;
* aplicaciones de escritorio web;
* software profesional.

No asumir una estética “startup” salvo petición expresa.

\---

# 3\. Prohibiciones visuales por defecto

No introducir automáticamente:

* glassmorphism;
* neomorphism;
* gradients llamativos;
* fondos aurora;
* blobs decorativos;
* glow excesivo;
* neón;
* paletas excesivamente vibrantes;
* tarjetas flotantes sin función;
* cards dentro de cards;
* bordes redondeados exagerados;
* sombras profundas;
* fondos con ruido decorativo;
* animaciones ornamentales;
* iconos gigantes;
* hero sections enormes;
* slogans de marketing;
* ilustraciones decorativas de startup;
* mockups flotantes;
* badges promocionales;
* efectos “AI”;
* estética cyberpunk;
* estética cripto;
* estética gamer;
* interfaces que parezcan una landing page cuando son una herramienta;
* dashboards construidos exclusivamente mediante mosaicos de cards.

Estas técnicas solo pueden utilizarse si:

1. el usuario las solicita;
2. ya forman parte del lenguaje visual existente;
3. existe una razón funcional clara.

\---

# 4\. Regla anti-“AI generated UI”

La ausencia de una especificación visual **NO autoriza al agente a inventar una estética decorativa**.

Cuando falte dirección visual:

```text
preferir:
sobrio → estructurado → funcional → legible

antes que:
llamativo → futurista → decorativo → promocional
```

No añadir elementos visuales únicamente para que la interfaz “parezca más diseñada”.

Cada elemento visible debe cumplir al menos una función:

* informar;
* agrupar;
* jerarquizar;
* permitir una acción;
* mostrar estado;
* facilitar orientación.

\---

# 5\. Economía visual e informativa

La interfaz debe comunicar la **máxima información útil con el mínimo número de elementos visuales necesarios**.

No crear un componente visual cuando texto, alineación, espaciado, tipografía o un indicador simple puedan resolver correctamente la misma función.

Antes de añadir cualquier elemento visible, comprobar:

1. ¿El usuario necesita conocer esta información en este momento?
2. ¿Esta información ya aparece en otra parte de la interfaz?
3. ¿Necesita realmente un componente propio?
4. ¿Puede mostrarse como texto simple o indicador inline?
5. ¿Necesita icono?
6. ¿Necesita color?
7. ¿Necesita fondo de color?
8. ¿Necesita borde?
9. ¿Necesita permanecer visible constantemente?
10. ¿Su importancia visual corresponde con su importancia funcional?

Si varias respuestas son negativas, simplificar o eliminar el elemento.

Regla de preferencia:

```text
menos componente               → antes que más componente
texto simple                   → antes que badge o chip
inline                         → antes que bloque independiente
neutral                        → antes que coloreado
una señal semántica            → antes que varias simultáneas
información bajo demanda       → antes que información permanente
reutilizar                     → antes que crear un componente nuevo
```

No diseñar algo únicamente porque exista espacio disponible o porque el dato esté disponible.

La ausencia de un elemento visual también es una decisión de diseño válida.

\---

# 6\. Estados e indicadores

Los estados normales y rutinarios deben tener **baja prominencia visual**.

Ejemplos habituales:

* Sincronizado;
* Conectado;
* Guardado;
* Actualizado;
* Disponible;
* Listo;
* Correcto;
* Sin cambios.

Estos estados no deben convertirse automáticamente en:

* badges coloreados;
* pills;
* botones;
* tarjetas;
* bloques con fondo;
* banners permanentes;
* icono + texto + fondo + borde + color semántico simultáneamente;
* elementos de gran contraste.

Preferir, según importancia:

```text
Sincronizado
```

o:

```text
● Sincronizado
```

o un icono discreto con tooltip cuando el texto permanente no sea necesario.

El color semántico puede reforzar el estado, pero no debe convertir un estado correcto y rutinario en uno de los elementos más visibles de la pantalla.

Reservar mayor prominencia visual principalmente para estados que requieren atención o una decisión:

* error;
* advertencia;
* bloqueo;
* conflicto;
* pérdida de conexión relevante;
* operación crítica;
* acción necesaria.

Jerarquía recomendada:

```text
estado normal        → texto o indicador inline discreto
estado en progreso   → indicador simple + progreso si aporta información
advertencia          → énfasis moderado
error accionable     → énfasis claro
bloqueo / crítico    → alta prominencia justificada
```

Un estado correcto no debe competir visualmente con las acciones, los datos o los problemas que requieren atención.

No convertir un estado en botón salvo que exista una acción real asociada.

\---

# 7\. No duplicar información ni señales

Una misma información no debe mostrarse simultáneamente mediante varios elementos salvo que exista una razón funcional, de contexto o de accesibilidad.

Evitar combinaciones como:

```text
icono + label + badge + fondo + borde + color + descripción
```

cuando:

```text
label
```

o:

```text
icono + label
```

comunican suficientemente el estado.

No repetir información existente en:

* encabezado y card;
* toolbar y banner;
* sidebar y contenido;
* badge y label;
* icono y texto cuando ambos expresan exactamente lo mismo;
* tooltip y texto permanente;
* título y subtítulo con el mismo significado;
* estado global y estado repetido en cada elemento sin necesidad.

Cada repetición debe aportar contexto nuevo.

El refuerzo multimodal es válido cuando mejora accesibilidad o reduce ambigüedad, pero debe ser proporcional. Por defecto, una señal principal y, cuando sea útil, una señal secundaria son suficientes.

\---

# 8\. Divulgación progresiva y control de sobreinformación

No toda la información disponible debe estar visible permanentemente.

Clasificar la información en:

```text
Primaria
    Necesaria para comprender o realizar la tarea actual.

Secundaria
    Útil, pero no imprescindible constantemente.

Técnica
    Diagnóstico, identificadores, rutas completas, timestamps detallados,
    métricas internas, metadatos, logs y datos de implementación.
```

Por defecto:

* mostrar la información primaria;
* mantener la secundaria discreta;
* mostrar información técnica bajo demanda mediante detalles, inspector, tooltip, menú, expansión, panel lateral o vista especializada;
* evitar presentar simultáneamente información que pertenece a distintos niveles de detalle cuando no sea necesaria para la tarea.

No mostrar información simplemente porque esté disponible.

No añadir textos explicativos de conceptos obvios para el usuario objetivo.

No añadir subtítulos, ayudas, leyendas o mensajes permanentes si el control se entiende correctamente sin ellos.

Cuando exista mucha información, priorizar:

```text
resumen → detalle bajo demanda
```

antes que:

```text
todo visible al mismo tiempo
```

La interfaz debe permitir profundizar sin obligar a procesar detalles innecesarios constantemente.

\---

# 9\. Jerarquía de decisiones de diseño

Ante cualquier decisión visual, seguir este orden:

1. Diseño existente del proyecto.
2. Capturas, Figma o mockups proporcionados.
3. Componentes existentes.
4. Tokens y estilos existentes.
5. Este documento.
6. Convenciones de la plataforma.
7. Solución visual neutra y funcional.

Nunca usar como referencia implícita:

* diseños populares de Dribbble;
* estética “AI SaaS”;
* tendencias decorativas;
* plantillas de landing pages;
* componentes visualmente llamativos sin necesidad.

\---

# 10\. Tema claro y oscuro

Toda interfaz debe diseñarse considerando ambos temas desde el principio cuando el producto los soporte.

## Tema claro

Debe evitar:

* blanco puro en grandes superficies si genera fatiga;
* contraste excesivamente duro;
* sombras innecesarias;
* demasiadas superficies diferenciadas.

Preferir:

* fondos neutros;
* superficies ligeramente diferenciadas;
* bordes sutiles;
* texto principal oscuro, no necesariamente negro absoluto.

## Tema oscuro

Debe evitar:

* negro absoluto como fondo general salvo necesidad;
* blanco puro para todo el texto;
* saturación elevada;
* contrastes agresivos;
* glow.

Preferir:

* fondos gris oscuro o casi negros;
* superficies diferenciadas mediante luminosidad;
* texto principal claro pero no blanco puro;
* colores de estado moderados;
* bordes suaves y visibles.

## Reglas

* Nunca invertir colores de forma mecánica.
* Revisar contraste en ambos temas.
* Los estados semánticos deben funcionar en ambos.
* Evitar colores que solo sean legibles en uno de los temas.
* Los componentes deben conservar jerarquía visual en ambos modos.

\---

# 11\. Sistema de color

El color debe ser **funcional antes que decorativo**.

Usar:

* neutrales para estructura;
* un color de acento principal;
* colores semánticos para estados.

Estados habituales:

* información;
* éxito;
* advertencia;
* error;
* selección;
* foco.

Evitar usar muchos colores simultáneamente.

Si un elemento puede entenderse perfectamente sin color, el color debe actuar como refuerzo, no como única señal.

\---

# 12\. Tipografía

La tipografía debe favorecer sesiones de lectura prolongadas.

Preferir tipografías:

* sans-serif;
* profesionales;
* neutras;
* altamente legibles;
* con buena diferenciación entre caracteres;
* adecuadas para UI;
* con pesos suficientes sin depender de demasiadas variantes.

Familias adecuadas:

* Inter;
* Roboto;
* IBM Plex Sans;
* Source Sans 3;
* Segoe UI;
* system-ui.

No introducir tipografías decorativas como fuente principal de interfaz.

\---

# 13\. CamelCase y nombres

Para nombres de entidades, módulos, recursos técnicos o elementos identificables, se puede utilizar CamelCase cuando forme parte del lenguaje del producto:

```text
ProjectManager
FileExplorer
ConflictResolver
PhotoSession
UserSettings
```

No convertir frases normales de UI a CamelCase.

Correcto:

```text
ConflictResolver
Archivos procesados
Última actualización
```

Incorrecto:

```text
ArchivosProcesados
UltimaActualizacion
GuardarCambiosAhora
```

CamelCase es apropiado para nombres técnicos, módulos, herramientas, productos, entidades o identificadores visibles cuando forman parte de la identidad. El texto normal de interfaz debe seguir lenguaje natural.

\---

# 14\. Escala tipográfica

Mantener una jerarquía contenida.

```text
12–13 px   metadata / captions
14 px      UI secundaria
15–16 px   texto principal
18–20 px   subtítulos
22–28 px   títulos de sección
28–36 px   títulos principales
```

Evitar titulares gigantes en aplicaciones internas, escalas tipo landing page, diferencias extremas de tamaño y texto excesivamente pequeño.

Para aplicaciones densas, priorizar **14–16 px** como rango principal.

\---

# 15\. Densidad

Una aplicación profesional no debe desperdiciar espacio.

Evitar interfaces donde:

* cada dato tenga su propia card;
* haya márgenes enormes;
* la información útil quede dispersa;
* haya mucho scroll por decisiones decorativas;
* la densidad sea artificialmente baja.

Orientación:

```text
Aplicación productiva / técnica  → media-alta / alta
Administración / gestión         → media
Aplicación de lectura            → media-baja
Marketing                        → fuera del alcance por defecto
```

\---

# 16\. Spacing

Usar una escala consistente:

```text
4
8
12
16
24
32
48
```

Evitar valores arbitrarios salvo necesidad real.

Los espacios pequeños deben crear relaciones. Los grandes deben separar contextos. No usar whitespace como decoración excesiva.

\---

# 17\. Bordes y radios

Los radios deben ser moderados.

```text
4–6 px   controles compactos
6–8 px   componentes
8–12 px  superficies principales
```

Evitar por defecto radios de 20, 24, 32 o 9999 px, excepto elementos naturalmente píldora como tags, chips, badges o toggles.

No redondear todos los elementos porque sí.

\---

# 18\. Sombras

Preferir:

```text
border + diferencia de superficie
```

antes que sombras.

Usar sombra solo cuando comunique elevación, overlay, menú flotante, modal, drag o separación temporal.

Evitar sombras decorativas permanentes en cada componente.

\---

# 19\. Cards

No convertir cada grupo de información en una card.

Una card debe existir porque representa:

* una entidad;
* una unidad independiente;
* un elemento seleccionable;
* un bloque con acciones propias;
* un elemento que puede reordenarse;
* una unidad visual claramente separable.

No usar card para cada métrica, label, grupo de texto o sección que podría ser simplemente un encabezado + contenido.

Preferir estructuras simples y planas cuando comuniquen mejor.

\---

# 20\. Layout

Preferir estructuras claras:

```text
Header
Sidebar
Main
Inspector
Footer / Status
```

O:

```text
Toolbar
Content
Details
```

La navegación debe permanecer estable. No mover controles principales según contenido salvo necesidad.

Priorizar alineación, ritmo, columnas, jerarquía y agrupación semántica.

\---

# 21\. Tablas y datos densos

Para aplicaciones profesionales con mucha información:

* usar tablas cuando los datos sean comparables;
* permitir orden;
* filtros;
* selección;
* columnas claras;
* densidad ajustable cuando tenga sentido;
* encabezados persistentes en tablas largas;
* truncado con acceso al contenido completo;
* jerarquía visual sutil.

No reemplazar automáticamente tablas por grids de cards.

\---

# 22\. Toolbars

Las acciones principales deben estar agrupadas de forma estable.

Una toolbar profesional debe:

* tener pocas acciones principales visibles;
* agrupar acciones secundarias;
* evitar iconos sin significado evidente;
* usar tooltip cuando el icono no sea universal;
* mantener orden consistente.

No usar botones enormes para acciones frecuentes.

\---

# 23\. Botones

Jerarquía recomendada:

```text
Primary
Secondary
Tertiary / Ghost
Destructive
```

No convertir todas las acciones en primary.

En una misma zona, normalmente debe existir **un único primary action dominante**.

Evitar botones gigantes, gradientes, glow, animaciones llamativas y pills enormes sin razón.

\---

# 24\. Iconografía

Preferir una única familia de iconos.

Debe mantener:

* trazo consistente;
* tamaño consistente;
* estilo sobrio;
* significado reconocible.

No mezclar filled, outline, 3D, emoji e ilustraciones sin sistema.

\---

# 25\. Animaciones

Las animaciones deben explicar cambios de estado, mantener contexto o mejorar continuidad.

```text
100–150 ms   microinteracción
150–250 ms   transición estándar
200–300 ms   overlays / paneles
```

Evitar por defecto bounce, springs exagerados, zoom dramático, glow animado, fondos en movimiento, particles, parallax, animaciones constantes y transiciones largas.

Respetar `prefers-reduced-motion`.

\---

# 26\. Marketing vs aplicación

Una aplicación no debe comportarse visualmente como una landing page.

Dentro del producto evitar:

* slogans;
* hero sections;
* claims;
* banners promocionales;
* copy aspiracional;
* CTAs gigantes;
* elementos puramente comerciales.

El producto debe mostrar función, estado, contexto, acción y datos.

\---

# 27\. Formularios

Los formularios deben ser predecibles.

Preferir:

```text
Label
\[ Input                       ]
Texto de ayuda
```

No depender del placeholder como label.

Mostrar validación, error, ayuda, disabled y loading cuando corresponda.

\---

# 28\. Feedback

Cada acción debe producir feedback proporcional.

* Inmediato → cambiar estado visible.
* Operación lenta → mostrar progreso o loading.
* Acción completada → confirmar solo cuando aporte valor.
* Error → explicar qué ocurrió, qué impacto tiene y qué puede hacerse.

No abusar de toast notifications. Si un cambio puede representarse directamente en la UI, preferir eso.

No confirmar de forma llamativa acciones rutinarias cuyo resultado ya sea evidente. Evitar acumular simultáneamente toast + badge + cambio de color + mensaje persistente para comunicar un único éxito.

\---

# 29\. Estados vacíos

Los empty states deben ser útiles, no promocionales.

Correcto:

```text
No hay archivos.

Arrastra archivos aquí o utiliza “Añadir archivos”.
```

Evitar:

```text
✨ Empieza tu increíble viaje
Transforma tu productividad con IA
```

\---

# 30\. Accesibilidad

Toda UI debe:

* usar HTML semántico;
* soportar teclado;
* mantener foco visible;
* tener labels;
* mantener contraste;
* no depender únicamente de color;
* respetar preferencias del usuario;
* evitar trampas de foco.

ARIA debe complementar HTML, no sustituirlo innecesariamente.

\---

# 31\. Responsive

Diseñar por espacio disponible, no por dispositivos concretos.

Preferir Grid, Flexbox, container queries y media queries justificadas.

No asumir:

```text
desktop = mouse
mobile = touch
```

Una aplicación de escritorio debe degradar su layout de forma coherente en ventanas pequeñas.

\---

# 32\. Rendimiento visual

No añadir efectos visuales que introduzcan coste importante sin beneficio.

Evitar:

* blur masivo;
* filtros CSS caros;
* fondos animados;
* múltiples sombras;
* listeners por elemento innecesarios;
* animaciones continuas;
* render masivo de componentes invisibles.

La UI debe sentirse inmediata.

\---

# 33\. Estados de aplicación

Toda pantalla relevante debe contemplar:

* loading;
* empty;
* error;
* partial;
* disabled;
* offline cuando aplique;
* permisos insuficientes;
* operación en progreso;
* éxito;
* selección;
* datos obsoletos cuando corresponda.

No diseñar únicamente el happy path.

\---

# 34\. Design tokens universales

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  --font-ui: Inter, Roboto, "Segoe UI", system-ui, sans-serif;

  --font-xs: 12px;
  --font-sm: 13px;
  --font-md: 14px;
  --font-lg: 16px;
  --font-xl: 20px;
  --font-title: 24px;
}
```

El proyecto puede modificar valores, pero debe mantener coherencia.

\---

# 35\. Tema base conceptual

## Light

```text
Background     neutral very light
Surface        subtle contrast from background
Border         visible but quiet
Text primary   dark neutral
Text secondary medium neutral
Accent         restrained brand/action color
```

## Dark

```text
Background     near-black neutral
Surface        slightly lighter neutral
Border         low-contrast visible neutral
Text primary   soft white
Text secondary muted gray
Accent         restrained, slightly desaturated
```

Evitar colores RGB intensos en superficies grandes.

\---

# 36\. Componentes reutilizables

Crear componentes para comportamiento repetible, no únicamente por encapsular HTML.

Un componente debe tener responsabilidad clara, API clara, estados claros, comportamiento accesible, responsive y estilo consistente.

No crear abstracciones excesivas antes de que exista repetición real.

Tampoco crear un componente nuevo únicamente para envolver texto, aplicar un fondo, añadir un icono o representar un estado que ya puede integrarse de forma clara en un componente existente.

\---

# 37\. Regla native-first

Antes de añadir JavaScript o una dependencia, comprobar:

1. ¿HTML puede resolverlo?
2. ¿CSS puede resolverlo?
3. ¿Existe una Web API estándar?
4. ¿Existe ya una utilidad interna?

Después considerar una dependencia.

\---

# 38\. Baseline y compatibilidad

Para funcionalidad crítica:

* preferir Web Platform Baseline Widely Available.

Para mejoras:

* se puede usar Baseline Newly Available con fallback cuando resulte necesario.

No introducir APIs experimentales como dependencia esencial sin justificación.

\---

# 39\. Core Web Vitals

Objetivos recomendados:

```text
LCP <= 2.5 s
INP <= 200 ms
CLS <= 0.1
```

La estética nunca debe comprometer significativamente estas métricas.

\---

# 40\. Seguridad visual y funcional

Nunca:

* exponer secretos;
* confiar en validación cliente;
* renderizar HTML no confiable sin tratamiento;
* mostrar información sensible innecesaria;
* ocultar controles de seguridad mediante CSS;
* depender de elementos invisibles para autorización.

\---

# 41\. Reglas específicas para agentes de IA

Todo agente que modifique frontend debe seguir estas reglas.

## Antes de modificar

* leer componentes existentes;
* identificar patrones;
* identificar tokens;
* revisar layout;
* buscar reutilización;
* respetar estilo actual.

## Durante el cambio

* realizar el cambio mínimo coherente;
* no rediseñar áreas no solicitadas;
* no introducir estética propia;
* no añadir gradientes decorativos;
* no añadir glassmorphism;
* no añadir glow;
* no convertir contenido en cards automáticamente;
* no incrementar radios sin motivo;
* no añadir animaciones decorativas;
* no introducir librerías UI sin autorización;
* no cambiar tipografía global salvo petición;
* no convertir una aplicación en una landing page;
* buscar primero si la información puede incorporarse a un componente existente;
* preferir modificar o reutilizar antes que crear un componente nuevo;
* no crear badges, chips, cards, banners, callouts o indicadores de estado automáticamente;
* no envolver texto en un contenedor únicamente para estilizarlo;
* no añadir iconos cuando el texto ya comunica claramente la función;
* no añadir texto explicativo obvio;
* no mostrar estados positivos rutinarios con alta prominencia;
* no duplicar una misma información mediante varias señales visuales;
* no mostrar información técnica de forma permanente sin necesidad;
* eliminar ruido y redundancia antes de añadir nueva información.

## Antes de crear un componente nuevo

El agente debe comprobar internamente:

1. ¿Ya existe un componente que pueda asumir esta función?
2. ¿Puede resolverse mediante texto, layout o estilo dentro de una estructura existente?
3. ¿El componente representa una entidad, acción, estado o agrupación realmente independiente?
4. ¿Seguiría siendo necesario si se eliminaran fondo, borde, icono y color?
5. ¿Añade comprensión o solo decoración?

Si no existe una justificación funcional clara, no crear el componente.

\---

# 42\. Preguntas obligatorias del agente al diseñar

Antes de crear UI, el agente debe responder internamente:

1. ¿Cuál es la función principal?
2. ¿Cuál es la información más importante?
3. ¿Qué acciones son realmente primarias?
4. ¿Qué puede eliminarse?
5. ¿La jerarquía se entiende sin color?
6. ¿Necesito realmente una card?
7. ¿Necesito realmente una sombra?
8. ¿Necesito realmente una animación?
9. ¿Necesito realmente JavaScript?
10. ¿Funcionará durante horas de uso?
11. ¿Funcionará en claro y oscuro?
12. ¿Funciona con teclado?
13. ¿Qué ocurre si los datos son largos?
14. ¿Qué ocurre sin datos?
15. ¿Qué ocurre si falla?
16. ¿Estoy creando un componente que podría evitarse?
17. ¿Esta información ya existe en otra parte?
18. ¿Estoy mostrando un estado rutinario con demasiada prominencia?
19. ¿Estoy usando más señales visuales de las necesarias para comunicar una sola cosa?
20. ¿Puede parte de esta información mostrarse bajo demanda?
21. ¿Estoy añadiendo algo porque es útil o simplemente porque puedo mostrarlo?

\---

# 43\. Definición de “profesional”

En este documento “profesional” significa:

* estable;
* predecible;
* legible;
* discreto;
* coherente;
* eficiente;
* con buena densidad;
* sin ruido decorativo;
* sin apariencia promocional;
* sin tendencia visual dominante;
* adecuado para trabajar durante largos periodos.

No significa aburrido, anticuado o sin personalidad.

La personalidad debe aparecer mediante tipografía, ritmo, acento, iconografía, microdetalles y estructura; no mediante decoración excesiva.

Regla resumida:

> **No diseñar lo que no necesita ser diseñado. No mostrar lo que no necesita estar visible.**

\---

# 44\. Ejemplo de transformación

## Evitar

```text
🌈 Gradient background

      Transform your workflow
   with the power of intelligent AI

┌──────────────┐   ┌──────────────┐
│    12.4K     │   │      87%     │
│   Amazing!   │   │   Growth     │
└──────────────┘   └──────────────┘

        \[ Get Started ✨ ]
```

## Preferir

```text
Projects

12 active      4 pending      86 completed

────────────────────────────────────

Recent activity

Project            Status        Updated
Apollo             Active        10:42
Atlas              Pending       Yesterday
Orion              Completed     27 Sep
```

La segunda interfaz comunica más con menos elementos.

\---

# 45\. Checklist visual

Antes de considerar terminada una pantalla:

* \[ ] No parece una landing page.
* \[ ] No utiliza estética “AI startup” por defecto.
* \[ ] No hay gradients decorativos innecesarios.
* \[ ] No hay glassmorphism.
* \[ ] No hay neomorphism.
* \[ ] No hay glow innecesario.
* \[ ] No hay animaciones ornamentales.
* \[ ] No existen cards innecesarias.
* \[ ] La densidad es adecuada.
* \[ ] La jerarquía se entiende rápidamente.
* \[ ] La tipografía es legible durante uso prolongado.
* \[ ] El color tiene función.
* \[ ] Los radios son moderados.
* \[ ] Las sombras tienen propósito.
* \[ ] Tema claro correcto.
* \[ ] Tema oscuro correcto.
* \[ ] Teclado correcto.
* \[ ] Foco visible.
* \[ ] Responsive correcto.
* \[ ] Estados de error/loading/empty considerados.
* \[ ] La pantalla funciona con contenido largo.
* \[ ] No se añadieron dependencias innecesarias.
* \[ ] Cada elemento visible aporta información o acción necesaria.
* \[ ] No hay información duplicada sin una razón clara.
* \[ ] Los estados normales tienen baja prominencia.
* \[ ] No existen badges, chips, banners o indicadores innecesarios.
* \[ ] No se ha creado un componente cuando bastaba texto o contenido inline.
* \[ ] Los iconos aportan significado y no decoración.
* \[ ] No se muestra información técnica permanentemente sin necesidad.
* \[ ] La cantidad de señales visuales corresponde con la importancia real.
* \[ ] No se ha añadido información simplemente porque estaba disponible.
* \[ ] La pantalla puede entenderse sin ruido visual innecesario.

\---

# 46\. Política por defecto

Si no hay especificaciones adicionales:

```text
Estética:       profesional / sobria / funcional
Tema:           light + dark
Tipografía:     sans-serif de UI de alta legibilidad
Color:          neutros + un acento moderado
Densidad:       media / media-alta
Radios:         4–8 px
Sombras:        mínimas
Animación:      100–250 ms, solo funcional
Cards:          solo cuando exista entidad o agrupación real
Estados OK:     discretos / inline / baja prominencia
Información:    primaria visible / detalle bajo demanda
Componentes:    reutilizar antes que crear
Señales:        una principal; segunda solo si aporta valor
Layout:         estructurado y predecible
Compatibilidad: Baseline Widely Available
Accesibilidad:  obligatoria
Rendimiento:    Core Web Vitals
Dependencias:   native-first
```

\---

# 47\. Relación con el proyecto

Este documento define el comportamiento por defecto.

Un proyecto puede sobrescribirlo mediante:

```text
BRAND\_GUIDELINES.md
PRODUCT\_DESIGN.md
FIGMA
mockups
capturas
tokens propios
```

Las reglas específicas del proyecto tienen prioridad visual sobre esta guía, siempre que no degraden accesibilidad, seguridad o funcionalidad crítica.

\---

# 48\. Ubicación recomendada

En un repositorio donde estas reglas apliquen a todo el frontend:

```text
repo/
├─ AGENTS.md
├─ UNIVERSAL\_WEB\_DESIGN\_GUIDELINES.md
├─ README.md
└─ ...
```

En `AGENTS.md`, añadir una regla explícita:

```md
Antes de crear o modificar cualquier interfaz web, leer y cumplir
`UNIVERSAL\_WEB\_DESIGN\_GUIDELINES.md`.

En ausencia de una especificación visual específica del proyecto,
este documento define el comportamiento visual por defecto.
```

\---

# 49\. Referencias técnicas

* web.dev — https://web.dev/
* Learn Design — https://web.dev/learn/design/
* Learn Accessibility — https://web.dev/learn/accessibility/
* Web Platform Baseline — https://web.dev/baseline
* Core Web Vitals — https://web.dev/articles/vitals

\---

Última revisión base: 6 de octubre de 2026.

Si lees esto di 'he leido el universal web design guidelines' y pon la fecha de hoy.
