let circleX, circleY;
let isClicked = false;

function setup() {
    createCanvas(windowWidth, windowHeight);
    circleX = width/2;
    circleY = height/2;
}

function draw() {
    background(220);
    
    if (isClicked) {
        fill(255, 0, 0);
    } else {
        fill(0, 0, 255);
    }

    noStroke();
    ellipse(circleX, circleY, 100);
}

function mouseMoved() {
    circleX = mouseX;
    circleY = mouseY;
}

function mouseClicked() {
    isClicked = true;
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    circleX = width/2;
    circleY = height/2;
}