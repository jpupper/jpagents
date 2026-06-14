/**
 * markdown-v2.js — Conversor de Markdown estándar a Telegram MarkdownV2
 *
 * Basado en el algoritmo de Hermes Agent Gateway (telegram.py → format_message).
 *
 * Estrategia:
 *   1. Proteger regiones (code blocks, inline code) con placeholders
 *   2. Convertir constructores markdown (headers, bold, italic, links, etc.)
 *   3. Escapar caracteres especiales MarkdownV2
 *   4. Restaurar placeholders
 *
 * Telegram MarkdownV2 caracteres especiales: _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Uso:
 *   import { formatMessage, escapeMarkdownV2, stripMarkdownV2 } from './lib/markdown-v2.js';
 *   const formatted = formatMessage('**bold** and `code`');
 *   const escaped = escapeMarkdownV2('Esto _tiene_ especiales');
 *   const plain = stripMarkdownV2('Esto \\_tiene\\_ escapes');
 */

// Caracteres especiales de MarkdownV2 que necesitan backslash-escape
const MDV2_ESCAPE_RE = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

// Regex para detectar delimiter row de tabla GFM
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*){1,}\|?\s*$/;

// Regex para detectar fenced code blocks
const FENCED_CODE_RE = /```[\s\S]*?```/g;

// Regex para inline code
const INLINE_CODE_RE = /`[^`]+`/g;

/**
 * Escapa caracteres especiales de MarkdownV2 con backslash.
 */
export function escapeMarkdownV2(text) {
    return text.replace(MDV2_ESCAPE_RE, '\\$1');
}

/**
 * Remueve escapes MarkdownV2 para obtener texto plano.
 * También remueve marcadores de formato (**bold** → bold, etc.)
 */
export function stripMarkdownV2(text) {
    let cleaned = text
        // Remover backslashes de escape
        .replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1')
        // Remover bold **text** → text
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        // Remover bold simple *text* → text (solo palabras completas)
        .replace(/\*([^*\n]+)\*/g, '$1')
        // Remover italic _text_ con word boundary (no romper snake_case)
        .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
        // Remover strikethrough ~text~ → text
        .replace(/~([^~]+)~/g, '$1')
        // Remover spoiler ||text|| → text
        .replace(/\|\|([^|]+)\|\|/g, '$1');
    return cleaned;
}

/**
 * Verifica si una línea es una fila de tabla (contiene |)
 */
function isTableRow(line) {
    return line.trim().includes('|');
}

/**
 * Divide una fila de tabla en celdas.
 */
function splitTableRow(line) {
    let stripped = line.trim();
    if (stripped.startsWith('|')) stripped = stripped.slice(1);
    if (stripped.endsWith('|')) stripped = stripped.slice(0, -1);
    return stripped.split('|').map(c => c.trim());
}

/**
 * Convierte un bloque de tabla GFM a grupos de bullets para Telegram.
 * Telegram no soporta tablas en MarkdownV2.
 */
function renderTableBlock(tableBlock) {
    if (tableBlock.length < 3) return tableBlock.join('\n');

    const headers = splitTableRow(tableBlock[0]);
    if (headers.length < 2) return tableBlock.join('\n');

    // Detectar columna de label (row-label)
    const firstDataRow = tableBlock[2] ? splitTableRow(tableBlock[2]) : [];
    const hasRowLabel = firstDataRow.length === headers.length + 1;

    const groups = [];
    for (let i = 2; i < tableBlock.length; i++) {
        const cells = splitTableRow(tableBlock[i]);

        let heading, dataCells;
        if (hasRowLabel) {
            heading = cells[0] || `Row ${i - 1}`;
            dataCells = cells.slice(1);
        } else {
            heading = cells.find(c => c) || `Row ${i - 1}`;
            dataCells = cells;
        }

        // Pad/trim data cells
        while (dataCells.length < headers.length) dataCells.push('');
        if (dataCells.length > headers.length) dataCells = dataCells.slice(0, headers.length);

        const bullets = [];
        for (let j = 0; j < headers.length; j++) {
            if (!hasRowLabel && dataCells[j] === heading) continue;
            if (dataCells[j]) {
                bullets.push(`• ${headers[j]}: ${dataCells[j]}`);
            }
        }

        groups.push(`**${heading}**\n${bullets.join('\n')}`);
    }

    return groups.join('\n\n');
}

/**
 * Detecta y reescribe tablas GFM a formato Telegram-friendly.
 */
function wrapMarkdownTables(text) {
    if (!text.includes('|') || !text.includes('-')) return text;

    const lines = text.split('\n');
    const out = [];
    let inFence = false;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Track fenced code blocks
        if (line.trimStart().startsWith('```')) {
            inFence = !inFence;
            out.push(line);
            i++;
            continue;
        }
        if (inFence) {
            out.push(line);
            i++;
            continue;
        }

        // Detectar tabla: header row con | seguido de delimiter row
        if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1])) {
            const tableBlock = [line, lines[i + 1]];
            let j = i + 2;
            while (j < lines.length && isTableRow(lines[j])) {
                tableBlock.push(lines[j]);
                j++;
            }
            out.push(renderTableBlock(tableBlock));
            i = j;
            continue;
        }

        out.push(line);
        i++;
    }

    return out.join('\n');
}

