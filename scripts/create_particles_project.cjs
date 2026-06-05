const http = require('http');

const BASE = 'http://localhost:3001';

function getSessions() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/api/sessions`, res => {
      let data = '';
      res.on('data', c => data += c.toString('utf-8').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function saveSessions(data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request(`${BASE}/api/sessions/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

(async () => {
  const state = await getSessions();
  const projects = state.projects || [];
  console.log('Proyectos actuales:', projects.map(p => p.name).join(', '));

  // Create project
  const newProject = {
    id: 'proj-particulas-violetas-' + Date.now().toString(36),
    name: 'Efecto Particulas Violetas',
    folder: 'D:/Programacion/jpagents/proyects/particulas_violetas',
    description: '\u2728 Efecto de part\u00edculas violetas interactivo con mouse',
    model: 'deepseek-v4-flash',
    chats: []
  };

  projects.push(newProject);
  const payload = { ...state, projects };
  const result = await saveSessions(payload);
  console.log('✅ Proyecto "Efecto Particulas Violetas" creado.');
  console.log('ID:', newProject.id);

  // Create agent
  const agentResult = await createAgent(newProject.id, 'Particle Creator', 
    'Eres un experto en p5.js y efectos visuales. Tu especialidad es crear part\u00edculas interactivas con el mouse.');
  console.log('✅ Agente "Particle Creator" creado.');
  console.log('ID agente:', (agentResult.agent || {}).id || '?');

  // Verify
  const check = await getSessions();
  const p = check.projects.find(pr => pr.id === newProject.id);
  if (p) {
    console.log(`\n📊 Proyecto: ${p.name}`);
    console.log(`   Agentes: ${(p.chats || []).length}`);
    (p.chats || []).forEach(c => console.log(`   - ${c.name} (${c.id})`));
  }
})();

function createAgent(projectId, agentName, systemPrompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      projectId,
      agentName,
      model: 'deepseek-v4-flash',
      systemPrompt: systemPrompt || ''
    });
    const req = http.request(`${BASE}/api/admin/agents/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
