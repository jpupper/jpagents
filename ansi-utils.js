/**
 * ansi-utils.js — Utilidades compartidas para limpiar/formatear ANSI
 * 
 * Las funciones stripAnsi estaban duplicadas en 4 archivos.
 * Ahora viven acá y se importan donde se necesiten.
 */

/**
 * Limpia secuencias ANSI de un string de texto.
 * Orden importa: OSC primero (contienen [ que confunden CSI).
 * Maneja:
 *   - OSC (Operating System Command): ESC ] 
 *   - CSI (Control Sequence Introducer): ESC [
 *   - Otros escapes: ESC solo
 *   - Normaliza \r\n y \r a \n
 */
export function stripAnsi(text) {
    if (typeof text !== 'string') return text;
    return text
        // OSC sequences: ESC ] <n> ; <text> BEL/ST
        .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
        // Other escape sequences starting with ESC [PX^_]
        .replace(/\x1b[PX^_].*?(?:\x1b\\)/g, '')
        // CSI: ESC [ <params> <final byte>
        .replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
        // Any remaining bare ESC sequences
        .replace(/\x1b[\[\(].{0,3}/g, '')
        .replace(/\x1b./g, '')
        // Normalize line endings
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

/**
 * Convierte texto ANSI a HTML con spans de color.
 * Similar a stripAnsi pero preserva colores como HTML.
 */
export function ansiToHtml(text) {
    if (typeof text !== 'string') return '';
    
    // First escape HTML
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Then convert ANSI codes to spans
    const colorMap = {
        '30': '#000000', '31': '#e06c75', '32': '#98c379',
        '33': '#d19a66', '34': '#61afef', '35': '#c678dd',
        '36': '#56b6c2', '37': '#abb2bf', '90': '#5c6370',
        '91': '#e06c75', '92': '#98c379', '93': '#d19a66',
        '94': '#61afef', '95': '#c678dd', '96': '#56b6c2',
        '97': '#ffffff',
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
            if (n >= 40 && n <= 47) {
                const bgMap = {'40':'#1e1e1e','41':'#e06c75','42':'#98c379',
                               '43':'#d19a66','44':'#61afef','45':'#c678dd',
                               '46':'#56b6c2','47':'#abb2bf'};
                if (bgMap[String(n)]) style += `background:${bgMap[String(n)]};`;
            }
        }
        return style ? `<span style="${style}">` : '';
    });
    
    // Clean any remaining bare escapes
    html = html.replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
               .replace(/\x1b./g, '');
    
    return html;
}
