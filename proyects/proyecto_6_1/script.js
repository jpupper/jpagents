let particles = [];
const NUM_PARTICLES = 100;

// Clase para manejar partículas
class Particle {
    constructor(x, y) {
        this.position = createVector(x, y);
        this.velocity = createVector(random(-1, 1), random(-1, 1));
        this.radius = random(2, 5);
        this.lifespan = 255;
    }

    update() {
        this.position.add(this.velocity);
        this.lifespan -= 3;
        this.velocity.mult(0.98); // Fricción
    }

    show() {
        stroke(255, 100, this.lifespan);
        strokeWeight(this.radius);
        point(this.position.x, this.position.y);
    }
}

function setup() {
    // Se configura el canvas para ocupar todo el espacio disponible (fullscreen)
    createCanvas(windowWidth, windowHeight);
    background(0);
    particles = [];
    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles.push(new Particle(random(width), random(height)));
    }
}

function draw() {
    // Dibujar un fondo con un ligero desenfoque para el efecto trail
    background(0, 10); 

    // Interactividad: Se reinicia o modifica el comportamiento al hacer clic
    if (mouseIsPressed) {
        // Emitir nuevas partículas o afectar las existentes al hacer clic
        for (let i = 0; i < 10; i++) {
            particles.push(new Particle(mouseX, mouseY));
        }
    }

    // Actualizar y mostrar cada partícula
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update();
        p.show();
        
        // Remover partículas que han 'muerto'
        if (p.lifespan < 0) {
            particles.splice(i, 1);
        }
    }
}

function mouseMoved() {
    // Interacción suave: Las partículas cercanas al cursor son empujadas levemente
    for (let i = 0; i < particles.length; i++) {
        let p = particles[i];
        let distance = dist(p.position.x, p.position.y, mouseX, mouseY);
        if (distance < 150) {
            let force = p5.Vector.sub(createVector(mouseX, mouseY), p.position);
            force.setMag(0.5);
            p.velocity.add(force);
        }
    }
}

// Manejar redimensionamiento de la ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0);
}

// Al terminar, asegurarse de que el canvas cubre toda la ventana
// (Aunque lo maneja el body CSS, es buena práctica p5)
