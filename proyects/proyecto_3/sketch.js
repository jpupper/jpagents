// Global arrays to hold game objects
let player;
let bullets = [];
let enemies = [];
let gameFPS = 60;

// --- Classes ---

class Player {
  constructor(x, y, size) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.speed = 5;
    this.health = 100;
  }

  move() {
    let dx = 0;
    let dy = 0;
    
    // Handle keyboard input for movement
    if (keyIsDown(LEFT_ARROW) || keyIsDown(65)) { // A or Left
      dx = -this.speed;
    }
    if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) { // D or Right
      dx = this.speed;
    }
    if (keyIsDown(UP_ARROW) || keyIsDown(87)) { // W or Up
      dy = -this.speed;
    }
    if (keyIsDown(DOWN_ARROW) || keyIsDown(89)) { // S or Down
      dy = this.speed;
    }

    this.x += dx;
    this.y += dy;

    // Keep player within bounds
    this.x = constrain(this.x, this.size / 2, width - this.size / 2);
    this.y = constrain(this.y, this.size / 2, height - this.size / 2);
  }

  shoot() {
    // Create a bullet originating from the center-top of the player
    bullets.push(new Bullet(this.x, this.y - this.size / 2, true));
  }

  display() {
    // Draw the spaceship (a simple triangle representation)
    fill(0, 200, 255); // Light blue color
    stroke(255);
    strokeWeight(2);
    triangle(
      this.x, this.y - this.size / 2, // Top point
      this.x - this.size / 2, this.y + this.size / 2, // Bottom left
      this.x + this.size / 2, this.y + this.size / 2  // Bottom right
    );
    
    // Display health
    fill(255, 0, 0);
    textSize(16);
    text(`Health: ${nf(this.health, '', 0)}%`, 10, 20);
  }

  takeDamage(amount) {
    this.health -= amount;
    if (this.health < 0) this.health = 0;
  }
}

class Bullet {
  constructor(x, y, isPlayerBullet) {
    this.x = x;
    this.y = y;
    this.radius = 4;
    this.speed = 10;
    this.isPlayerBullet = isPlayerBullet;
  }

  move() {
    // Player bullets move up (negative y)
    if (this.isPlayerBullet) {
      this.y -= this.speed;
    } else {
      // Enemy bullets move down (positive y)
      this.y += this.speed * 0.8;
    }
  }

  display() {
    fill(this.isPlayerBullet ? 255 : 255, 255, 0); // White or Yellow
    ellipse(this.x, this.y, this.radius * 2);
  }

  // Check collision with another bullet (for enemy bullets hitting player)
  isColliding(otherBullet) {
      let d = dist(this.x, this.y, otherBullet.x, otherBullet.y);
      return d < this.radius + otherBullet.radius;
  }
}

class Enemy {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = random(20, 40);
    this.speed = random(1, 3);
    this.health = 30;
  }

  move() {
    // Enemies drift slowly downwards, simulating an incoming threat
    this.y += this.speed * 0.5;
  }

  display() {
    fill(255, 100, 0); // Orange color for enemies
    stroke(200, 50, 0);
    strokeWeight(2);
    ellipse(this.x, this.y, this.size * 2);
  }

  // Check collision with player
  checkPlayerCollision(player) {
    let distance = dist(this.x, this.y, player.x, player.y + player.size / 2);
    if (distance < this.size + player.size / 2) {
        return true;
    }
    return false;
  }
}

// --- Game Functions ---

function setup() {
  createCanvas(800, 600);
  // Initialize player at the bottom center
  player = new Player(width / 2, height - 50, 40);
  
  // Set up event listener for shooting
  setInterval(() => {
    if (keyIsDown(SPACE)) {
      player.shoot();
    }
  }, 150); // Fire rate limiter (approx every 150ms)
}

function draw() {
  background(10, 10, 40); // Dark space background

  // 1. Handle Player Logic
  player.move();
  player.display();

  // 2. Handle Bullet Logic
  // Move and draw bullets, and clean up off-screen ones
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.move();
    b.display();

    // Check collision: Bullet vs Enemy
    for (let j = enemies.length - 1; j >= 0; j--) {
        let e = enemies[j];
        if (b.isPlayerBullet) {
            // Check if player bullet hits enemy
            let d = dist(b.x, b.y, e.x, e.y);
            if (d < e.size) {
                enemies[j].health -= 10; // Damage enemy
                // If enemy health drops to 0 or less, remove it
                if (enemies[j].health <= 0) {
                    enemies.splice(j, 1);
                    j--; // Adjust index after removal
                }
                break; // Bullet only needs to hit one enemy per frame
            }
        }
    }
    
    // Clean up bullets that leave the screen
    if (b.y < 0 || b.y > height) {
      bullets.splice(i, 1);
    }
  }
  
  // 3. Handle Enemy Logic
  // Spawn new enemies periodically
  if (frameCount % 60 === 0) { // Spawn one enemy every second (approx)
      let x = random(50, width - 50);
      enemies.push(new Enemy(x, random(-50, 50)));
  }
  
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.move();
    e.display();

    // Check enemy collision with player
    if (e.checkPlayerCollision(player)) {
        player.takeDamage(1); // Small damage per frame of contact
    }
    
    // Clean up enemies that leave the bottom or if they were hit by player bullets
    if (e.y > height + 50 || enemies[i].health <= 0) {
        enemies.splice(i, 1);
        i--; // Correct index after splicing
    }
  }

  // 4. Check Game Over
  if (player.health <= 0) {
    gameOver();
  }
}

function keyPressed() {
    // This handler now manages all key presses, including restart
    if (key === 'r' || key === 'R') {
        // Restart the game
        location.reload();
    }
}

function gameOver() {
    // Stop drawing game elements and display Game Over message
    noLoop();
    background(0, 0, 0);
    fill(255, 50, 50);
    textSize(48);
    textAlign(CENTER, CENTER);
    text("GAME OVER", width / 2, height / 2 - 50);
    textSize(24);
    text("Press R to Restart", width / 2, height / 2 + 50);
}
