const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl');
if (!gl) {
  throw new Error('WebGL not supported');
}


canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
gl.viewport(0, 0, canvas.width, canvas.height);

// Dados do quad de tela (dois triângulos cobrindo toda a área)
const vertexData = new Float32Array([
  -1, -1,
   1, -1,
  -1,  1,
  -1,  1,
   1, -1,
   1,  1
]);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

// Vertex shader simples: passa as coordenadas para o fragment shader
const vertexShaderSource = `
precision mediump float;
attribute vec2 position;
varying vec2 vUV;
void main() {
  // Converte de [-1,1] para [0,1]
  vUV = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Fragment shader com ray marching para a água e céu com múltiplos movimentos espirais
const fragmentShaderSource = `

precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
varying vec2 vUV;

#define MAX_MARCHING_STEPS 255
#define MIN_DIST 0.0
#define MAX_DIST 100.0
#define EPSILON 0.0001
#define CYCLE_TIME 30.0 // 30 segundos para um ciclo completo

// Parâmetros do sol
#define SUN_RADIUS 0.5
#define SUN_SPEED 0.4  
#define SUN_AMPLITUDE 5.0
#define SUN_BASE_HEIGHT 0.0
const vec3 sunColor = vec3(0.5, 0.4, 0.1);

vec3 getSunPosition();
float sdWater(vec3 p);
float sdSun(vec3 p, vec3 sunPos);
float sceneSDF(vec3 p);
float shortestDistanceToSurface(vec3 eye, vec3 dir, float start, float end);
vec3 estimateNormal(vec3 p);
vec3 phongIllumination(vec3 p, vec3 eye);
vec3 cameraPath(float t, out bool isMoving);

vec3 getSunPosition() {
    return vec3(
        7.0, 
        SUN_BASE_HEIGHT + (sin(u_time * SUN_SPEED) * 0.5 + 0.5) * SUN_AMPLITUDE,
        0.0
    );
}

float opSmoothUnion(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5*(d2 - d1)/k, 0.0, 1.0);
    return mix(d2, d1, h) - k*h*(1.0 - h);
}

float sdWater(vec3 p) {
    float wave1 = sin(p.x * 0.5 + u_time * 0.3) * 0.1; // Ondas mais lentas
    float wave2 = cos(p.z * 3.0 + u_time * 0.2) * 0.2;
    float wave3 = sin(p.x * 1.5 + p.z * 1.0 + u_time * 1.5) * 0.25;
    float wave4 = sin(p.z * 2.0 + u_time * 0.7) * 0.25;
    return p.y - (wave1 + wave2 + wave3 * wave4);
}

float sdSun(vec3 p, vec3 sunPos) {
    return length(p - sunPos) - SUN_RADIUS;
}

float sceneSDF(vec3 p) {
    vec3 sunPos = getSunPosition();
    float water = sdWater(p);
    float sun = sdSun(p, sunPos);
    return opSmoothUnion(water, sun, 0.3);
}

float shortestDistanceToSurface(vec3 eye, vec3 dir, float start, float end) {
    float depth = start;
    for(int i = 0; i < MAX_MARCHING_STEPS; i++) {
        float dist = sceneSDF(eye + depth * dir);
        if(dist < EPSILON) return depth;
        depth += dist;
        if(depth >= end) return end;
    }
    return end;
}

vec3 estimateNormal(vec3 p) {
    return normalize(vec3(
        sceneSDF(vec3(p.x + EPSILON, p.y, p.z)) - sceneSDF(vec3(p.x - EPSILON, p.y, p.z)),
        sceneSDF(vec3(p.x, p.y + EPSILON, p.z)) - sceneSDF(vec3(p.x, p.y - EPSILON, p.z)),
        sceneSDF(vec3(p.x, p.y, p.z + EPSILON)) - sceneSDF(vec3(p.x, p.y, p.z - EPSILON))
    ));
}