/**
 * Convierte markdown estándar a Telegram MarkdownV2.
 *
 * Estrategia de placeholders:
 *   1. Extraer regiones protegidas (code blocks, inline code)
 *   2. Convertir constructores markdown
 *   3. Escapar caracteres especiales
 *   4. Restaurar placeholders
 *
 * @param {string} content - Texto en markdown estándar
 * @returns {string} Texto en MarkdownV2 para Telegram
 */
export function formatMessage(content) {
    if (!content) return content;

    const placeholders = {};
    let counter = 0;

    function stash(value) {
        const key = `\x00PH${counter}\x00`;
        counter++;
        placeholders[key] = value;
        return key;
    }

    let text = content;

    // 0) Reescribir tablas GFM a bullets
    text = wrapMarkdownTables(text);

    // 1) Proteger fenced code blocks (```...```)
    // NOTA: MarkdownV2 trata el contenido de code blocks como literal.
    // NO escapar backslashes ni otros caracteres dentro del bloque.
    text = text.replace(/(```(?:[^\n]*\n)?[\s\S]*?```)/g, (match) => {
        const openEnd = match.indexOf('\n') >= 3 ? match.indexOf('\n') + 1 : 3;
        const opening = match.slice(0, openEnd);
        const bodyAndClose = match.slice(openEnd);
        const body = bodyAndClose.slice(0, -3);
        // Solo escapar backticks que podrían cerrar prematuramente el bloque
        const escaped = body.replace(/`/g, '\\`');
        return stash(opening + escaped + '```');
    });

    // 2) Proteger inline code (`...`)
    // NOTA: contenido literal, NO escapar backslashes
    text = text.replace(/(`[^`]+`)/g, (match) => {
        return stash(match);
    });

    // 3) Convertir links [text](url) — con soporte para paréntesis anidados (hasta 2 niveles de profundidad)
    text = text.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\)|\([^()]*\([^()]*\)[^()]*\))*)\)/g, (match, display, url) => {
        const escapedDisplay = escapeMarkdownV2(display);
        const escapedUrl = url.replace(/\)/g, '\\)');
        return stash(`[${escapedDisplay}](${escapedUrl})`);
    });

    // 4) Headers → bold
    text = text.replace(/^#{1,6}\s+(.+)$/gm, (match, inner) => {
        const cleaned = inner.replace(/\*\*(.+?)\*\*/g, '$1').trim();
        return stash(`*${escapeMarkdownV2(cleaned)}*`);
    });

    // 5) Bold: **text** → *text*
    text = text.replace(/\*\*(.+?)\*\*/g, (match, inner) => {
        return stash(`*${escapeMarkdownV2(inner)}*`);
    });

    // 6) Italic: *text* (single asterisk) → _text_
    text = text.replace(/\*([^*\n]+)\*/g, (match, inner) => {
        return stash(`_${escapeMarkdownV2(inner)}_`);
    });

    // 7) Strikethrough: ~~text~~ → ~text~
    text = text.replace(/~~(.+?)~~/g, (match, inner) => {
        return stash(`~${escapeMarkdownV2(inner)}~`);
    });

    // 8) Spoiler: ||text|| → ||text|| (proteger |)
    text = text.replace(/\|\|(.+?)\|\|/g, (match, inner) => {
        return stash(`||${escapeMarkdownV2(inner)}||`);
    });

    // 9) Blockquotes: > text
    text = text.replace(/^((?:\*\*)?>{1,3}) (.+)$/gm, (match, prefix, content) => {
        return stash(`${prefix} ${escapeMarkdownV2(content)}`);
    });

    // 10) Escapar caracteres especiales restantes
    text = escapeMarkdownV2(text);

    // 11) Restaurar placeholders en orden inverso
    const keys = Object.keys(placeholders);
    for (let i = keys.length - 1; i >= 0; i--) {
        text = text.replace(keys[i], placeholders[keys[i]]);
    }

    // 12) Safety net: escapar ( ) { } no escapados fuera de code
    // Estrategia: trackear si estamos dentro de [text](url) para NO escapar sus paréntesis.
    // Un link MarkdownV2 es: [text](url) — los paréntesis del URL NO se escapan.
    const codeSplit = text.split(/(```[\s\S]*?```|`[^`]+`)/);
    const safeParts = codeSplit.map((seg, idx) => {
        if (idx % 2 === 1) return seg; // code segment — leave alone
        let result = '';
        let inLinkUrl = 0;  // nesting depth inside [text](...)
        let pendingBracket = false;  // true si el último char no escapado fue ']'
        for (let i = 0; i < seg.length; i++) {
            const ch = seg[i];
            if (ch === '[') {
                pendingBracket = true;
                result += ch;
            } else if (ch === ']') {
                // Si el próximo char es '(', entramos en link URL
                if (i + 1 < seg.length && seg[i + 1] === '(') {
                    pendingBracket = true; // marcar para el '(' que sigue
                } else {
                    pendingBracket = false;
                }
                result += ch;
            } else if (ch === '(') {
                if (pendingBracket) {
                    // Esto abre [text](url) — no escapar
                    inLinkUrl = 1;
                    pendingBracket = false;
                    result += ch;
                } else if (inLinkUrl > 0) {
                    // Paréntesis anidado DENTRO del URL
                    inLinkUrl++;
                    result += ch;
                } else {
                    result += '\\(';
                }
            } else if (ch === ')') {
                if (inLinkUrl > 0) {
                    inLinkUrl--;
                    result += ch;
                } else {
                    result += '\\)';
                }
            } else if (ch === '{' || ch === '}') {
                result += '\\' + ch;
            } else {
                // Reiniciar pendingBracket si no es seguido de '('
                if (pendingBracket && ch !== ']') pendingBracket = false;
                result += ch;
            }
        }
        return result;
    });
    text = safeParts.join('');

    return text;
}

/**
 * Trunca un mensaje respetando límite de UTF-16 (Telegram usa UTF-16 code units).
 * Preserva bloques de código.
 */
export function truncateMessage(content, maxLength = 4096) {
    if (content.length <= maxLength) return [content];

    const chunks = [];
    let remaining = content;
    let carryLang = null;

    const INDICATOR_RESERVE = 10; // room for " (X/Y)"
    const FENCE_CLOSE = '\n```';

    while (remaining) {
        const prefix = carryLang !== null ? `\`\`\`${carryLang}\n` : '';
        const headroom = maxLength - INDICATOR_RESERVE - prefix.length - FENCE_CLOSE.length;

        if (prefix.length + remaining.length <= maxLength - INDICATOR_RESERVE) {
            chunks.push(prefix + remaining);
            break;
        }

        let splitAt = Math.min(headroom, remaining.length);
        // Prefer newline splits
        const newlinePos = remaining.slice(0, splitAt).lastIndexOf('\n');
        if (newlinePos > splitAt / 2) splitAt = newlinePos;
        else {
            const spacePos = remaining.slice(0, splitAt).lastIndexOf(' ');
            if (spacePos > splitAt / 2) splitAt = spacePos;
        }

        const chunk = remaining.slice(0, splitAt);
        remaining = remaining.slice(splitAt);

        // Check if we're inside a code block
        const backtickCount = (chunk.match(/```/g) || []).length;
        if (backtickCount % 2 === 1) {
            carryLang = '';

            // Si la advertencia es por cierre de bloque (``` en content), cerrarlo
            chunks.push(prefix + chunk + FENCE_CLOSE);
        } else {
            carryLang = null;
            chunks.push(prefix + chunk);
        }
    }

    // Add chunk indicators (1/3, 2/3, etc.)
    if (chunks.length > 1) {
        return chunks.map((chunk, i) => `${chunk} (${i + 1}/${chunks.length})`);
    }

    return chunks;
}
