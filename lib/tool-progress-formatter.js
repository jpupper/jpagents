/**
 * tool-progress-formatter.js — Formateo de tool progress para plataformas de mensajería
 *
 * Basado en:
 *   - Hermes Desktop: liveToolEvents.ts, chat-stream.ts
 *   - Hermes Agent gateway: run.py (send_progress_messages), display.py (get_tool_emoji, build_tool_preview)
 *
 * Centraliza el formateo de tool events para Telegram, Discord, etc.
 */

import { getToolEmoji } from '../shared/tool-emojis.js';

// Argumento primario para preview por tool
const PRIMARY_ARGS = {
    terminal: 'command',
    web_search: 'query',
    web_extract: 'urls',
    read_file: 'path',
    write_file: 'path',
    patch: 'path',
    search_files: 'pattern',
    browser_navigate: 'url',
    browser_click: 'ref',
    browser_type: 'text',
    image_generate: 'prompt',
    text_to_speech: 'text',
    vision_analyze: 'question',
    execute_code: 'code',
    delegate_task: 'goal',
    clarify: 'question',
    skill_view: 'name',
    cronjob: 'action',
    todo: 'content',
    process: 'action',
};

/**
 * Construye un preview corto de una tool call.
 *
 * @param {string} toolName - Nombre de la herramienta
 * @param {Object} args - Argumentos de la tool call
 * @param {number} [maxLen=40] - Longitud máxima del preview
 * @returns {string|null} Preview o null si no hay args
 */
export function buildToolPreview(toolName, args, maxLen = 40) {
    if (!args || typeof args !== 'object') return null;

    const primary = PRIMARY_ARGS[toolName];
    let previewText = null;

    if (primary && args[primary]) {
        previewText = String(args[primary]).replace(/\s+/g, ' ').trim();
    }

    if (!previewText && args.query) {
        previewText = String(args.query).replace(/\s+/g, ' ').trim();
    }

    if (!previewText && args.goal) {
        previewText = String(args.goal).replace(/\s+/g, ' ').trim();
    }

    if (!previewText && args.command) {
        previewText = String(args.command).replace(/\s+/g, ' ').trim();
    }

    if (!previewText) return null;

    if (maxLen > 0 && previewText.length > maxLen) {
        previewText = previewText.slice(0, maxLen - 3) + '...';
    }

    return previewText;
}

/**
 * Construye el texto de progreso para una tool.
 *
 * @param {Object} toolEvent - Evento de tool (name, args, preview, emoji, status)
 * @param {number} [previewMaxLen=40] - Longitud máxima del preview
 * @returns {string} Texto formateado ej: "💻 terminal: \"npm install\""
 */
export function formatToolProgress(toolEvent, previewMaxLen = 40) {
    const emoji = toolEvent.emoji || getToolEmoji(toolEvent.name);
    const preview = toolEvent.preview || buildToolPreview(toolEvent.name, toolEvent.args, previewMaxLen);

    if (preview) {
        return `${emoji} ${toolEvent.name}: "${preview}"`;
    }
    return `${emoji} ${toolEvent.name}...`;
}

/**
 * Manager de tool progress para una conversación.
 * Acumula líneas de herramientas y las envía/edita como un solo mensaje.
 *
 * Uso:
 *   const mgr = new ToolProgressManager(sendFn, editFn, deleteFn);
 *   mgr.onToolStart(toolEvent);
 *   mgr.onToolComplete(toolEvent);
 *   mgr.cleanup();
 */
export class ToolProgressManager {
    /**
     * @param {Function} sendFn - async (text) => messageId
     * @param {Function} editFn - async (messageId, text) => ok
     * @param {Function} [deleteFn] - async (messageId) => void
     * @param {Object} [opts]
     * @param {number} [opts.previewMaxLen=40]
     * @param {number} [opts.maxLines=20] - Máximo líneas antes de rotar
     * @param {boolean} [opts.showCompleted=true] - Mostrar tools completadas
     */
    constructor(sendFn, editFn, deleteFn, opts = {}) {
        this.sendFn = sendFn;
        this.editFn = editFn;
        this.deleteFn = deleteFn || (() => {});
        this.previewMaxLen = opts.previewMaxLen || 40;
        this.maxLines = opts.maxLines || 20;
        this.showCompleted = opts.showCompleted !== false;

        this.lines = [];
        this.messageId = null;
        this.lastMsg = null;
        this.repeatCount = 0;
        this.lastEditTime = 0;
        this.MIN_EDIT_INTERVAL = 1500; // ms entre edits (flood control)
    }

    /**
     * Llama cuando una herramienta empieza.
     */
    async onToolStart(toolEvent) {
        const msg = formatToolProgress(toolEvent, this.previewMaxLen);

        // Dedup: colapsar mensajes idénticos consecutivos
        if (msg === this.lastMsg) {
            this.repeatCount++;
            if (this.lines.length > 0) {
                this.lines[this.lines.length - 1] = `${msg} (x${this.repeatCount})`;
            }
        } else {
            this.lastMsg = msg;
            this.repeatCount = 0;
            this.lines.push(msg);
        }

        // Rotar si excede el máximo
        if (this.lines.length > this.maxLines) {
            this.lines = this.lines.slice(-this.maxLines);
        }

        await this.flush();
    }

    /**
     * Llama cuando una herramienta termina.
     * Si showCompleted es true, marca la línea como completada.
     */
    async onToolComplete(toolEvent) {
        if (!this.showCompleted) return;

        // Marcar la última línea de este tool como completada
        const toolName = toolEvent.name;
        for (let i = this.lines.length - 1; i >= 0; i--) {
            if (this.lines[i].includes(toolName)) {
                // Reemplazar "..." por "✅" al final
                this.lines[i] = this.lines[i].replace(/\.\.\.$/, ' ✅');
                break;
            }
        }

        await this.flush();
    }

    /**
     * Envía o edita el mensaje de progreso.
     */
    async flush() {
        if (this.lines.length === 0) return;

        const text = '⎔ Progreso:\n' + this.lines.join('\n');
        const now = Date.now();

        if (!this.messageId) {
            // Enviar mensaje nuevo
            const result = await this.sendFn(text);
            if (result && result.message_id) {
                this.messageId = result.message_id;
            } else if (typeof result === 'string') {
                this.messageId = result;
            }
            this.lastEditTime = now;
        } else {
            // Editar mensaje existente (con rate limiting)
            if (now - this.lastEditTime < this.MIN_EDIT_INTERVAL) return;
            try {
                await this.editFn(this.messageId, text);
                this.lastEditTime = now;
            } catch (e) {
                if (e.description?.includes('not modified') || e.message?.includes('not modified')) {
                    // Mensaje idéntico — no es error
                    return;
                }
                // Si el edit falla, intentar enviar nuevo
                if (e.description?.includes('message not found') || e.error_code === 400) {
                    this.messageId = null;
                    await this.flush();
                }
            }
        }
    }

    /**
     * Limpia el mensaje de progreso.
     */
    async cleanup() {
        if (this.messageId) {
            try {
                await this.deleteFn(this.messageId);
            } catch {
                // non-fatal
            }
            this.messageId = null;
        }
        this.lines = [];
        this.lastMsg = null;
        this.repeatCount = 0;
    }
}
