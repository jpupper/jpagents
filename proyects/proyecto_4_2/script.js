let particles = [];
const NUM_PARTICLES = 150;

// Clase para manejar las partículas
class Particle {
    constructor(x, y) {
        this.pos = createVector(x, y);
        this.vel = p5.Vector.random2D().mult(random(0.5, 2));
        this.acc = createVector(0, 0);
        this.lifespan = 255;
        this.size = random(2, 4);
    }

    applyForce(force) {
        this.acc.add(force); // Añade la fuerza (ej: gravedad o atracción)
    }

    update() {
        this.vel.add(this.acc); // Velocidad = Velocidad + Aceleración
        this.pos.add(this.vel); // Posición = Posición + Velocidad
        this.acc.add(0, 0);
        this.vel.mult(0.98); // Amortiguación
        this.acc.mult(0);
        this.lifespan -= 2; // Disminuir vida
    }

    display() {
        stroke(255, this.lifespan); // Color blanco que desvanece
        strokeWeight(this.size); 
        point(this.pos.x, this.pos.y);
    }
}

// Función de configuración de p5.js
function setup() {
    // El sketch debe ocupar todo el viewport
    createCanvas(windowWidth, windowHeight);
    
    // Inicializar partículas en posiciones aleatorias
    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles.push(new Particle(random(width), random(height)));
    }
}

// Función de bucle principal de p5.js
function draw() {
    // Fondo semi-transparente para crear el efecto de estela/cola
    background(0, 0, 0, 20); 
    
    // Lógica de interacción: Atraer o repeler partículas basándose en el ratón
    let mouseVector = createVector(mouseX, mouseY);
    
    particles.forEach(p => {
        // Calcular la fuerza de atracción/repulsión hacia el cursor
        let forceDir = p5.Vector.sub(mouseVector, p.pos);
        forceDir.setMag(0.1); // Fuerza débil
        
        // Si la partícula está cerca del ratón, la empujamos ligeramente más fuerte
        let distance = p5.Vector.dist(p.pos, mouseVector);
        if (distance < 150) {
            forceDir.mult(1.5); // Mayor fuerza cercana
        } else {
            forceDir.mult(0.5);
        }
        
        p.applyForce(forceDir);
        p.update();
        p.display();
    });
}

// Ajustar el canvas si se cambia el tamaño de la ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

// El requisito del BAT debe modificar el comando para usar un puerto aleatorio y 'start'. 
// Asumiremos que el entorno de ejecución de scripts puede generar un puerto aleatorio.
// La modificación se aplicará al run.bat.