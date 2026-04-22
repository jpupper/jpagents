
// --- SCENE SETUP ---
let scene, camera, renderer;
const cubes = [];
const numCubes = 20;
const cubeSize = 1;
const spacing = 2.5;

// Camera setup
camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

// Renderer setup
renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Scene setup
scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333); // Dark background

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 2); // Soft white light
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

// --- OBJECT CREATION ---

function createCube(x, y, z) {
    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    // Use a material that allows opacity changes (MeshStandardMaterial is good for lighting)
    const material = new THREE.MeshStandardMaterial({ 
        color: Math.random() * 0xffffff, 
        opacity: 0, // Start invisible
        transparent: true 
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(x, y, z);
    scene.add(cube);
    return cube;
}

function initializeCubes() {
    for (let i = 0; i < numCubes; i++) {
        // Stagger placement across X-Z plane, slightly staggered on Y
        const x = (i % 5 - 2) * spacing;
        const z = Math.floor(i / 5) * spacing;
        const y = (i % 3 === 0) ? 1 : 0; // Slight vertical variation
        
        const cube = createCube(x, y, z);
        cubes.push(cube);
    }
}

// --- ANIMATION LOGIC ---

let cubeAppearanceProgress = 0;
const appearanceSpeed = 0.015; // Rate at which cubes become visible

function animate() {
    requestAnimationFrame(animate);

    // 1. Make cubes appear (Fade in)
    if (cubeAppearanceProgress < 1) {
        cubeAppearanceProgress += appearanceSpeed;
        
        const opacityTarget = Math.min(1, cubeAppearanceProgress * 2); // Fade from 0 to 1 quickly
        
        cubes.forEach(cube => {
            // Smoothly interpolate opacity towards the target
            cube.material.opacity = THREE.MathUtils.lerp(cube.material.opacity, opacityTarget, 0.05);
        });
    } else {
        // Optional: Make cubes hover slightly after appearing
        cubes.forEach((cube, index) => {
            // Simple sine wave movement for visual effect
            cube.position.x = (Math.sin(Date.now() * 0.001 + index) * 0.5) * (index % 3 === 0 ? 1 : 0);
            cube.position.y = (Math.cos(Date.now() * 0.001 + index * 0.5) * 0.2) * (index % 3 === 1 ? 1 : 0);
            cube.position.z = (Math.sin(Date.now() * 0.001 + index * 0.8) * 0.2);
        });
    }


    // 2. Render the scene
    renderer.render(scene, camera);
}

// --- EVENT HANDLERS ---

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', onWindowResize, false);

// --- INITIALIZATION ---
initializeCubes();
animate();

log("Three.js scene initialized successfully. Cubes are appearing!");
