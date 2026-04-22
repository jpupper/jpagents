// p5.js sketch interactivo

let particles = [];
const numParticles = 50;

// Clase para las partículas
class Particle {
  constructor(x, y) {
    this.position = createVector(x, y);
    this.velocity = p5.Vector.random2D().mult(random(0.5, 1.5));
    this.acceleration = createVector(0, 0);
    this.lifespan = 255;
  }

  applyForce(force) {
    this.acceleration.add(force);
  }

  update() {
    this.velocity.add(this.acceleration);
    this.position.add(this.velocity);
    this.acceleration.add(createVector(0, 0)); // Reset acceleration
    this.lifespan -= 1.5;
  }

  display() {
    stroke(255, this.lifespan); // Usamos la vida para el color
    strokeWeight(3);
    point(this.position.x, this.position.y);
  }
}

function setup() {
  // El p5.js se encargará de crear el canvas en fullscreen debido a style.css
  createCanvas(windowWidth, windowHeight);
  
  // Inicializar partículas en el centro
  for (let i = 0; i < numParticles; i++) {
    particles.push(new Particle(random(width), random(height)));
  }
}

function draw() {
  // Desenfoque sutil para efecto de cola (Trail Effect)
  background(0, 0, 0, 50); 
  
  // Lógica de interacción: Atracción al ratón
  let mousePos = createVector(mouseX, mouseY);
  let force = createVector(mousePos.x - width/2, mousePos.y - height/2).normalize().mult(0.01);

  for (let i = 0; i < particles.length; i++) {
    let p = particles[i];
    
    // Aplicar fuerza central (si no estamos en el ratón)
    p.applyForce(force);
    
    p.update();
    p.display();
  }
}

// Función para redimensionar el canvas si cambia la ventana
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
