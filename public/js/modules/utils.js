/**
 * utils.js — Funciones puras de utilidad. Sin dependencias externas.
 */
// ── escapeHtml ──
export function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}
window.escapeHtml = escapeHtml;

// ── ANSI Strip ──
export function stripAnsi(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b[PX^_].*?(?:\x1b\\)/g, '')
        .replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '')
        .replace(/\x1b[\[\(].{0,3}/g, '')
        .replace(/\x1b./g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}
window.stripAnsi = stripAnsi;

// ── ANSI to HTML ──
export function ansiToHtml(text) {
    if (typeof text !== 'string') return escapeHtml(String(text));
    let html = escapeHtml(text);
    let result = '';
    let i = 0;
    let openSpans = 0;
    const FG = ['#1a1a1a','#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#abb2bf'];
    const FG_BRIGHT = ['#5c6370','#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#ffffff'];
    const BG = ['#1a1a1a','#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#abb2bf'];
    const BG_BRIGHT = ['#5c6370','#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#ffffff'];
    let cur = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
    function styleStr() {
        const s = [];
        if (cur.fg) s.push('color:' + cur.fg);
        if (cur.bg) s.push('background-color:' + cur.bg);
        if (cur.bold) s.push('font-weight:bold');
        if (cur.dim) s.push('opacity:0.6');
        if (cur.italic) s.push('font-style:italic');
        if (cur.underline) s.push('text-decoration:underline');
        return s.join(';');
    }
    function closeSpans() { while (openSpans > 0) { result += '</span>'; openSpans--; } }
    function openSpan() {
        closeSpans();
        const st = styleStr();
        if (st) { result += '<span style="' + st + '">'; openSpans = 1; }
    }
    while (i < html.length) {
        if (html.charCodeAt(i) === 27 && html.charAt(i + 1) === '[') {
            let j = i + 2;
            while (j < html.length && !/[A-Za-z@-_]/.test(html.charAt(j))) j++;
            if (j >= html.length) break;
            const params = html.substring(i + 2, j);
            const final = html.charAt(j);
            i = j + 1;
            if (final !== 'm') continue;
            const codes = params ? params.split(';').map(Number) : [0];
            for (const c of codes) {
                if (c === 0) { cur = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false }; }
                else if (c === 1) cur.bold = true;
                else if (c === 2) cur.dim = true;
                else if (c === 3) cur.italic = true;
                else if (c === 4) cur.underline = true;
                else if (c === 22) { cur.bold = false; cur.dim = false; }
                else if (c === 23) cur.italic = false;
                else if (c === 24) cur.underline = false;
                else if (c >= 30 && c <= 37) cur.fg = FG[c - 30];
                else if (c === 39) cur.fg = null;
                else if (c >= 90 && c <= 97) cur.fg = FG_BRIGHT[c - 90];
                else if (c >= 40 && c <= 47) cur.bg = BG[c - 40];
                else if (c === 49) cur.bg = null;
                else if (c >= 100 && c <= 107) cur.bg = BG_BRIGHT[c - 100];
            }
            openSpan();
            continue;
        }
        result += html.charAt(i);
        i++;
    }
    closeSpans();
    return result.replace(/\r\n?/g, '\n');
}
window.ansiToHtml = ansiToHtml;

// ── createChat ──
export function createChat(project, opts = {}) {
    const { name, useHermes = true, model, skills, mode = 'auto' } = opts;
    const chatName = name || 'Agente ' + ((project.chats?.length || 0) + 1);
    return {
        id: 'chat-' + (Date.now().toString(36) + Math.random().toString(36).substr(2)),
        name: chatName, messages: [], isThinking: false, isRunning: false, isStreaming: false, isStopped: false,
        mode, lastProgress: Date.now(), model: model || project?.model || '', useHermes, isNew: true,
        skills: skills || (project?.skills ? [...project.skills] : []),
        totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalApiCalls: 0
    };
}

// ── isAgentActive ──
export function isAgentActive(chat) {
    if (!chat) return false;
    return !!chat.isThinking;
}

// ── getDiffEngine ──
export function getDiffEngine() {
    return window.JsDiff || window.Diff || (typeof JsDiff !== 'undefined' ? JsDiff : null) || (typeof Diff !== 'undefined' ? Diff : null);
}
window.getDiffEngine = getDiffEngine;

// ── countLines ──
export function countLines(str) {
    if (!str || str.length === 0) return 0;
    const lines = str.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') return lines.length - 1;
    return (lines.length === 1 && lines[0] === '') ? 0 : lines.length;
}
window.countLines = countLines;

// ── getLanguage ──
export function getLanguage(ext) {
    const map = {
        'js': 'javascript', 'ts': 'typescript', 'py': 'python',
        'html': 'xml', 'css': 'css', 'json': 'json',
        'md': 'markdown', 'txt': 'plaintext', 'bat': 'dos',
        'sql': 'sql', 'sh': 'bash'
    };
    return map[ext] || null;
}
window.getLanguage = getLanguage;

// ── formatProgressLines ──
export function formatProgressLines(rawContent) {
    if (!rawContent) return '';
    return rawContent.split('\n').map(line => {
        const trimmed = line.trim();
        const escaped = escapeHtml(line);
        if (trimmed.startsWith('+')) return `<span class="diff-add">${escaped}</span>`;
        if (trimmed.startsWith('-')) return `<span class="diff-del">${escaped}</span>`;
        if (trimmed.startsWith('🛠️') || trimmed.includes('🛠️')) return `<span class="tool-line">${escaped}</span>`;
        if (/^[📖📝🔧🔍⚙️]/.test(trimmed)) return `<span class="tool-line">${escaped}</span>`;
        if (trimmed.startsWith('✅')) return `<span class="status-ok">${escaped}</span>`;
        if (trimmed.startsWith('❌')) return `<span class="status-err">${escaped}</span>`;
        if (trimmed.startsWith('🤔')) return `<span class="thinking-line">${escaped}</span>`;
        return escaped;
    }).join('\n');
}

// ── highlightGitDiff ──
export function highlightGitDiff(diffText) {
    if (!diffText) return '';
    return diffText.split('\n').map(line => {
        const esc = escapeHtml(line);
        if (/^(diff --git|index |--- |\+\+\+ )/.test(esc)) return `<span class="gd-header">${esc}</span>`;
        if (/^@@ /.test(esc)) return `<span class="gd-hunk">${esc}</span>`;
        if (/^\-/.test(esc)) return `<span class="gd">${esc}</span>`;
        if (/^\+/.test(esc)) return `<span class="gi">${esc}</span>`;
        return esc;
    }).join('\n');
}

// ── formatMarkdown ──
export function formatMarkdown(text) {
    try {
        const clean = stripAnsi(text);
        const str = typeof clean === 'string' ? clean : (typeof clean === 'object' ? JSON.stringify(clean, null, 2) : String(clean || ""));
        if (window.marked && window.marked.parse) {
            return window.marked.parse(str, { gfm: true, breaks: true });
        }
        return text.replace(/\n/g, '<br>');
    } catch (e) {
        return text.replace(/\n/g, '<br>');
    }
}

// ── pathJoin ──
export function pathJoin(dir, file) {
    if (!dir) return file;
    if (!file) return dir;
    const fSan = file.replace(/\\/g, '/');
    if (fSan.includes(':') || fSan.startsWith('/')) return fSan;
    const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
    const f = fSan.replace(/^\//, '');
    return d + '/' + f;
}
window.pathJoin = pathJoin;

// ── syncModeUI ──
export function syncModeUI(mode) {
    const isAuto = mode === 'auto';
    const toggle = document.getElementById('mode-switch-toggle');
    const accept = document.getElementById('accept-change');
    const reject = document.getElementById('reject-change');
    if (toggle) toggle.checked = isAuto;
    if (accept) accept.style.display = isAuto ? 'none' : '';
    if (reject) reject.style.display = isAuto ? 'none' : '';
}

// ── formatLogs ──
export function formatLogs(logs) {
    if (!logs || logs.length === 0) return '<div class="log-empty">Sin logs</div>';
    return [...logs].reverse().map(l => {
        const time = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '--:--:--';
        return `<div class="log-entry ${l.type || 'info'}">
            <span class="log-time">[${time}]</span>
            <span class="log-type">${(l.type || 'INFO').toUpperCase()}:</span>
            <span class="log-msg">${escapeHtml((l.messages || []).join(' '))}</span>
        </div>`;
    }).join('');
}
