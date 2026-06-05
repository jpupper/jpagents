import http from 'http';
const data = JSON.stringify({
    projectId: 'proj-mpyqyquohw60d6',
    chatId: 'chat-mpyqyquo5cbp8e',
    message: 'Creá un sketch de p5.js interactivo de efecto de partículas violetas controlado con el mouse. Guardalo en D:\\Programacion\\jpagents\\proyects\\violet_particles\\sketch.html. Requisitos: 1) Fondo oscuro (#0a0015 o similar) 2) Mínimo 200 partículas violetas/moradas con tamaños variados 3) Las partículas siguen al mouse con movimiento suave (lerp) 4) Efecto de estela al mover el mouse 5) Efecto glow/brillo (usar drawingContext.shadowBlur o blendMode) 6) Las partículas se conectan con líneas cuando están cerca una de otra 7) Las partículas se alejan/escapan cuando el mouse se acerca demasiado 8) Transiciones de color entre púrpura, violeta y magenta 9) Código completo autocontenido en un HTML con p5.js desde CDN. Usá write_file para crear el archivo.'
});
const req = http.request({
    hostname: 'localhost', port: 3001, path: '/api/admin/agent-message',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
        console.log('STATUS:', res.statusCode);
        try { const j = JSON.parse(d); console.log(JSON.stringify(j, null, 2)); }
        catch { console.log('RAW:', d); }
    });
});
req.on('error', e => console.error('ERROR:', e.message));
req.write(data);
req.end();
