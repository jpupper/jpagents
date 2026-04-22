let particles = [];

function setup() {
    createCanvas(windowWidth, windowHeight);
    colorMode(HSB, 100);
    noStroke();
}

function draw() {
    background(0, 0, 100, 15);
    
    // Create new particle on mouse press
    if (mouseIsPressed) {
        particles.push({
            x: mouseX,
            y: mouseY,
            hue: random(100),
            radius: random(10, 40)
        });
    }

    // Draw all particles
    for (let p of particles) {
        fill(p.hue, 80, 100);
        ellipse(p.x, p.y, p.radius);
        p.hue += 0.1;
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}