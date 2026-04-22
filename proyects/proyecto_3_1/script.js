
let particles = [];
const NUM_PARTICLES = 50;

// Particle class definition
class Particle {
    constructor(x, y) {
        this.position = createVector(x, y);
        this.velocity = p5.Vector.random2D();
        this.velocity.mult(random(0.5, 2));
        this.radius = random(3, 10);
        this.lifespan = 255;
    }

    update() {
        // Move towards the mouse position (attraction force)
        let mouseVector = createVector(mouseX, mouseY);
        let directionToMouse = p5.Vector.sub(mouseVector, this.position);
        let distance = directionToMouse.mag();

        // Apply a slight pull towards the mouse, inversely proportional to distance
        let force = p5.Vector.div(directionToMouse, distance);
        force.mult(0.005); // Tuning factor

        this.velocity.add(force);
        this.velocity.limit(5); // Keep speed reasonable

        this.position.add(this.velocity);
        
        // Fade out slightly over time
        this.lifespan -= 1;
    }

    display() {
        stroke(255, 150, 0, this.lifespan);
        strokeWeight(this.radius);
        noFill();
        ellipse(this.position.x, this.position.y, this.radius * 2);
    }
}

function setup() {
    createCanvas(windowWidth, windowHeight);
    
    // Initialize particles spread across the screen
    for (let i = 0; i < NUM_PARTICLES; i++) {
        let x = random(width);
        let y = random(height);
        particles.push(new Particle(x, y));
    }
    
    background(10, 10, 50); // Dark blue background
}

function draw() {
    // Creating a slight fade effect on the background each frame instead of clearing completely
    background(10, 10, 50, 30); 
    
    // Update and display all particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update();
        p.display();
        
        // Remove particles that have faded away
        if (p.lifespan < 0) {
            particles.splice(i, 1);
        }
    }
    
    // Add a small particle burst directly at the mouse location for more immediate feedback
    if (frameCount % 3 === 0) {
        particles.push(new Particle(mouseX, mouseY));
    }
}

function mouseMoved() {
    // Interaction happens via the attraction force in update()
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}
