// Variables globales
let circle;

// Función setup: Se ejecuta una sola vez al inicio
function setup() {
    // Crea el canvas para que ocupe todo el viewport
    createCanvas(windowWidth, windowHeight);
    // Inicializa el círculo en el centro
    circle = createGraphics(width, height);
    circle.ellipse(width / 2, height / 2, 50, 50);
}

// Función draw: Se ejecuta en un bucle continuo
function draw() {
    // 1. Fondo: Transparente o con un color de fondo suave
    background(20, 20, 50, 50); // Fondo azul oscuro semi-transparente para efecto de estela

    // 2. Dibujar el círculo que sigue el ratón
    let x = mouseX;
    let y = mouseY;
    
    // Calcular un color basado en la posición (ej: más rojo si está a la derecha, más azul si está a la izquierda)
    let r = map(x, 0, width, 50, 255);
    let g = map(y, 0, height, 50, 255);
    let b = 255; // Azul constante
    
    // Dibujar el círculo principal
    fill(r, g, b, 200); // Color con algo de transparencia
    noStroke();
    ellipse(x, y, 80, 80);

    // 3. Efecto de estela (opcional, pero mejora la interactividad)
    // Dibujamos el círculo anterior con menor opacidad para que se desvanezca
    fill(r * 0.8, g * 0.8, b * 0.8, 100);
    ellipse(mouseX - 10, mouseY - 10, 60, 60);
}

// Función drawSize: Se llama cuando el tamaño de la ventana cambia
function windowResized() {
    // Cambia el tamaño del canvas al tamaño actual de la ventana
    resizeCanvas(windowWidth, windowHeight);
}