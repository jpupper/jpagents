
let particles = [];
const NUM_PARTICLES = 100;

// Particle class
class Particle {
  constructor(x, y) {
    this.position = createVector(x, y);
    this.velocity = p5.Vector.random2D();
    this.velocity.mult(random(1, 4));
    this.acceleration = createVector(0, 0);
    this.lifespan = 255;
  }

  applyForce(force) {
    this.acceleration.add(force);
  }

  update() {
    this.velocity.add(this.acceleration);
    this.position.add(this.velocity);
    this.acceleration.mult(0); // Reset acceleration
    this.lifespan -= 3; // Fade out over time
  }

  show() {
    stroke(255, this.lifespan);
    strokeWeight(2);
    point(this.position.x, this.position.y);
  }

  isDead() {
    return this.lifespan < 0;
  }
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  background(0);
  
  // Initialize particles across the canvas
  particles = [];
  for (let i = 0; i < NUM_PARTICLES; i++) {
    particles.push(new Particle(random(width), random(height)));
  }
}

function draw() {
  // Create a semi-transparent background wipe effect for trails
  background(0, 10); 

  // Attraction force towards the center, simulating a vortex
  let center = createVector(width / 2, height / 2);
  let force = p5.Vector.sub(center, createVector(width / 2, height / 2));
  force.normalize();
  force.mult(0.005); // Small constant force

  for (let i = 0; i < particles.length; i++) {
    let p = particles[i];
    
    // Apply general force (Vortex effect)
    p.applyForce(force); 
    
    // Apply mouse interaction: push particles away if mouse is near
    let mouseForce = p5.Vector.sub(createVector(mouseX, mouseY), p.position);
    mouseForce.normalize();
    mouseForce.div(dist(mouseX, mouseY, p.position.x, p.position.y) + 1); // Inverse distance falloff
    p.applyForce(mouseForce);
    
    p.update();
    p.show();
  }
}

function mouseMoved() {
    // This hook is useful for immediate interaction, but we rely on the draw loop for continuous effect.
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
