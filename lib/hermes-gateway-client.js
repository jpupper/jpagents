/**
 * hermes-gateway-client.js — Cliente HTTP para la API REST del Gateway de Hermes Agent
 *
 * Reemplaza el spawn de Hermes.exe como subproceso CLI.
 * Usa POST /v1/chat/completions con stream:true para recibir:
 *   - Tool progress en vivo (hermes.tool.progress)
 *   - Reasoning delta (reasoning_content)
 *   - Assistant text streaming (choices[0].delta.content)
 *   - Usage al finalizar
 *
 * Basado en el patrón de Hermes Desktop (hermes.ts → sendMessageViaApi).
 *
 * Uso:
 *   import { createHermesClient } from './lib/hermes-gateway-client.js';
 *   const client = createHermesClient({ baseUrl: 'http://127.0.0.1:8642' });
 *
 *   // Streaming
 *   const response = await client.chat(messages, callbacks);
 *
 *   // One-shot (sin streaming)
 *   const response = await client.chat(messages, {}, { stream: false });
 */

import http from 'http';
import https from 'https';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createSseParser } from './sse-parser.js';

const DEFAULT_GATEWAY_PORT = 8642;
const DEFAULT_TIMEOUT = 300000; // 5 min

/**
 * Determina la URL base del gateway de Hermes.
 * Busca en orden:
 *   1. Variable de entorno HERMES_GATEWAY_URL
 *   2. ~/.hermes/config.yaml → api_server.extra.port
 *   3. Puerto por defecto (8642)
 */
