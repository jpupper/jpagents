// Estructura de un sistema simple de partículas que reacciona al mouse (MULTICOLOR Y GRANDE)
let particles = [];

// Clase Particle
class Particle {
    constructor(x, y) {
        this.position = createVector(x, y);
        this.velocity = createVector(random(-1, 1), random(-1, 1));
        this.acceleration = createVector(0, 0);
        this.lifespan = 255;
    }

    applyForce(force) {
        this.acceleration.add(force); // Añadir la fuerza al aceleración
    }

    update() {
        this.velocity.add(this.acceleration);
        this.position.add(this.velocity);
        this.acceleration.mult(0); // Resetear aceleración
        this.lifespan -= 3; // Decrementar vida
    }

    display() {
        // MODIFICACIÓN: Multicolor y más grande
        // Usar un color RGB aleatorio con transparencia basada en la vida.
        stroke(random(255), random(255), random(255), this.lifespan);
        // Aumentar grosor dinámicamente (entre 3 y 5)
        strokeWeight(3 + random(2)); 
        point(this.position.x, this.position.y);
    }
}

function setup() {
    // p5.js se inicializa automáticamente con el canvas en el body
    createCanvas(windowWidth, windowHeight);
    background(26, 26, 46); // Fondo oscuro inicial
    
    // Inicializar partículas en el centro
    for(let i = 0; i < 10; i++) {
        particles.push(new Particle(random(width), random(height)));
    }
}

function draw() {
    // Dibujar un fondo semi-transparente para efecto de estela
    background(26, 26, 46, 50); 
    
    // 1. Actualizar y dibujar partículas existentes
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update();
        p.display();
        
        // Eliminar si la vida es menor a cero
        if (p.lifespan < 0) {
            particles.splice(i, 1);
        }
    }
    
    // 2. Interacción con el ratón: Añadir nuevas partículas en la posición del ratón
    // Se mantiene la lógica de creación basada en el ratón.
    if (frameCount % 2 === 0) {
        particles.push(new Particle(mouseX, mouseY));
    }
}

// Función de interacción para redimensionar el lienzo
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(26, 26, 46);
}

/*
IMPORTANTE: Para que este sketch funcione, debes ejecutar el .bat generado 
que servirá como servidor web y abrirá el navegador en la dirección correcta.
*/