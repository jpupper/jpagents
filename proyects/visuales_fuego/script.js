// --- CLASE DE PARTÍCULA DE FUEGO ---
class FireParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = random(2, 5);
        this.life = 255; // Alpha inicial
        this.age = 0;
        
        // Velocidad inicial (hacia arriba y con algo de deriva caótica)
        this.vx = random(-1.5, 1.5);
        this.vy = random(-4, -2);

        // Color base (más caliente al inicio)
        this.baseHue = random(0, 360);
    }

    update() {
        this.age++;
        this.life = map(this.age, 0, 150, 255, 0); // Desvanece
        
        // Simulación de movimiento caótico (como el aire caliente)
        this.vx += random(-0.2, 0.2);
        this.vy += random(0.1, 0.3); // Gravedad muy débil simulando caída lenta
        
        // Aplicar movimiento
        this.x += this.vx;
        this.y += this.vy;

        // Reducir tamaño con la edad
        this.size = map(this.age, 0, 150, 5, 0.5);
    }

    display() {
        // El color se basa en la vida (alpha) y una transformación de color de fuego (Rojo -> Naranja -> Amarillo)
        let alpha = this.life;
        let r, g, b;
        
        // Determinación del color basado en la vida (más caliente cuando la vida es alta)
        if (alpha > 150) {
            // Amarillo brillante/Naranja
            r = map(alpha, 150, 255, 255, 255);
            g = map(alpha, 150, 255, 255, 50);
            b = map(alpha, 150, 255, 255, 0);
        } else {
            // Rojo oscuro/Disipación
            r = map(alpha, 0, 150, 50, 150);
            g = map(alpha, 0, 150, 50, 20);
            b = map(alpha, 0, 150, 10, 0); 
        }
        
        fill(r, g, b, alpha);
        noStroke();
        ellipse(this.x, this.y, this.size, this.size * 1.2);
    }

    isDead() {
        return this.life <= 0.1 || this.y < -100; // Muere si se desvanece o sale mucho por arriba
    }
}

let particles = [];
let nextParticleTimer = 0;
const PARTICLE_INTERVAL = 2; // Cada cuántos frames se genera un nuevo grupo

function setup() {
    createCanvas(windowWidth, windowHeight);
    background(0);
    // Inicializar con algunas partículas para un efecto de encendido
    for(let i = 0; i < 50; i++) {
        particles.push(new FireParticle(random(width), height));
    }
}

function draw() {
    // Fondo semi-transparente para el efecto de estela y persistencia
    background(0, 0, 0, 50);

    // Generar nuevas partículas de forma constante
    nextParticleTimer++;
    if (nextParticleTimer >= PARTICLE_INTERVAL) {
        // Generar un grupo pequeño de partículas en la base
        for(let i = 0; i < random(1, 3); i++) {
             particles.push(new FireParticle(random(width), height));
        }
        nextParticleTimer = 0;
    }

    // Actualizar y dibujar partículas
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update();
        p.display();

        if (p.isDead()) {
            particles.splice(i, 1);
        }
    }
}

// Manejar redimensionamiento para que siempre esté fullscreen
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0);
}

// Mejorar la interactividad: si el usuario hace clic, simula un nuevo foco de fuego
function mousePressed() {
    let newParticles = 10;
    for(let i = 0; i < newParticles; i++) {
         particles.push(new FireParticle(mouseX, mouseY));
    }
}
