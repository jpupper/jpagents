/**
 * tool-emojis.js — SINGLE SOURCE OF TRUTH para emojis de herramientas Hermes
 *
 * Si agregás una tool nueva, actualizá SOLO ESTE ARCHIVO.
 * NO dupliques el mapa en hermes-executor.js, server.js, ni en ningún otro lado.
 *
 * Usado por:
 *   - hermes-executor.js (thinking stream)
 *   - server-test.js      (thinking stream)
 *   - hermes-god-worker.js (vía hermes-executor.js)
 *   - server.js            (vía hermes-executor.js)
 */

const TOOL_EMOJIS = {
    // File operations
    read_file: '📖',
    write_file: '✍️',
    search_files: '🔍',
    file: '📁',

    // Execution
    terminal: '💻',
    execute_code: '🐍',
    process: '⚙️',

    // Editing
    patch: '🔧',

    // Web / Search
    web_search: '🌐',
    web_extract: '📄',

    // Vision / Media
    vision_analyze: '👁️',

    // Browser
    browser_navigate: '🌎',
    browser_snapshot: '📸',
    browser_click: '🖱️',
    browser_type: '⌨️',
    browser_scroll: '📜',
    browser_back: '⬅️',
    browser_press: '🔑',
    browser_console: '🖥️',
    browser_vision: '👁️',
    browser_get_images: '🖼️',

    // Knowledge / Memory
    memory: '🧠',
    session_search: '🔎',
    skill_view: '📚',
    skill_manage: '🛠️',

    // Delegation / Agents
    delegate_task: '🤖',
    computer_use: '🖥️',

    // Interaction
    clarify: '❓',

    // Automation
    cronjob: '⏰',
    send_message: '📨',

    // TTS
    text_to_speech: '🔊',

    // Task management
    todo: '📋',

    // Image generation
    image_generate: '🎨',
};

/**
 * Obtiene el emoji para una herramienta.
 * @param {string} name - Nombre de la herramienta (ej: 'web_search', 'read_file')
 * @returns {string} Emoji + espacio, o '🔧 ' si no está mapeada.
 */
function getToolEmoji(name, defaultEmoji = '⚡') {
    return TOOL_EMOJIS[name] || defaultEmoji;
}

export { TOOL_EMOJIS, getToolEmoji };
