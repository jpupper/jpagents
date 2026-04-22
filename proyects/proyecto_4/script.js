// Variables de seguimiento para la interacción
let circles = [];
const MAX_CIRCLES = 20;

function setup() {
    // Fullscreen canvas
    createCanvas(windowWidth, windowHeight);
    background(0);
}

function draw() {
    // Dibujar un semiclear para crear el efecto de estela/arrastre
    fill(0, 10); // Negro con baja opacidad para el rastro
    rect(0, 0, width, height);

    // 1. Dibujar el círculo que sigue al mouse
    // Usaremos un tamaño dinámico basado en la velocidad o el tiempo
    let currentSize = map(mouseX, 0, width, 5, 80, true); // Tamaño basado en X
    let currentAlpha = map(mouseY, 0, height, 100, 255, true);
    
    stroke(255, 50, 150, currentAlpha); // Color Magenta con transparencia
    strokeWeight(5);
    point(mouseX, mouseY);

    // 2. Generar o actualizar círculos de cola (interacción pasiva)
    if (frameCount % 3 === 0) { // Crear un nuevo elemento cada 3 frames
        circles.push(new Circle(mouseX, mouseY));
    }

    // Actualizar y dibujar todos los círculos de la cola
    for (let i = circles.length - 1; i >= 0; i--) {
        circles[i].update();
        circles[i].display();
        
        // Remover círculos que se han desvanecido o salido del área
        if (circles[i].isFinished()) {
            circles.splice(i, 1);
        }
    }
}

// Función para manejar el redimensionamiento (importante para fullscreen)
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0);
}

/**
 * Clase Circle: Representa un punto de la estela interactiva.
 */
class Circle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = random(10, 40);
        this.life = 255; // Alpha inicial
        this.maxLife = 255;
    }

    update() {
        // Simular movimiento hacia abajo ligeramente y desvanecimiento
        this.y += 1.5;
        this.life -= 3; // Disminuir la vida/opacidad
    }

    display() {
        // El color cambia ligeramente basado en la vida restante
        let r = map(this.life, 0, this.maxLife, 0, 255);
        let g = map(this.life, 0, this.maxLife, 100, 255);
        let b = map(this.life, 0, this.maxLife, 255, 100);
        
        fill(r, g, b, this.life);
        noStroke();
        ellipse(this.x, this.y, this.size, this.size);
    }

    isFinished() {
        return this.life < 0 || this.y > height + 50;
    }
}
