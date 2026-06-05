const fs = require('fs');
const data = JSON.parse(fs.readFileSync('sessions.json', 'utf-8'));
console.log('File has', data.projects.length, 'projects:');
data.projects.forEach(p => console.log(' -', p.name, '(' + p.id + ') chats:', (p.chats || []).length));
