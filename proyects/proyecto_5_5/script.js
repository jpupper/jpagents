// --- Clase Particle ---
class Particle {
    constructor(x, y, angle, speed) {
        this.pos = createVector(x, y);
        this.vel = p5.Vector.fromAngle(angle).mult(speed); // Direccional basado en ángulo
        this.acc = createVector(0, 0.1); // Gravedad suave
        this.lifespan = 255;
    }

    update() {
        this.vel.add(this.acc); // Aplicar aceleración (gravedad)
        this.pos.add(this.vel);
        this.vel.mult(0.98); // Amortiguación (fricción)
        this.lifespan -= 4; // Reducir vida
    }

    show() {
        stroke(255, this.lifespan); // El color varía con la vida
        strokeWeight(3);
        point(this.pos.x, this.pos.y);
    }
}

// Array para almacenar todas las partículas
let particles = [];

// --- Función de Creación de Partículas ---
// Llama a esta función cuando el ratón se mueve
function emitParticles(x, y) {
    let numParticles = 5;
    for (let i = 0; i < numParticles; i++) {
        // Generar un ángulo aleatorio entre 0 y TWO_PI
        let angle = random(TWO_PI);
        // Velocidad inicial (más fuerte cerca del ratón)
        let speed = random(4, 8);
        particles.push(new Particle(x, y, angle, speed));
    }
}

// --- p5 Setup y Loop ---
function setup() {
    // Creamos el canvas en fullscreen
    createCanvas(windowWidth, windowHeight);
    background(0);
    // Indicamos que el sistema de eventos de mouse debe funcionar
}

function draw() {
    // Dibujar un fondo semi-transparente para crear el efecto de estela
    background(0, 0, 0, 20); // RGBA: Negro con baja opacidad

    // 1. Actualizar y dibujar cada partícula
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update();
        p.show();
        
        // Eliminar la partícula si su vida es menor a 0
        if (p.lifespan < 0) {
            particles.splice(i, 1);
        }
    }
}

// Event handler específico para movimiento del ratón (p5js)
function mouseMoved() {
    // Emitir partículas cada vez que el mouse se mueve
    emitParticles(mouseX, mouseY);
}

// Asegurarse de que el canvas se redimensione si la ventana cambia de tamaño
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0);
}
