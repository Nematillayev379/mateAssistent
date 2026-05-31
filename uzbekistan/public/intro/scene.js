import * as THREE from 'three';

const canvas = document.getElementById('bg-canvas');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0a0f, 0.035);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 8;

const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0a0f);

const particlesGeo = new THREE.BufferGeometry();
const count = 200;
const positions = new Float32Array(count * 3);
const colors = new Float32Array(count * 3);
for (let i = 0; i < count * 3; i++) {
  positions[i] = (Math.random() - 0.5) * 30;
  colors[i] = Math.random() * 0.3 + 0.1;
}
particlesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particlesGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const particlesMat = new THREE.PointsMaterial({
  size: 0.04,
  transparent: true,
  opacity: 0.8,
  vertexColors: true,
  blending: THREE.AdditiveBlending,
});
const particles = new THREE.Points(particlesGeo, particlesMat);
scene.add(particles);

const torusGeo = new THREE.TorusKnotGeometry(1.2, 0.4, 128, 16);
const torusMat = new THREE.MeshPhysicalMaterial({
  color: 0x22d3ee,
  emissive: 0x22d3ee,
  emissiveIntensity: 0.15,
  metalness: 0.3,
  roughness: 0.4,
  transparent: true,
  opacity: 0.6,
  wireframe: false,
});
const torus = new THREE.Mesh(torusGeo, torusMat);
torus.position.y = -0.5;
scene.add(torus);

const wireGeo = new THREE.TorusKnotGeometry(1.25, 0.45, 64, 8);
const wireMat = new THREE.MeshBasicMaterial({
  color: 0x22d3ee,
  wireframe: true,
  transparent: true,
  opacity: 0.15,
});
const wire = new THREE.Mesh(wireGeo, wireMat);
wire.position.y = -0.5;
scene.add(wire);

const ringGeo = new THREE.RingGeometry(2.2, 2.5, 64);
const ringMat = new THREE.MeshBasicMaterial({
  color: 0x6366f1,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.06,
});
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.position.z = -2;
scene.add(ring);

let mouseX = 0;
let mouseY = 0;
const targetX = 0;
const targetY = 0;

document.addEventListener('mousemove', (e) => {
  mouseX = (e.clientX / window.innerWidth) * 2 - 1;
  mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
});

let scrollY = 0;
window.addEventListener('scroll', () => {
  scrollY = window.scrollY;
});

function animate() {
  requestAnimationFrame(animate);

  const time = Date.now() * 0.001;
  torus.rotation.x = time * 0.2;
  torus.rotation.y = time * 0.3;
  wire.rotation.x = time * 0.2;
  wire.rotation.y = time * 0.3;
  ring.rotation.z = time * 0.05;

  particles.rotation.y = time * 0.01;
  particles.rotation.x = Math.sin(time * 0.005) * 0.1;

  const parallaxX = (mouseX - targetX) * 0.3;
  const parallaxY = (mouseY - targetY) * 0.3;
  torus.position.x += (parallaxX - torus.position.x) * 0.02;
  torus.position.y += (parallaxY - 0.5 - torus.position.y) * 0.02;
  wire.position.x = torus.position.x;
  wire.position.y = torus.position.y;

  const scrollOffset = Math.min(scrollY * 0.003, 2);
  const opacity = Math.max(1 - scrollOffset * 0.5, 0.2);
  torusMat.opacity = opacity * 0.6;
  wireMat.opacity = opacity * 0.15;

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
