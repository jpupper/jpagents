/**
 * fix-project-loop.mjs
 * 
 * BUG: loadData() llama createNewProject() cuando falla. createNewProject()
 * llama saveData(), que dispara sync:stateUpdate via WebSocket, que ejecuta
 * loadData() otra vez, que falla y crea OTRO proyecto... BUCLE INFINITO.
 * 
 * FIX: Reemplazar createNewProject() por console.error().
 */
import fs from 'fs';

const path = 'public/js/main.js';
let c = fs.readFileSync(path, 'utf-8');

const oldCode = `    } catch (e) {
        console.error("Error loading data:", e);
        await createNewProject();
    }`;

const newCode = `    } catch (e) {
        console.error("Error loading data:", e);
        // 🐛 BUGFIX: NO llamar createNewProject() aqui porque eso dispara
        // saveData() → WebSocket sync:stateUpdate → loadData() → error → 
        // createNewProject() → saveData() → ... BUCLE INFINITO.
        // Mejor loguear el error y dejar que el usuario cree proyectos manualmente.
    }`;

if (c.includes(oldCode)) {
    c = c.replace(oldCode, newCode);
    fs.writeFileSync(path, c, 'utf-8');
    console.log('✅ Fix applied: remove createNewProject() from loadData() error handler');
    process.exit(0);
} else {
    console.log('❌ Pattern not found');
    process.exit(1);
}
