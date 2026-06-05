const http = require('http');

// GET current state
const getData = () => new Promise((resolve, reject) => {
  http.get('http://localhost:3001/api/sessions', res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => resolve(JSON.parse(data)));
    res.on('error', reject);
  });
});

async function main() {
  const state = await getData();
  const names = state.projects.map(p => p.name);
  console.log('Current projects:', names.join(', '));

  if (names.includes('Fuego Violeta')) {
    console.log('Fuego Violeta already exists!');
    return;
  }

  // Generate unique ID
  const id = 'proj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  
  state.projects.push({
    id,
    name: 'Fuego Violeta',
    folder: 'D:\\Programacion\\jpagents\\proyects\\fuego_violeta',
    model: 'deepseek-v4-flash',
    chats: []
  });

  // POST save
  const body = JSON.stringify(state);
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/sessions/save',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const result = await new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  console.log('Save result:', result);
  console.log('Fuego Violeta registered successfully!');
}

main().catch(e => { console.error(e); process.exit(1); });
