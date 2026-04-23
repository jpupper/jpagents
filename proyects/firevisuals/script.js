let tracers = [];

// Clase para representar un trazo de rayo (partícula/segmento)
class LightningTrail {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.life = 255; // Opacidad inicial
        this.velocity = p5.Vector.random2D();
        this.velocity.mult(random(2, 6)); // Velocidad variable
        this.history = []; // Para guardar puntos
    }

    update() {
        this.x += this.velocity.x;
        this.y += this.velocity.y;
        this.life -= 4; // Decrementa la vida (desaparece)
        
        // Limitar la vida y hacer que el rastro sea más corto en los bordes
        if (this.life < 0) return false; 
        
        // Actualizar historial de posiciones
        this.history.push(createVector(this.x, this.y));
        if (this.history.length > 20) {
            this.history.shift(); // Mantiene solo los últimos 20 puntos
        }
        return true; // Sigue vivo
    }

    draw() {
        stroke(255, random(150), random(200), this.life);
        strokeWeight(map(this.life, 0, 255, 1, 4)); // Grosor basado en vida
        noFill();
        beginShape();
        for (let i = 0; i < this.history.length; i++) {
            vertex(this.history[i].x, this.history[i].y);
        }
        endShape();
    }
}

let trails = [];

function setup() {
    // P5.js se encargará de hacerlo fullscreen basado en el CSS
    createCanvas(windowWidth, windowHeight);
    // Inicializar con un pequeño "chisporroteo" al cargar
    for (let i = 0; i < 3; i++) {
        trails.push(new LightningTrail(random(width), random(height)));
    }
}

function draw() {
    // Crea el efecto de rastro (trail) dibujando un fondo semitransparente oscuro
    background(0, 0, 0, 10); // Negro con 10/255 de opacidad

    // 1. Actualizar y dibujar todos los trazos existentes
    for (let i = trails.length - 1; i >= 0; i--) {
        let trail = trails[i];
        if (!trail.update()) {
            trails.splice(i, 1); // Remover si no está vivo
            continue;
        }
        trail.draw();
    }

    // 2. Lógica de generación de nuevos rayos (caos)
    // Probabilidad de generar un nuevo rayo cada frame (mayor caos)
    if (random(1) < 0.05) {
        let newTrail = new LightningTrail(random(width), random(height));
        trails.push(newTrail);
    }

    // 3. Manex: Agregar más partículas si la pantalla está muy "limpia"
    if (random(1) < 0.01 && trails.length < 15) {
         trails.push(new LightningTrail(random(width), random(height)));
    }
}

// Manejar redimensionamiento de la ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}