const http = require('http');

const BASE = 'http://localhost:3001';

async function getSessions() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/api/sessions`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function saveSessions(data) {
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
  const projects = state.projects || state.sessions || [];
  console.log('Proyectos actuales:', projects.map(p => p.name || p.projectName));

  // Check if Fuego Violeta already exists
  const exists = projects.some(p => (p.name || p.projectName || '').toLowerCase().includes('fuego'));
  if (exists) {
    console.log('✅ Fuego Violeta ya está en la DB.');
    return;
  }

  // Add it
  const folderPath = 'D:/Programacion/jpagents/proyects/fuego_violeta';
  const newProject = {
    id: 'proj-fuego-' + Date.now(),
    projectName: 'Fuego Violeta',
    name: 'Fuego Violeta',
    folder: folderPath,
    path: folderPath,
    description: 'Interactive p5.js violet fire particle system',
    createdAt: new Date().toISOString()
  };

  // Create a new array with the new project appended
  const updated = [...projects, newProject];
  const payload = { ...state, projects: updated, sessions: updated };

  const result = await saveSessions(payload);
  console.log('✅ Fuego Violeta registrado en DB.');
  console.log('Respuesta:', result.slice(0, 200));

  // Verify
  const check = await getSessions();
  const names = (check.projects || check.sessions || []).map(p => p.name || p.projectName);
  console.log('Proyectos ahora:', JSON.stringify(names));
})();
