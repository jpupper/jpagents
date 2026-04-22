import fs from 'fs';
const path = 'main.js';
let content = fs.readFileSync(path, 'utf8');

// Fix 1: errorMsg cleanup
const oldErrorMsg = 'const errorMsg = `⚠️ No se pudieron aplicar tus cambios:\\n${actionResult.errors.join(\'\\n\')}\\n\\nPor favor, corrige tu respuesta. Si el error es de SEARCH, lee el archivo de nuevo para asegurarte de copiar el bloque EXACTO. Si no usaste etiquetas, hazlo ahora.`;';
const newErrorMsg = 'const errorMsg = `⚠️ No se pudieron aplicar tus cambios:\\n${actionResult.errors.join(\'\\n\')}\\n\\nPor favor, utiliza el formato MCP [CALL:...] válido. Verifica que el JSON sea correcto y que hayas leído los archivos necesarios con read_file.`;';
content = content.replace(oldErrorMsg, newErrorMsg);

// Fix 2: displayContent in autoRetry
const oldDisplayLine = 'chat.messages.push({ role: \'agent\', content: displayContent + logsHtml });';
const newDisplayBlock = `// Clean display text: replace MCP CALL blocks with clickable links
        let displayContent = assistantResponse
            .replace(/\\[CALL:(.*?)\\]([\\s\\S]*?)\\[\\/CALL\\]/g, (match, toolName, argsText) => {
                let args = {};
                try { args = JSON.parse(argsText); } catch(e) {}
                const name = args.filePath || args.folderPath || toolName;
                return \`<div class="file-action-link">🛠️ Herramienta: <strong>\${toolName}</strong> (\${name})</div>\`;
            });

        chat.messages.push({ role: 'agent', content: displayContent + logsHtml });`;

const parts = content.split(oldDisplayLine);
if (parts.length >= 3) {
    content = parts[0] + oldDisplayLine + parts[1] + newDisplayBlock + parts[2];
} else if (parts.length === 2) {
    content = parts[0] + newDisplayBlock + parts[1];
}

fs.writeFileSync(path, content);
console.log('Fixed main.js successfully.');
