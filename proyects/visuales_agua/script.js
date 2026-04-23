// === CONFIGURACION GLOBAL ===
let currentWaveAmplitude = 5;
let currentWaveFrequency = 0.02;
let waveColor = [100, 150, 255, 150]; // Azul semi-transparente

// Función setup se llama una vez al inicio
function setup() {
    // El sketch debe ocupar toda la ventana (Fullscreen)
    createCanvas(windowWidth, windowHeight);
    colorMode(HSB, 360, 100, 100, 100);
    background(0, 10, 100);
    noStroke();
}

// Función draw se llama en cada frame
function draw() {
    // Creamos un efecto de persistencia o arrastre dibujando un fondo ligeramente transparente
    fill(0, 10, 100, 10);
    rect(0, 0, width, height);

    // --- SIMULACION DE OLAS ---
    // Iteramos sobre píxeles horizontales (x) y verticales (y)
    for (let x = 0; x < width; x += 5) {
        // Calculamos el desplazamiento de la onda usando Perlin Noise
        // Los parámetros (x, y, frameCount) aseguran que la onda se mueva y varíe con el tiempo.
        let noiseValue = noise(x * currentWaveFrequency, (y * currentWaveFrequency), frameCount * 0.005);

        // Aplicamos una función seno combinada con ruido para obtener un movimiento más realista
        let waveOffset = sin(x * 0.05 + frameCount * 0.01) * cos(y * 0.03 + frameCount * 0.01) * currentWaveAmplitude;

        // Determinamos el color y el brillo basados en la posición (creando un efecto de brillo en la cresta)
        let brightnessFactor = map(cos(x * 0.02 + frameCount * 0.005), -1, 1, 50, 100);
        fill(hue(frameCount * 0.5), 80, brightnessFactor, 80);

        // Dibujamos un rectángulo muy delgado que representa la "cresta" de la onda en ese punto
        let waveHeight = map(noiseValue, 0, 1, -30, 30); // Mapea el ruido a un rango de altura
        rect(x, height / 2 + waveHeight, 5, abs(waveHeight));
    }

    // Dibujar el usuario en el centro (opcional, solo para referencia)
    fill(255, 100, 100, 50);
    ellipse(mouseX, mouseY, 50, 50); 
}

// Función de interacción: Se llama cuando el ratón se mueve
function mouseMoved() {
    // Cálculo de la distancia desde el ratón al centro
    let dx = mouseX - width / 2;
    let dy = mouseY - height / 2;
    let distance = dist(dx, dy, 0, 0);

    // A mayor distancia (más lejos del centro), más energía y frecuencia.
    // Limitamos el cambio de parámetros para que sea estable.
    let newFrequency = map(distance, 0, width, 0.01, 0.05) * 0.5;
    let newAmplitude = map(distance, 0, width, 1, 10);

    // Aplicamos un filtro para que los cambios no sean bruscos
    currentWaveFrequency = lerp(currentWaveFrequency, newFrequency, 0.1); 
    currentWaveAmplitude = lerp(currentWaveAmplitude, newAmplitude, 0.1); 
}

// Manejo del redimensionamiento de la ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    background(0, 10, 100);
}
