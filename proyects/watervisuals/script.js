/**
 * Sketch p5.js para simular el movimiento de agua utilizando funciones sinusoidales.
 * Este código debe ejecutarse en el contexto p5.js.
 */

let waveSpeed = 0.015;
let waveAmplitude = 50;
let backgroundColor = [10, 20, 40]; // Azul muy oscuro para el fondo

function setup() {
    // Configurar el canvas para que ocupe toda la ventana
    createCanvas(windowWidth, windowHeight);
    colorMode(HSB, 360, 100, 100, 100);
    background(backgroundColor[0], backgroundColor[1], backgroundColor[2], 100);
    // Inicializar la resolución de la ventana
    windowResized();
}

function draw() {
    // Dibujar el fondo ligeramente cada frame para un efecto de persistencia
    fill(10, 20, 40, 10); // Opacidad baja para el rastro
    rect(0, 0, width, height);

    // Definir el modo de color para el dibujo de olas
    noStroke();

    // Bucle para dibujar las capas de agua o el patrón de olas
    for (let y = 0; y < height; y += 10) { 
        let currentY = y;
        let displacement = 0;

        // El componente sinusoidal simulará la onda verticalmente
        // Usamos 'frameCount * waveSpeed' para el movimiento en el tiempo (el desplazamiento)
        // y 'y * 0.01' para variar la frecuencia verticalmente
        let waveVal = sin((x * 0.005) + (currentY * 0.02) + (frameCount * waveSpeed));
        
        // Calcular el desplazamiento horizontal basado en la sinusoide (efecto más realista)
        let offset = waveAmplitude * waveVal * cos((currentY * 0.02) + (frameCount * waveSpeed * 0.5));
        
        // Determinar el color basado en la altura de la ola (opcional: para dar profundidad)
        let colorHue = map(sin(frameCount * waveSpeed * 2 + currentY * 0.01), -1, 1, 200, 260); // Cambiar entre cian y azul-verde
        let colorValue = map(sin(frameCount * waveSpeed * 1 + currentY * 0.01), -1, 1, 70, 100);
        let colorAlpha = map(sin(frameCount * waveSpeed * 0.5 + currentY * 0.01), -1, 1, 30, 90); 
        
        fill(colorHue, 80, colorValue, colorAlpha);
        
        // Dibujar una línea o rectángulo que representa la sección de agua en este 'y'
        beginShape();
        vertex(0, currentY);
        // Dibujamos desde el borde izquierdo hasta el derecho, ajustando la posición por la onda
        for (let x = 0; x <= width; x += 10) {
             // Aquí se debería implementar una función de desplazamiento más compleja, pero para el esqueleto:
             let newX = x + offset;
             vertex(newX, currentY);
        }
        endShape();
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    backgroundColor = [10, 20, 40]; // Reestablecer el fondo tras redimensionar
}
