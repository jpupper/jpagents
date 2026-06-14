/**
 * response-utils.js — Utilidades de formato y limpieza de respuestas de Hermes
 *
 * Funciones 100% puras: reciben strings, devuelven strings.
 * Sin dependencias del servidor.
 */

/**
 * Limpia la respuesta de Hermes: quita [thinking], metadatos de sesión,
 * líneas de resumen (Conversation completed, Session:, Duration:, etc.)
 */
export function cleanHermesResponse(text) {
    if (!text) return '';
    return text
        // Quitar [thinking] lines
        .replace(/^.*\[thinking\].*$/gm, '')
        // Quitar líneas de resumen de sesión
        .replace(/^.*¡+ Conversation completed after.*$/gm, '')
        .replace(/^.*Resume this session with:.*$/gm, '')
        .replace(/^.*hermes --resume.*$/gm, '')
        .replace(/^Session:\s+\S+.*$/gm, '')
        .replace(/^Duration:\s+.*$/gm, '')
        .replace(/^Messages:\s+.*$/gm, '')
        // Quitar tool call residual
        .replace(/^.*Tool call:.*$/gm, '')
        .replace(/^.*Turn ended:.*$/gm, '')
        // Multiple newlines → single
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Extrae SOLO el bloque de resumen estructurado (📋⚙️📝📊) de la respuesta de Hermes.
 * Busca desde 📋 OBJETIVO hasta el final del contenido de 📊 ESTADO ACTUAL.
 * Si no encuentra el bloque estructurado, usa cleanHermesResponse() como fallback.
 */
export function extractTelegramSummary(text) {
    if (!text || typeof text !== 'string') return '';

    // Buscar inicio del bloque: 📋 OBJETIVO
    const objetivoIdx = text.indexOf('📋');
    if (objetivoIdx === -1) return cleanHermesResponse(text);

    // Buscar 📊 ESTADO ACTUAL (cierre del bloque)
    const estadoMatch = text.slice(objetivoIdx).match(/(📊\s*ESTADO\s*ACTUAL:[^\n]*)/);
    if (!estadoMatch) return cleanHermesResponse(text);

    const estadoEnd = objetivoIdx + estadoMatch.index + estadoMatch[1].length;

    // El contenido después de ESTADO ACTUAL continúa hasta:
    // - doble salto de línea (\n\n)
    // - otro emoji de sección (📋⚙️📝📊 etc.)
    // - fin del string
    const rest = text.slice(estadoEnd);
    const contentEnd = rest.search(/\n\n|\n(?=\s*[📋⚙️📝📊✅❌ℹ️⏭️]|[A-ZÁÉÍÓÚÑ]{3,}:)/);
    const blockEnd = contentEnd > 0 ? estadoEnd + contentEnd : text.length;

    let summary = text.slice(objetivoIdx, blockEnd).trim();

    // Si el bloque está vacío después de limpiar, fallback
    if (!summary || summary.length < 15) return cleanHermesResponse(text);

    return summary;
}

/**
 * Valida que la respuesta contenga el formato RESUMEN obligatorio (📋⚙️📝📊).
 * Si no lo tiene, lo SINTETIZA usando el mensaje original y la respuesta.
 */
export function hasResumenFormat(text) {
    if (!text || text.length < 20) return false;
    // Check for proper RESUMEN format with labels — NOT just the emojis alone
    if (text.includes('📋 OBJETIVO') && text.includes('📊 ESTADO')) return true;
    // Also check old format for backward compat during transition
    if (text.includes('━━━ 📋 RESUMEN')) return true;
    return false;
}

/**
 * Extrae información útil de la respuesta de Hermes para sintetizar
 * un RESUMEN con contenido real.
 */
export function extractResumenData(response, originalMessage) {
    const data = {
        objetivo: originalMessage || 'Consulta',
        realizacion: [],
        modificaciones: [],
        estado: 'Procesado',
        notas: 'N/A'
    };

    // Extraer paths de archivos creados/modificados
    const filePaths = response.match(/[DC]:\\[^\s,;)\]]{10,}/g);
    if (filePaths) {
        const unique = [...new Set(filePaths)];
        // Limitar a 5 paths para no saturar
        data.modificaciones = unique.slice(0, 5);
    }

    // Extraer URLs (subidas a web, etc) — formateadas como links clickeables
    const urls = response.match(/https?:\/\/[^\s,;)\]}\s]{10,}/g);
    if (urls && data.modificaciones.length < 5) {
        const formattedUrls = urls.slice(0, 3).map(u => `[${u}](${u})`);
        data.modificaciones.push(...formattedUrls);
    }

    // Detectar herramientas usadas
    const toolPatterns = [
        /write_file|crea(?:r|ste)|escribí|modifiq/i,
        /terminal|ejecut|comando|npm|git/i,
        /web_search|buscador|google/i,
        /vision_analyze|imagen|imág|screenshot/i,
        /ftp|deploy|subir|upload/i,
        /skill_view|habilidad|skill/i,
        /patch|edit/i,
        /browser|navegador|web/i,
        /read_file|leer|lei/i,
        /search_files|busqu|archiv/i,
        /CREATE_PROJECT|CREATE_AGENT|DELETE_|STOP_AGENT|delegad/i,
        /curl|fetch|api|endpoint/i
    ];
    for (const pattern of toolPatterns) {
        if (pattern.test(response)) {
            const match = response.match(pattern);
            if (match) data.realizacion.push(match[0].toLowerCase());
        }
    }

    // Detectar estado
    if (/error|fall[óo]|no pudo|exception/i.test(response)) {
        data.estado = '❌ Error';
    } else if (/completad|terminad|listo|✅|hecho|cread|subid/i.test(response)) {
        data.estado = '✅ Completado';
    } else if (/en proceso|trabajando|ejecutando|procesando/i.test(response)) {
        data.estado = '🔄 En progreso';
    }

    // Detectar notas/pendientes
    const seguirMatch = response.match(/pr[oó]ximos? paso|seguir|pendiente|falta|faltar[íi]a/i);
    if (seguirMatch) {
        data.notas = 'Ver detalle en respuesta arriba';
    }

    return data;
}

