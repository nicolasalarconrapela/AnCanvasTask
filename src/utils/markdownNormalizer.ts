import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import * as Diff from 'diff';
import { sanitizeTaskMetadataOrder } from './markdownSync';

export type ChangeCategory =
  | 'formato_seguro'
  | 'cambio_estructural'
  | 'anadido'
  | 'eliminacion';

export interface ContentLossWarning {
  lineIndex: number;
  originalText: string;
  reason: string;
  severity: 'high' | 'medium';
}

export interface NormalizedChange {
  id: string;
  category: ChangeCategory;
  categoryLabel: string;
  description: string;
  originalStartLine: number;
  originalLineCount: number;
  modifiedStartLine: number;
  modifiedLineCount: number;
  originalLines: string[];
  proposedLines: string[];
  isAccepted: boolean;
  hasLossRisk: boolean;
  lossWarning?: ContentLossWarning;
}

export interface NormalizationAnalysisResult {
  originalMarkdown: string;
  fullyNormalizedMarkdown: string;
  effectiveMarkdown: string;
  changes: NormalizedChange[];
  stats: {
    totalChanges: number;
    safeFormatCount: number;
    structuralCount: number;
    additionCount: number;
    deletionCount: number;
    lossRiskCount: number;
    acceptedCount: number;
  };
  contentLossReport: {
    hasLossRisk: boolean;
    lostLinesCount: number;
    lostCharactersCount: number;
    warnings: ContentLossWarning[];
  };
}

/**
 * Normalizes Markdown text using unified + remark with remark-gfm.
 * Preserves AnTaskCanvas metadata blocks while standardizing formatting.
 */
export function generateNormalizedMarkdown(rawMarkdown: string): string {
  if (!rawMarkdown || rawMarkdown.trim() === '') {
    return '';
  }

  // Step 1: Pre-process custom AnTaskCanvas metadata so remark does not distort it
  // AnTaskCanvas uses indented metadata lines following task items:
  // - [ ] Task title
  //   id: task-1
  //   priority: P0
  //   blockedBy: task-2
  
  // Parse AST using unified + remarkParse + remarkGfm
  let ast: any;
  try {
    ast = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(rawMarkdown);
  } catch (err) {
    // Fallback if parsing fails on edge-case syntax
    return normalizeFallback(rawMarkdown);
  }

  // Format AST back to markdown using remarkStringify with canonical rules
  let stringified = '';
  try {
    stringified = String(
      unified()
        .use(remarkGfm)
        .use(remarkStringify as any, {
          bullet: '-',
          listItemIndent: 'one',
          rule: '---',
          emphasis: '_',
          strong: '**',
          fences: true,
          incrementListMarker: true,
        })
        .stringify(ast)
    );
  } catch (err) {
    return normalizeFallback(rawMarkdown);
  }

  // Step 2: Post-process metadata indentation and ensure consistent line breaks
  return postProcessCanonicalMarkdown(stringified, rawMarkdown);
}

/**
 * Post-processes remark-stringified markdown to align with developer task formatting:
 * - Ensures single newline after headers
 * - Formats task metadata nicely (2 spaces indentation)
 * - Normalizes empty lines between sections to exactly 1 blank line
 * - Ensures a single newline at the end of the file
 */
