// === CONSTANTES Y VARIABLES GLOBALES ===
let particles = [];
const NUM_PARTICLES = 150;
const colors = ['#ff416c', '#118cff', '#33ff66', '#ffb400']; // Rojo, Azul, Verde, Naranja

// *** CORRECCIÓN DE ALCANCE: Definir variables globales al inicio ***
const buttons = [
    { x: windowWidth * 0.15, y: windowHeight * 0.3, color: colors[0] }, 
    { x: windowWidth * 0.35, y: windowHeight * 0.3, color: colors[1] }, 
    { x: windowWidth * 0.15, y: windowHeight * 0.55, color: colors[2] }, 
    { x: windowWidth * 0.35, y: windowHeight * 0.55, color: colors[3] } 
];

// === CLASE DE PARTÍCULAS (FONDO) ===

class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.r = random(1, 3);
        this.vx = random(-0.5, 0.5);
        this.vy = random(-0.5, 0.5);
        this.color = color(random(100, 255), random(100, 255), random(100, 255), random(50, 150));
    }

    // *** CORRECCIÓN: Lógica física en update() ***
    update() {
        this.x += this.vx;
        this.y += this.vy;

        // Fricción
        this.vx *= 0.98;
        this.vy *= 0.98;
        
        // Colisión con límites (Depende de width/height globales de p5.js)
        if (this.x < this.r || this.x > width - this.r) {
            this.vx *= -1;
        }
        if (this.y < this.r || this.y > height - this.r) {
            this.vy *= -1;
        }
    }

    // *** CORRECCIÓN: display() es puramente dibujo, sin lógica de dimensión ***
    display() {
        stroke(this.color);
        stroke-width(this.r);
        point(this.x, this.y);
    }
}

function setupParticles() {
    particles = [];
    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles.push(new Particle(random(width), random(height)));
    }
}

function drawParticles() {
    // Dibujar fondo con baja opacidad para efecto de estela
    background(0, 0, 0, 20); 
    
    for (let p of particles) {
        p.update(); // Actualiza posición y colisiones
        p.display(); // Solo dibuja
    }
}

// === LÓGICA DEL JUEGO SIMON DICE ===

let sequence = []; // La secuencia que el juego recuerda
let playerTurn = []; // Lo que el jugador ha pulsado
let gameActive = false;
let gameLevel = 0;

function setup() {
    createCanvas(windowWidth, windowHeight);
    setupParticles();
}

function draw() {
    drawParticles();
    drawGameUI();
}

function drawGameUI() {
    // Dibujar Título
    fill(255); 
    textSize(48);
    textAlign(CENTER);
    text("SIMON DICE", width / 2, 80);
    
    // Nivel
    fill(255, 255, 0); 
    textSize(24);
    text(`Nivel: ${gameLevel}`, width / 2, 120);

    // Botones
    buttons.forEach(btn => {
        fill(btn.color);
        stroke(0); 
        strokeWeight(5);
        // Dibujar el rectángulo base del botón
        rect(btn.x - 70, btn.y - 70, 140, 140);
    });
}

function mousePressed() {
    if (!gameActive) {
        startGame();
    } else {
        // Se comprueba si es click y se pasa el evento
        handleGuess(mouseX, mouseY);
    }
}

function startGame() {
    gameLevel = 0;
    sequence = [];
    playerTurn = [];
    gameActive = true;
    
    setTimeout(() => {
        nextRound();
    }, 1000);
}

function handleGuess(mx, my) {
    // Usamos el 'const' buttons que está bien inicializado al inicio del script.
    for (let i = 0; i < buttons.length; i++) {
        let btn = buttons[i];
        // Verificación de click (con margen de error)
        if (mx > btn.x - 80 && mx < btn.x + 80 && my > btn.y - 80 && my < btn.y + 80) {
            let guessedColor = btn.color;
            playerTurn.push(guessedColor);
            
            checkPlayerMove();
            return;
        }
    }
}

function checkPlayerMove() {
    let correct = true;
    for(let i = 0; i < sequence.length; i++) {
        // Comprobar que el jugador no haya fallado y que coincida el elemento
        if (i >= playerTurn.length || sequence[i] !== playerTurn[i]) {
            correct = false;
            break;
        }
    }

    if (correct && playerTurn.length === sequence.length) {
        gameLevel++;
        playerTurn = []; // Limpiar turno
        setTimeout(() => { 
            nextRound();
        }, 1000);
    } else {
        gameOver();
    }
}

function nextRound() {
    if (gameLevel >= 5) { 
        alert(`¡Felicidades! Has alcanzado el Nivel ${gameLevel}!`);
        gameActive = false;
        return;
    }
    
    let newColor = colors[floor(random(colors.length))];
    sequence.push(newColor);
    playerTurn = []; 
    
    setTimeout(() => { 
        playSequence();
    }, 1000);
}

function playSequence() {
    let index = 0;
    const playInterval = setInterval(() => {
        if (index < sequence.length) {
            let colorToPlay = sequence[index];
            flashButton(colorToPlay); 
            index++;
        } else {
            clearInterval(playInterval);
        }
    }, 700);
}

function flashButton(color) {
    // Este código ahora tiene acceso seguro a 'buttons' debido a la reestructuración.
    let btn = buttons.find(b => b.color === color);
    if (btn) {
        console.log(`Flash: ${color}`);
    }
}

function gameOver() {
    gameActive = false;
    alert(`¡Game Over! El juego terminó en el Nivel ${gameLevel}. La secuencia era: ${sequence.join(' -> ')}
Intenta de nuevo.`);
}

// Ajustar canvas en redimensionamiento de ventana
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    // Re-inicializar partículas para cubrir el nuevo tamaño
    setupParticles();
}
