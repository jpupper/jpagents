const http = require('http');

const BASE = 'http://localhost:3001';

function sendMessage(projectId, chatId, message) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ message });
    const req = http.request(`${BASE}/api/admin/agents/${projectId}/${chatId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data.slice(0, 1000)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const projectId = 'proj-particulas-violetas-mpyqzws5';
const chatId = 'chat-mpyqzwsmi0go04';

const task = `Creá un archivo sketch.html en D:\\Programacion\\jpagents\\proyects\\particulas_violetas\\ con un efecto de partículas violetas interactivo usando p5.js.

Requisitos:
1. Partículas violetas (tonos 260-300 HSB) con variación de tono
2. El mouse atrae las partículas al pasar cerca (radio ~150px)
3. Click = explosión de partículas desde el cursor
4. Rueda del mouse = controla intensidad del efecto
5. Fondo oscuro (#05000a), partículas con estela (trail)
6. Al menos 500 partículas iniciales
7. Efecto de flujo (noise field) para movimiento orgánico
8. Vista completa, responsiva (windowResized)
9. Incluir texto informativo minimalista: "✦ Partículas Violetas ✦"

Creá el archivo ahora mismo. NO me des explicaciones, solo creá el sketch.html completo.`;

(async () => {
  console.log('📤 Enviando tarea al agente...');
  const result = await sendMessage(projectId, chatId, task);
  console.log('Respuesta:', result);
})();