export function resolveGatewayConfig() {
    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');

    // 1. URL: env var → config.yaml → default 8642
    let baseUrl = process.env.HERMES_GATEWAY_URL;
    if (!baseUrl) {
        const configPath = path.join(hermesHome, 'config.yaml');
        let port = DEFAULT_GATEWAY_PORT;
        try {
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf-8');
                const portMatch = content.match(/port:\s*(\d+)/);
                if (portMatch) {
                    port = parseInt(portMatch[1], 10);
                }
            }
        } catch { /* fallback al default */ }
        baseUrl = `http://127.0.0.1:${port}`;
    }

    // 2. API key: env var del proyecto → ~/.hermes/.env
    let apiKey = '';
    if (process.env.HERMES_GATEWAY_API_KEY) {
        apiKey = process.env.HERMES_GATEWAY_API_KEY.trim().replace(/['"]/g, '');
    } else {
        try {
            const envPath = path.join(hermesHome, '.env');
            if (fs.existsSync(envPath)) {
                const content = fs.readFileSync(envPath, 'utf-8');
                // Buscar API_SERVER_KEY o HERMES_GATEWAY_API_KEY
                const keyMatch = content.match(/(?:API_SERVER_KEY|HERMES_GATEWAY_API_KEY)\s*=\s*(.+)/);
                if (keyMatch) {
                    apiKey = keyMatch[1].trim().replace(/['"]/g, '');
                }
            }
        } catch { /* sin API key */ }
    }

    return { baseUrl, apiKey };
}

/**
 * Crea un cliente HTTP para la API del gateway de Hermes.
 *
 * @param {Object} opts
 * @param {string} [opts.baseUrl='http://127.0.0.1:8642'] - URL base del gateway
 * @param {string} [opts.apiKey=''] - API key para Authorization header
 * @param {number} [opts.timeout=300000] - Timeout por request
 */
export function createHermesClient(opts = {}) {
    const config = resolveGatewayConfig();
    const baseUrl = (opts.baseUrl || config.baseUrl || `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}`).replace(/\/+$/, '');
    const apiKey = opts.apiKey || config.apiKey || '';
    const defaultTimeout = opts.timeout || DEFAULT_TIMEOUT;

    /**
     * Resuelve el módulo HTTP según el protocolo.
     */
    function getRequester(url) {
        return url.startsWith('https') ? https : http;
    }

    /**
     * Construye el header Authorization si hay API key.
     */
    function getAuthHeaders() {
        return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    }

    /**
     * Envía un mensaje a Hermes vía la API de chat completions.
     *
     * @param {Array<{role:string, content:string}>} messages - Mensajes en formato OpenAI
     * @param {Object} [callbacks] - Callbacks para streaming
     * @param {Function} [callbacks.onChunk] - fn(text) por cada delta
     * @param {Function} [callbacks.onReasoningChunk] - fn(text) reasoning en vivo
     * @param {Function} [callbacks.onToolEvent] - fn(toolEvent) tool progress
     * @param {Function} [callbacks.onToolProgress] - fn(label) legacy
     * @param {Function} [callbacks.onUsage] - fn(usage) al finalizar
     * @param {Function} [callbacks.onDone] - fn(sessionId) al completar
     * @param {Function} [callbacks.onError] - fn(error)
     * @param {Object} [opts] - Opciones adicionales
     * @param {string} [opts.model='hermes-agent'] - Modelo
     * @param {boolean} [opts.stream=true] - Usar streaming
     * @param {string} [opts.sessionId] - Session ID para reanudar
     * @param {string} [opts.reasoningEffort] - reasoning_effort
     * @param {AbortSignal} [opts.signal] - AbortSignal
     * @returns {Promise<{response:string, sessionId:string|null, usage:Object|null}>}
     */
    async function chat(messages, callbacks = {}, opts = {}) {
        const model = opts.model || 'hermes-agent';
        const stream = opts.stream !== false;
        const sessionId = opts.sessionId || (apiKey ? `jpagents-${Date.now()}-${randomUUID()}` : '');
        const reasoningEffort = opts.reasoningEffort;

        const bodyObj = { model, messages, stream };

        if (sessionId) {
            bodyObj.session_id = sessionId;
        }
        if (reasoningEffort) {
            bodyObj.reasoning_effort = reasoningEffort;
        }

        const body = JSON.stringify(bodyObj);
        const bodyBuf = Buffer.from(body, 'utf-8');

        const url = `${baseUrl}/v1/chat/completions`;
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': String(bodyBuf.length),
            ...getAuthHeaders(),
        };
        if (sessionId) {
            headers['X-Hermes-Session-Id'] = sessionId;
        }

        const { onChunk, onReasoningChunk, onToolEvent, onToolProgress,
                onUsage, onDone, onError } = callbacks;

        // Para modo no-streaming, hacemos un POST normal
        if (!stream) {
            return new Promise((resolve, reject) => {
                const requester = getRequester(url);
                const req = requester.request(url, {
                    method: 'POST',
                    headers,
                    timeout: defaultTimeout,
                    signal: opts.signal,
                }, (res) => {
                    let raw = '';
                    res.on('data', (d) => { raw += d.toString(); });
                    res.on('end', () => {
                        if (res.statusCode !== 200) {
                            try {
                                const err = JSON.parse(raw);
                                reject(new Error(err.error?.message || `API error ${res.statusCode}`));
                            } catch {
                                reject(new Error(`API returned ${res.statusCode}: ${raw.slice(0, 200)}`));
                            }
                            return;
                        }
                        try {
                            const parsed = JSON.parse(raw);
                            const content = parsed.choices?.[0]?.message?.content || '';
                            const usage = parsed.usage ? {
                                promptTokens: parsed.usage.prompt_tokens || 0,
                                completionTokens: parsed.usage.completion_tokens || 0,
                                totalTokens: parsed.usage.total_tokens || 0,
                                cost: parsed.usage.cost,
                            } : null;

                            // 🐛 BUGFIX (Julio 2026): En modo no-streaming, el error real del
                            // upstream suele estar en parsed.error.message. Si solo tenemos
                            // 0 tokens y contenido vacío, no podemos distinguir la causa exacta.
                            // Reportamos genérico y dejamos que hermes-bridge.js haga el análisis
                            // fino sobre el error completo.
                            const isEmptyCompletion = usage &&
                                usage.totalTokens === 0 &&
                                !(parsed.choices?.[0]?.message?.content || '').trim();
                            if (isEmptyCompletion) {
                                // Log del error real del gateway si existe
                                const gatewayError = parsed.error?.message || parsed.error || '';
                                const debugInfo = gatewayError ? `Gateway error: ${gatewayError}` : 'Sin error específico del gateway';
                                console.warn(`[HERMES-GATEWAY] ⚠️ Respuesta vacía. Modelo: ${model}. ${debugInfo}`);
                                const errorMsg = `⚠️ El modelo upstream (${model}) no generó respuesta (0 tokens, contenido vacío). Esto puede deberse a un error de la API, saldo insuficiente, o un problema de conexión con el Gateway. Revisá la consola del servidor para más detalles.`;
                                reject(new Error(errorMsg));
                                return;
                            }

                            resolve({
                                response: content,
                                sessionId: sessionId || null,
                                usage: usage,
                            });
                        } catch (e) {
                            reject(new Error('Failed to parse response: ' + e.message));
                        }
                    });
                });
                req.on('error', (err) => reject(err));
                req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
                req.write(bodyBuf);
                req.end();
            });
        }

        // Modo streaming: SSE
        let accumulatedContent = '';
        let finalUsage = null;
        let finalSessionId = sessionId;

        const parser = createSseParser({
            onChunk: (text) => {
                accumulatedContent += text;
                if (onChunk) onChunk(text);
            },
            onReasoningChunk,
            onToolEvent,
            onToolProgress,
            onUsage: (usage) => {
                finalUsage = usage;
                if (onUsage) onUsage(usage);
            },
            onDone(sid) {
                if (onDone) onDone(sid || sessionId || null);
            },
            onError,
        });

        return new Promise((resolve, reject) => {

            const requester = getRequester(url);
            const req = requester.request(url, {
                method: 'POST',
                headers,
                timeout: defaultTimeout,
                signal: opts.signal,
            }, (res) => {
                // Capturar session id del header de respuesta
                const sid = res.headers['x-hermes-session-id'];
                if (sid) {
                    finalSessionId = Array.isArray(sid) ? sid[0] : sid;
                }

                if (res.statusCode !== 200) {
                    let errBody = '';
                    res.on('data', (d) => { errBody += d.toString(); });
                    res.on('end', () => {
                        try {
                            const err = JSON.parse(errBody);
                            reject(new Error(err.error?.message || `API error ${res.statusCode}`));
                        } catch {
                            reject(new Error(`API returned ${res.statusCode}: ${errBody.slice(0, 200)}`));
                        }
                    });
                    return;
                }

                res.on('data', (chunk) => {
                    const text = chunk.toString();
                    parser.onChunk(text);
                });

                res.on('end', () => {
                    parser.onEnd();

                    // 🐛 BUGFIX (Julio 2026): En modo streaming, el error puede venir en
                    // eventos SSE separados que NO se acumulan en accumulatedContent.
                    // No podemos distinguir la causa exacta desde acá — reportamos genérico
                    // y dejamos que el bridge (hermes-bridge.js) haga el análisis fino
                    // sobre el mensaje de error completo.
                    const hasRealContent = accumulatedContent.trim().length > 0;
                    const isEmptyCompletion = finalUsage &&
                        finalUsage.totalTokens === 0 &&
                        !hasRealContent;

                    if (isEmptyCompletion) {
                        const rawSnippet = accumulatedContent.slice(0, 200);
                        console.warn(`[HERMES-GATEWAY] ⚠️ Respuesta vacía (streaming). Modelo: ${model}. Raw: ${rawSnippet}`);
                        const errorMsg = `⚠️ El modelo upstream (${model}) no generó respuesta (0 tokens, contenido vacío). Esto puede deberse a un error de la API, saldo insuficiente, o un problema de conexión con el Gateway. Revisá la consola del servidor para más detalles.`;
                        if (onError) onError(errorMsg);
                        reject(new Error(errorMsg));
                        return;
                    }

                    resolve({
                        response: accumulatedContent,
                        sessionId: finalSessionId || null,
                        usage: finalUsage,
                    });
                });

                res.on('error', (err) => {
                    parser.abort();
                    if (err.message === 'aborted' || err.name === 'AbortError') {
                        reject(new Error('Request aborted'));
                    } else {
                        reject(new Error(`Stream error: ${err.message}`));
                    }
                });
            });

            req.on('error', (err) => {
                if (err.name === 'AbortError') {
                    reject(new Error('Request aborted'));
                } else {
                    reject(new Error(`API request failed: ${err.message}`));
                }
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('API request timed out'));
            });

            // Hook para acumular contenido si nadie provee onChunk
            const originalOnChunk = parser.onChunk;
            // No podemos reemplazar, mejor hacemos tracking desde afuera

            req.write(bodyBuf);
            req.end();
        });
    }

    /**
     * Detecta si el gateway está disponible.
     */
    async function health() {
        const url = `${baseUrl}/health`;
        return new Promise((resolve) => {
            const requester = getRequester(url);
            const req = requester.get(url, {
                timeout: 3000,
                headers: getAuthHeaders(),
            }, (res) => {
                resolve(res.statusCode === 200);
                res.resume();
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    }

    return { chat, health, baseUrl };
}
