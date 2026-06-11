/**
 * ansi-utils.js — Única fuente de verdad para limpiar/formatear ANSI
 *
 * Las funciones stripAnsi estaban duplicadas en 4 archivos de JP Agents.
 * Ahora viven acá y se importan donde se necesiten.
 *
 * También incluye el stripAnsi "rápido" de Hermes Desktop para casos
 * donde no se necesita el parseo completo de colores.
 *
 * Regla: SIEMPRE importar de acá, nunca redefinir localmente.
 */

/**
 * stripAnsi COMPLETO — Maneja todos los casos conocidos de ANSI.
 * Orden importa: OSC primero (contienen [ que confunden CSI).
 *
 * Casos manejados:
 *   - OSC (Operating System Command): ESC ] <n> ; <text> BEL/ST
 *   - CSI (Control Sequence Introducer): ESC [ <params> <final byte>
 *   - Secuencias de selección de charset: ESC ( B, ESC ) B
 *   - Otros escapes: ESC solo
 *   - Normaliza \r\n y \r a \n
 */
const ANSI_FULL_RE = /(?:\x1b\].*?(?:\x07|\x1b\\))|(?:\x1b[PX^_].*?(?:\x1b\\))|(?:\x1b\[[\d;]*[A-Za-z@\-_])|(?:\x1b[\[\(].{0,3})|(?:\x1b.)|(?:\r\n)|\r/g;

export function stripAnsi(str) {
    if (typeof str !== 'string') return str;
    return str.replace(ANSI_FULL_RE, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * stripAnsi RÁPIDO (Hermes Desktop compatible) — Solo remueve secuencias CSI y OSC.
 * Más rápido que stripAnsi completo pero no maneja todos los casos.
 * Útil para limpieza en caliente durante streaming.
 */
// eslint-disable-next-line no-control-regex
const ANSI_FAST_RE = /\x1B\[[0-9;]*[a-zA-Z]|\x1B\][^\x07]*\x07|\x1B\(B|\r/g;

export function stripAnsiFast(str) {
    if (typeof str !== 'string') return str;
    return str.replace(ANSI_FAST_RE, '').trim();
}

/**
 * Convierte texto ANSI a HTML con spans de color.
 */
export function ansiToHtml(text) {
    if (typeof text !== 'string') return '';

    // Escapar HTML primero
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Mapa de colores ANSI a CSS
    const colorMap = {
        '30': '#000000', '31': '#e06c75', '32': '#98c379',
        '33': '#d19a66', '34': '#61afef', '35': '#c678dd',
        '36': '#56b6c2', '37': '#abb2bf', '90': '#5c6370',
        '91': '#e06c75', '92': '#98c379', '93': '#d19a66',
        '94': '#61afef', '95': '#c678dd', '96': '#56b6c2',
        '97': '#ffffff',
    };

    const bgMap = {
        '40': '#1e1e1e', '41': '#e06c75', '42': '#98c379',
        '43': '#d19a66', '44': '#61afef', '45': '#c678dd',
        '46': '#56b6c2', '47': '#abb2bf',
    };

    html = html.replace(/\x1b\[(\d+(?:;\d+)*)m/g, (match, codes) => {
        const nums = codes.split(';').map(Number);
        if (nums.includes(0)) return '</span>';

        let style = '';
        for (const n of nums) {
            if (colorMap[String(n)]) style += `color:${colorMap[String(n)]};`;
            if (n === 1) style += 'font-weight:bold;';
            if (n === 3) style += 'font-style:italic;';
            if (n === 4) style += 'text-decoration:underline;';
            if (n >= 40 && n <= 47 && bgMap[String(n)]) {
                style += `background:${bgMap[String(n)]};`;
            }
        }
        return style ? `<span style="${style}">` : '';
    });

    // Clean remaining bare escapes
    html = html.replace(/\x1b\[[\d;]*[A-Za-z@\-_]/g, '')
               .replace(/\x1b./g, '');

    return html;
}
