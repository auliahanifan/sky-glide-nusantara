import * as THREE from 'three';
import type { GraphicsQuality, StageId } from '../types/game';
import type { ProceduralTexturePack } from './ProceduralTextures';

interface BiomeTheme {
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  rimColor: THREE.Color;
  cloudTint: THREE.Color;
  dirIntensity: number;
  sunElev: number;
}

const BIOME_THEMES: Record<StageId, BiomeTheme> = {
  // 1: Blue-Hour Coastal Megacity
  1: {
    zenith: new THREE.Color('#060d24'),
    mid: new THREE.Color('#142a56'),
    horizon: new THREE.Color('#57b5e7'),
    sunColor: new THREE.Color('#ffdcb0'),
    fogColor: new THREE.Color('#193663'),
    hemiSky: new THREE.Color('#8ecae6'),
    hemiGround: new THREE.Color('#1d2d44'),
    rimColor: new THREE.Color('#38bdf8'),
    cloudTint: new THREE.Color('#9bd3f2'),
    dirIntensity: 2.85,
    sunElev: 0.21
  },
  // 2: Volcanic Golden-Hour Foundry
  2: {
    zenith: new THREE.Color('#16080f'),
    mid: new THREE.Color('#5c1f24'),
    horizon: new THREE.Color('#ff8a3d'),
    sunColor: new THREE.Color('#ffcf75'),
    fogColor: new THREE.Color('#471d22'),
    hemiSky: new THREE.Color('#f4a261'),
    hemiGround: new THREE.Color('#3d131a'),
    rimColor: new THREE.Color('#fb923c'),
    cloudTint: new THREE.Color('#f6ad7b'),
    dirIntensity: 3.05,
    sunElev: 0.17
  },
  // 3: Electrified Supercell Storm Citadel
  3: {
    zenith: new THREE.Color('#07091b'),
    mid: new THREE.Color('#1e1d4a'),
    horizon: new THREE.Color('#5d58b5'),
    sunColor: new THREE.Color('#b8dcff'),
    fogColor: new THREE.Color('#1f224d'),
    hemiSky: new THREE.Color('#818cf8'),
    hemiGround: new THREE.Color('#171836'),
    rimColor: new THREE.Color('#a855f7'),
    cloudTint: new THREE.Color('#7a7fc9'),
    dirIntensity: 2.6,
    sunElev: 0.26
  },
  // 4: High-Orbit Astral Singularity
  4: {
    zenith: new THREE.Color('#03030c'),
    mid: new THREE.Color('#1e0c36'),
    horizon: new THREE.Color('#d14b8f'),
    sunColor: new THREE.Color('#ffe08c'),
    fogColor: new THREE.Color('#1e0d33'),
    hemiSky: new THREE.Color('#f472b6'),
    hemiGround: new THREE.Color('#1a0b2e'),
    rimColor: new THREE.Color('#f43f5e'),
    cloudTint: new THREE.Color('#c978ad'),
    dirIntensity: 2.95,
    sunElev: 0.15
  }
};

