
let particles = [];
const NUM_PARTICLES = 8; // A bit more particles for a stronger burst

// Clase para representar una partícula
class Particle {
    constructor(x, y) {
        this.historyX = x;
        this.historyY = y;
        this.x = x;
        this.y = y;
        this.lifespan = 255; // Vida inicial (opacidad)
        this.radius = random(3, 6);
        
        // Velocidad inicial (se calcula en mouseMoved)
        this.vx = random(-5, 5); 
        this.vy = random(-5, 5); 
    }

    // Actualiza la posición y la vida aplicando física simple
    update() {
        // Aplicar fricción o desaceleración
        this.vx *= 0.98;
        this.vy *= 0.98;
        
        // Aplicar movimiento
        this.x += this.vx;
        this.y += this.vy;

        // Gravedad ligera (opcional, pero añade realismo)
        this.vy += 0.1; 

        // Reducir vida y opacidad
        this.lifespan -= 3;
        if (this.lifespan < 0) {
            this.lifespan = 0;
        }
    }

    // Dibuja la partícula en su nueva posición
    display() {
        stroke(255, 150, 0, this.lifespan); // Color naranja brillante, con opacidad
        strokeWeight(this.radius);
        // Dibujamos en la posición actual (x, y)
        point(this.x, this.y);
    }
}

// Función que se ejecuta al iniciar la sketch
function setup() {
    createCanvas(windowWidth, windowHeight);
    background(0);
}

// Función que se ejecuta en cada frame
function draw() {
    // Fondo semi-transparente: Esto crea el efecto de estela persistente.
    background(0, 10); 

    // 1. Actualizar y dibujar partículas
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update();
        p.display();

        // Eliminar partículas muertas
        if (p.lifespan <= 0) {
            particles.splice(i, 1);
        }
    }
}

// Evento clave: Se activa cuando el ratón se mueve
function mouseMoved() {
    // Creamos N partículas al pasar el ratón
    for (let i = 0; i < NUM_PARTICLES; i++) {
        // Creamos la partícula en la posición actual del ratón
        let p = new Particle(mouseX, mouseY);
        
        // *** MODIFICACIÓN CLAVE: Darle un impulso aleatorio hacia afuera ***
        // Esto hace que la partícula "salte" o se "dispare" ligeramente desde el punto del cursor.
        p.vx = random(-8, 8); 
        p.vy = random(-8, 8); 
        
        particles.push(p);
    }
}

// Manejar el redimensionamiento de la ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0);
}
