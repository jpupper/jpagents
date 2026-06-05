const { MongoClient } = require('mongodb');

async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('jpagents');
  const sessions = db.collection('sessions');

  // 1. Cargar global_state
  let gs = await sessions.findOne({ _id: 'global_state' });
  let state = gs ? gs.state : { projects: [] };
  state.projects = state.projects || [];

  // Verificar si ya existe
  const existing = state.projects.find(p => p.name.toLowerCase() === 'fuegovioleta');
  if (existing) {
    console.log('El proyecto FuegoVioleta ya existe:', existing.id);
    return;
  }

  // 2. Crear proyecto
  const projectId = 'proj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newProject = {
    id: projectId,
    name: 'FuegoVioleta',
    chats: [],
    folder: '',
    model: 'deepseek-v4-pro'
  };
  state.projects.push(newProject);
  console.log('📁 Proyecto FuegoVioleta creado:', projectId);

  // 3. Crear agente
  const chatId = 'chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const agent = {
    id: chatId,
    name: 'Generative Artist',
    messages: [],
    isThinking: false,
    isRunning: false,
    isStopped: false,
    mode: 'auto',
    lastProgress: Date.now(),
    model: 'deepseek-v4-pro',
    useHermes: true
  };
  newProject.chats.push(agent);
  console.log('🤖 Agente Generative Artist creado:', chatId);

  // 4. Inyectar mensaje de tarea
  const taskMessage = {
    role: 'user',
    content: `CREÁ UN SKETCH INTERACTIVO DE P5.JS SOBRE FUEGO VIOLETA.

REQUISITOS:
- Título: "Fuego Violeta" — obra generativa en p5.js
- Archivo destino: D:/Programacion/fuegovioleta/index.html
- Tema: fuego violeta/morado (tonos #800080, #9400D3, #8A2BE2, #DA70D6, violeta profundo a magenta claro)

CARACTERÍSTICAS VISUALES:
- Partículas de fuego que emanan desde la base hacia arriba, con colores degradados violeta
- Efecto de calor con distorsión/ondulación de fondo
- Partículas con diferentes tamaños, velocidades y opacidades que simulan llamas
- Estela/cola de cada partícula se desvanece gradualmente
- Interacción con mouse: las partículas se ven afectadas por la posición del mouse (atracción/repulsión)
- Fondo oscuro profundo (casi negro, #0a0015) para que el violeta contraste
- Partículas más brillantes hacia el centro, más translúcidas en los bordes
- Sistema de partículas optimizado (object pooling o similar) para mantener buen framerate

CONTROLES:
- Click izquierdo: ráfaga de partículas violeta
- Click derecho: cambia la forma de la llama (estilo llama, estilo chispa, estilo onda)
- Rueda del mouse: controla la intensidad / cantidad de partículas
- Tecla 'R': reiniciar el sketch
- Tecla 'S': guardar screenshot (canvas.toDataURL + download)

ESTRUCTURA DEL HTML:
- Un solo archivo index.html autónomo (p5.js vía CDN)
- CSS inline para posicionar y estilizar la página
- El sketch DEBE ser fullscreen
- Footer pequeño con instrucciones de control

IMPORTANTE: Probá que funcione visualmente. Asegurate de que las partículas violeta se vean bien contra el fondo oscuro.`,
    timestamp: Date.now()
  };
  agent.messages.push(taskMessage);
  console.log('📝 Mensaje de tarea inyectado');

  // 5. Guardar
  await sessions.updateOne(
    { _id: 'global_state' },
    { $set: { state, updatedAt: new Date() } },
    { upsert: true }
  );

  console.log('\n✅ TODO LISTO:');
  console.log(`   Proyecto: FuegoVioleta (${projectId})`);
  console.log(`   Agente: Generative Artist (${chatId})`);
  console.log(`   Tarea inyectada con ${taskMessage.content.length} caracteres`);

  await client.close();
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
