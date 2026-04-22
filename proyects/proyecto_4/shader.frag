
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

// --- SDF Functions ---

// Sphere SDF: distance from point p to a sphere centered at center with radius r
float sdSphere(vec3 p, vec3 center, float r) {
    return length(p - center) - r;
}

// Distortion function (simple sine wave based on world coordinates)
vec3 distort(vec3 p) {
    float distortion = sin(p.x * 2.0 + u_time * 0.5) * 0.1;
    float distortionY = cos(p.y * 1.5 + u_time * 0.3) * 0.08;
    return vec3(p.x + distortion, p.y + distortionY, p.z);
}

// Main Raymarch function
vec4 raymarch(vec3 ro, vec3 rd) {
    float t = 0.0;
    float max_dist = 10.0;
    int max_steps = 100;
    float epsilon = 0.001;

    for (int i = 0; i < max_steps; i++) {
        vec3 p = ro + rd * t;
        
        // Apply distortion to the point being tested
        vec3 distorted_p = distort(p);
        
        // Test against the sphere (Center at (0, 0, 0), Radius 1.5)
        float dist = sdSphere(distorted_p, vec3(0.0, 0.0, 0.0), 1.5);

        if (dist < epsilon) {
            // Hit: Calculate surface normal and color
            vec3 normal = normalize(vec3(
                -2.0 * (p.x - 0.0) / (1.5 * 1.5),
                -2.0 * (p.y - 0.0) / (1.5 * 1.5),
                -2.0 * (p.z - 0.0) / (1.5 * 1.5)
            ));
            
            // A basic diffuse color based on normal (lighting)
            vec3 color = normal * 0.8 + 0.2; 
            
            // Add slight blue tint based on depth/distortion influence
            color = mix(color, vec3(0.7, 0.9, 1.0), abs(sin(p.z * 0.5)));
            
            return vec4(color, 1.0);
        }

        if (dist > 1.0) {
            // Miss: Passed through the object entirely, or too far.
            // Check if we exceeded the max distance or if the distance is too large to be meaningful
            if (t > max_dist) break;
        }
        
        // Update distance
        t += dist;

        if (t > max_dist) break;
    }

    // Background color (Sky blue/dark)
    return vec4(0.05, 0.05, 0.1, 1.0);
}

void main() {
    // 1. Setup Camera (Ray Origin and Direction)
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    
    // Simple perspective projection from screen coordinates
    // This defines the ray direction (rd)
    vec2 target = (uv * 2.0 - 1.0); // Range [-1, 1]
    float focalLength = 3.0;
    vec3 rd = normalize(vec3(target.x * focalLength, target.y * focalLength, 1.0));
    
    // Ray Origin (Camera position - slightly pulled back)
    vec3 ro = vec3(0.0, 0.0, -3.0); 

    // 2. Perform Raymarching
    vec4 color = raymarch(ro, rd);
    
    gl_FragColor = color;
}
