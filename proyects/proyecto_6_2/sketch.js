// Sketch de p5.js interactivo

let backgroundColor = [0, 0, 0];

function setup() {
    // Crear canvas que ocupe toda la ventana
    createCanvas(windowWidth, windowHeight);
    angleMode(DEGREES);
    background(backgroundColor);
}

function draw() {
    // Transparencia suave para el efecto de "rastro"
    fill(0, 0, 0, 20); // Negro muy transparente
    rect(0, 0, width, height);
    
    // Lógica principal: Dibujar círculos que reaccionan al ratón
    let mouseXNorm = map(mouseX, 0, width, 0, 1);
    let mouseYNorm = map(mouseY, 0, height, 0, 1);
    
    // Calcular un color basado en la posición normalizada del ratón
    let r = floor(mouseX * 0.5);
    let g = floor(mouseY * 0.5);
    let b = floor(sin(frameCount * 2) * 127 + 127);
    
    // Dibujar varios círculos para un efecto más rico
    for (let i = 0; i < 3; i++) {
        let x = mouseX + (i * 20);
        let y = mouseY + (i * 15);
        let size = 20 + i * 10;
        
        stroke(r, g, b - (i * 10), 200);
        strokeWeight(4);
        noFill();
        ellipse(x, y, size, size); 
    }
}

function windowResized() {
    // Asegura que el canvas se redimensione si el usuario cambia el tamaño de la ventana
    resizeCanvas(windowWidth, windowHeight);
    background(backgroundColor);
}
