import * as THREE from 'three';

export interface EnvironmentRig {
  envMap: THREE.Texture;
  dispose: () => void;
}

/**
 * Generates a realistic HDR-like procedural IBL environment map using PMREMGenerator.
 * Bright emissive light panels (> 1.0 linear RGB) give metallic hulls, glass canopies,
 * and architectural curtain walls crisp specular reflections without external HDR files.
 */
export function createEnvironmentMap(renderer: THREE.WebGLRenderer): EnvironmentRig {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  // Soft atmospheric dome gradient inside the PMREM capture scene
  const domeGeo = new THREE.SphereGeometry(40, 24, 16);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 ground = vec3(0.06, 0.09, 0.16);
        vec3 horizon = vec3(0.45, 0.68, 0.95);
        vec3 zenith = vec3(0.05, 0.10, 0.24);
        vec3 col = mix(ground, horizon, smoothstep(0.32, 0.52, h));
        col = mix(col, zenith, smoothstep(0.52, 0.92, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  envScene.add(dome);

  const disposables: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [
    { geometry: domeGeo, material: domeMat }
  ];

  const addPanel = (
    pos: [number, number, number],
    size: [number, number],
    rgb: [number, number, number]
  ) => {
    const geo = new THREE.PlaneGeometry(size[0], size[1]);
    const color = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
    disposables.push({ geometry: geo, material: mat });
  };

  // High-intensity sun key reflector
  addPanel([12, 18, -24], [12, 12], [6.2, 5.4, 4.4]);
  // Broad cool overhead sky softbox
  addPanel([0, 28, 2], [28, 22], [1.35, 2.05, 3.0]);
  // Horizon rim strips for crisp aircraft edge highlights
  addPanel([-24, 3, -6], [24, 5], [1.2, 2.4, 3.4]);
  addPanel([24, 4, -8], [24, 5], [2.8, 1.7, 1.2]);
  // Subtle underside bounce so ventral hull plates stay readable
  addPanel([0, -24, 0], [26, 26], [0.35, 0.48, 0.72]);

  const rt = pmrem.fromScene(envScene, 0.035);
  const envMap = rt.texture;

  for (const item of disposables) {
    item.geometry.dispose();
    item.material.dispose();
  }
  pmrem.dispose();

  return {
    envMap,
    dispose: () => {
      rt.dispose();
      envMap.dispose();
    }
  };
}
