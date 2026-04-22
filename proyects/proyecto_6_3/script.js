let colorCirculo = 'red';

function setup() {
    createCanvas(windowWidth, windowHeight);
}

function draw() {
    background('white');
    fill(colorCirculo);
    noStroke();
    ellipse(mouseX, mouseY, 100, 100);
}

function mousePressed() {
    colorCirculo = (colorCirculo === 'red') ? 'blue' : 'red';
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}