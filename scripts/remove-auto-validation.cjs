/**
 * remove-auto-validation.cjs
 * 
 * 1) Elimina mode-switch (AUTO/SUPV) del chat
 * 2) Elimina el bucle de validación automática
 * 3) Renombra la pestaña "Bucle de Validación" a "Standard settings"
 * 4) Elimina autoValidation/maxValidationRetries del estado
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let changes = 0;

// ════════════════════════════════════════════
// 1. public/index.html
// ════════════════════════════════════════════
(function fixHTML() {
    const fp = path.join(ROOT, 'public', 'index.html');
    let html = fs.readFileSync(fp, 'utf8');

    // 1a. Remove mode-switch-container
    const modeSwitchBlock = `<div class="mode-switch-container">
                <div id="mode-switch-toggle" class="mode-switch auto" title="Alternar Modo: Auto / Supervisado">
                  <div class="mode-switch-handle">
                    <span class="mode-icon-manual">🤖</span>
                  </div>
                </div>
              </div>`;

    // Try exact match first, then flexible
    let modeIdx = html.indexOf(modeSwitchBlock);
    if (modeIdx >= 0) {
        html = html.slice(0, modeIdx) + html.slice(modeIdx + modeSwitchBlock.length);
        console.log('1a. ✅ Mode-switch removido del HTML');
        changes++;
    } else {
        // Flexible match: find mode-switch-container
        const flexStart = html.indexOf('<div class="mode-switch-container">');
        if (flexStart >= 0) {
            const flexEnd = html.indexOf('</div>', flexStart) + 6;
            // Need to find the actual closing div - count nested divs
            let depth = 0;
            let end = flexStart;
            let inTag = false;
            for (let i = flexStart; i < html.length; i++) {
                const c = html[i];
                if (c === '<') inTag = true;
                else if (c === '>') inTag = false;
                else if (!inTag && c === '<' && html.slice(i, i+5) === '<div ') { depth++; }
                else if (!inTag && c === '<' && html.slice(i, i+6) === '</div>') {
                    if (depth === 0) { end = i + 6; break; }
                    depth--;
                }
            }
            html = html.slice(0, flexStart) + html.slice(end);
            console.log('1a. ✅ Mode-switch removido del HTML (flex match)');
            changes++;
        } else {
            console.log('1a. ⚠️ Mode-switch no encontrado en HTML');
        }
    }

    // 1b. Rename sidebar tab: "🔄 Bucle de Validación" → "Standard settings"
    const oldTab = '<span>🔄 Bucle de Validación</span>';
    const newTab = '<span>Standard settings</span>';
    if (html.includes(oldTab)) {
        html = html.replace(oldTab, newTab);
        console.log('1b. ✅ Tab renombrado a "Standard settings"');
        changes++;
    } else {
        console.log('1b. ⚠️ Tab "Bucle de Validación" no encontrado');
    }

    // 1c. Replace validation-loop tab content with simplified Standard settings
    const oldValidationContent = `<div id="modal-tab-validation-loop" class="modal-tab-content hidden">
              <div class="modal-body-content">
                <div class="sub-tab-pane">
                  <div class="config-field">
                    <label>Máximo de Reintentos de Validación</label>
                    <p class="field-help">Número de veces que el agente intentará corregir el proyecto si falla la validación (Screenshot + Consola). Pon 0 para desactivar, o un número alto (ej: 15) para máxima autonomía. Use "999" para infinito (virtualmente).</p>
                    <input type="number" id="max-validation-retries" class="config-input" min="0" value="15" />
                  </div>
                  <div class="config-field">
                    <label>Validación Automática</label>
                    <p class="field-help">¿Debería el agente iniciar automáticamente la validación tras generar archivos?</p>
                    <div class="toggle-container">
                      <input type="checkbox" id="auto-validation-toggle" checked />
                      <span>Activar validación automática</span>
                    </div>
                  </div>
                  <div class="config-field">
                    <label>Abrir Archivos Modificados</label>
                    <p class="field-help">Cuando un agente termina de modificar archivos, ¿abrir automáticamente pestañas con cada archivo modificado?</p>
                    <div class="toggle-container">
                      <input type="checkbox" id="auto-open-files-toggle" checked />
                      <span>Abrir archivos modificados en pestañas</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>`;

    const newStandardContent = `<div id="modal-tab-standard-settings" class="modal-tab-content">
              <div class="modal-body-content">
                <div class="sub-tab-pane">
                  <div class="config-field">
                    <label>Abrir Archivos Modificados</label>
                    <p class="field-help">Cuando un agente termina de modificar archivos, ¿abrir automáticamente pestañas con cada archivo modificado?</p>
                    <div class="toggle-container">
                      <input type="checkbox" id="auto-open-files-toggle" checked />
                      <span>Abrir archivos modificados en pestañas</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>`;

    if (html.includes(oldValidationContent)) {
        html = html.replace(oldValidationContent, newStandardContent);
        console.log('1c. ✅ Contenido de validación reemplazado por Standard settings');
        changes++;
    } else {
        // Try more flexible match for the validation tab
        const valTabStart = html.indexOf('id="modal-tab-validation-loop"');
        if (valTabStart >= 0) {
            // Find the end of this block: </div></div></div>
            let depth = 0;
            let end = valTabStart;
            let foundFirst = false;
            for (let i = valTabStart; i < html.length; i++) {
                // Check for opening div
                if (html.slice(i, i+5) === '<div ') { depth++; }
                // Check for closing div
                if (html.slice(i, i+6) === '</div>') {
                    if (depth === 0 && foundFirst) { end = i + 6; break; }
                    depth--;
                    if (!foundFirst) foundFirst = true;
                }
            }
            // Also try looking for the pattern after the original start
            const blockEnd = html.indexOf('</div>', html.indexOf('</div>', valTabStart) + 6) + 6;
            const blockEnd2 = html.indexOf('</div>', blockEnd) + 6;
            
            // Simpler: find the 3 closing divs pattern after the tab content starts
            // The validation tab structure is:
            // <div id="modal-tab-validation-loop" class="modal-tab-content hidden">
            //   <div class="modal-body-content">
            //     <div class="sub-tab-pane">
            //       ... config fields ...
            //     </div>
            //   </div>
            // </div>
            
            // Find first closing div that's at the right nesting level
            let searchStart = valTabStart;
            for (let divCount = 0; divCount < 4; divCount++) {
                searchStart = html.indexOf('</div>', searchStart) + 6;
            }
            
            const fullOldBlock = html.slice(valTabStart, searchStart);
            
            // Replace the content inside keeping the tab header structure
            const simpleContent = `<div id="modal-tab-standard-settings" class="modal-tab-content">
              <div class="modal-body-content">
                <div class="sub-tab-pane">
                  <div class="config-field">
                    <label>Abrir Archivos Modificados</label>
                    <p class="field-help">Cuando un agente termina de modificar archivos, ¿abrir automáticamente pestañas con cada archivo modificado?</p>
                    <div class="toggle-container">
                      <input type="checkbox" id="auto-open-files-toggle" checked />
                      <span>Abrir archivos modificados en pestañas</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>`;

            html = html.slice(0, valTabStart) + simpleContent + html.slice(searchStart);
            console.log('1c. ✅ Contenido de validación reemplazado (flex match)');
            changes++;
        } else {
            console.log('1c. ⚠️ Validation tab no encontrado en HTML');
        }
    }

    fs.writeFileSync(fp, html, 'utf8');
    console.log('✅ index.html guardado');
})();

// ════════════════════════════════════════════
// 2. public/js/modules/dom-refs.js
// ════════════════════════════════════════════
(function fixDomRefs() {
    const fp = path.join(ROOT, 'public', 'js', 'modules', 'dom-refs.js');
    let content = fs.readFileSync(fp, 'utf8');

    const line = `export const modeSwitchToggle = document.getElementById('mode-switch-toggle');`;
    if (content.includes(line)) {
        content = content.replace(line, '');
        fs.writeFileSync(fp, content, 'utf8');
        console.log('2. ✅ modeSwitchToggle removido de dom-refs.js');
        changes++;
    } else {
        console.log('2. ⚠️ modeSwitchToggle no encontrado en dom-refs.js');
    }
})();

// ════════════════════════════════════════════
// 3. public/js/modules/state.js
// ════════════════════════════════════════════
(function fixState() {
    const fp = path.join(ROOT, 'public', 'js', 'modules', 'state.js');
    let content = fs.readFileSync(fp, 'utf8');

    // Remove autoValidation from default state
    if (content.includes('autoValidation: true,')) {
        content = content.replace('autoValidation: true,\n    ', '');
        console.log('3a. ✅ autoValidation removido de state.js defaults');
        changes++;
    }

    // Remove maxValidationRetries from default state
    if (content.includes('maxValidationRetries: 15,')) {
        content = content.replace('maxValidationRetries: 15,\n    ', '');
        console.log('3b. ✅ maxValidationRetries removido de state.js defaults');
        changes++;
    }

    // Remove state.mode
    if (content.includes("mode: 'auto',")) {
        content = content.replace("mode: 'auto',\n    ", '');
        console.log('3c. ✅ mode removido de state.js defaults');
        changes++;
    }

    fs.writeFileSync(fp, content, 'utf8');
    console.log('✅ state.js guardado');
})();

// ════════════════════════════════════════════
// 4. server/utils/session.js
// ════════════════════════════════════════════
(function fixSession() {
    const fp = path.join(ROOT, 'server', 'utils', 'session.js');
    let content = fs.readFileSync(fp, 'utf8');

    // Remove 'maxValidationRetries', 'autoValidation' from configKeys array
    const oldConfigKeys = `'maxValidationRetries', 'autoValidation', 'autoOpenModifiedFiles',`;
    if (content.includes(oldConfigKeys)) {
        content = content.replace(oldConfigKeys, `'autoOpenModifiedFiles',`);
        console.log('4. ✅ autoValidation/maxValidationRetries removido de session.js config keys');
        changes++;
    } else {
        console.log('4. ⚠️ Patrón no encontrado en session.js');
    }

    fs.writeFileSync(fp, content, 'utf8');
    console.log('✅ session.js guardado');
})();

// ════════════════════════════════════════════
// 5. public/js/main.js (the big one)
// ════════════════════════════════════════════
(function fixMainJS() {
    const fp = path.join(ROOT, 'public', 'js', 'main.js');
    let content = fs.readFileSync(fp, 'utf8');
    let count = 0;

    // 5a. Remove modeSwitchToggle from import
    const oldImport = 'modeSwitchToggle, ';
    const newImport = '';
    if (content.includes(oldImport)) {
        content = content.replace(oldImport, newImport);
        count++;
        console.log('5a. ✅ modeSwitchToggle removido del import');
    }

    // 5b. Remove mode-switch toggle handler block
    const modeHandlerStart = `modeSwitchToggle.onclick = () => {`;
    const modeHandlerIdx = content.indexOf(modeHandlerStart);
    if (modeHandlerIdx >= 0) {
        // Find the closing of the handler (ends with `};` before the next comment or handler)
        let braceDepth = 0;
        let end = modeHandlerIdx;
        let foundArrow = false;
        for (let i = modeHandlerIdx; i < content.length; i++) {
            const c = content[i];
            if (c === '{') { braceDepth++; foundArrow = true; }
            if (c === '}') {
                braceDepth--;
                if (braceDepth === 0 && foundArrow) {
                    // Check for the next line being a `//` comment or another handler
                    end = i + 1;
                    break;
                }
            }
        }
        // Extend to include the trailing newline
        const block = content.slice(modeHandlerIdx, end);
        content = content.slice(0, modeHandlerIdx) + content.slice(end);
        count++;
        console.log(`5b. ✅ Mode-switch handler removido (${block.length} chars)`);
    }

    // 5c. Remove mode update code block (the if/else that updates classes)
    const modeUpdateBlock = `    if (!modeSwitchToggle) return;
    if (chat.mode === 'auto') {
        modeSwitchToggle.classList.add('auto');
        modeSwitchToggle.classList.remove('supervised');
        modeSwitchToggle.querySelector('.mode-icon-manual').textContent = '🤖';
    } else {
        modeSwitchToggle.classList.add('supervised');
        modeSwitchToggle.classList.remove('auto');
        modeSwitchToggle.querySelector('.mode-icon-manual').textContent = '👤';
    }`;
    
    if (content.includes(modeUpdateBlock)) {
        content = content.replace(modeUpdateBlock, '');
        count++;
        console.log('5c. ✅ Mode update block removido');
    } else {
        // Try more flexible match
        const modeUpdateStart = `if (!modeSwitchToggle) return;`;
        const modeUpdateEnd = `modeSwitchToggle.querySelector('.mode-icon-manual').textContent = '👤';`;
        const startIdx = content.indexOf(modeUpdateStart);
        if (startIdx >= 0) {
            const endIdx = content.indexOf(modeUpdateEnd, startIdx) + modeUpdateEnd.length;
            const block = content.slice(startIdx, endIdx);
            content = content.slice(0, startIdx) + content.slice(endIdx);
            count++;
            console.log(`5c. ✅ Mode update block removido (flex match, ${block.length} chars)`);
        } else {
            console.log('5c. ⚠️ Mode update block no encontrado');
        }
    }

    // 5d. Remove /mode slash command line
    const slashModeCmd = `{ cmd: '/mode', desc: 'Alternar modo Auto / Supervisado', action: 'mode', icon: '⚙️' },`;
    if (content.includes(slashModeCmd)) {
        content = content.replace(slashModeCmd, '');
        count++;
        console.log('5d. ✅ /mode slash command removido');
    }

    // 5e. Remove mode response handling in slash commands
    // Look for "Modo: " + chat.mode pattern
    const modeResponse = `showToast(\`Modo: \${chat.mode === 'auto' ? '🤖 Auto' : '👁️ Supervisado'}\``;
    const modeResponseIdx = content.indexOf(modeResponse);
    if (modeResponseIdx >= 0) {
        // Find the end of this statement (at the `;`)
        const endIdx = content.indexOf(';', modeResponseIdx) + 1;
        content = content.slice(0, modeResponseIdx) + content.slice(endIdx);
        count++;
        console.log('5e. ✅ Mode response toast removido');
    }

    // 5f. Remove autoValidation state loading
    content = content.replace(
        "state.autoValidation = data.autoValidation !== undefined ? data.autoValidation : true;\n            ",
        ''
    );
    content = content.replace(
        "state.maxValidationRetries = data.maxValidationRetries !== undefined ? data.maxValidationRetries : 15;\n            ",
        ''
    );

    // 5g. Remove autoValidation from saveData() payload
    const autoValSaveLine = `autoValidation: state.autoValidation,\n            `;
    if (content.includes(autoValSaveLine)) {
        content = content.replace(autoValSaveLine, '');
        count++;
        console.log('5g. ✅ autoValidation removido de saveData()');
    }
    
    const maxRetriesSaveLine = `maxValidationRetries: state.maxValidationRetries,\n            `;
    if (content.includes(maxRetriesSaveLine)) {
        content = content.replace(maxRetriesSaveLine, '');
        count++;
        console.log('5g. ✅ maxValidationRetries removido de saveData()');
    }

    // 5h. Remove auto-validation loop function entirely
    // The function starts with: `if (!state.autoValidation) return;` and ends at the next function or significant comment
    const valLoopStart = `    if (!state.autoValidation) return;`;
    const valLoopIdx = content.indexOf(valLoopStart);
    if (valLoopIdx >= 0) {
        // Find end - look for a line that starts with some significant comment or function definition
        // The validation function is inside some larger function. Let me trace back to find the function entry.
        // Look backwards for the function entry point
        const funcStartMarkers = [
            'async function runAutoValidation(',
            'function runAutoValidation(',
        ];
        
        let funcStart = -1;
        for (const marker of funcStartMarkers) {
            funcStart = content.lastIndexOf(marker, valLoopIdx);
            if (funcStart >= 0) break;
        }
        
        if (funcStart >= 0) {
            // Find function end: next function at same level or end of file region
            // Look for the next `async function` or `function ` or `//` section header
            const afterFunc = content.indexOf('\nfunction ', funcStart + 10);
            const afterAsync = content.indexOf('\nasync function ', funcStart + 10);
            let funcEnd = content.length;
            if (afterFunc > valLoopIdx && afterFunc < funcEnd) funcEnd = afterFunc;
            if (afterAsync > valLoopIdx && afterAsync < funcEnd) funcEnd = afterAsync;

            const block = content.slice(funcStart, funcEnd);
            content = content.slice(0, funcStart) + content.slice(funcEnd);
            count++;
            console.log(`5h. ✅ Auto-validation function removida (${block.length} chars)`);
        } else {
            // Just remove the line and some surrounding code
            content = content.replace(valLoopStart, '');
            console.log('5h. ⚠️ Auto-validation start line removida (no se encontró function start)');
        }
    } else {
        console.log('5h. ⚠️ Auto-validation function start no encontrada');
    }

    // 5i. Remove validation UI loading code
    const valUILoad1 = `        const maxRetriesInput = document.getElementById('max-validation-retries');`;
    const valUILoad2 = `        if (maxRetriesInput) maxRetriesInput.value = state.maxValidationRetries;`;
    const valUILoad3 = `        if (autoValToggle) autoValToggle.checked = state.autoValidation;`;

    if (content.includes(valUILoad1)) {
        content = content.replace(valUILoad1 + '\n', '');
        content = content.replace(valUILoad2 + '\n', '');
        content = content.replace(valUILoad3 + '\n', '');
        count++;
        console.log('5i. ✅ Validation UI loading code removido');
    }

    // 5j. Remove validation UI saving code
    const valUISave1 = `        if (maxRetriesInput) state.maxValidationRetries = parseInt(maxRetriesInput.value) || 0;`;
    const valUISave2 = `        if (autoValToggle) state.autoValidation = autoValToggle.checked;`;

    if (content.includes(valUISave1)) {
        content = content.replace(valUISave1 + '\n', '');
        content = content.replace(valUISave2 + '\n', '');
        count++;
        console.log('5j. ✅ Validation UI saving code removido');
    }

    // 5k. Remove autoValidation from state persist load (the one that's duplicated)
    content = content.replace(
        "state.autoValidation = data.autoValidation !== undefined ? data.autoValidation : true;",
        ''
    );
    
    // 5l. Remove the auto-validation-toggle getElementById lines
    const autoValToggleLine1 = `        const autoValToggle = document.getElementById('auto-validation-toggle');`;
    if (content.includes(autoValToggleLine1)) {
        content = content.replace(autoValToggleLine1 + '\n', '');
        content = content.replace(autoValToggleLine1 + '\n', '');
        count++;
        console.log('5l. ✅ auto-validation-toggle getElementById removido');
    }

    fs.writeFileSync(fp, content, 'utf8');
    console.log(`\n✅ main.js: ${count} cambios aplicados`);
    changes += count;
})();

console.log(`\n═══════════════════════════════════`);
console.log(`✅ Total: ${changes} cambios aplicados`);
console.log(`⚠️  Nota: main.js puede tener código residual — revisá con node --check`);
