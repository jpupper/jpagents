// Constantes del sistema
const NUM_PARTICLES = 50;
const MAX_SPEED = 0.1;
const TRAIL_DECAY = 0.05; // Controla qué tan rápido se desvanece el rastro

// Array para almacenar las partículas (círculos)
let particles = [];

/**
 * Clase para representar una partícula del rastro.
 * Ahora solo maneja la posición y el historial.
 */
class Particle {
    constructor(x, y) {
        this.history = []; // Almacena posiciones pasadas
        this.maxHistory = 10; // Cuántos puntos guardar para el rastro
        this.radius = 5;
        // El color ahora se calculará externamente en draw()
    }

    // Actualiza la posición basándose en el mouse y el paso anterior
    update(targetX, targetY) {
        // 1. Registrar la posición actual
        this.history.push({ x: this.xcor, y: this.ycor });
        if (this.history.length > this.maxHistory) {
            this.history.shift(); // Mantener solo los últimos 'maxHistory' puntos
        }

        // 2. Calcular la nueva posición
        let currentX, currentY;

        if (this.history.length === 0) {
            // Inicialización si no hay historial
            currentX = targetX;
            currentY = targetY;
        } else {
            // El primer elemento (índice 0) sigue al mouse directamente
            if (this === particles[0]) {
                currentX = targetX;
                currentY = targetY;
            } else {
                // Los demás elementos se mueven suavemente hacia la posición del elemento anterior
                const previous = this.history[this.history.length - 1];
                
                // Interpolación suave (lerp) hacia la posición anterior
                currentX = this.xcor + (previous.x - this.xcor) * 0.5;
                currentY = this.ycor + (previous.y - this.ycor) * 0.5;
            }
        }
        
        // 3. Actualizar la posición
        this.xcor = currentX;
        this.ycor = currentY;
    }
}

// Propiedades de la partícula (para mantener el estado entre frames)
let xcor, ycor;

function setup() {
    // Configurar el canvas para que ocupe toda la ventana
    createCanvas(windowWidth, windowHeight);
    
    // Inicializar el array de partículas
    particles = [];
    for (let i = 0; i < NUM_PARTICLES; i++) {
        // Inicializamos todas las partículas en el centro o en el mouse inicial
        particles.push(new Particle(width / 2, height / 2));
    }
    
    // Inicializar las coordenadas de estado para el primer frame
    xcor = width / 2;
    ycor = height / 2;
}

function draw() {
    // 1. Efecto de rastro: Dibujar un fondo semi-transparente para que los círculos anteriores se desvanezcan
    background(0, 0, 0, 20); // Negro con baja opacidad (20/255)

    // 2. Actualizar y dibujar cada partícula
    for (let i = 0; i < particles.length; i++) {
        let p = particles[i];
        
        // --- LÓGICA DE POSICIÓN (SIN CAMBIOS) ---
        if (i === 0) {
            p.update(mouseX, mouseY);
        } else {
            const previousParticle = particles[i - 1];
            p.update(previousParticle.xcor, previousParticle.ycor);
        }
        
        // --- CÁLCULO DE COLOR (NUEVA LÓGICA) ---
        // Interpolación de color de Rojo (i=0) a Azul (i=NUM_PARTICLES-1)
        let t = i / (NUM_PARTICLES - 1); // Factor de interpolación de 0 a 1
        
        // Rojo: 255 -> 0
        let r = map(t, 0, 1, 255, 0); 
        // Verde: 0 -> 0 (Constante)
        let g = 0; 
        // Azul: 0 -> 255
        let b = map(t, 0, 1, 0, 255);
        
        // El color base para esta partícula es (r, g, b)
        let baseColor = color(r, g, b);

        // --- DIBUJO (MODIFICADO PARA USAR EL COLOR CALCULADO) ---
        
        // Dibujar el rastro (los puntos históricos)
        noFill();
        strokeWeight(1);
        beginShape();
        for (let j = 0; j < p.history.length; j++) {
            let p_hist = p.history[j];
            // El alpha disminuye con la antigüedad del punto, pero manteniendo el tono de color
            let alpha = map(j, 0, p.history.length - 1, 100, 255);
            
            // Aplicamos el color base, pero con alpha decreciente
            stroke(r, g, b, alpha); 
            vertex(p_hist.x, p_hist.y);
        }
        endShape();

        // Dibujar el círculo actual (el punto más reciente)
        fill(r, g, b, 255); // Color sólido calculado
        noStroke();
        ellipse(p.xcor, p.ycor, p.radius * 2, p.radius * 2);
    }
}

function mouseMoved() {
    // Esto asegura que el sistema de p5.js sepa que el mouse se movió
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}