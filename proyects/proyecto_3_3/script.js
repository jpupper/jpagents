// Sketch de p5.js interactivo

let lastX = 0;
let lastY = 0;
// Variable global para el color de fondo (R, G, B)
const GLOBAL_BG_COLOR = [10, 10, 30];

function setup() {
    // Configura el canvas para que ocupe toda la ventana (fullscreen)
    createCanvas(windowWidth, windowHeight);
    // Uso de la variable global
    background(GLOBAL_BG_COLOR[0], GLOBAL_BG_COLOR[1], GLOBAL_BG_COLOR[2]);
    // Inicializa las posiciones anteriores con las actuales
    lastX = mouseX;
    lastY = mouseY;
}

function draw() {
    // Dibujar un fondo semi-transparente para crear un efecto de estela
    // Usamos los componentes globales y mantenemos el alpha de 40
    background(GLOBAL_BG_COLOR[0], GLOBAL_BG_COLOR[1], GLOBAL_BG_COLOR[2], 40); 

    // Calcular la distancia recorrida desde el último frame
    let dx = mouseX - lastX;
    let dy = mouseY - lastY;
    let distance = dist(lastX, lastY, mouseX, mouseY);

    // 1. Dibujar un círculo que sigue al ratón
    // El tamaño y el color dependen de la velocidad de movimiento
    let circleSize = map(distance, 0, 50, 5, 50); // Tamaño entre 5px y 50px
    let alphaValue = map(distance, 0, 50, 200, 255); // Opacidad
    
    // Color que cambia ligeramente con el tiempo (usando la función sin para un cambio suave)
    let r = (sin(frameCount * 0.05) * 127 + 127) % 255;
    let g = (cos(frameCount * 0.05) * 127 + 127) % 255;
    let b = (frameCount * 0.5) % 255;
    
    noStroke();
    fill(r, g, b, alphaValue);
    ellipse(mouseX, mouseY, circleSize, circleSize);
    
    // 2. Dejar un rastro más tenue donde estuvo el ratón en el frame anterior
    fill(0, 100, 200, 50); // Color azul oscuro y transparente
    ellipse(lastX, lastY, 10, 10);

    // Actualizar las posiciones anteriores para el próximo frame
    lastX = mouseX;
    lastY = mouseY;
}

// Asegurar que el canvas se redimensiona al cambiar el tamaño de la ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    // Uso de la variable global
    background(GLOBAL_BG_COLOR[0], GLOBAL_BG_COLOR[1], GLOBAL_BG_COLOR[2]);
}
