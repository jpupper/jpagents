const http = require('http');

// GET current sessions
http.get('http://localhost:3001/api/sessions', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    let data;
    try { data = JSON.parse(body); } catch(e) {
      // Try cleaning control chars
      data = JSON.parse(body.replace(/[\x00-\x1f]/g, ' '));
    }
    
    // Check if already exists
    const exists = data.projects.some(p => p.name === 'Fuego Violeta');
    if (exists) {
      console.log('Fuego Violeta already in DB');
      return;
    }
    
    data.projects.push({
      id: 'proj-fv-' + Date.now(),
      name: 'Fuego Violeta',
      folder: 'D:/Programacion/jpagents/proyects/fuego_violeta',
      model: 'deepseek-v4-flash',
      chats: [],
      skills: [],
      isCorrupted: false,
      isInitialName: true
    });
    
    const body2 = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/sessions/save',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body2)
      }
    }, (res2) => {
      let r = '';
      res2.on('data', c => r += c);
      res2.on('end', () => {
        console.log('Save result:', r);
      });
    });
    req.write(body2);
    req.end();
  });
}).on('error', e => console.log('Error:', e.message));
