import * as THREE from 'three';

interface SkyTheme {
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  dirIntensity: number;
  sunElev: number;
}

const SKY_THEMES: SkyTheme[] = [
  // 0: Crisp Turquoise Morning
  {
    zenith: new THREE.Color('#0ea5e9'),
    mid: new THREE.Color('#67e8f9'),
    horizon: new THREE.Color('#e0f7ff'),
    sunColor: new THREE.Color('#fff7d6'),
    fogColor: new THREE.Color('#bfefff'),
    hemiSky: new THREE.Color('#bae6fd'),
    hemiGround: new THREE.Color('#6ee7b7'),
    dirIntensity: 1.9,
    sunElev: 0.42
  },
  // 1: Sunlit Golden Afternoon
  {
    zenith: new THREE.Color('#2563eb'),
    mid: new THREE.Color('#60a5fa'),
    horizon: new THREE.Color('#fde68a'),
    sunColor: new THREE.Color('#fde047'),
    fogColor: new THREE.Color('#d9ecff'),
    hemiSky: new THREE.Color('#93c5fd'),
    hemiGround: new THREE.Color('#fca5a5'),
    dirIntensity: 1.75,
    sunElev: 0.28
  },
  // 2: Warm Peach Sunset
  {
    zenith: new THREE.Color('#4338ca'),
    mid: new THREE.Color('#f472b6'),
    horizon: new THREE.Color('#fed7aa'),
    sunColor: new THREE.Color('#fb923c'),
    fogColor: new THREE.Color('#f9c5b4'),
    hemiSky: new THREE.Color('#f9a8d4'),
    hemiGround: new THREE.Color('#fdba74'),
    dirIntensity: 1.55,
    sunElev: 0.16
  },
  // 3: Soft Pastel Dawn
  {
    zenith: new THREE.Color('#0284c7'),
    mid: new THREE.Color('#7dd3fc'),
    horizon: new THREE.Color('#fef3c7'),
    sunColor: new THREE.Color('#fef08a'),
    fogColor: new THREE.Color('#d8f3ff'),
    hemiSky: new THREE.Color('#bae6fd'),
    hemiGround: new THREE.Color('#a7f3d0'),
    dirIntensity: 1.8,
    sunElev: 0.34
  }
];

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly dirLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;

  private readonly uniforms: {
    uZenith: { value: THREE.Color };
    uMid: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
  };

  private cycleTime = 0;
  private warmth = 0;

  constructor(scene: THREE.Scene, enableShadows: boolean) {
    this.uniforms = {
      uZenith: { value: SKY_THEMES[0].zenith.clone() },
      uMid: { value: SKY_THEMES[0].mid.clone() },
      uHorizon: { value: SKY_THEMES[0].horizon.clone() },
      uSunColor: { value: SKY_THEMES[0].sunColor.clone() },
      uSunDir: { value: new THREE.Vector3(0.42, 0.4, -0.82).normalize() }
    };

    const geo = new THREE.SphereGeometry(520, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        varying vec3 vWorldDir;

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          float upper = smoothstep(0.46, 0.92, h);
          float lower = smoothstep(0.32, 0.54, h);
          vec3 col = mix(uHorizon, uMid, lower);
          col = mix(col, uZenith, upper);

          float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
          float sunHalo = pow(sunDot, 10.0) * 0.35;
          float sunDisc = smoothstep(0.994, 0.9985, sunDot) * 0.95;
          col += uSunColor * (sunHalo + sunDisc);

          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.hemiLight = new THREE.HemisphereLight(
      SKY_THEMES[0].hemiSky,
      SKY_THEMES[0].hemiGround,
      1.05
    );
    scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(SKY_THEMES[0].sunColor, SKY_THEMES[0].dirIntensity);
    this.dirLight.position.set(36, 48, -28);
    if (enableShadows) {
      this.dirLight.castShadow = true;
      this.dirLight.shadow.mapSize.set(1024, 1024);
      this.dirLight.shadow.camera.near = 2;
      this.dirLight.shadow.camera.far = 140;
      const d = 32;
      this.dirLight.shadow.camera.left = -d;
      this.dirLight.shadow.camera.right = d;
      this.dirLight.shadow.camera.top = d;
      this.dirLight.shadow.camera.bottom = -d;
      this.dirLight.shadow.bias = -0.0008;
    }
    scene.add(this.dirLight);
    scene.add(this.dirLight.target);

    this.fog = new THREE.FogExp2(SKY_THEMES[0].fogColor.getHex(), 0.0046);
    scene.fog = this.fog;
  }

  getDayWarmth(): number {
    return this.warmth;
  }

  setShadowEnabled(enabled: boolean): void {
    this.dirLight.castShadow = enabled;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    // Full morning -> afternoon -> sunset -> dawn cycle every 120s
    this.cycleTime = (this.cycleTime + dt) % 120;
    const progress = (this.cycleTime / 120) * SKY_THEMES.length;
    const idxA = Math.floor(progress) % SKY_THEMES.length;
    const idxB = (idxA + 1) % SKY_THEMES.length;
    const t = progress - Math.floor(progress);
    const smoothT = t * t * (3 - 2 * t);

    const a = SKY_THEMES[idxA];
    const b = SKY_THEMES[idxB];

    this.uniforms.uZenith.value.copy(a.zenith).lerp(b.zenith, smoothT);
    this.uniforms.uMid.value.copy(a.mid).lerp(b.mid, smoothT);
    this.uniforms.uHorizon.value.copy(a.horizon).lerp(b.horizon, smoothT);
    this.uniforms.uSunColor.value.copy(a.sunColor).lerp(b.sunColor, smoothT);

    this.fog.color.copy(a.fogColor).lerp(b.fogColor, smoothT);
    this.hemiLight.color.copy(a.hemiSky).lerp(b.hemiSky, smoothT);
    this.hemiLight.groundColor.copy(a.hemiGround).lerp(b.hemiGround, smoothT);

    const elev = THREE.MathUtils.lerp(a.sunElev, b.sunElev, smoothT);
    const sunX = 0.42;
    const sunZ = -0.82;
    this.uniforms.uSunDir.value.set(sunX, elev, sunZ).normalize();

    this.dirLight.color.copy(this.uniforms.uSunColor.value);
    this.dirLight.intensity = THREE.MathUtils.lerp(a.dirIntensity, b.dirIntensity, smoothT);

    // Keep sky dome & directional shadow frustum centered on player
    this.mesh.position.copy(playerPos);
    this.dirLight.position.set(playerPos.x + 28, playerPos.y + 42, playerPos.z - 22);
    this.dirLight.target.position.set(playerPos.x, playerPos.y, playerPos.z - 18);

    // Track warmth (0 around morning, 1 around sunset)
    this.warmth = Math.sin((this.cycleTime / 120) * Math.PI);
  }
}