function postProcessCanonicalMarkdown(stringified: string, original: string): string {
  const lines = stringified.split(/\r?\n/);
  const resultLines: string[] = [];
  let prevBlank = false;

  // Extract known metadata keys from original if any were indented
  const metadataKeyRegex = /^(\s*)(id|priority|blockedBy|status|tags|description|descripci[oó]n|desc|assignee):\s*(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Remove trailing spaces
    line = line.replace(/\s+$/, '');

    // Standardize metadata indentation under tasks to 2 spaces
    const metaMatch = line.match(metadataKeyRegex);
    if (metaMatch) {
      const rawKey = metaMatch[2].toLowerCase();
      const normKey = /^desc/i.test(rawKey) ? 'description' : rawKey;
      line = `  ${normKey}: ${metaMatch[3].trim()}`;
    }

    // Standardize task checkboxes: '- [ ]' or '- [x]'
    const taskMatch = line.match(/^(\s*[-*])\s*\[([ xX])\]\s*(.*)$/);
    if (taskMatch) {
      const isChecked = taskMatch[2].toLowerCase() === 'x';
      line = `${taskMatch[1].replace('*', '-')} [${isChecked ? 'x' : ' '}] ${taskMatch[3].trim()}`;
    }

    // Avoid multiple consecutive blank lines
    if (line.trim() === '') {
      if (!prevBlank && resultLines.length > 0) {
        resultLines.push('');
        prevBlank = true;
      }
    } else {
      prevBlank = false;
      resultLines.push(line);
    }
  }

  let finalContent = resultLines.join('\n').trim();
  if (finalContent.length > 0) {
    finalContent += '\n';
  }
  return sanitizeTaskMetadataOrder(finalContent).updatedMarkdown;
}

/**
 * Fallback cleaner in case AST processor encounters non-standard syntax
 */
function normalizeFallback(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const cleaned: string[] = [];
  let prevEmpty = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (!prevEmpty && cleaned.length > 0) {
        cleaned.push('');
        prevEmpty = true;
      }
    } else {
      prevEmpty = false;
      // Normalize task box
      const taskMatch = line.match(/^(\s*)[-*]\s*\[([ xX])\]\s*(.*)$/);
      if (taskMatch) {
        cleaned.push(`${taskMatch[1]}- [${taskMatch[2].toLowerCase() === 'x' ? 'x' : ' '}] ${taskMatch[3].trim()}`);
      } else {
        cleaned.push(line.replace(/\s+$/, ''));
      }
    }
  }

  return cleaned.join('\n').trim() + '\n';
}

/**
 * Detects if a deletion or change involves potential data/content loss.
 * Compares significant words, unrecognized metadata, or deleted non-whitespace lines.
 */