interface CloudWispItem {
  sprite: THREE.Sprite;
  driftSpeed: number;
}

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly dirLight: THREE.DirectionalLight;
  readonly rimLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  readonly terrainMesh: THREE.Mesh;

  private readonly terrainMat: THREE.ShaderMaterial;
  private readonly cloudGroup = new THREE.Group();
  private readonly cloudTierMats: THREE.SpriteMaterial[] = [];
  private readonly cloudBaseOpacities = [0.08, 0.106, 0.132, 0.158];
  private readonly cloudWisps: CloudWispItem[] = [];

  private readonly skyUniforms: {
    uZenith: { value: THREE.Color };
    uMid: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uOverdrive: { value: number };
    uTime: { value: number };
  };

  private readonly terrainUniforms: {
    uTime: { value: number };
    uScrollZ: { value: number };
    uBiomeId: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uFogColor: { value: THREE.Color };
    uOverdrive: { value: number };
  };

  private currentTheme: BiomeTheme = {
    zenith: BIOME_THEMES[1].zenith.clone(),
    mid: BIOME_THEMES[1].mid.clone(),
    horizon: BIOME_THEMES[1].horizon.clone(),
    sunColor: BIOME_THEMES[1].sunColor.clone(),
    fogColor: BIOME_THEMES[1].fogColor.clone(),
    hemiSky: BIOME_THEMES[1].hemiSky.clone(),
    hemiGround: BIOME_THEMES[1].hemiGround.clone(),
    rimColor: BIOME_THEMES[1].rimColor.clone(),
    cloudTint: BIOME_THEMES[1].cloudTint.clone(),
    dirIntensity: BIOME_THEMES[1].dirIntensity,
    sunElev: BIOME_THEMES[1].sunElev
  };

  private targetBiome: StageId = 1;
  private smoothBiomeFloat = 1;
  private warmth = 0;
  private elapsed = 0;

  constructor(scene: THREE.Scene, enableShadows: boolean, textures: ProceduralTexturePack) {
    const sunDirInit = new THREE.Vector3(0.22, 0.21, -0.95).normalize();

    this.skyUniforms = {
      uZenith: { value: this.currentTheme.zenith.clone() },
      uMid: { value: this.currentTheme.mid.clone() },
      uHorizon: { value: this.currentTheme.horizon.clone() },
      uSunColor: { value: this.currentTheme.sunColor.clone() },
      uSunDir: { value: sunDirInit.clone() },
      uOverdrive: { value: 0 },
      uTime: { value: 0 }
    };

    const skyGeo = new THREE.SphereGeometry(540, 40, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.skyUniforms,
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
        uniform float uOverdrive;
        uniform float uTime;
        varying vec3 vWorldDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * noise2(p);
            p = p * 2.04 + vec2(17.1, 31.7);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          vec3 sunDir = normalize(uSunDir);
          float y = dir.y;

          // Physically inspired atmospheric gradient
          float lowerMix = smoothstep(-0.08, 0.16, y);
          float upperMix = smoothstep(0.10, 0.72, y);
          vec3 col = mix(uHorizon * 0.72, uHorizon, smoothstep(-0.25, 0.03, y));
          col = mix(col, uMid, lowerMix);
          col = mix(col, uZenith, upperMix);

          // Mie forward-scattering solar aureole & atmospheric horizon glow
          float sunDot = max(dot(dir, sunDir), 0.0);
          float mieHalo = pow(sunDot, 5.0) * 0.36 + pow(sunDot, 28.0) * 0.55;
          float sunDisc = smoothstep(0.9968, 0.9988, sunDot);
          float horizonHaze = exp(-abs(y) * 9.5) * (0.35 + pow(sunDot, 3.0) * 0.45);
          col += uSunColor * (mieHalo * (1.0 + uOverdrive * 0.45) + sunDisc * 2.2);
          col = mix(col, uHorizon * 1.15 + uSunColor * 0.25, clamp(horizonHaze * 0.55, 0.0, 0.7));

          // Volumetric-style FBM cloud deck in upper-mid sky
          if (y > 0.015) {
            vec2 cloudUv = dir.xz / (y + 0.16) * 1.35 + vec2(uTime * 0.014, uTime * 0.028);
            float cBase = fbm(cloudUv);
            float cDetail = noise2(cloudUv * 2.3 - vec2(uTime * 0.02, 0.0));
            float density = smoothstep(0.47, 0.80, cBase * 0.72 + cDetail * 0.34);
            float skyMask = smoothstep(0.015, 0.14, y) * (1.0 - smoothstep(0.55, 0.92, y));
            density *= skyMask;

            // Sunlit silver lining vs shaded cloud underside
            float sunScatter = pow(sunDot, 4.0) * 0.75 + 0.25;
            vec3 cloudDark = mix(uMid, uZenith, 0.35) * 0.95;
            vec3 cloudLit = mix(uHorizon, uSunColor, 0.62) * (1.1 + sunScatter * 0.55);
            vec3 cloudCol = mix(cloudDark, cloudLit, smoothstep(0.3, 0.85, cDetail) * 0.75 + sunScatter * 0.25);
            col = mix(col, cloudCol, density * 0.72);
          }

          // Multi-magnitude stars high above the horizon
          float starCell = hash21(floor(dir.xz * 290.0 + dir.y * 170.0));
          float stars = smoothstep(0.9955, 0.9998, starCell) * smoothstep(0.22, 0.72, y);
          col += vec3(0.85, 0.94, 1.0) * stars * 1.15;

          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    this.mesh = new THREE.Mesh(skyGeo, skyMat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // 3-Point Atmospheric Lighting Rig
    this.hemiLight = new THREE.HemisphereLight(
      this.currentTheme.hemiSky,
      this.currentTheme.hemiGround,
      0.95
    );
    scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(
      this.currentTheme.sunColor,
      this.currentTheme.dirIntensity
    );
    this.dirLight.position.set(24, 38, -32);
    this.dirLight.castShadow = enableShadows;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 150;
    const d = 36;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.04;
    scene.add(this.dirLight);
    scene.add(this.dirLight.target);

    // Opposing cool/biome rim light to carve out metallic craft & tower silhouettes
    this.rimLight = new THREE.DirectionalLight(this.currentTheme.rimColor, 0.95);
    this.rimLight.position.set(-28, 12, 26);
    scene.add(this.rimLight);
    scene.add(this.rimLight.target);

    this.fog = new THREE.FogExp2(this.currentTheme.fogColor.getHex(), 0.0042);
    scene.fog = this.fog;

    // Realistic Scrolling Displaced Terrain / Sea / Cloud-Deck Floor
    this.terrainUniforms = {
      uTime: { value: 0 },
      uScrollZ: { value: 0 },
      uBiomeId: { value: 1 },
      uSunDir: { value: sunDirInit.clone() },
      uSunColor: { value: this.currentTheme.sunColor.clone() },
      uHorizon: { value: this.currentTheme.horizon.clone() },
      uFogColor: { value: this.currentTheme.fogColor.clone() },
      uOverdrive: { value: 0 }
    };

    const terrainGeo = new THREE.PlaneGeometry(460, 560, 48, 48);
    terrainGeo.rotateX(-Math.PI / 2);
    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: this.terrainUniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uScrollZ;
        varying vec3 vWorldPos;
        varying float vRidge;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          vec3 pos = position;
          float wz = pos.z - uScrollZ;
          float wx = pos.x;

          // Keep center flight corridor safely low; raise flanking canyon/ridge relief
          float valleyMask = smoothstep(22.0, 78.0, abs(wx));
          float n1 = vnoise(vec2(wx * 0.032, wz * 0.032));
          float n2 = vnoise(vec2(wx * 0.085, wz * 0.085 + uTime * 0.12));
          float waves = sin(wx * 0.08 + wz * 0.05 + uTime * 0.9) * 0.55;

          float height = valleyMask * (n1 * 18.0 + n2 * 6.0) + waves * (1.0 - valleyMask * 0.5);
          pos.y += height;

          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorldPos = vec3(wx, pos.y, wz);
          vRidge = valleyMask * n1;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uBiomeId;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uHorizon;
        uniform vec3 uFogColor;
        uniform float uOverdrive;
        varying vec3 vWorldPos;
        varying float vRidge;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        float fbm(vec2 p) {
          float s = 0.0;
          float a = 0.5;
          for (int i = 0; i < 2; i++) {
            s += a * vnoise(p);
            p *= 2.15;
            a *= 0.5;
          }
          return s;
        }

        void main() {
          vec2 p = vWorldPos.xz;
          float valley = smoothstep(22.0, 74.0, abs(p.x));

          // Procedural normal estimation for sun specular & relief
          float eps = 0.85;
          float hC = fbm(p * 0.055);
          float hX = fbm((p + vec2(eps, 0.0)) * 0.055);
          float hZ = fbm((p + vec2(0.0, eps)) * 0.055);
          vec3 N = normalize(vec3((hC - hX) * (1.2 + valley * 2.2), 1.0, (hC - hZ) * (1.2 + valley * 2.2)));

          vec3 sunDir = normalize(uSunDir);
          vec3 viewDir = normalize(vec3(0.0, 18.0, 42.0) - vec3(p.x, vWorldPos.y, p.y * 0.12));
          float ndl = max(dot(N, sunDir), 0.0);
          vec3 halfV = normalize(sunDir + viewDir);
          float spec = pow(max(dot(N, halfV), 0.0), mix(46.0, 14.0, valley));
          float fresnel = pow(1.0 - max(dot(N, viewDir), 0.0), 3.0);

          // Biome-specific realistic ground surface
          vec3 baseOcean = vec3(0.015, 0.035, 0.08);
          vec3 baseLand = vec3(0.04, 0.055, 0.085);
          vec3 emissiveAccent = vec3(0.0);

          if (uBiomeId < 1.5) {
            // Sector 1: Deep coastal ocean + dark mountain ridges + fine distant city light pinpoints
            baseOcean = vec3(0.012, 0.032, 0.075);
            baseLand = vec3(0.035, 0.045, 0.07);
            vec2 gridUv = p * 0.95;
            vec2 cellId = floor(gridUv);
            vec2 cellLocal = fract(gridUv) - 0.5;
            float isLit = step(0.76, hash(cellId)) * valley * (1.0 - smoothstep(0.18, 0.65, hC));
            float dotMask = smoothstep(0.24, 0.05, length(cellLocal));
            vec3 lightCol = mix(vec3(0.35, 0.8, 1.0), vec3(1.0, 0.78, 0.45), hash(cellId + 9.1));
            emissiveAccent = lightCol * dotMask * isLit * 0.95;
          } else if (uBiomeId < 2.5) {
            // Sector 2: Volcanic Foundry basalt & glowing magma fissures
            baseOcean = vec3(0.045, 0.02, 0.018);
            baseLand = vec3(0.07, 0.03, 0.028);
            float fissure = 1.0 - smoothstep(0.0, 0.09, abs(hC - 0.375));
            emissiveAccent = vec3(1.4, 0.4, 0.06) * fissure * (0.7 + 0.25 * sin(uTime * 2.2 + p.y * 0.05));
          } else if (uBiomeId < 3.5) {
            // Sector 3: Storm Citadel churning cloud sea + subtle sheet lightning
            baseOcean = vec3(0.02, 0.03, 0.09);
            baseLand = vec3(0.06, 0.07, 0.16);
            float stormPulse = pow(max(0.0, sin(uTime * 1.9 + p.y * 0.02)), 14.0);
            float arc = smoothstep(0.72, 0.94, vnoise(p * 0.05 + uTime * 0.18));
            emissiveAccent = vec3(0.45, 0.65, 1.3) * arc * (0.22 + stormPulse * 0.9);
          } else {
            // Sector 4: Astral Singularity obsidian flats + fine energy veins
            baseOcean = vec3(0.02, 0.012, 0.045);
            baseLand = vec3(0.045, 0.02, 0.075);
            float vein = 1.0 - smoothstep(0.0, 0.08, abs(hC - 0.39));
            emissiveAccent = vec3(1.15, 0.2, 0.68) * vein;
          }

          vec3 albedo = mix(baseOcean, baseLand, valley);
          vec3 lit = albedo * (0.3 + ndl * 0.95)
            + uSunColor * spec * (0.45 - valley * 0.3)
            + uHorizon * fresnel * 0.28
            + emissiveAccent * (1.0 + uOverdrive * 0.4);

          // Seamless horizon fog blend
          float dist = length(vec2(p.x * 0.85, p.y - 40.0));
          float fogFactor = 1.0 - exp(-pow(dist * 0.0046, 1.55));
          vec3 finalCol = mix(lit, mix(uFogColor, uHorizon, 0.35), clamp(fogFactor, 0.0, 1.0));

          gl_FragColor = vec4(finalCol, 1.0);
        }
      `
    });

    this.terrainMesh = new THREE.Mesh(terrainGeo, this.terrainMat);
    this.terrainMesh.position.set(0, -25, -180);
    this.terrainMesh.receiveShadow = false;
    scene.add(this.terrainMesh);

    // 3D Volumetric-Style Passing Cloud Wisps sharing 4 SpriteMaterials
    for (let t = 0; t < 4; t++) {
      this.cloudTierMats.push(
        new THREE.SpriteMaterial({
          map: textures.cloudWisp,
          color: this.currentTheme.cloudTint,
          transparent: true,
          opacity: this.cloudBaseOpacities[t],
          depthWrite: false
        })
      );
    }

    for (let i = 0; i < 24; i++) {
      const mat = this.cloudTierMats[i % 4];
      const sprite = new THREE.Sprite(mat);
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (16 + ((i * 7) % 34));
      const y = -13 + ((i * 5) % 24);
      const z = -i * 13.0;
      const w = 18 + (i % 5) * 6;
      sprite.position.set(x, y, z);
      sprite.scale.set(w, w * 0.45, 1);
      this.cloudGroup.add(sprite);
      this.cloudWisps.push({
        sprite,
        driftSpeed: 0.6 + (i % 3) * 0.35
      });
    }
    scene.add(this.cloudGroup);
  }

  getDayWarmth(): number {
    return this.warmth;
  }

  setShadowEnabled(enabled: boolean): void {
    this.dirLight.castShadow = enabled;
  }

  setQuality(quality: GraphicsQuality): void {
    const shadows = quality !== 'saver';
    this.dirLight.castShadow = shadows;
    const mapSize = quality === 'high' ? 1024 : 512;
    if (this.dirLight.shadow.mapSize.x !== mapSize) {
      this.dirLight.shadow.mapSize.set(mapSize, mapSize);
      this.dirLight.shadow.map?.dispose();
      this.dirLight.shadow.map = null;
    }
    this.cloudGroup.visible = quality !== 'saver';
    if (quality !== 'saver') {
      const maxWisps = quality === 'high' ? 24 : 14;
      for (let i = 0; i < this.cloudWisps.length; i++) {
        this.cloudWisps[i].sprite.visible = i < maxWisps;
      }
    }
  }

  setTargetBiome(stageId: StageId, instant = false): void {
    this.targetBiome = stageId;
    if (instant) {
      const t = BIOME_THEMES[stageId];
      this.smoothBiomeFloat = stageId;
      this.currentTheme.zenith.copy(t.zenith);
      this.currentTheme.mid.copy(t.mid);
      this.currentTheme.horizon.copy(t.horizon);
      this.currentTheme.sunColor.copy(t.sunColor);
      this.currentTheme.fogColor.copy(t.fogColor);
      this.currentTheme.hemiSky.copy(t.hemiSky);
      this.currentTheme.hemiGround.copy(t.hemiGround);
      this.currentTheme.rimColor.copy(t.rimColor);
      this.currentTheme.cloudTint.copy(t.cloudTint);
      this.currentTheme.dirIntensity = t.dirIntensity;
      this.currentTheme.sunElev = t.sunElev;
    }
  }

  update(dt: number, playerPos: THREE.Vector3, overdrive = false): void {
    this.elapsed += dt;
    const target = BIOME_THEMES[this.targetBiome];
    const lerpRate = Math.min(1, dt * 1.4);

    this.smoothBiomeFloat = THREE.MathUtils.lerp(this.smoothBiomeFloat, this.targetBiome, lerpRate);
    this.currentTheme.zenith.lerp(target.zenith, lerpRate);
    this.currentTheme.mid.lerp(target.mid, lerpRate);
    this.currentTheme.horizon.lerp(target.horizon, lerpRate);
    this.currentTheme.sunColor.lerp(target.sunColor, lerpRate);
    this.currentTheme.fogColor.lerp(target.fogColor, lerpRate);
    this.currentTheme.hemiSky.lerp(target.hemiSky, lerpRate);
    this.currentTheme.hemiGround.lerp(target.hemiGround, lerpRate);
    this.currentTheme.rimColor.lerp(target.rimColor, lerpRate);
    this.currentTheme.cloudTint.lerp(target.cloudTint, lerpRate);
    this.currentTheme.dirIntensity = THREE.MathUtils.lerp(
      this.currentTheme.dirIntensity,
      target.dirIntensity,
      lerpRate
    );
    this.currentTheme.sunElev = THREE.MathUtils.lerp(
      this.currentTheme.sunElev,
      target.sunElev,
      lerpRate
    );

    const sunDir = this.skyUniforms.uSunDir.value;
    sunDir.set(0.22, this.currentTheme.sunElev, -0.95).normalize();

    this.skyUniforms.uZenith.value.copy(this.currentTheme.zenith);
    this.skyUniforms.uMid.value.copy(this.currentTheme.mid);
    this.skyUniforms.uHorizon.value.copy(this.currentTheme.horizon);
    this.skyUniforms.uSunColor.value.copy(this.currentTheme.sunColor);
    this.skyUniforms.uOverdrive.value = THREE.MathUtils.lerp(
      this.skyUniforms.uOverdrive.value,
      overdrive ? 1 : 0,
      Math.min(1, dt * 5)
    );
    this.skyUniforms.uTime.value = this.elapsed;

    this.terrainUniforms.uTime.value = this.elapsed;
    this.terrainUniforms.uScrollZ.value = -playerPos.z;
    this.terrainUniforms.uBiomeId.value = Math.round(this.smoothBiomeFloat);
    this.terrainUniforms.uSunDir.value.copy(sunDir);
    this.terrainUniforms.uSunColor.value.copy(this.currentTheme.sunColor);
    this.terrainUniforms.uHorizon.value.copy(this.currentTheme.horizon);
    this.terrainUniforms.uFogColor.value.copy(this.currentTheme.fogColor);
    this.terrainUniforms.uOverdrive.value = this.skyUniforms.uOverdrive.value;

    this.fog.color.copy(this.currentTheme.fogColor);
    this.hemiLight.color.copy(this.currentTheme.hemiSky);
    this.hemiLight.groundColor.copy(this.currentTheme.hemiGround);
    this.dirLight.color.copy(this.currentTheme.sunColor);
    this.dirLight.intensity = this.currentTheme.dirIntensity + (overdrive ? 0.45 : 0);
    this.rimLight.color.copy(this.currentTheme.rimColor);

    // Keep sky dome, shadow frustum, and terrain floor locked to player Z
    this.mesh.position.copy(playerPos);
    this.dirLight.position.set(playerPos.x + 26, playerPos.y + 42, playerPos.z - 26);
    this.dirLight.target.position.set(playerPos.x, playerPos.y, playerPos.z - 18);
    this.rimLight.position.set(playerPos.x - 28, playerPos.y + 12, playerPos.z + 24);
    this.rimLight.target.position.set(playerPos.x, playerPos.y, playerPos.z - 12);
    this.terrainMesh.position.z = playerPos.z - 190;

    // Recycle volumetric cloud wisps ahead of the interceptor
    if (this.cloudGroup.visible) {
      const mult = overdrive ? 1.25 : 1.0;
      for (let t = 0; t < this.cloudTierMats.length; t++) {
        this.cloudTierMats[t].color.copy(this.currentTheme.cloudTint);
        this.cloudTierMats[t].opacity = this.cloudBaseOpacities[t] * mult;
      }
      for (const w of this.cloudWisps) {
        if (!w.sprite.visible) continue;
        w.sprite.position.x +=
          Math.sin(this.elapsed * 0.25 + w.sprite.position.z * 0.05) * w.driftSpeed * dt;
        if (w.sprite.position.z > playerPos.z + 28) {
          w.sprite.position.z -= 312;
        }
      }
    }

    this.warmth = (this.targetBiome - 1) / 3;
  }
}
