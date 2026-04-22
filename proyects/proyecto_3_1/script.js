// Variable global para almacenar los puntos que forman el rastro
let points = [];
const MAX_POINTS = 50;

function setup() {
    // Configura el lienzo para que ocupe toda la ventana (Fullscreen)
    createCanvas(windowWidth, windowHeight);
    background(0); // Fondo negro
    colorMode(HSB, 360, 100, 100, 100);
}

function draw() {
    // Dibujar un fondo semi-transparente para crear el efecto de rastro/desvanecimiento
    background(0, 0, 0, 15); // 15/255 de opacidad

    // 1. Capturar la posición actual del ratón
    let mousePos = createVector(mouseX, mouseY);
    points.push(mousePos);

    // Mantener el array de puntos limitado en tamaño
    if (points.length > MAX_POINTS) {
        points.shift(); // Eliminar el punto más antiguo
    }

    // 2. Iterar sobre los puntos para dibujar el rastro
    for (let i = 0; i < points.length; i++) {
        let p = points[i];
        
        // Calcular el tamaño y el color basados en la antigüedad del punto (índice i)
        // Cuanto más cerca del inicio (i=0), más grande y visible es el punto.
        let lifeRatio = i / points.length; // 0 (viejo) a 1 (nuevo)
        let size = map(lifeRatio, 0, 1, 1, 15); // Tamaño varía de 1 a 15
        let alpha = map(lifeRatio, 0, 1, 10, 100); // Opacidad varía

        // Determinar el color: usa la posición X para el matiz (Hue) y Y para la saturación
        let hue = map(mouseX, 0, width, 0, 360); // Hue cambia con el movimiento horizontal
        let saturation = map(mouseY, 0, height, 50, 100); // Saturation cambia con el movimiento vertical

        // Dibujar el círculo
        noStroke();
        fill(hue, saturation, 90, alpha); // HSB: Hue, Saturation, Brightness, Alpha
        ellipse(p.x, p.y, size, size);
    }
}

// Ajustar el canvas si la ventana cambia de tamaño
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0);
}