import http from 'http';

// 1) Start the Hermes instance
const startData = JSON.stringify({
    projectId: 'proj-mpyqyquohw60d6',
    chatId: 'chat-mpyqyquo5cbp8e',
    workdir: 'D:\\Programacion\\jpagents\\proyects\\violet_particles',
    model: 'deepseek-v4-flash',
    name: 'Violet Particle Dev'
});

const startReq = http.request({
    hostname: 'localhost', port: 3001, path: '/api/hermes/start',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(startData) }
}, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
        console.log('START STATUS:', res.statusCode);
        console.log('START:', d);
        
        // 2) Send the message
        if (res.statusCode === 200) {
            const msgData = JSON.stringify({
                projectId: 'proj-mpyqyquohw60d6',
                chatId: 'chat-mpyqyquo5cbp8e',
                message: 'Creá un sketch de p5.js interactivo de efecto de partículas violetas controlado con el mouse. Guardalo en D:\\Programacion\\jpagents\\proyects\\violet_particles\\sketch.html. Requisitos:\n\n1) Fondo oscuro (#0a0015 o similar)\n2) Mínimo 200 partículas violetas/moradas con tamaños variados (2-8px)\n3) Las partículas siguen al mouse con movimiento suave (lerp o easing)\n4) Efecto de estela/trail al mover el mouse usando opacidad\n5) Efecto glow/brillo (usar drawingContext.shadowBlur de canvas 2D)\n6) Las partículas se conectan con líneas semitransparentes cuando están cerca (distancia < 120px)\n7) Las partículas se alejan/repelen cuando el mouse se acerca demasiado (distancia < 60px)\n8) Transiciones de color entre púrpura, violeta y magenta (colores HSL)\n9) Animación suave con requestAnimationFrame (draw loop de p5.js)\n10) Código completo autocontenido en un solo archivo HTML con p5.js cargado desde CDN\n\nUsá la herramienta write_file para crear el archivo. No necesitás crear ningún otro archivo.'
            });
            
            const msgReq = http.request({
                hostname: 'localhost', port: 3001, path: '/api/admin/communicate/agent',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(msgData) }
            }, res2 => {
                let d2 = '';
                res2.on('data', c => d2 += c);
                res2.on('end', () => {
                    console.log('MSG STATUS:', res2.statusCode);
                    console.log('MSG:', d2);
                });
            });
            msgReq.on('error', e => console.error('MSG ERROR:', e.message));
            msgReq.write(msgData);
            msgReq.end();
        }
    });
});
startReq.on('error', e => console.error('START ERROR:', e.message));
startReq.write(startData);
startReq.end();
