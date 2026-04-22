// Variables globales
let circles = [];
const NUM_CIRCLES = 30;

function setup() {
    // El canvas se inicializará en fullscreen por defecto en p5.js
    createCanvas(windowWidth, windowHeight);
    background(0);
    
    // Inicializar los círculos
    for (let i = 0; i < NUM_CIRCLES; i++) {
        let x = random(width); 
        let y = random(height); 
        let size = random(10, 50);
        let hue = random(360);
        circles.push(new Circle(x, y, size, hue));
    }
}

function draw() {
    // Dibujamos un semi-transparente para efecto de estela/movimiento
    background(0, 10); 
    
    // Actualizar y dibujar todos los círculos
    for (let i = 0; i < circles.length; i++) {
        circles[i].update();
        circles[i].display();
    }
}

// Función de interacción principal con el mouse
function mouseMoved() {
    // Al mover el ratón, todos los círculos son influenciados por la posición del mouse
    for (let i = 0; i < circles.length; i++) {
        circles[i].interactMouse(mouseX, mouseY);
    }
}

// Reacciona al click del ratón
function mousePressed() {
    // Añadir un círculo grande en el punto de clic
    let newCircle = new Circle(mouseX, mouseY, 70, random(360));
    circles.push(newCircle);

    // Limitar el número de círculos para no saturar memoria
    if (circles.length > NUM_CIRCLES + 10) {
        circles.shift(); // Eliminar el más antiguo
    }
}

// Maneja el redimensionamiento de la ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0);
}

// Clase para manejar la lógica de cada círculo
class Circle {
    constructor(x, y, size, hue) {
        this.history = []; // Para rastrear posiciones pasadas
        this.maxHistory = 10;
        this.setInitial(x, y, size, hue);
    }

    setInitial(x, y, size, hue) {
        this.x = x;
        this.y = y;
        this.baseSize = size;
        this.hue = hue;
        this.r = random(255);
        this.g = random(255);
        this.b = random(255);
    }

    update() {
        // Moverse ligeramente aleatoriamente y seguir el rastro
        this.x += random(-1, 1);
        this.y += random(-1, 1);

        // Mantener un historial de posiciones
        this.history.push({x: this.x, y: this.y});
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
    }

    interactMouse(mx, my) {
        // Cálculo de la distancia al mouse
        let dx = mx - this.x;
        let dy = my - this.y;
        let distance = dist(this.x, this.y, mx, my);
        
        // Si está cerca del mouse, se repele/se atrae
        if (distance < 150) {
            let force = 1 - (distance / 150); // Fuerza máxima de 1
            
            // Aplicar desplazamiento basado en la fuerza y la dirección
            this.x += (dx / distance) * force * 1.5;
            this.y += (dy / distance) * force * 1.5;
        }
        
        // Cambiar ligeramente el color si se interactúa
        this.hue = (this.hue + 0.5) % 360;
    }

    display() {
        // Dibujar el rastro (history) con opacidad decreciente
        for (let i = 0; i < this.history.length; i++) {
            let pos = this.history[i];
            let alpha = map(i, 0, this.history.length - 1, 10, 0, true); // Mayor en el pasado
            fill(this.hue, 80, 100, alpha * 0.5); // Color base
            noStroke();
            ellipse(pos.x, pos.y, this.baseSize * (1 - (i / this.history.length) * 0.5), this.baseSize * (1 - (i / this.history.length) * 0.5));
        }
        
        // Dibujar el círculo principal (en la posición actual)
        stroke(this.hue, 100, 100); // Color del borde
        strokeWeight(2); 
        fill(this.hue, 80, 100, 150); 
        ellipse(this.x, this.y, this.baseSize, this.baseSize);
    }
}
