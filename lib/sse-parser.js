/**
 * sse-parser.js — Parser de Server-Sent Events (SSE)
 *
 * Maneja tanto el protocolo SSE estándar (event: / data: / [DONE])
 * como los eventos custom de Hermes Agent (hermes.tool.progress).
 *
 * Basado en el parser de Hermes Desktop (sse-parser.ts + run-stream.ts).
 * Único punto de entrada para todo parseo SSE en JP Agents.
 *
 * Uso:
 *   import { createSseParser } from './lib/sse-parser.js';
 *   const parser = createSseParser(callbacks);
 *   parser.onChunk(chunk);  // llama con cada chunk TCP del stream
 *   parser.onEnd();          // cuando el stream se cierra
 */

// Patrón legacy: tool progress inyectado en content como `💻 terminal: "npm install"`
const TOOL_PROGRESS_CONTENT_RE = /^`([^\s`]+)\s+(.+?)`$/;

// Patrón emoji al inicio: 🔍 search_web ...
const EMOJI_PREFIX_RE = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\s+(.+)$/u;

// Caracteres especiales MarkdownV2
const MDV2_ESCAPE_RE = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Crea un parser SSE con callbacks.
 *
 * @param {Object} callbacks
 * @param {Function} [callbacks.onChunk] - fn(text) por cada delta de texto
 * @param {Function} [callbacks.onReasoningChunk] - fn(text) por reasoning delta
 * @param {Function} [callbacks.onToolEvent] - fn(toolEvent) por tool.start/complete
 * @param {Function} [callbacks.onToolProgress] - fn(label) formato legacy
 * @param {Function} [callbacks.onUsage] - fn(usage) al finalizar
 * @param {Function} [callbacks.onDone] - fn(sessionId) cuando termina
 * @param {Function} [callbacks.onError] - fn(error) en caso de error
 */
export function createSseParser(callbacks) {
    const state = {
        buffer: '',
        hasContent: false,
        lastError: '',
        finished: false,
        sessionId: null,
        usage: null,
    };

    function finish(error) {
        if (state.finished) return;
        state.finished = true;
        if (error && callbacks.onError) {
            callbacks.onError(error);
        } else if (callbacks.onDone) {
            callbacks.onDone(state.sessionId);
        }
    }

    /**
     * Procesa un bloque SSE (entre \n\n).
     */
    function processSseBlock(block) {
        let eventType = '';
        let dataLine = '';

        for (const rawLine of block.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
                dataLine = line.slice(6);
            }
        }

        if (!dataLine) return false;

        if (eventType) {
            processCustomEvent(eventType, dataLine);
            return false;
        }

        return processDataLine(dataLine);
    }

    /**
     * Procesa eventos custom (hermes.tool.progress, etc.)
     */
    function processCustomEvent(eventType, data) {
        if (eventType === 'hermes.tool.progress') {
            try {
                const payload = JSON.parse(data);
                const toolEvent = chatToolEventFromPayload(payload);
                if (callbacks.onToolEvent) {
                    callbacks.onToolEvent(toolEvent);
                } else if (callbacks.onToolProgress) {
                    callbacks.onToolProgress(chatToolProgressLabel(toolEvent));
                }
            } catch {
                // malformed — skip
            }
        }
    }

    /**
     * Procesa una línea data: (sin event: prefix).
     * Contenido típico: choices[{delta}], usage, [DONE]
     */
    function processDataLine(data) {
        if (data === '[DONE]') {
            if (state.hasContent) {
                finish();
            } else if (state.lastError) {
                finish(state.lastError);
            }
            return true; // señal de completado
        }

        try {
            const parsed = JSON.parse(data);

            // Capturar errores
            if (parsed.error) {
                state.lastError = parsed.error.message || JSON.stringify(parsed.error);
                return false;
            }

            // Extraer session id de la respuesta
            if (parsed.session_id) {
                state.sessionId = parsed.session_id;
            }

            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            // Usage al final
            if (parsed.usage && callbacks.onUsage) {
                const usage = {
                    promptTokens: parsed.usage.prompt_tokens || 0,
                    completionTokens: parsed.usage.completion_tokens || 0,
                    totalTokens: parsed.usage.total_tokens || 0,
                    cost: parsed.usage.cost,
                    cacheReadTokens: parsed.usage.cache_read_tokens ?? parsed.usage.prompt_tokens_details?.cached_tokens,
                    cacheWriteTokens: parsed.usage.cache_write_tokens,
                };
                callbacks.onUsage(usage);
            }

            // Reasoning delta (DeepSeek: reasoning_content, OpenAI: reasoning)
            const reasoningDelta = delta?.reasoning_content || delta?.reasoning;
            if (reasoningDelta && callbacks.onReasoningChunk) {
                callbacks.onReasoningChunk(reasoningDelta);
            }

            // Texto normal
            if (delta?.content) {
                const trimmed = delta.content.trim();
                // Legacy: detectar tool progress inyectado en content
                const match = TOOL_PROGRESS_CONTENT_RE.exec(trimmed);
                if (match && callbacks.onToolProgress) {
                    callbacks.onToolProgress(`${match[1]} ${match[2]}`);
                } else {
                    state.hasContent = true;
                    if (callbacks.onChunk) {
                        callbacks.onChunk(delta.content);
                    }
                }
            }
        } catch {
            // malformed chunk — skip
        }
        return false;
    }

    /**
     * Convierte un payload de tool event al formato ChatToolEvent.
     */
    function chatToolEventFromPayload(payload) {
        const tool = stringValue(payload.tool);
        const label = stringValue(payload.label) || tool;
        const name = tool || label || 'tool';
        const rawStatus = stringValue(payload.status);
        const status = rawStatus === 'completed' || rawStatus === 'failed' ? rawStatus : 'running';
        const explicitCallId = stringValue(payload.toolCallId) || stringValue(payload.tool_call_id) || stringValue(payload.callId);
        const callId = explicitCallId || `${name}:${label}`;
        const emoji = stringValue(payload.emoji);
        // Gateway sends `label` (built from build_tool_preview) instead of `preview`.
        // Use label as preview when no explicit preview is given.
        const preview = stringValue(payload.preview) || stringValue(payload.label);
        const result = stringValue(payload.result);

        return {
            callId,
            hasStableCallId: !!explicitCallId,
            name,
            status,
            ...(label ? { label } : {}),
            ...(emoji ? { emoji } : {}),
            ...(preview ? { preview } : {}),
            ...(result ? { result } : {}),
        };
    }

    function chatToolProgressLabel(event) {
        const label = event.label || event.name;
        return event.emoji ? `${event.emoji} ${label}` : label;
    }

    function stringValue(value) {
        return typeof value === 'string' ? value : '';
    }

    return {
        /**
         * Procesa un chunk de datos del stream.
         * @param {string} chunk - datos del stream
         */
        onChunk(chunk) {
            if (state.finished) return;
            state.buffer += chunk;
            const parts = state.buffer.split('\n\n');
            state.buffer = parts.pop() || '';

            for (const part of parts) {
                if (processSseBlock(part)) return;
            }
        },

        /**
         * Señal de fin de stream.
         */
        onEnd() {
            if (state.finished) return;
            // Procesar cualquier resto en el buffer
            if (state.buffer.trim()) {
                for (const part of state.buffer.split('\n\n')) {
                    if (processSseBlock(part)) return;
                }
            }
            if (!state.hasContent && !state.lastError) {
                // Streaming empty — podría ser error silencioso
                finish('No response received from Hermes gateway');
            } else {
                finish(state.hasContent ? undefined : state.lastError);
            }
        },

        /**
         * Aborta el parser (no emite más callbacks).
         */
        abort() {
            state.finished = true;
        },
    };
}

// ─── Helpers de extracción para eventos run (v1/runs transport) ───

/**
 * Extrae un tool event del formato run event.
 */
export function chatToolEventFromRunEvent(event) {
    const eventName = stringValue(event.event);
    if (!['tool.started', 'tool.completed', 'tool.failed'].includes(eventName)) {
        return null;
    }

    const name = stringValue(event.tool) || stringValue(event.tool_name) || 'tool';
    const status = eventName === 'tool.completed' ? 'completed'
        : eventName === 'tool.failed' ? 'failed'
        : 'running';
    const runId = stringValue(event.run_id) || 'run';
    const preview = stringValue(event.preview);

    return {
        callId: `${runId}:${name}`,
        hasStableCallId: false,
        name,
        status,
        ...(preview ? { preview } : {}),
    };
}

/**
 * Extrae texto de reasoning de un evento run.
 */
export function runEventReasoningText(event) {
    if (event.event !== 'reasoning.available') return '';
    return stringValue(event.text) || stringValue(event.delta);
}

/**
 * Extrae usage de un evento run.completed.
 */
export function runCompletedUsage(event) {
    if (event.event !== 'run.completed') return null;
    const usage = event.usage;
    if (!usage || typeof usage !== 'object') return null;
    return {
        promptTokens: Number(usage.input_tokens) || 0,
        completionTokens: Number(usage.output_tokens) || 0,
        totalTokens: Number(usage.total_tokens) || 0,
    };
}

/**
 * Parsea un bloque SSE (event:/data: lines) del formato raw.
 */
export function parseSseBlock(block) {
    let eventType = '';
    let dataLine = '';
    for (const rawLine of block.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
            dataLine = line.slice(6);
        }
    }
    if (!dataLine) return null;
    return { eventType, data: dataLine };
}
