/**
 * fix-remaining-issues.cjs
 * 1) Fix data-modal-tab to match new div id
 * 2) Clean remaining auto-validation code in main.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ─── 1. Fix index.html: update data-modal-tab attribute ───
(function fixHTML() {
    const fp = path.join(ROOT, 'public', 'index.html');
    let html = fs.readFileSync(fp, 'utf8');

    // Find the validation-loop button and update its data-modal-tab
    const oldBtn = `data-modal-tab="validation-loop">
                <span>🔄 Bucle de Validación</span>`;
    const newBtn = `data-modal-tab="standard-settings">
                <span>Standard settings</span>`;

    if (html.includes(oldBtn)) {
        html = html.replace(oldBtn, newBtn);
        fs.writeFileSync(fp, html, 'utf8');
        console.log('1. ✅ data-modal-tab actualizado a "standard-settings"');
    } else {
        // Try more flexible: find the button with data-modal-tab="validation-loop"
        const match = html.match(/data-modal-tab="validation-loop">/);
        if (match) {
            html = html.replace(match[0], 'data-modal-tab="standard-settings">');
            // Also ensure the label text is updated
            html = html.replace('<span>🔄 Bucle de Validación</span>', '<span>Standard settings</span>');
            fs.writeFileSync(fp, html, 'utf8');
            console.log('1. ✅ data-modal-tab actualizado (flex match)');
        } else {
            console.log('1. ⚠️ Botón validation-loop no encontrado');
        }
    }
})();

// ─── 2. Clean remaining auto-validation / chat.validationRetries in main.js ───
(function fixMainJS() {
    const fp = path.join(ROOT, 'public', 'js', 'main.js');
    let content = fs.readFileSync(fp, 'utf8');

    // 2a. Find and extract the entire auto-validation function block
    // Search for the function that handles validation retries
    const retriesRefs = [
        'chat.validationRetries',
        'state.autoValidation',
        'validationRetries',
        'BUCLE DE VALIDACIÓN',
        'Validación Automática',
        'runAutoValidation'
    ];

    // Find the validation loop function by looking for the systemPrompt generation
    const valPromptStart = 'const systemPrompt = `### 🔄 BUCLE DE VALIDACIÓN';
    const valPromptIdx = content.indexOf(valPromptStart);
    if (valPromptIdx >= 0) {
        // Go backwards to find the function start
        // Look for 'async function' or 'function' before this point
        let funcStart = content.lastIndexOf('\nasync function ', valPromptIdx);
        if (funcStart < 0) funcStart = content.lastIndexOf('\nfunction ', valPromptIdx);
        if (funcStart < 0) funcStart = content.lastIndexOf('\nconst ', valPromptIdx);
        
        if (funcStart >= 0) {
            // Find function end: next `\nfunction`, `\nasync function`, or `\n//` section header
            let funcEnd = content.length;
            const nextFunc = content.indexOf('\nfunction ', funcStart + 1);
            const nextAsync = content.indexOf('\nasync function ', funcStart + 1);
            if (nextFunc > valPromptIdx && nextFunc < funcEnd) funcEnd = nextFunc;
            if (nextAsync > valPromptIdx && nextAsync < funcEnd) funcEnd = nextAsync;
            
            // Also check for the next `// ───` or `// =====` section header
            const nextSection = content.indexOf('\n// ───', funcStart + 1);
            if (nextSection > valPromptIdx && nextSection < funcEnd) funcEnd = nextSection;

            const block = content.slice(funcStart, funcEnd);
            content = content.slice(0, funcStart) + content.slice(funcEnd);
            console.log(`2a. ✅ Bloque de validación removido (${block.length} chars)`);
        } else {
            console.log('2a. ⚠️ No se encontró el inicio de la función de validación');
        }
    } else {
        console.log('2a. ⚠️ BUCLE DE VALIDACIÓN no encontrado (puede que ya haya sido removido)');
    }

    // 2b. Remove any remaining references to chat.validationRetries
    const remainingRetries = [
        'chat.validationRetries >= (state.maxValidationRetries || 15)',
        'chat.validationRetries++',
        'chat.validationRetries',
    ];

    for (const ref of remainingRetries) {
        if (content.includes(ref)) {
            const lines = content.split('\n');
            const newLines = lines.filter(l => !l.includes(ref));
            content = newLines.join('\n');
            console.log(`2b. ✅ Líneas con "${ref}" removidas`);
        }
    }

    // 2c. Remove any remaining maxValidationRetries references in main.js
    const maxRetriesRef = 'state.maxValidationRetries';
    if (content.includes(maxRetriesRef)) {
        const lines = content.split('\n');
        const newLines = lines.filter(l => !l.includes(maxRetriesRef));
        content = newLines.join('\n');
        console.log(`2c. ✅ Líneas con state.maxValidationRetries removidas`);
    }

    // 2d. Remove any remaining state.autoValidation references
    if (content.includes('state.autoValidation')) {
        const lines = content.split('\n');
        const newLines = lines.filter(l => !l.includes('state.autoValidation'));
        content = newLines.join('\n');
        console.log(`2d. ✅ Líneas con state.autoValidation removidas`);
    }

    fs.writeFileSync(fp, content, 'utf8');
    console.log('✅ main.js limpiado');
})();

console.log('\n✅ Fix aplicado');
