// Función principal del sketch p5.js
def drawCanvas() {
    function setup() {
        createCanvas(windowWidth, windowHeight);
        angleMode(DEGREES);
    }

    function draw() {
        background(20, 20, 50); // Fondo oscuro
        
        // Dibujar un círculo que sigue el ratón
        fill(255, 100, 100, 150); // Color rojo semi-transparente
        noStroke();
        ellipse(mouseX, mouseY, 80, 80);
        
        // Texto informativo
        fill(255);
        textSize(20);
        text("¡Hola, p5.js! Mueve el ratón para interactuar.", 20, 50);
    }

    // Asegurarse de que el canvas se ajuste al redimensionar la ventana
    function windowResized() {
        resizeCanvas(windowWidth, windowHeight);
    }
}

drawCanvas();