vec3 phongIllumination(vec3 p, vec3 eye) {
    vec3 sunPos = getSunPosition();
    vec3 lightDir = normalize(sunPos - p);
    vec3 normal = estimateNormal(p);
    
    vec3 waterColor = vec3(0.1, 0.3, 0.8);
    vec3 sunColorFinal = sunColor * 2.0;
    
    float sunDist = sdSun(p, sunPos);
    float waterDist = sdWater(p);
    
    float blendFactor = smoothstep(-0.2, 0.2, waterDist - sunDist);
    float diff = max(dot(normal, lightDir), 0.0);
    
    return mix(waterColor, sunColorFinal, blendFactor) * (diff + 0.3);
}

float easeInOutCubic(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

vec3 cameraPath(float t, out bool isMoving) {
    float startTime = 5.0;    // Tempo inicial estático
    float moveTime = 20.0;    // Tempo de movimento
    float returnTime = 5.0;   // Tempo de retorno
    
    float progress = mod(t, CYCLE_TIME);
    isMoving = true;
    
    if(progress < startTime) { // Fase estática inicial
        isMoving = false;
        return vec3(0.0, 2.0, 5.0);
    }
    else if(progress < startTime + moveTime) { // Movimento suave
        float p = (progress - startTime) / moveTime;
        p = easeInOutCubic(p);
        
        // Movimento orbital lento
        float angle = mix(0.0, 3.141592 * 0.5, p); // 90 graus
        return vec3(
            cos(angle) * 8.0,
            mix(2.0, 4.0, sin(p * 3.1415)),
            sin(angle) * 8.0
        );
    }
    else { // Retorno suave
        float p = (progress - startTime - moveTime) / returnTime;
        p = easeInOutCubic(p);
        return vec3(
            mix(cos(3.141592 * 0.5) * 8.0, 0.0, p),
            mix(4.0, 2.0, p),
            mix(sin(3.141592 * 0.5) * 8.0, 5.0, p)
        );
    }
}

void main() {
    vec2 uv = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
    uv.x *= u_resolution.x / u_resolution.y;

    bool isMoving;
    vec3 eye = cameraPath(u_time, isMoving);
    vec3 target = getSunPosition();
    vec3 rayDir;
    
    if(isMoving) {
        // Movimento suave mantendo o sol no centro
        vec3 forward = normalize(target - eye);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
        vec3 up = cross(forward, right);
        rayDir = normalize(uv.x * right + uv.y * up + forward * 2.0);
    } else {
        // Vista estática inicial
        rayDir = normalize(vec3(uv, -1.0));
    }

    float dist = shortestDistanceToSurface(eye, rayDir, MIN_DIST, MAX_DIST);

    if(dist > MAX_DIST - EPSILON) {
        // Céu com gradiente suave
        vec3 skyColor = mix(vec3(0.2, 0.3, 0.7), vec3(0.6, 0.7, 1.0), uv.y);
        gl_FragColor = vec4(skyColor, 1.0);
        return;
    }

    vec3 p = eye + dist * rayDir;
    vec3 color = phongIllumination(p, eye);
    
    // Glow suave do sol
    vec3 sunPos = getSunPosition();
    float glow = pow(1.0 - smoothstep(0.0, SUN_RADIUS * 3.0, length(p - sunPos)), 4.0);
    color = mix(color, sunColor, glow * 0.6);
    
    gl_FragColor = vec4(color, 1.0);
}
    
`;

// Função auxiliar para compilar shaders
function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

const vertexShader = createShader(gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program));
}
gl.useProgram(program);

// Configura o atributo de posição do vértice
const positionLocation = gl.getAttribLocation(program, "position");
gl.enableVertexAttribArray(positionLocation);
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

// Obtém as localizações dos uniforms
const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
const timeLocation = gl.getUniformLocation(program, "u_time");

function render(time) {
  time *= 0.001; 
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.uniform1f(timeLocation, time);
  
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
