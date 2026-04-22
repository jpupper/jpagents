let particles = [];

// Clase para representar una partícula
class Particle {
    constructor(x, y) {
        this.position = createVector(x, y);
        // Direccionalidad aleatoria en todas las direcciones
        this.velocity = p5.Vector.random2D();
        // Normalizamos la velocidad para darle una fuerza inicial constante
        this.velocity.setMag(random(2, 5)); 
        this.acceleration = createVector(0, 0);
        this.lifespan = 255; // Vida inicial
        this.size = random(3, 6);
    }

    applyForce(force) {
        this.acceleration.add(force);
    }

    update() {
        // Aplicar la aceleración a la velocidad
        this.velocity.add(this.acceleration);
        this.acceleration.mult(0); // Resetear aceleración
        // Actualizar la posición
        this.position.add(this.velocity);
        // Reducir la vida
        this.lifespan -= 4; 
    }

    display() {
        stroke(255, this.lifespan, 100); // Color blanco/naranja que desvanece
        strokeWeight(this.size); // Grosor basado en el tamaño inicial
        point(this.position.x, this.position.y);
    }

    isDead() {
        return this.lifespan <= 0;
    }
}

// Función de setup (se ejecuta una vez)
function setup() {
    // Creamos el canvas para que ocupe todo el viewport
    createCanvas(windowWidth, windowHeight);
    background(0, 0, 20); // Fondo azul oscuro
    // Configurar el modo de color y el desenfoque para un mejor efecto visual
    blendMode(ADD);
}

// Función de draw (se ejecuta en un bucle continuo)
function draw() {
    // Dibujar un fondo semi-transparente para crear el rastro (trailing effect)
    background(0, 0, 20, 50); 
    
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

// Función especial para manejar la interacción del mouse
function mouseMoved() {
    // Creamos un número de partículas basado en la velocidad del movimiento del mouse
    let numParticles = map(dist(mouseX, mouseY, pmouseX, pmouseY), 0, 20, 1, 4);
    
    for (let i = 0; i < numParticles; i++) {
        // Creamos la partícula en la posición actual del mouse
        particles.push(new Particle(mouseX, mouseY));
    }
}

// Función para redimensionar el canvas si el usuario cambia el tamaño de la ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0, 0, 20);
}
