import http from 'http';

const data = JSON.stringify({
    projectId: 'proj-mpyqyquohw60d6',
    chatId: 'chat-mpyqyquo5cbp8e',
    message: 'Creá un sketch de p5.js interactivo de efecto de partículas violetas controlado con el mouse. Guardalo en D:\\Programacion\\jpagents\\proyects\\violet_particles\\sketch.html.\n\nRequisitos:\n1) Fondo oscuro (#0a0015 o similar)\n2) Mínimo 200 partículas violetas/moradas con tamaños variados (2-8px)\n3) Las partículas siguen al mouse con movimiento suave (lerp)\n4) Efecto de estela/trail al mover el mouse usando capa de opacidad\n5) Efecto glow/brillo usando drawingContext.shadowBlur\n6) Las partículas se conectan con líneas semitransparentes cuando están cerca (distancia < 120px)\n7) Las partículas se alejan/repelen cuando el mouse se acerca demasiado (distancia < 60px)\n8) Transiciones de color entre púrpura, violeta y magenta (usar HSL)\n9) Animación suave con el draw loop de p5.js\n10) Código completo autocontenido en un solo archivo HTML con p5.js cargado desde CDN\n\nUsá la herramienta write_file para crear el archivo. No necesitás crear ningún otro archivo.'
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