/**
 * Fuerza que la respuesta SIEMPRE termine con el bloque RESUMEN formateado.
 * Si el modelo no lo generó, lo sintetiza automáticamente con datos reales.
 *
 * @param {string} response - Respuesta cruda de Hermes
 * @param {string} originalMessage - Mensaje original del usuario
 * @returns {string} - Respuesta con RESUMEN garantizado
 */
export function ensureResumen(response, originalMessage = '') {
    if (!response || response.length < 5) {
        return (
`━━━ 📋 RESUMEN ━━━

📋 OBJETIVO: ${originalMessage || 'Consulta al asistente'}
⚙️ REALIZACIÓN: N/A — El asistente no produjo respuesta
📝 MODIFICACIONES: Ninguna
📊 ESTADO: Sin respuesta disponible
📌 NOTAS: N/A`);
    }

    // Si ya tiene nuestro nuevo formato (━━━ 📋 RESUMEN ━━━), devolver tal cual
    if (response.includes('━━━ 📋 RESUMEN ━━━')) {
        return response;
    }

    // Si tiene formato emoji (📋...📊) pero sin nuestro separador
    if (hasResumenFormat(response)) {
        const objetivoIdx = response.indexOf('📋');
        const preContent = response.slice(0, objetivoIdx).trim();
        const resumenBlock = response.slice(objetivoIdx).trim();

        // Limpiar basura técnica del preContent (reusa cleanHermesResponse)
        const cleanPre = cleanHermesResponse(preContent);

        if (cleanPre.length > 10) {
            // Formatear el bloque resumen con nuestro formato estándar
            return `${cleanPre}\n\n━━━ 📋 RESUMEN ━━━\n\n${resumenBlock}`;
        }
        return `━━━ 📋 RESUMEN ━━━\n\n${resumenBlock}`;
    }

    // No tiene formato — sintetizar con datos extraídos
    const data = extractResumenData(response, originalMessage);

    // Truncar respuesta larga (máximo 2000 chars en el cuerpo)
    const shortBody = response.length > 2000
        ? response.slice(0, 2000) + '\n\n[...]'
        : response;

    const realizacionStr = data.realizacion.length > 0
        ? [...new Set(data.realizacion)].join(', ')
        : 'Procesó la consulta';

    const modificacionesStr = data.modificaciones.length > 0
        ? data.modificaciones.join('\n    ')
        : 'N/A';

    return (
`${shortBody}

━━━ 📋 RESUMEN ━━━

📋 OBJETIVO: ${data.objetivo.slice(0, 300)}
⚙️ REALIZACIÓN: ${realizacionStr}
📝 MODIFICACIONES:
    ${modificacionesStr}
📊 ESTADO: ${data.estado}
📌 NOTAS: ${data.notas}`);
}
