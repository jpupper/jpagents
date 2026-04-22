let particles = [];
const numParticles = 100;
const maxDist = 100; // Distancia máxima de interacción

// Clase para las partículas
class Particle {
    constructor(x, y) {
        this.pos = createVector(x, y);
        this.vel = p5.Vector.random2D().mult(random(1, 3));
        this.acc = createVector(0, 0);
        this.lifespan = 255;
    }

    // Aplicar fuerza de repulsión del ratón
    applyMouseForce(mx, my) {
        let force = createVector(mx - this.pos.x, my - this.pos.y);
        let dist = p5.Vector.dist(this.pos, createVector(mx, my));

        if (dist < maxDist) {
            // Calcula la fuerza inversamente proporcional a la distancia
            let strength = map(dist, 0, maxDist, 1.0, 0.0);
            force = p5.Vector.div(force, dist) // Vector unitario
            force = p5.Vector.mult(force, strength * 0.5); // Fuerza de repulsión
            this.acc.add(force);
        }
    }

    update(mx, my) {
        // Reseteamos aceleración para el frame
        this.acc.mult(0);
        this.applyMouseForce(mx, my);
        
        this.vel.add(this.acc);
        this.vel.limit(5);
        this.pos.add(this.vel);
        this.acc.add(createVector(0, 0)); // Reiniciar aceleración para la próxima iteración
        
        this.lifespan -= 3;
    }

    display() {
        stroke(255, this.lifespan); // Color blanco desvanecido
        strokeWeight(2);
        point(this.pos.x, this.pos.y);
    }
}

function setup() {
    // Fullscreen canvas
    createCanvas(windowWidth, windowHeight);
    background(0);
    
    // Inicializar partículas distribuidas aleatoriamente
    particles = [];
    for (let i = 0; i < numParticles; i++) {
        particles.push(new Particle(random(width), random(height)));
    }
}

function draw() {
    // Crea un efecto de cola o desvanecimiento suave
    background(0, 10); 

    let mouseX = mouseX;
    let mouseY = mouseY;

    for (let i = 0; i < particles.length; i++) {
        let p = particles[i];
        p.update(mouseX, mouseY);
        p.display();
    }
}

function mouseMoved() {
    // El movimiento del ratón es clave para la interactividad
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}
