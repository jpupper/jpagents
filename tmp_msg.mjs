import http from 'http';
const data = JSON.stringify({
    projectId: 'proj-mpyqwyvgpc23g1',
    chatId: 'chat-mpyqwyvgatljwj',
    message: 'Creá un sketch de p5.js interactivo de efecto de partículas violetas controlado con el mouse. El proyecto debe guardarse en D:\\Programacion\\jpagents\\proyects\\violet_particles\\sketch.html. Requisitos: 1) Fondo oscuro (#0a0015 o similar) 2) Partículas violetas/gradientes morados que siguen/responden al mouse 3) Mínimo 150 partículas con tamaño variado 4) Efecto de estela/trail al mover el mouse 5) Las partículas deben tener movimiento suave (lerp o easing) 6) Incluir efectos de brillo/glow (usar blendMode o shadows) 7) Las partículas deben conectar entre sí con líneas cuando están cerca 8) También deben alejarse/escapar cuando el mouse se acerca demasiado 9) Código completo autocontenido en un solo archivo HTML con p5.js cargado desde CDN. Usá write_file para crear el archivo.'
});
const req = http.request({
    hostname: 'localhost', port: 3001, path: '/api/admin/agent-message',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => console.log('STATUS:', res.statusCode, 'RESPONSE:', d));
});
req.on('error', e => console.error('ERROR:', e.message));
req.write(data);
req.end();