function evaluateContentLoss(
  originalLines: string[],
  proposedLines: string[],
  origStartLine: number
): { hasLossRisk: boolean; warning?: ContentLossWarning } {
  const origText = originalLines.join('\n').trim();
  const propText = proposedLines.join('\n').trim();

  // If proposed has everything or is only whitespace adjustment
  if (origText.length === 0) {
    return { hasLossRisk: false };
  }

  // Tokenize significant alphanumeric tokens
  const extractTokens = (txt: string) => {
    return (txt.match(/[\p{L}\p{N}_-]+/gu) || []).map((t) => t.toLowerCase());
  };

  const origTokens = extractTokens(origText);
  const propTokens = extractTokens(propText);
  const propTokenSet = new Set(propTokens);

  const missingTokens = origTokens.filter((t) => !propTokenSet.has(t));

  // Check for task deletion
  const hadTask = originalLines.some((l) => /^\s*[-*]\s*\[[ xX]\]/.test(l));
  const hasTask = proposedLines.some((l) => /^\s*[-*]\s*\[[ xX]\]/.test(l));

  if (hadTask && !hasTask) {
    return {
      hasLossRisk: true,
      warning: {
        lineIndex: origStartLine,
        originalText: origText,
        reason: 'Se detectó la eliminación completa de una tarea de la lista',
        severity: 'high',
      },
    };
  }

  // Check for unknown metadata or custom properties dropped
  const hadMetadata = originalLines.some((l) => /^\s*[\w.-]+:\s*.+/.test(l));
  const hasMetadata = proposedLines.some((l) => /^\s*[\w.-]+:\s*.+/.test(l));

  if (hadMetadata && !hasMetadata && origText.includes(':')) {
    return {
      hasLossRisk: true,
      warning: {
        lineIndex: origStartLine,
        originalText: origText,
        reason: 'Posible pérdida de bloque de metadatos o propiedad personalizada',
        severity: 'high',
      },
    };
  }

  // If more than 2 distinct alphanumeric tokens are missing
  if (missingTokens.length > 0) {
    const uniqueMissing = Array.from(new Set(missingTokens));
    if (uniqueMissing.length >= 2 || (uniqueMissing.length === 1 && uniqueMissing[0].length > 4)) {
      return {
        hasLossRisk: true,
        warning: {
          lineIndex: origStartLine,
          originalText: origText,
          reason: `Palabras o términos ausentes en la propuesta: "${uniqueMissing.slice(0, 3).join(', ')}${uniqueMissing.length > 3 ? '...' : ''}"`,
          severity: uniqueMissing.length > 3 ? 'high' : 'medium',
        },
      };
    }
  }

  // Completely deleted lines with meaningful content
  if (proposedLines.length === 0 && origText.replace(/[-*#>\s]/g, '').length > 0) {
    return {
      hasLossRisk: true,
      warning: {
        lineIndex: origStartLine,
        originalText: origText,
        reason: 'Eliminación completa de contenido original sin reemplazo',
        severity: 'high',
      },
    };
  }

  return { hasLossRisk: false };
}

/**
 * Classifies a hunk/change into one of the 4 requested categories:
 * - Formato seguro: whitespace, blank line, bullet standard (- vs *), checkbox spacing (-[] vs - [ ])
 * - Cambio estructural: headings (# vs ##), nesting indentation change, list item restructuring
 * - Añadido: lines added that didn't exist
 * - Eliminación: lines removed
 */
function classifyChange(
  originalLines: string[],
  proposedLines: string[]
): { category: ChangeCategory; categoryLabel: string; description: string } {
  const origTrimmed = originalLines.map((l) => l.trim()).filter((l) => l.length > 0);
  const propTrimmed = proposedLines.map((l) => l.trim()).filter((l) => l.length > 0);

  // Pure addition
  if (originalLines.length === 0 || (originalLines.every((l) => l.trim() === '') && propTrimmed.length > 0)) {
    return {
      category: 'anadido',
      categoryLabel: 'Añadido',
      description: 'Líneas o espaciados incorporados en la normalización',
    };
  }

  // Pure deletion
  if (proposedLines.length === 0 || (proposedLines.every((l) => l.trim() === '') && origTrimmed.length > 0)) {
    return {
      category: 'eliminacion',
      categoryLabel: 'Eliminación',
      description: 'Líneas o caracteres omitidos en la versión normalizada',
    };
  }

  // Compare if it's only formatting / whitespace / bullet character
  const normalizeForFormatCheck = (str: string) => {
    return str
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[-*]\s*\[([ xX])\]/, '- [$1]')
      .replace(/^[*]\s+/, '- ')
      .trim();
  };

  const origNormalized = originalLines.map(normalizeForFormatCheck).join(' ').trim();
  const propNormalized = proposedLines.map(normalizeForFormatCheck).join(' ').trim();

  if (origNormalized === propNormalized) {
    // Determine specific formatting type for clarity
    const hadTrailingSpaces = originalLines.some((l) => /\s+$/.test(l));
    const hadStarBullet = originalLines.some((l) => /^\s*[*]\s+/.test(l));
    const hadCheckboxSpacing = originalLines.some((l) => /^\s*[-*]\s*\[([ xX])\]/.test(l) && !/^\s*[-*]\s\[([ xX])\]\s/.test(l));
    const hadIndentDiff = originalLines.some((l, idx) => {
      const origInd = l.match(/^\s*/)?.[0].length || 0;
      const propInd = proposedLines[idx]?.match(/^\s*/)?.[0].length || 0;
      return origInd !== propInd;
    });

    let specificDesc = 'Alineación de espacios y formato';
    if (hadTrailingSpaces) {
      specificDesc = 'Espacios sobrantes al final de línea eliminados';
    } else if (hadStarBullet) {
      specificDesc = 'Estandarización de viñeta (* ➔ -)';
    } else if (hadCheckboxSpacing) {
      specificDesc = 'Espaciado uniforme de casilla (- [ ])';
    } else if (hadIndentDiff) {
      specificDesc = 'Alineación de sangría (2 espacios estándar)';
    } else if (originalLines.length !== proposedLines.length) {
      specificDesc = 'Normalización de líneas vacías redundantes';
    }

    return {
      category: 'formato_seguro',
      categoryLabel: 'Formato seguro',
      description: specificDesc,
    };
  }

  // Check if headings or structural levels changed
  const hasHeadingChange =
    originalLines.some((l) => /^#{1,6}\s+/.test(l.trim())) ||
    proposedLines.some((l) => /^#{1,6}\s+/.test(l.trim()));

  if (hasHeadingChange) {
    return {
      category: 'cambio_estructural',
      categoryLabel: 'Cambio estructural',
      description: 'Modificación en niveles de encabezado o estructura de secciones',
    };
  }

  // Check if nesting/indentation depth changed significantly
  const origIndents = originalLines.map((l) => (l.match(/^\s*/)?.[0].length || 0));
  const propIndents = proposedLines.map((l) => (l.match(/^\s*/)?.[0].length || 0));
  const isIndentShift =
    origIndents.length === propIndents.length &&
    origIndents.some((ind, idx) => Math.abs(ind - propIndents[idx]) >= 2);

  if (isIndentShift) {
    return {
      category: 'cambio_estructural',
      categoryLabel: 'Cambio estructural',
      description: 'Ajuste en la jerarquía o nivel de anidamiento de elementos',
    };
  }

  // If text was modified (some added, some removed)
  return {
    category: 'cambio_estructural',
    categoryLabel: 'Cambio estructural',
    description: 'Transformación de contenido o reestructuración sintáctica',
  };
}

/**
 * Performs full analysis between original and normalized Markdown:
 * - Computes Git-style patch/diff hunks using diff library
 * - Classifies every change
 * - Detects content loss risk
 * - Initializes all changes with `isAccepted: true` (or safe default)
 */
export function analyzeMarkdownNormalization(originalMarkdown: string): NormalizationAnalysisResult {
  const normalized = generateNormalizedMarkdown(originalMarkdown);

  // Compute structured patch
  const patch = Diff.structuredPatch(
    'original.md',
    'normalizado.md',
    originalMarkdown,
    normalized,
    '',
    '',
    { context: 0 } // context: 0 isolates every hunk change cleanly
  );

  const changes: NormalizedChange[] = [];
  const warnings: ContentLossWarning[] = [];

  let safeFormatCount = 0;
  let structuralCount = 0;
  let additionCount = 0;
  let deletionCount = 0;
  let lossRiskCount = 0;

  patch.hunks.forEach((hunk, index) => {
    const origLines: string[] = [];
    const propLines: string[] = [];

    for (const line of hunk.lines) {
      if (line.startsWith('-')) {
        origLines.push(line.substring(1));
      } else if (line.startsWith('+')) {
        propLines.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Context line if any
      }
    }

    const { category, categoryLabel, description } = classifyChange(origLines, propLines);
    const { hasLossRisk, warning } = evaluateContentLoss(origLines, propLines, hunk.oldStart);

    if (warning) {
      warnings.push(warning);
    }

    if (category === 'formato_seguro') safeFormatCount++;
    else if (category === 'cambio_estructural') structuralCount++;
    else if (category === 'anadido') additionCount++;
    else if (category === 'eliminacion') deletionCount++;

    if (hasLossRisk) {
      lossRiskCount++;
    }

    changes.push({
      id: `change-${index + 1}`,
      category,
      categoryLabel,
      description,
      originalStartLine: hunk.oldStart,
      originalLineCount: hunk.oldLines,
      modifiedStartLine: hunk.newStart,
      modifiedLineCount: hunk.newLines,
      originalLines: origLines,
      proposedLines: propLines,
      isAccepted: true, // Default to accepted proposal for preview
      hasLossRisk,
      lossWarning: warning,
    });
  });

  const effectiveMarkdown = applySelectedChanges(originalMarkdown, changes);

  return {
    originalMarkdown,
    fullyNormalizedMarkdown: normalized,
    effectiveMarkdown,
    changes,
    stats: {
      totalChanges: changes.length,
      safeFormatCount,
      structuralCount,
      additionCount,
      deletionCount,
      lossRiskCount,
      acceptedCount: changes.filter((c) => c.isAccepted).length,
    },
    contentLossReport: {
      hasLossRisk: lossRiskCount > 0,
      lostLinesCount: warnings.length,
      lostCharactersCount: warnings.reduce((acc, w) => acc + w.originalText.length, 0),
      warnings,
    },
  };
}

/**
 * Reconstructs the document dynamically based on accepted/rejected individual changes.
 * When a change is accepted, its proposedLines are taken.
 * When rejected, the originalLines are preserved exactly.
 */
export function applySelectedChanges(
  originalMarkdown: string,
  changes: NormalizedChange[]
): string {
  if (changes.length === 0) {
    return originalMarkdown;
  }

  // Work with line-level reconstruction
  const originalLines = originalMarkdown.split(/\r?\n/);
  const outputLines: string[] = [];

  // Sort changes by originalStartLine ascending
  const sortedChanges = [...changes].sort((a, b) => a.originalStartLine - b.originalStartLine);

  let currentLineIdx = 1; // 1-based index matching hunk oldStart

  for (const change of sortedChanges) {
    // Copy any untouched original lines before this change
    while (currentLineIdx < change.originalStartLine && currentLineIdx <= originalLines.length) {
      outputLines.push(originalLines[currentLineIdx - 1]);
      currentLineIdx++;
    }

    // Now handle this change
    if (change.isAccepted) {
      // Use proposed lines
      for (const pLine of change.proposedLines) {
        outputLines.push(pLine);
      }
    } else {
      // Preserve original lines
      for (const oLine of change.originalLines) {
        outputLines.push(oLine);
      }
    }

    // Advance current line counter past original consumed lines
    currentLineIdx += change.originalLineCount;
  }

  // Copy any remaining original lines
  while (currentLineIdx <= originalLines.length) {
    outputLines.push(originalLines[currentLineIdx - 1]);
    currentLineIdx++;
  }

  let finalDoc = outputLines.join('\n');
  // Ensure trailing newline if original had one or has content
  if (finalDoc.length > 0 && !finalDoc.endsWith('\n')) {
    finalDoc += '\n';
  }
  return finalDoc;
}

/**
 * Quick action helpers:
 */
export function setChangesPreset(
  changes: NormalizedChange[],
  preset: 'safe_only' | 'no_deletions' | 'accept_all' | 'reject_all'
): NormalizedChange[] {
  return changes.map((c) => {
    switch (preset) {
      case 'safe_only':
        // Aceptar cambios seguros: only formato_seguro and no loss risk
        return {
          ...c,
          isAccepted: c.category === 'formato_seguro' && !c.hasLossRisk,
        };
      case 'no_deletions':
        // Aceptar todo excepto eliminaciones: accept format, structure, additions; reject deletions and loss risk
        return {
          ...c,
          isAccepted: c.category !== 'eliminacion' && !c.hasLossRisk,
        };
      case 'accept_all':
        // Aceptar todo
        return {
          ...c,
          isAccepted: true,
        };
      case 'reject_all':
        // Rechazar todo
        return {
          ...c,
          isAccepted: false,
        };
      default:
        return c;
    }
  });
}
