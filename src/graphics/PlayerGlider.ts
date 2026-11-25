import * as THREE from 'three';
import { getAviatorSpec, getWingSpec } from '../data/catalog';
import type { AviatorId, WingId } from '../types/game';
import {
  buildMythicalHaloGroup,
  createBillowingSailGeo,
  createCapeSegmentGeo,
  createFeatherGeo,
  createFlamePetalGeo,
  createPhinisiHullGeo,
  createSaddleBaseGeo,
  createTaperedLoftGeo
} from './MountGeometry';
import type { ProceduralTexturePack } from './ProceduralTextures';

type HeadgearStyle =
  | 'blangkon'
  | 'udeng'
  | 'pelangi'
  | 'songkok_recca'
  | 'mahkota_papua'
  | 'topi_dayak';

interface AnimRig {
  wingLeftPivot?: THREE.Object3D;
  wingRightPivot?: THREE.Object3D;
  wingTipLeftPivot?: THREE.Object3D;
  wingTipRightPivot?: THREE.Object3D;
  wingFlapSpeed: number;
  wingFlapAmp: number;
  wingBaseZ: number;
  tailPivot?: THREE.Object3D;
  headPivot?: THREE.Object3D;
  lanternPivot?: THREE.Object3D;
  haloPivots: THREE.Object3D[];
  plumePivotsL: THREE.Object3D[];
  plumePivotsR: THREE.Object3D[];
  whiskerPivots: THREE.Object3D[];
  snakeSegments: THREE.Object3D[];
  ribbonSegmentsL: THREE.Object3D[];
  ribbonSegmentsR: THREE.Object3D[];
  legPivots: THREE.Object3D[];
  propellers: THREE.Object3D[];
  sailMeshes: THREE.Object3D[];
  riderUpperBodyPivot?: THREE.Object3D;
  riderHeadPivot?: THREE.Object3D;
  riderCapeSegments: THREE.Object3D[];
  flameScaleBase: number;
}

export class PlayerGlider {
  readonly root = new THREE.Group();
  readonly visualPivot = new THREE.Group();

  private readonly textures: ProceduralTexturePack;

  // Shared rider & facial materials (never disposed on mount swap)
  private readonly riderOutfitMat: THREE.MeshStandardMaterial;
  private readonly riderScarfMat: THREE.MeshStandardMaterial;
  private readonly riderHatAccentMat: THREE.MeshStandardMaterial;
  private readonly skinMat: THREE.MeshStandardMaterial;
  private readonly hairMat: THREE.MeshStandardMaterial;
  private readonly eyeWhiteMat: THREE.MeshBasicMaterial;
  private readonly eyePupilMat: THREE.MeshStandardMaterial;

  // Per-mount container & disposal tracking (Sets prevent double-dispose when shared)
  private readonly mountGroup = new THREE.Group();
  private mountGeos = new Set<THREE.BufferGeometry>();
  private mountMats = new Set<THREE.Material>();

  // Hardpoint anchors
  private readonly wingtipLeftAnchor = new THREE.Object3D();
  private readonly wingtipRightAnchor = new THREE.Object3D();
  private readonly cannonLeftAnchor = new THREE.Object3D();
  private readonly cannonRightAnchor = new THREE.Object3D();
  private readonly thrusterLeftAnchor = new THREE.Object3D();
  private readonly thrusterRightAnchor = new THREE.Object3D();

  // Shared thruster plumes & glows
  private readonly flameLeft: THREE.Mesh;
  private readonly flameRight: THREE.Mesh;
  private readonly flameUniforms: {
    uTime: { value: number };
    uColor: { value: THREE.Color };
    uHot: { value: number };
  };
  private readonly thrusterGlowLeft: THREE.Sprite;
  private readonly thrusterGlowRight: THREE.Sprite;

  // Shared holographic shield, vapor cone & nova shockwave
  private readonly shieldBubble: THREE.Group;
  private readonly shieldUniforms: {
    uTime: { value: number };
    uColor: { value: THREE.Color };
  };
  private readonly vaporCone: THREE.Mesh;
  private readonly vaporUniforms: {
    uTime: { value: number };
    uStrength: { value: number };
  };
  private readonly novaWave: THREE.Mesh;
  private readonly novaMat: THREE.MeshBasicMaterial;

  private currentWingId: WingId = 'garuda_nusantara';
  private rig: AnimRig = this.createEmptyRig();
  private rollAngle = 0;
  private isRolling = false;
  private novaTimer = 0;
  private phaseDashActive = false;
  private switchPopTimer = 0;
  private elapsed = 0;

  constructor(textures: ProceduralTexturePack) {
    this.textures = textures;
    this.root.add(this.visualPivot);
    this.visualPivot.add(this.mountGroup);
    this.visualPivot.add(
      this.wingtipLeftAnchor,
      this.wingtipRightAnchor,
      this.cannonLeftAnchor,
      this.cannonRightAnchor,
      this.thrusterLeftAnchor,
      this.thrusterRightAnchor
    );

    // Shared rider materials with Nusantara Batik/Songket PBR weave
    this.riderOutfitMat = new THREE.MeshStandardMaterial({
      color: 0xe11d48,
      map: textures.batikPBR.map,
      normalMap: textures.batikPBR.normalMap,
      roughnessMap: textures.batikPBR.roughnessMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.58,
      metalness: 0.14
    });
    this.riderScarfMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      normalMap: textures.batikPBR.normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.52,
      metalness: 0.08,
      side: THREE.DoubleSide
    });
    this.riderHatAccentMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.3,
      metalness: 0.45
    });
    this.skinMat = new THREE.MeshStandardMaterial({
      color: 0xd49460,
      roughness: 0.56,
      metalness: 0.03
    });
    this.hairMat = new THREE.MeshStandardMaterial({
      color: 0x161412,
      roughness: 0.42,
      metalness: 0.12
    });
    this.eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    this.eyePupilMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.15,
      metalness: 0.1
    });

    // Shared GLSL afterburner / magical sparkle plumes
    this.flameUniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xffd000) },
      uHot: { value: 0 }
    };
    const flameMat = new THREE.ShaderMaterial({
      uniforms: this.flameUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uHot;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
          float axial = clamp(vUv.y, 0.0, 1.0);
          float fresnel = pow(abs(dot(normalize(vNormal), normalize(vViewDir))), 1.3);
          float shock = 0.55 + 0.45 * sin(axial * 24.0 + uTime * 42.0);
          float core = smoothstep(0.35, 0.95, axial) * fresnel;
          vec3 col = mix(uColor * 1.25, vec3(1.35, 1.4, 1.55), core * 0.75 + shock * 0.25);
          float alpha = pow(axial, 1.15) * fresnel * (0.65 + uHot * 0.35);
          gl_FragColor = vec4(col * (1.05 + uHot * 0.5), clamp(alpha, 0.0, 1.0));
        }
      `
    });

    const flameGeo = new THREE.ConeGeometry(0.11, 0.82, 12, 1, true);
    flameGeo.translate(0, -0.41, 0);
    flameGeo.rotateX(Math.PI / 2);

    this.flameLeft = new THREE.Mesh(flameGeo, flameMat);
    this.flameRight = new THREE.Mesh(flameGeo, flameMat);
    this.visualPivot.add(this.flameLeft, this.flameRight);

    const glowMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0xffd000,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.thrusterGlowLeft = new THREE.Sprite(glowMat);
    this.thrusterGlowRight = new THREE.Sprite(glowMat);
    this.visualPivot.add(this.thrusterGlowLeft, this.thrusterGlowRight);

    // Transonic Prandtl-Glauert Vapor Cone
    this.vaporUniforms = {
      uTime: { value: 0 },
      uStrength: { value: 0 }
    };
    const vaporGeo = new THREE.ConeGeometry(1.75, 2.7, 28, 1, true);
    vaporGeo.rotateX(Math.PI / 2);
    const vaporMat = new THREE.ShaderMaterial({
      uniforms: this.vaporUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.8);
          float band = smoothstep(0.05, 0.45, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
          float ripple = 0.8 + 0.2 * sin(vUv.x * 24.0 + uTime * 22.0);
          float alpha = band * (0.35 + edge * 0.65) * ripple * uStrength * 0.55;
          gl_FragColor = vec4(vec3(0.84, 0.95, 1.0), alpha);
        }
      `
    });
    this.vaporCone = new THREE.Mesh(vaporGeo, vaporMat);
    this.vaporCone.position.set(0, 0.08, 0.2);
    this.vaporCone.visible = false;
    this.visualPivot.add(this.vaporCone);

    // Holographic Energy Shield
    this.shieldUniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xffd000) }
    };
    const shieldMat = new THREE.ShaderMaterial({
      uniforms: this.shieldUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vLocalPos;

        float hexDist(vec2 p) {
          p = abs(p);
          return max(dot(p, normalize(vec2(1.0, 1.73205))), p.x);
        }

        void main() {
          float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.2);
          vec2 uv = vec2(atan(vLocalPos.x, vLocalPos.z) * 3.0, vLocalPos.y * 5.0 + uTime * 0.6);
          vec2 r = vec2(1.0, 1.73205);
          vec2 h = r * 0.5;
          vec2 a = mod(uv, r) - h;
          vec2 b = mod(uv - h, r) - h;
          vec2 gv = dot(a, a) < dot(b, b) ? a : b;
          float d = 0.5 - hexDist(gv);
          float hexLine = 1.0 - smoothstep(0.0, 0.08, d);
          float pulse = 0.75 + 0.25 * sin(uTime * 4.5 + vLocalPos.y * 3.0);
          float alpha = clamp((fresnel * 0.8 + hexLine * 0.35 * (0.4 + fresnel)) * pulse, 0.0, 0.9);
          gl_FragColor = vec4(uColor * (1.15 + hexLine * 0.45), alpha);
        }
      `
    });
    this.shieldBubble = new THREE.Group();
    const shieldSphere = new THREE.Mesh(new THREE.SphereGeometry(1.75, 28, 22), shieldMat);
    this.shieldBubble.add(shieldSphere);
    this.shieldBubble.visible = false;
    this.visualPivot.add(this.shieldBubble);

    // Expanding Skill Shockwave Ring
    this.novaMat = new THREE.MeshBasicMaterial({
      color: 0xffd000,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.novaWave = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.45, 36), this.novaMat);
    this.novaWave.rotation.x = Math.PI / 2;
    this.novaWave.visible = false;
    this.root.add(this.novaWave);

    this.rebuildMount('garuda_nusantara');
  }

  private createEmptyRig(): AnimRig {
    return {
      wingFlapSpeed: 7.5,
      wingFlapAmp: 0.32,
      wingBaseZ: 0.08,
      haloPivots: [],
      plumePivotsL: [],
      plumePivotsR: [],
      whiskerPivots: [],
      snakeSegments: [],
      ribbonSegmentsL: [],
      ribbonSegmentsR: [],
      legPivots: [],
      propellers: [],
      sailMeshes: [],
      riderCapeSegments: [],
      flameScaleBase: 0.55
    };
  }

  private makeMat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.12,
      ...params
    });
    this.mountMats.add(mat);
    return mat;
  }

  private makeFeatherMat(
    color: number,
    extra: THREE.MeshStandardMaterialParameters = {}
  ): THREE.MeshStandardMaterial {
    return this.makeMat({
      color,
      map: this.textures.featherPBR.map,
      normalMap: this.textures.featherPBR.normalMap,
      roughnessMap: this.textures.featherPBR.roughnessMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.62,
      metalness: 0.14,
      ...extra
    });
  }

  private makeGoldMat(emissiveIntensity = 0.14): THREE.MeshStandardMaterial {
    return this.makeMat({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity,
      roughness: 0.25,
      metalness: 0.72
    });
  }

  private regGeo = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
    this.mountGeos.add(geo);
    return geo;
  };

  private addMesh(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    castShadow = true
  ): THREE.Mesh {
    this.mountGeos.add(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private clearMount(): void {
    while (this.mountGroup.children.length > 0) {
      this.mountGroup.remove(this.mountGroup.children[0]);
    }
    for (const g of this.mountGeos) g.dispose();
    for (const m of this.mountMats) m.dispose();
    this.mountGeos.clear();
    this.mountMats.clear();
    this.rig = this.createEmptyRig();
  }

  applyCosmetics(wingId: WingId, aviatorId: AviatorId): void {
    const wing = getWingSpec(wingId);
    const skin = getAviatorSpec(aviatorId);

    this.riderOutfitMat.color.setHex(skin.jacketColor);
    this.riderScarfMat.color.setHex(skin.scarfColor);
    this.riderHatAccentMat.color.setHex(skin.helmetColor);

    this.flameUniforms.uColor.value.setHex(wing.trimColor);
    this.thrusterGlowLeft.material.color.setHex(wing.trimColor);
    this.shieldUniforms.uColor.value.setHex(wing.trimColor);
    this.novaMat.color.setHex(wing.trimColor);

    if (wingId !== this.currentWingId) {
      this.currentWingId = wingId;
      this.rebuildMount(wingId);
    }
  }

  triggerSwitchPop(): void {
    this.switchPopTimer = 0.42;
  }

  triggerBarrelRoll(): boolean {
    if (this.isRolling) return false;
    this.isRolling = true;
    this.rollAngle = 0;
    return true;
  }

  isBarrelRolling(): boolean {
    return this.isRolling;
  }

  triggerPulseNovaVisual(): void {
    this.novaTimer = 0.45;
    this.novaWave.visible = true;
    this.novaWave.scale.setScalar(1);
    this.novaMat.opacity = 0.9;
  }

  setPhaseDash(active: boolean): void {
    this.phaseDashActive = active;
    this.riderOutfitMat.emissive.setHex(active ? 0x00ff9d : 0x000000);
    this.riderOutfitMat.emissiveIntensity = active ? 0.55 : 0;
  }

  getThrusterWorldPositions(outLeft: THREE.Vector3, outRight: THREE.Vector3): void {
    this.thrusterLeftAnchor.getWorldPosition(outLeft);
    this.thrusterRightAnchor.getWorldPosition(outRight);
  }

  getWingtipWorldPositions(outLeft: THREE.Vector3, outRight: THREE.Vector3): void {
    this.wingtipLeftAnchor.getWorldPosition(outLeft);
    this.wingtipRightAnchor.getWorldPosition(outRight);
  }

  getCannonWorldPositions(outLeft: THREE.Vector3, outRight: THREE.Vector3): void {
    this.cannonLeftAnchor.getWorldPosition(outLeft);
    this.cannonRightAnchor.getWorldPosition(outRight);
  }

  update(
    dt: number,
    steerX: number,
    steerY: number,
    boosting: boolean,
    invincibleTimer: number,
    shieldActive: boolean,
    feverActive = false,
    mach = 0.72,
    gLoad = 1.0,
    directBank?: number,
    directPitch?: number
  ): void {
    this.elapsed += dt;

    const targetBank = directBank ?? -steerX * 0.68;
    const targetPitch = directPitch ?? steerY * 0.36;

    if (this.isRolling) {
      this.rollAngle += dt * Math.PI * 4.6;
      if (this.rollAngle >= Math.PI * 2) {
        this.rollAngle = 0;
        this.isRolling = false;
      }
    }

    const baseRoll =
      directBank !== undefined
        ? directBank
        : THREE.MathUtils.lerp(this.visualPivot.rotation.z, targetBank, Math.min(1, dt * 11));
    this.visualPivot.rotation.z = this.isRolling ? baseRoll + this.rollAngle : baseRoll;
    this.visualPivot.rotation.x =
      directPitch !== undefined
        ? directPitch
        : THREE.MathUtils.lerp(this.visualPivot.rotation.x, targetPitch, Math.min(1, dt * 10));

    // Switch-mount elastic pop & hop
    let popScale = 1.0;
    let popHopY = 0;
    if (this.switchPopTimer > 0) {
      this.switchPopTimer = Math.max(0, this.switchPopTimer - dt);
      const t = 1 - this.switchPopTimer / 0.42;
      popScale = 1 + Math.sin(t * Math.PI) * 0.18;
      popHopY = Math.sin(t * Math.PI) * 0.24;
    }
    this.visualPivot.scale.setScalar(popScale);

    const buffet = mach >= 0.96 || gLoad > 2.4 ? Math.sin(this.elapsed * 38) * 0.015 : 0;
    this.visualPivot.position.y = Math.sin(this.elapsed * 4.6) * 0.045 + buffet + popHopY;

    // Per-mount expressive animations
    const hot = boosting || feverActive || this.phaseDashActive;
    const flapSpeed = this.rig.wingFlapSpeed * (hot ? 1.45 : 1.0);
    if (this.rig.wingLeftPivot && this.rig.wingRightPivot) {
      const flap = Math.sin(this.elapsed * flapSpeed) * this.rig.wingFlapAmp;
      this.rig.wingLeftPivot.rotation.z = this.rig.wingBaseZ + flap;
      this.rig.wingRightPivot.rotation.z = -this.rig.wingBaseZ - flap;

      if (this.rig.wingTipLeftPivot && this.rig.wingTipRightPivot) {
        const tipFlex = Math.sin(this.elapsed * flapSpeed - 0.72) * this.rig.wingFlapAmp * 0.52;
        this.rig.wingTipLeftPivot.rotation.z = tipFlex;
        this.rig.wingTipRightPivot.rotation.z = -tipFlex;
      }
    }

    if (this.rig.tailPivot) {
      this.rig.tailPivot.rotation.x = Math.sin(this.elapsed * 5.5) * 0.12 + 0.06;
      this.rig.tailPivot.rotation.y = Math.cos(this.elapsed * 3.8) * 0.08;
    }

    if (this.rig.headPivot) {
      this.rig.headPivot.rotation.x = Math.sin(this.elapsed * 3.4) * 0.055;
    }

    if (this.rig.lanternPivot) {
      this.rig.lanternPivot.rotation.z = Math.sin(this.elapsed * 4.2) * 0.18;
      this.rig.lanternPivot.rotation.x = Math.cos(this.elapsed * 3.1) * 0.12 + 0.12;
    }

    // Sacred Prabha / celestial halos rotating gently
    for (let i = 0; i < this.rig.haloPivots.length; i++) {
      const halo = this.rig.haloPivots[i];
      halo.rotation.z += dt * (i % 2 === 0 ? 0.55 : -0.72);
      const pulse = 1 + Math.sin(this.elapsed * 3.2 + i) * 0.04;
      halo.scale.setScalar(pulse);
    }

    // Naga Barong undulating body wave & fluttering whiskers
    for (let i = 0; i < this.rig.snakeSegments.length; i++) {
      const seg = this.rig.snakeSegments[i];
      const phase = this.elapsed * (hot ? 9.0 : 6.2) - i * 0.62;
      seg.position.x = Math.sin(phase) * (0.042 + i * 0.024);
      seg.position.y = -0.02 + Math.cos(phase * 0.85) * (0.026 + i * 0.012);
      seg.rotation.y = Math.cos(phase) * 0.16;
    }

    for (let i = 0; i < this.rig.whiskerPivots.length; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const flutter = Math.sin(this.elapsed * (hot ? 14 : 9) + i) * 0.14;
      this.rig.whiskerPivots[i].rotation.y = side * 0.18 + flutter;
      this.rig.whiskerPivots[i].rotation.x = Math.cos(this.elapsed * 7 + i) * 0.1;
    }

    // Cenderawasih silky flank plumes & trailing wire ribbons
    for (let i = 0; i < this.rig.plumePivotsL.length; i++) {
      const sway = Math.sin(this.elapsed * 6.5 - i * 0.45) * 0.09;
      const lift = Math.cos(this.elapsed * 5.0 - i * 0.35) * 0.07;
      this.rig.plumePivotsL[i].rotation.z = sway;
      this.rig.plumePivotsL[i].rotation.x = lift;
      if (this.rig.plumePivotsR[i]) {
        this.rig.plumePivotsR[i].rotation.z = -sway;
        this.rig.plumePivotsR[i].rotation.x = lift;
      }
    }

    for (let i = 0; i < this.rig.ribbonSegmentsL.length; i++) {
      const wave = Math.sin(this.elapsed * 7.5 - i * 0.82);
      const lift = Math.cos(this.elapsed * 5.2 - i * 0.65);
      this.rig.ribbonSegmentsL[i].rotation.y = wave * 0.22;
      this.rig.ribbonSegmentsL[i].rotation.x = lift * 0.13;
      this.rig.ribbonSegmentsR[i].rotation.y = -wave * 0.22;
      this.rig.ribbonSegmentsR[i].rotation.x = -lift * 0.13;
    }

    // Kuda Sembrani sky gallop & Naga dragon legs
    for (let i = 0; i < this.rig.legPivots.length; i++) {
      const isFront = i < 2;
      const sideOffset = i % 2 === 0 ? 0 : 0.45;
      const phase = this.elapsed * (hot ? 12 : 8.5) + (isFront ? 0 : Math.PI) + sideOffset;
      this.rig.legPivots[i].rotation.x = Math.sin(phase) * 0.38 - 0.18;
    }

    // Phinisi spinning brass propellers & billowing sails
    for (const prop of this.rig.propellers) {
      prop.rotation.z += dt * (hot ? 30 : 18);
    }
    for (let i = 0; i < this.rig.sailMeshes.length; i++) {
      const puff = 1 + Math.sin(this.elapsed * 4.5 + i * 1.1) * 0.07;
      this.rig.sailMeshes[i].scale.z = puff;
    }

    // Heroic rider dynamic riding lean, aerodynamic crouch & flowing cape wave
    if (this.rig.riderUpperBodyPivot) {
      const targetLeanZ = -steerX * 0.18;
      const targetCrouchX = hot ? 0.34 : 0.16;
      const alpha = Math.min(1, dt * 8);
      this.rig.riderUpperBodyPivot.rotation.z = THREE.MathUtils.lerp(
        this.rig.riderUpperBodyPivot.rotation.z,
        targetLeanZ,
        alpha
      );
      this.rig.riderUpperBodyPivot.rotation.x = THREE.MathUtils.lerp(
        this.rig.riderUpperBodyPivot.rotation.x,
        targetCrouchX,
        alpha
      );
    }

    if (this.rig.riderHeadPivot) {
      const targetYaw = -steerX * 0.22;
      const targetCounterPitch = hot ? -0.22 : -0.1;
      const alpha = Math.min(1, dt * 9);
      this.rig.riderHeadPivot.rotation.y = THREE.MathUtils.lerp(
        this.rig.riderHeadPivot.rotation.y,
        targetYaw,
        alpha
      );
      this.rig.riderHeadPivot.rotation.x = THREE.MathUtils.lerp(
        this.rig.riderHeadPivot.rotation.x,
        targetCounterPitch,
        alpha
      );
    }

    for (let i = 0; i < this.rig.riderCapeSegments.length; i++) {
      const seg = this.rig.riderCapeSegments[i];
      const waveSpeed = hot ? 16 : 9.5;
      seg.rotation.x = Math.sin(this.elapsed * waveSpeed - i * 0.85) * (0.12 + i * 0.05) + 0.08;
      seg.rotation.y = Math.cos(this.elapsed * 6.5 - i * 0.65) * 0.09;
    }

    // Volumetric afterburners / magical jet boost plumes
    const flicker = 0.9 + Math.sin(this.elapsed * 50) * 0.14;
    const baseScale = this.rig.flameScaleBase;
    const lenScale = (hot ? 1.85 : baseScale) * flicker;
    const radScale = hot ? 1.2 : baseScale * 0.95;
    this.flameLeft.scale.set(radScale, radScale, lenScale);
    this.flameRight.scale.set(radScale, radScale, lenScale);

    this.flameUniforms.uTime.value = this.elapsed;
    this.flameUniforms.uHot.value = THREE.MathUtils.lerp(
      this.flameUniforms.uHot.value,
      hot ? 1 : 0,
      Math.min(1, dt * 10)
    );

    const glowScale = (hot ? 1.08 : 0.55 * baseScale) * flicker;
    this.thrusterGlowLeft.scale.setScalar(glowScale);
    this.thrusterGlowRight.scale.setScalar(glowScale);

    // Transonic Prandtl-Glauert Vapor Cone at Mach >= 0.98
    const targetVapor = mach >= 0.98 ? Math.min(1, (mach - 0.98) * 8 + 0.35) : 0;
    this.vaporUniforms.uTime.value = this.elapsed;
    this.vaporUniforms.uStrength.value = THREE.MathUtils.lerp(
      this.vaporUniforms.uStrength.value,
      targetVapor,
      Math.min(1, dt * 8)
    );
    this.vaporCone.visible = this.vaporUniforms.uStrength.value > 0.03;

    // Invincibility flicker
    if (invincibleTimer > 0 && !this.phaseDashActive && !feverActive) {
      this.visualPivot.visible = Math.floor(invincibleTimer * 16) % 2 === 0;
    } else {
      this.visualPivot.visible = true;
    }

    // Holographic shield shader
    this.shieldBubble.visible = shieldActive || feverActive;
    if (this.shieldBubble.visible) {
      this.shieldUniforms.uTime.value = this.elapsed;
      this.shieldBubble.rotation.y += dt * 0.8;
      const s = 1 + Math.sin(this.elapsed * 6) * 0.035;
      this.shieldBubble.scale.setScalar(s);
    }

    // Expanding skill shockwave ring
    if (this.novaTimer > 0) {
      this.novaTimer = Math.max(0, this.novaTimer - dt);
      const t = 1 - this.novaTimer / 0.45;
      this.novaWave.scale.setScalar(1 + t * 14);
      this.novaMat.opacity = (1 - t) * 0.85;
      if (this.novaTimer <= 0) {
        this.novaWave.visible = false;
      }
    }
  }

  private rebuildMount(wingId: WingId): void {
    this.clearMount();

    if (wingId === 'garuda_nusantara') {
      this.buildGarudaNusantara();
    } else if (wingId === 'naga_barong') {
      this.buildNagaBarong();
    } else if (wingId === 'unicorn_sembrani') {
      this.buildUnicornSembrani();
    } else if (wingId === 'phinisi_bugis') {
      this.buildPhinisiBugis();
    } else if (wingId === 'cenderawasih_papua') {
      this.buildCenderawasihPapua();
    } else {
      this.buildEnggangDayak();
    }

    this.flameLeft.position.copy(this.thrusterLeftAnchor.position);
    this.flameRight.position.copy(this.thrusterRightAnchor.position);
    this.thrusterGlowLeft.position.copy(this.thrusterLeftAnchor.position);
    this.thrusterGlowRight.position.copy(this.thrusterRightAnchor.position);
  }

  private addRealisticRiderEyes(parent: THREE.Object3D): void {
    const irisMat = this.makeMat({ color: 0x3b2314, roughness: 0.22, metalness: 0.08 });
    for (const side of [-1, 1] as const) {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(side * 0.036, 0.012, -0.094);
      eyeGroup.rotation.y = side * -0.18;
      parent.add(eyeGroup);

      const sclera = this.addMesh(
        eyeGroup,
        new THREE.SphereGeometry(0.014, 8, 6),
        this.eyeWhiteMat,
        false
      );
      sclera.scale.set(1.25, 0.65, 0.55);

      const iris = this.addMesh(
        eyeGroup,
        new THREE.SphereGeometry(0.0095, 8, 6),
        irisMat,
        false
      );
      iris.position.set(0, 0, -0.005);

      const pupil = this.addMesh(
        eyeGroup,
        new THREE.SphereGeometry(0.0055, 6, 6),
        this.eyePupilMat,
        false
      );
      pupil.position.set(0, 0, -0.01);

      const glint = this.addMesh(
        eyeGroup,
        new THREE.SphereGeometry(0.0024, 5, 5),
        this.eyeWhiteMat,
        false
      );
      glint.position.set(side * 0.003, 0.003, -0.013);

      const brow = this.addMesh(
        eyeGroup,
        new THREE.BoxGeometry(0.032, 0.007, 0.012),
        this.hairMat,
        false
      );
      brow.position.set(0, 0.019, -0.004);
      brow.rotation.z = -side * 0.1;
    }
  }

  /**
   * Expressive mythical creature eyes with sculpted brow ridge, luminous colored iris,
   * dark pupil, and specular catchlight.
   */
  private addMythicalEyes(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    irisHex: number,
    scale = 1,
    fierce = true,
    browHex = 0xd97706
  ): void {
    const irisMat = this.makeMat({
      color: irisHex,
      emissive: irisHex,
      emissiveIntensity: 0.75,
      roughness: 0.2
    });
    const browMat = this.makeMat({ color: browHex, roughness: 0.35, metalness: 0.3 });

    for (const side of [-1, 1] as const) {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(side * x, y, z);
      eyeGroup.rotation.y = side * -0.45;
      parent.add(eyeGroup);

      const sclera = this.addMesh(
        eyeGroup,
        new THREE.SphereGeometry(0.062 * scale, 10, 8),
        this.eyeWhiteMat,
        false
      );
      sclera.scale.set(0.85, 0.95, 1.15);

      const iris = this.addMesh(
        eyeGroup,
        new THREE.SphereGeometry(0.048 * scale, 10, 8),
        irisMat,
        false
      );
      iris.position.set(side * 0.018 * scale, 0, -0.028 * scale);

      const pupil = this.addMesh(
        eyeGroup,
        new THREE.SphereGeometry(0.028 * scale, 8, 8),
        this.eyePupilMat,
        false
      );
      pupil.scale.set(fierce ? 0.55 : 0.9, 1.15, 0.8);
      pupil.position.set(side * 0.032 * scale, 0, -0.046 * scale);

      const glint = this.addMesh(
        eyeGroup,
        new THREE.SphereGeometry(0.014 * scale, 6, 6),
        this.eyeWhiteMat,
        false
      );
      glint.position.set(side * 0.038 * scale, 0.022 * scale, -0.056 * scale);

      if (fierce) {
        const brow = this.addMesh(
          eyeGroup,
          new THREE.BoxGeometry(0.05 * scale, 0.026 * scale, 0.12 * scale),
          browMat,
          false
        );
        brow.position.set(side * 0.012 * scale, 0.056 * scale, -0.006 * scale);
        brow.rotation.x = 0.24;
        brow.rotation.z = -side * 0.2;
      }
    }
  }

  private buildOrnateSaddle(
    primaryMat: THREE.Material,
    trimGoldMat: THREE.Material,
    width = 0.54,
    length = 0.5
  ): THREE.Group {
    const saddleGroup = new THREE.Group();
    const leatherMat = this.makeMat({ color: 0x3b1f12, roughness: 0.62, metalness: 0.1 });

    // Contoured saddle cloth draping over mount's back
    const clothGeo = createSaddleBaseGeo(width * 1.18, length * 1.14, 0.12);
    const cloth = this.addMesh(saddleGroup, clothGeo, primaryMat);
    cloth.position.y = -0.02;

    // Sculpted leather-and-gold saddle seat with raised pommel & cantle
    const seatGeo = createSaddleBaseGeo(width * 0.9, length * 0.92, 0.075);
    const seat = this.addMesh(saddleGroup, seatGeo, leatherMat);
    seat.position.y = 0.01;

    // Gilded pommel & cantle trim arches
    const pommelTrim = this.addMesh(
      saddleGroup,
      new THREE.TorusGeometry(width * 0.34, 0.018, 6, 14, Math.PI),
      trimGoldMat
    );
    pommelTrim.position.set(0, 0.04, -length * 0.42);
    pommelTrim.rotation.x = 0.35;

    const cantleTrim = this.addMesh(
      saddleGroup,
      new THREE.TorusGeometry(width * 0.36, 0.02, 6, 14, Math.PI),
      trimGoldMat
    );
    cantleTrim.position.set(0, 0.055, length * 0.42);
    cantleTrim.rotation.x = -0.3;

    return saddleGroup;
  }

  private buildHeroicRider(
    headgear: HeadgearStyle,
    options: { stance: 'riding' | 'captain'; reinTarget?: THREE.Vector3 } = { stance: 'riding' }
  ): THREE.Group {
    const rider = new THREE.Group();
    const goldArmorMat = this.makeGoldMat(0.16);
    const leatherMat = this.makeMat({ color: 0x2c1a10, roughness: 0.58, metalness: 0.12 });
    const kerisWoodMat = this.makeMat({ color: 0x451a03, roughness: 0.42, metalness: 0.18 });
    const isCaptain = options.stance === 'captain';
    const hipY = isCaptain ? 0.35 : 0.05;

    // 1. Sculpted Pelvis & Draped Kain Dodot Waist Wrap + Golden Pending Belt
    const pelvis = this.addMesh(rider, new THREE.SphereGeometry(0.112, 12, 10), this.riderOutfitMat);
    pelvis.scale.set(1.12, 0.72, 0.92);
    pelvis.position.set(0, hipY, 0);

    const dodotWrap = this.addMesh(
      rider,
      new THREE.CylinderGeometry(0.118, 0.168, 0.16, 14),
      this.riderOutfitMat
    );
    dodotWrap.position.set(0, hipY - 0.01, 0.005);

    const belt = this.addMesh(
      rider,
      new THREE.TorusGeometry(0.122, 0.021, 8, 18),
      goldArmorMat
    );
    belt.rotation.x = Math.PI / 2;
    belt.position.set(0, hipY + 0.052, 0);

    for (const zSign of [-1, 1] as const) {
      const buckle = this.addMesh(
        rider,
        new THREE.OctahedronGeometry(0.028, 0),
        goldArmorMat,
        false
      );
      buckle.scale.set(1.1, 0.85, 0.5);
      buckle.position.set(0, hipY + 0.052, zSign * 0.128);
    }

    // Ceremonial Nusantara Keris tucked diagonally across lower back
    const kerisGroup = new THREE.Group();
    kerisGroup.position.set(0.02, hipY + 0.05, 0.132);
    kerisGroup.rotation.z = -0.58;
    kerisGroup.rotation.x = 0.12;
    rider.add(kerisGroup);
    this.addMesh(kerisGroup, new THREE.CylinderGeometry(0.016, 0.012, 0.24, 8), kerisWoodMat);
    const warangka = this.addMesh(
      kerisGroup,
      new THREE.BoxGeometry(0.095, 0.026, 0.028),
      goldArmorMat
    );
    warangka.position.y = 0.105;
    const ukiranHilt = this.addMesh(
      kerisGroup,
      createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0.115, 0),
          new THREE.Vector3(0.018, 0.16, 0.01),
          new THREE.Vector3(0.032, 0.185, 0.024)
        ],
        (u) => THREE.MathUtils.lerp(0.016, 0.02, u),
        { tubularSegments: 8, radialSegments: 8 }
      ),
      goldArmorMat
    );
    ukiranHilt.castShadow = false;

    // 2. Articulated 2-Segment Legs + Tailored Leather-and-Gold Boots
    for (const side of [-1, 1] as const) {
      const hipPt = new THREE.Vector3(side * 0.1, hipY - 0.01, 0.0);
      const kneePt = isCaptain
        ? new THREE.Vector3(side * 0.13, hipY - 0.17, -0.02)
        : new THREE.Vector3(side * 0.28, hipY - 0.09, -0.15);
      const anklePt = isCaptain
        ? new THREE.Vector3(side * 0.135, 0.035, 0.01)
        : new THREE.Vector3(side * 0.31, hipY - 0.25, -0.04);

      const thighGeo = createTaperedLoftGeo(
        [hipPt, kneePt],
        (u) => THREE.MathUtils.lerp(0.068, 0.05, u),
        { tubularSegments: 8, radialSegments: 10 }
      );
      this.addMesh(rider, thighGeo, this.riderOutfitMat);

      const kneeGuard = this.addMesh(rider, new THREE.SphereGeometry(0.05, 8, 8), goldArmorMat);
      kneeGuard.scale.set(0.85, 0.95, 0.9);
      kneeGuard.position.copy(kneePt).add(new THREE.Vector3(0, 0, -0.015));

      const calfGeo = createTaperedLoftGeo(
        [kneePt, anklePt],
        (u) => THREE.MathUtils.lerp(0.048, 0.036, u),
        { tubularSegments: 8, radialSegments: 10 }
      );
      this.addMesh(rider, calfGeo, leatherMat);

      const cuff = this.addMesh(
        rider,
        new THREE.TorusGeometry(0.044, 0.011, 6, 12),
        goldArmorMat
      );
      cuff.position.copy(kneePt).lerp(anklePt, 0.28);
      cuff.rotation.x = Math.PI / 2;

      const bootFoot = this.addMesh(rider, new THREE.SphereGeometry(0.042, 8, 8), leatherMat);
      bootFoot.scale.set(0.85, 0.65, 1.85);
      bootFoot.position.set(anklePt.x, anklePt.y - 0.018, anklePt.z - 0.048);
    }

    // 3. Articulated Upper Body Pivot (athletic torso, pauldrons, arms, cape, head)
    const upperPivot = new THREE.Group();
    upperPivot.position.set(0, hipY + 0.05, 0);
    rider.add(upperPivot);
    this.rig.riderUpperBodyPivot = upperPivot;

    // Athletic Sculpted Torso (narrow waist -> broad heroic chest & shoulders)
    const torsoGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.0, 0.0),
        new THREE.Vector3(0, 0.14, -0.01),
        new THREE.Vector3(0, 0.28, -0.018),
        new THREE.Vector3(0, 0.34, -0.02)
      ],
      (u) => {
        if (u < 0.65) return THREE.MathUtils.lerp(0.105, 0.145, u / 0.65);
        return THREE.MathUtils.lerp(0.145, 0.092, (u - 0.65) / 0.35);
      },
      { tubularSegments: 14, radialSegments: 14, scaleX: 1.22, scaleY: 0.82 }
    );
    this.addMesh(upperPivot, torsoGeo, this.riderOutfitMat);

    // High Royal Collar & Diagonal Golden Selempang Chest Sash
    const collar = this.addMesh(
      upperPivot,
      new THREE.CylinderGeometry(0.062, 0.072, 0.055, 12),
      this.riderOutfitMat
    );
    collar.position.set(0, 0.345, -0.02);

    const collarRim = this.addMesh(
      upperPivot,
      new THREE.TorusGeometry(0.064, 0.011, 6, 14),
      goldArmorMat
    );
    collarRim.rotation.x = Math.PI / 2;
    collarRim.position.set(0, 0.37, -0.02);

    const selempangGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(-0.12, 0.32, -0.03),
        new THREE.Vector3(0.0, 0.19, -0.115),
        new THREE.Vector3(0.11, 0.04, -0.05)
      ],
      () => 0.024,
      { tubularSegments: 10, radialSegments: 6, scaleY: 0.5 }
    );
    this.addMesh(upperPivot, selempangGeo, goldArmorMat, false);

    const chestMedallion = this.addMesh(
      upperPivot,
      new THREE.OctahedronGeometry(0.03, 0),
      this.riderHatAccentMat,
      false
    );
    chestMedallion.scale.set(1.0, 1.25, 0.5);
    chestMedallion.position.set(0, 0.24, -0.12);

    // Gilded Shoulder Pauldrons (Kelat Bahu) & 2-Segment Articulated Arms + Wrist Bracers
    const handPoints: THREE.Vector3[] = [];
    for (const side of [-1, 1] as const) {
      const shoulderPt = new THREE.Vector3(side * 0.175, 0.295, -0.015);
      const pauldron = this.addMesh(upperPivot, new THREE.SphereGeometry(0.072, 10, 8), goldArmorMat);
      pauldron.scale.set(1.05, 0.56, 1.15);
      pauldron.position.set(side * 0.185, 0.315, -0.015);
      pauldron.rotation.z = -side * 0.28;

      const elbowPt = new THREE.Vector3(side * 0.21, 0.155, -0.065);
      const handPt = isCaptain
        ? new THREE.Vector3(side * 0.11, 0.01, -0.22)
        : new THREE.Vector3(side * 0.145, 0.115, -0.24);
      handPoints.push(handPt);

      const upperArmGeo = createTaperedLoftGeo(
        [shoulderPt, elbowPt],
        (u) => THREE.MathUtils.lerp(0.048, 0.038, u),
        { tubularSegments: 8, radialSegments: 8 }
      );
      this.addMesh(upperPivot, upperArmGeo, this.riderOutfitMat);

      const forearmGeo = createTaperedLoftGeo(
        [elbowPt, handPt],
        (u) => THREE.MathUtils.lerp(0.038, 0.03, u),
        { tubularSegments: 8, radialSegments: 8 }
      );
      this.addMesh(upperPivot, forearmGeo, this.riderOutfitMat);

      // Burnished gold wrist bracer (Gelang Kana) + dark leather gloved hand
      const bracer = this.addMesh(
        upperPivot,
        new THREE.CylinderGeometry(0.036, 0.034, 0.07, 10),
        goldArmorMat
      );
      const bracerPos = elbowPt.clone().lerp(handPt, 0.72);
      bracer.position.copy(bracerPos);
      bracer.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        handPt.clone().sub(elbowPt).normalize()
      );

      const hand = this.addMesh(upperPivot, new THREE.SphereGeometry(0.036, 8, 8), leatherMat);
      hand.scale.set(0.95, 0.85, 1.25);
      hand.position.copy(handPt);
    }

    // Taut Golden Reins connecting rider hands to mount neck/collar
    if (options.reinTarget) {
      const targetLocal = options.reinTarget.clone();
      // Convert mount-relative target into rider upperPivot local approximation
      const worldOffsetY = hipY + 0.05;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const startPt = handPoints[i];
        const endPt = new THREE.Vector3(
          side * 0.16,
          targetLocal.y - worldOffsetY,
          targetLocal.z
        );
        const midPt = startPt.clone().lerp(endPt, 0.5).add(new THREE.Vector3(0, -0.05, 0));
        const reinGeo = createTaperedLoftGeo(
          [startPt, midPt, endPt],
          () => 0.012,
          { tubularSegments: 12, radialSegments: 6 }
        );
        this.addMesh(upperPivot, reinGeo, goldArmorMat, false);
      }
    }

    // 4. Flowing Multi-Segment Curved Royal Cape / Selendang (snug at collar, slightly draped left to reveal Keris)
    const capeBase = new THREE.Group();
    capeBase.position.set(-0.025, 0.335, 0.048);
    capeBase.rotation.y = -0.14;
    upperPivot.add(capeBase);
    const clasp = this.addMesh(capeBase, new THREE.SphereGeometry(0.036, 8, 8), goldArmorMat);
    clasp.scale.set(1.5, 0.75, 0.6);

    let capeParent: THREE.Object3D = capeBase;
    const segLen = isCaptain ? 0.15 : 0.18;
    const widths: Array<[number, number]> = [
      [0.2, 0.26],
      [0.26, 0.32],
      [0.32, 0.36]
    ];
    for (let i = 0; i < 3; i++) {
      const segPivot = new THREE.Group();
      segPivot.position.set(0, i === 0 ? -0.01 : 0, i === 0 ? 0.01 : segLen - 0.015);
      capeParent.add(segPivot);
      const [topW, botW] = widths[i];
      this.addMesh(
        segPivot,
        createCapeSegmentGeo(topW, botW, segLen, 0.028, 0.012),
        this.riderScarfMat
      );
      this.rig.riderCapeSegments.push(segPivot);
      capeParent = segPivot;
    }

    // 5. Slender Neck + Realistic Sculpted Head & Nusantara Regional Headgear
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.375, -0.02);
    upperPivot.add(headPivot);
    this.rig.riderHeadPivot = headPivot;

    const neck = this.addMesh(
      headPivot,
      new THREE.CylinderGeometry(0.042, 0.05, 0.085, 10),
      this.skinMat
    );
    neck.position.set(0, 0.035, 0);

    const head = new THREE.Group();
    head.position.set(0, 0.145, -0.005);
    headPivot.add(head);

    // Sculpted oval cranium + tapered jaw/chin + nose bridge + ears + realistic eyes
    const cranium = this.addMesh(head, new THREE.SphereGeometry(0.098, 16, 14), this.skinMat);
    cranium.scale.set(0.92, 1.12, 1.02);

    const jaw = this.addMesh(head, new THREE.SphereGeometry(0.072, 12, 10), this.skinMat);
    jaw.scale.set(0.86, 0.98, 0.92);
    jaw.position.set(0, -0.042, -0.016);

    const nose = this.addMesh(head, new THREE.ConeGeometry(0.015, 0.046, 5), this.skinMat, false);
    nose.position.set(0, -0.006, -0.098);
    nose.rotation.x = -Math.PI * 0.42;

    for (const side of [-1, 1] as const) {
      const ear = this.addMesh(head, new THREE.SphereGeometry(0.024, 8, 8), this.skinMat, false);
      ear.scale.set(0.45, 0.95, 0.7);
      ear.position.set(side * 0.09, 0.0, 0.005);
    }

    this.addRealisticRiderEyes(head);

    // Sleek layered dark hair + windswept nape lock
    const hairCap = this.addMesh(
      head,
      new THREE.SphereGeometry(0.102, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
      this.hairMat
    );
    hairCap.scale.set(0.94, 1.12, 1.04);
    hairCap.rotation.x = 0.24;

    const napeHair = this.addMesh(
      head,
      createFlamePetalGeo(0.15, 0.08, 0.026, 0.08),
      this.hairMat
    );
    napeHair.position.set(0, -0.01, 0.092);
    napeHair.rotation.x = Math.PI * 0.82;

    // 6. High-Craft Sculpted Nusantara Regional Headgear (fitted to 0.10m realistic head)
    if (headgear === 'blangkon') {
      const soganMat = this.makeMat({
        color: 0x78350f,
        map: this.textures.batikPBR.map,
        normalMap: this.textures.batikPBR.normalMap,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.58
      });
      const cap = this.addMesh(head, new THREE.CylinderGeometry(0.098, 0.108, 0.082, 16), soganMat);
      cap.position.set(0, 0.072, 0.005);
      const wiruBand = this.addMesh(
        head,
        new THREE.TorusGeometry(0.102, 0.016, 6, 16),
        soganMat
      );
      wiruBand.rotation.x = Math.PI / 2 - 0.16;
      wiruBand.position.set(0, 0.044, -0.004);
      const mondolan = this.addMesh(head, new THREE.SphereGeometry(0.048, 10, 10), soganMat);
      mondolan.position.set(0, 0.048, 0.106);
      const brooch = this.addMesh(
        head,
        new THREE.OctahedronGeometry(0.024, 0),
        goldArmorMat,
        false
      );
      brooch.position.set(0, 0.072, -0.108);
    } else if (headgear === 'udeng') {
      const whiteCloth = this.makeMat({
        color: 0xf8fafc,
        normalMap: this.textures.batikPBR.normalMap,
        normalScale: new THREE.Vector2(0.3, 0.3),
        roughness: 0.52
      });
      const wrap = this.addMesh(
        head,
        new THREE.TorusGeometry(0.098, 0.028, 8, 18),
        whiteCloth
      );
      wrap.rotation.x = Math.PI / 2 - 0.14;
      wrap.position.set(0, 0.056, 0);
      const peak = this.addMesh(
        head,
        createFlamePetalGeo(0.11, 0.068, 0.024, 0.03),
        whiteCloth
      );
      peak.position.set(0, 0.068, -0.082);
      peak.rotation.x = 0.22;
      const goldTrim = this.addMesh(
        head,
        new THREE.TorusGeometry(0.101, 0.011, 6, 18),
        goldArmorMat
      );
      goldTrim.rotation.x = Math.PI / 2 - 0.14;
      goldTrim.position.set(0, 0.038, 0);
      const templeGem = this.addMesh(
        head,
        new THREE.OctahedronGeometry(0.022, 0),
        goldArmorMat,
        false
      );
      templeGem.position.set(0, 0.095, -0.095);
    } else if (headgear === 'pelangi') {
      const sigerBand = this.addMesh(
        head,
        new THREE.TorusGeometry(0.1, 0.018, 8, 18),
        goldArmorMat
      );
      sigerBand.rotation.x = Math.PI / 2 - 0.18;
      sigerBand.position.set(0, 0.062, 0);
      for (let i = -2; i <= 2; i++) {
        const s = 1 - Math.abs(i) * 0.2;
        const spire = this.addMesh(
          head,
          createFlamePetalGeo(0.11 * s, 0.048 * s, 0.014, 0.02),
          goldArmorMat
        );
        spire.position.set(i * 0.034, 0.072, -0.086 + Math.abs(i) * 0.018);
        spire.rotation.z = -i * 0.28;
        spire.rotation.x = 0.22;
      }
      const starGem = this.addMesh(
        head,
        new THREE.OctahedronGeometry(0.028, 0),
        this.makeMat({
          color: 0xff66c4,
          emissive: 0xff66c4,
          emissiveIntensity: 1.25
        }),
        false
      );
      starGem.position.set(0, 0.098, -0.106);
    } else if (headgear === 'songkok_recca') {
      const songkokMat = this.makeMat({
        color: 0x1e1b18,
        normalMap: this.textures.batikPBR.normalMap,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.56
      });
      const cyl = this.addMesh(
        head,
        new THREE.CylinderGeometry(0.092, 0.102, 0.095, 16),
        songkokMat
      );
      cyl.position.set(0, 0.082, 0.005);
      const band = this.addMesh(
        head,
        new THREE.CylinderGeometry(0.099, 0.104, 0.028, 16),
        goldArmorMat
      );
      band.position.set(0, 0.052, 0.005);
      const crest = this.addMesh(head, new THREE.OctahedronGeometry(0.022, 0), goldArmorMat, false);
      crest.position.set(0, 0.088, -0.098);
    } else if (headgear === 'mahkota_papua') {
      const band = this.addMesh(
        head,
        new THREE.TorusGeometry(0.1, 0.02, 8, 18),
        goldArmorMat
      );
      band.rotation.x = Math.PI / 2 - 0.12;
      band.position.set(0, 0.062, 0);
      const featherCols = [0xef4444, 0xfacc15, 0x10b981, 0xfef9c3, 0x10b981, 0xfacc15, 0xef4444];
      const featherGeo = createFeatherGeo(0.2, 0.044, 0.012, 0.03, 0.02);
      for (let i = 0; i < featherCols.length; i++) {
        const fMat = this.makeFeatherMat(featherCols[i]);
        const f = this.addMesh(head, featherGeo, fMat, false);
        const fan = (i - 3) * 0.24;
        f.position.set(Math.sin(fan) * 0.082, 0.082, 0.02 + Math.abs(i - 3) * 0.01);
        f.rotation.y = -Math.PI / 2 + fan * 0.5;
        f.rotation.z = 0.72 - Math.abs(i - 3) * 0.08;
      }
    } else {
      // topi_dayak (Lavung beaded headband + sculpted Enggang tail feathers)
      const dayakRed = this.makeMat({
        color: 0xdc2626,
        normalMap: this.textures.batikPBR.normalMap,
        roughness: 0.48
      });
      const cap = this.addMesh(head, new THREE.CylinderGeometry(0.092, 0.104, 0.076, 16), dayakRed);
      cap.position.set(0, 0.074, 0.005);
      const beadBand = this.addMesh(
        head,
        new THREE.CylinderGeometry(0.105, 0.107, 0.024, 16),
        goldArmorMat
      );
      beadBand.position.set(0, 0.048, 0.005);
      const frontEmblem = this.addMesh(
        head,
        new THREE.OctahedronGeometry(0.024, 0),
        goldArmorMat,
        false
      );
      frontEmblem.position.set(0, 0.075, -0.102);

      const whiteFeather = this.makeFeatherMat(0xf8fafc);
      const tipBlack = this.makeFeatherMat(0x0f172a);
      const hornbillFeatherGeo = createFeatherGeo(0.25, 0.048, 0.012, 0.035, 0.03);
      for (const side of [-1, 1] as const) {
        const f = this.addMesh(head, hornbillFeatherGeo, whiteFeather, false);
        f.position.set(side * 0.085, 0.095, 0.04);
        f.rotation.y = -Math.PI / 2 + side * 0.28;
        f.rotation.z = 0.65;
        const bar = this.addMesh(f, new THREE.BoxGeometry(0.055, 0.016, 0.042), tipBlack, false);
        bar.position.set(0.18, 0.025, 0);
      }
    }

    return rider;
  }

  // Helper: place sculpted feather aligned outward along left (-1) or right (+1) wing
  private addWingFeather(
    parent: THREE.Object3D,
    side: -1 | 1,
    len: number,
    width: number,
    thickness: number,
    archY: number,
    sweepZ: number,
    x: number,
    y: number,
    z: number,
    sweepYaw: number,
    dihedralZ: number,
    mat: THREE.Material
  ): THREE.Mesh {
    const geo = createFeatherGeo(len, width, thickness, archY, side * sweepZ);
    const mesh = this.addMesh(parent, geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = side === 1 ? -sweepYaw : Math.PI + sweepYaw;
    mesh.rotation.z = side * dihedralZ;
    return mesh;
  }

  // 1. GARUDA NUSANTARA — Sacred Golden Solar Eagle-King + Prabha Halo + Blangkon Rider
  private buildGarudaNusantara(): void {
    const goldBodyMat = this.makeFeatherMat(0xf59e0b, {
      emissive: 0xb45309,
      emissiveIntensity: 0.12,
      roughness: 0.42,
      metalness: 0.32
    });
    const creamChestMat = this.makeFeatherMat(0xfef3c7, { roughness: 0.52, metalness: 0.08 });
    const crimsonMat = this.makeFeatherMat(0xdc2626, {
      emissive: 0x991b1b,
      emissiveIntensity: 0.1,
      roughness: 0.45
    });
    const burnishedGoldMat = this.makeGoldMat(0.16);
    const beakMat = this.makeMat({ color: 0xffa600, roughness: 0.28, metalness: 0.28 });
    const sunTipMat = this.makeMat({
      color: 0xfde047,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.08,
      roughness: 0.3
    });
    const jewelMat = this.makeMat({
      color: 0x38bdf8,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.35
    });

    // Sculpted teardrop eagle torso (broad proud chest -> tapered tail root)
    const bodyGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.02, -0.78),
        new THREE.Vector3(0, 0.04, -0.35),
        new THREE.Vector3(0, 0.02, 0.25),
        new THREE.Vector3(0, 0.03, 0.86)
      ],
      (u) => {
        if (u < 0.35) return 0.22 + Math.sin((u / 0.35) * (Math.PI * 0.5)) * 0.34;
        return 0.56 * (1 - ((u - 0.35) / 0.65) * 0.68);
      },
      { tubularSegments: 22, radialSegments: 16, scaleX: 1.0, scaleY: 0.92 }
    );
    this.addMesh(this.mountGroup, bodyGeo, goldBodyMat);

    // Sculpted cream-gold feathered chest shield
    const chestGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.14, -0.82),
        new THREE.Vector3(0, -0.12, -0.45),
        new THREE.Vector3(0, -0.16, 0.1)
      ],
      (u) => 0.16 + Math.sin(u * Math.PI) * 0.3,
      { tubularSegments: 14, radialSegments: 12, scaleX: 0.95, scaleY: 0.78 }
    );
    this.addMesh(this.mountGroup, chestGeo, creamChestMat);

    // Ornate Nusantara Kalung Badong (crimson-gold chest collar)
    const badong = this.addMesh(
      this.mountGroup,
      new THREE.TorusGeometry(0.36, 0.055, 8, 18, Math.PI * 1.25),
      burnishedGoldMat
    );
    badong.position.set(0, 0.06, -0.62);
    badong.rotation.set(Math.PI * 0.42, 0, -Math.PI * 0.125);
    const badongGem = this.addMesh(
      this.mountGroup,
      new THREE.OctahedronGeometry(0.065, 0),
      jewelMat,
      false
    );
    badongGem.position.set(0, -0.15, -0.84);

    // Arched muscular neck + layered golden-crimson neck hackles
    const neckGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.05, -0.64),
        new THREE.Vector3(0, 0.26, -0.82),
        new THREE.Vector3(0, 0.46, -0.92)
      ],
      (u) => THREE.MathUtils.lerp(0.34, 0.23, u),
      { tubularSegments: 14, radialSegments: 14, scaleX: 0.92, scaleY: 1.0 }
    );
    this.addMesh(this.mountGroup, neckGeo, goldBodyMat);

    for (let i = 0; i < 6; i++) {
      const a = (i / 5 - 0.5) * 2.1;
      const hackle = this.addMesh(
        this.mountGroup,
        createFlamePetalGeo(0.28, 0.14, 0.03, 0.08),
        i % 2 === 0 ? crimsonMat : burnishedGoldMat
      );
      hackle.position.set(Math.sin(a) * 0.28, 0.26, -0.78 + Math.cos(a) * 0.14);
      hackle.rotation.set(Math.PI * 0.72, 0, -a * 0.65);
    }

    // Proud Garuda Head + Strongly Hooked Eagle Beak + Jamang Crown
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.48, -0.94);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    const skull = this.addMesh(headPivot, new THREE.SphereGeometry(0.27, 16, 14), goldBodyMat);
    skull.scale.set(0.92, 0.95, 1.18);

    this.addMythicalEyes(headPivot, 0.165, 0.06, -0.15, 0xffd000, 1.05, true, 0xfbbf24);

    // Hooked raptor upper mandible curving down to a sharp eagle tip + lower mandible
    const upperBeakGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.03, -0.25),
        new THREE.Vector3(0, 0.03, -0.46),
        new THREE.Vector3(0, -0.04, -0.62),
        new THREE.Vector3(0, -0.15, -0.64)
      ],
      (u) => {
        if (u < 0.35) return THREE.MathUtils.lerp(0.115, 0.085, u / 0.35);
        return Math.max(0.012, 0.085 * (1 - (u - 0.35) / 0.65));
      },
      { tubularSegments: 16, radialSegments: 10, scaleX: 0.72, scaleY: 1.0 }
    );
    this.addMesh(headPivot, upperBeakGeo, beakMat);

    const cere = this.addMesh(headPivot, new THREE.SphereGeometry(0.105, 10, 8), burnishedGoldMat);
    cere.scale.set(0.88, 0.65, 0.9);
    cere.position.set(0, 0.05, -0.29);

    const lowerBeakGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.05, -0.22),
        new THREE.Vector3(0, -0.06, -0.42),
        new THREE.Vector3(0, -0.075, -0.54)
      ],
      (u) => Math.max(0.015, 0.075 * (1 - u * 0.78)),
      { tubularSegments: 10, radialSegments: 8, scaleX: 0.78, scaleY: 0.7 }
    );
    this.addMesh(headPivot, lowerBeakGeo, beakMat);

    // Tiered Wayang Jamang Crown + Sumping ear-scrolls + Javanese Eagle Crest
    const crownBand = this.addMesh(
      headPivot,
      new THREE.TorusGeometry(0.245, 0.036, 8, 18),
      burnishedGoldMat
    );
    crownBand.rotation.x = Math.PI / 2 - 0.25;
    crownBand.position.set(0, 0.16, 0.02);

    const jamangSpikeGeo = createFlamePetalGeo(0.26, 0.14, 0.035, 0.07);
    for (let i = -2; i <= 2; i++) {
      const hScale = 1 - Math.abs(i) * 0.18;
      const spike = this.addMesh(headPivot, jamangSpikeGeo, burnishedGoldMat);
      spike.scale.set(hScale, hScale, 1);
      spike.position.set(i * 0.075, 0.18, -0.14 + Math.abs(i) * 0.03);
      spike.rotation.z = -i * 0.24;
      spike.rotation.x = 0.22;
    }

    const crownGem = this.addMesh(headPivot, new THREE.OctahedronGeometry(0.055, 0), jewelMat, false);
    crownGem.position.set(0, 0.2, -0.21);

    // Sweeping golden ear-scrolls (sumping) & 5 Javanese eagle crest feathers
    for (const side of [-1, 1] as const) {
      const sumping = this.addMesh(
        headPivot,
        createFlamePetalGeo(0.24, 0.11, 0.03, 0.14),
        burnishedGoldMat
      );
      sumping.position.set(side * 0.23, 0.06, 0.04);
      sumping.rotation.set(0.35, side * 0.4, -side * 0.55);
    }

    const crestFeatherGeo = createFeatherGeo(0.42, 0.11, 0.028, 0.06, 0.06);
    for (let i = 0; i < 4; i++) {
      const crest = this.addMesh(
        headPivot,
        crestFeatherGeo,
        i % 2 === 0 ? crimsonMat : goldBodyMat
      );
      crest.position.set(0, 0.24 - i * 0.04, 0.08 + i * 0.05);
      crest.rotation.y = -Math.PI / 2;
      crest.rotation.z = 0.65 - i * 0.14;
    }

    // Grand Articulated Multi-Layer Eagle Wings (covert arm + secondaries + 7 splayed primaries)
    const buildEagleWing = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.42, 0.18, -0.18);

      // Curved feathered wing arm / shoulder covert
      const armGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.52, 0.07, -0.06),
          new THREE.Vector3(side * 1.05, 0.04, 0.08)
        ],
        (u) => THREE.MathUtils.lerp(0.18, 0.085, u),
        { tubularSegments: 14, radialSegments: 10, scaleX: 1, scaleY: 0.65 }
      );
      this.addMesh(pivot, armGeo, burnishedGoldMat);

      // Inner crimson covert layer
      for (let i = 0; i < 4; i++) {
        this.addWingFeather(
          pivot,
          side,
          0.92 - i * 0.05,
          0.3,
          0.042,
          0.05,
          0.08,
          side * (0.1 + i * 0.22),
          0.03,
          0.04 + i * 0.03,
          0.26 + i * 0.05,
          0.06,
          i % 2 === 0 ? crimsonMat : goldBodyMat
        );
      }

      // Secondary cream-gold flight feathers
      for (let i = 0; i < 5; i++) {
        this.addWingFeather(
          pivot,
          side,
          1.18 - i * 0.04,
          0.32,
          0.036,
          0.06,
          0.14,
          side * (0.08 + i * 0.2),
          -0.01,
          0.16 + i * 0.04,
          0.42 + i * 0.05,
          0.03,
          i % 2 === 0 ? creamChestMat : goldBodyMat
        );
      }

      // Articulated outer wingtip with 7 splayed eagle primary finger-feathers + solar tips
      const tipPivot = new THREE.Group();
      tipPivot.position.set(side * 0.96, 0.03, 0.08);
      pivot.add(tipPivot);
      if (side === -1) this.rig.wingTipLeftPivot = tipPivot;
      else this.rig.wingTipRightPivot = tipPivot;

      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const pLen = 1.15 - t * 0.24;
        const yaw = -0.05 + t * 0.68;
        const dihedral = 0.22 - t * 0.14;
        this.addWingFeather(
          tipPivot,
          side,
          pLen,
          0.22,
          0.028,
          0.06,
          0.12,
          0,
          0,
          i * 0.035,
          yaw,
          dihedral,
          i % 2 === 0 ? goldBodyMat : crimsonMat
        );
        // Subtle glowing solar feather tip
        const tipBead = this.addMesh(
          tipPivot,
          new THREE.SphereGeometry(0.035, 6, 6),
          sunTipMat,
          false
        );
        const dirX = side * Math.cos(yaw) * pLen * 0.95;
        const dirZ = Math.sin(yaw) * pLen * 0.95 + i * 0.035;
        const dirY = Math.sin(dihedral) * pLen * 0.72;
        tipBead.position.set(dirX, dirY, dirZ);
      }

      return pivot;
    };

    const wingL = buildEagleWing(-1);
    const wingR = buildEagleWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 7.0;
    this.rig.wingFlapAmp = 0.31;
    this.rig.wingBaseZ = 0.08;

    // Tucked Feathered Legs & 3-Clawed Golden Eagle Talons
    for (const side of [-1, 1] as const) {
      const thigh = this.addMesh(
        this.mountGroup,
        new THREE.SphereGeometry(0.16, 10, 8),
        goldBodyMat
      );
      thigh.scale.set(0.85, 1.1, 1.15);
      thigh.position.set(side * 0.28, -0.32, 0.22);

      const footPivot = new THREE.Group();
      footPivot.position.set(side * 0.28, -0.44, 0.34);
      this.mountGroup.add(footPivot);
      for (let t = -1; t <= 1; t++) {
        const toe = this.addMesh(
          footPivot,
          createTaperedLoftGeo(
            [
              new THREE.Vector3(t * 0.04, 0, 0),
              new THREE.Vector3(t * 0.06, -0.05, 0.12),
              new THREE.Vector3(t * 0.07, -0.11, 0.08)
            ],
            (u) => THREE.MathUtils.lerp(0.032, 0.008, u),
            { tubularSegments: 8, radialSegments: 6 }
          ),
          burnishedGoldMat
        );
        toe.castShadow = false;
      }
    }

    // Fanned 7-Feather Sculpted Tail
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.04, 0.8);
    this.mountGroup.add(tailPivot);
    this.rig.tailPivot = tailPivot;
    const tailFeatherGeo = createFeatherGeo(0.76, 0.22, 0.032, 0.04, 0.02);
    for (let i = -3; i <= 3; i++) {
      const fMat = Math.abs(i) % 2 === 0 ? goldBodyMat : crimsonMat;
      const tf = this.addMesh(tailPivot, tailFeatherGeo, fMat);
      tf.rotation.y = -Math.PI / 2 + i * 0.17;
      tf.position.set(i * 0.05, Math.abs(i) * 0.008, 0);
    }

    // Rotating Golden Solar Prabha Halo behind rider shoulders
    const prabha = buildMythicalHaloGroup(
      this.regGeo,
      sunTipMat,
      burnishedGoldMat,
      0.7,
      0.024,
      12,
      0.16
    );
    prabha.position.set(0, 0.86, 0.4);
    this.mountGroup.add(prabha);
    this.rig.haloPivots.push(prabha);

    // Ornate Contoured Saddle & Heroic Blangkon Rider
    const saddle = this.buildOrnateSaddle(crimsonMat, burnishedGoldMat, 0.56, 0.52);
    saddle.position.set(0, 0.43, 0.02);
    this.mountGroup.add(saddle);
    const rider = this.buildHeroicRider('blangkon', {
      stance: 'riding',
      reinTarget: new THREE.Vector3(0, -0.05, -0.68)
    });
    rider.position.set(0, 0.45, 0.03);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-2.15, 0.32, 0.35);
    this.wingtipRightAnchor.position.set(2.15, 0.32, 0.35);
    this.cannonLeftAnchor.position.set(-0.68, 0.06, -0.68);
    this.cannonRightAnchor.position.set(0.68, 0.06, -0.68);
    this.thrusterLeftAnchor.position.set(-0.34, -0.05, 0.94);
    this.thrusterRightAnchor.position.set(0.34, -0.05, 0.94);
    this.rig.flameScaleBase = 0.48;
  }

  // 2. NAGA BARONG — Sinuous Celestial Bali-Java Dragon + Mustika Pearl + Udeng Rider
  private buildNagaBarong(): void {
    const scaleMat = this.makeMat({
      color: 0x059669,
      map: this.textures.scalePBR.map,
      normalMap: this.textures.scalePBR.normalMap,
      roughnessMap: this.textures.scalePBR.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      emissive: 0x047857,
      emissiveIntensity: 0.14,
      roughness: 0.36,
      metalness: 0.32
    });
    const bellyMat = this.makeMat({ color: 0xfde047, roughness: 0.42, metalness: 0.18 });
    const redMat = this.makeMat({
      color: 0xdc2626,
      emissive: 0x991b1b,
      emissiveIntensity: 0.12,
      roughness: 0.4
    });
    const goldMat = this.makeGoldMat(0.18);
    const ivoryFangMat = this.makeMat({ color: 0xfef9c3, roughness: 0.3 });
    const emberMat = this.makeMat({
      color: 0xff8a00,
      emissive: 0xff5500,
      emissiveIntensity: 1.32,
      side: THREE.DoubleSide
    });
    const pearlMat = this.makeMat({
      color: 0x67e8f9,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.35,
      roughness: 0.15
    });

    // Sculpted Dragon Chest & Arched Sinuous Neck
    const chestGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.0, -0.52),
        new THREE.Vector3(0, 0.02, -0.15),
        new THREE.Vector3(0, -0.01, 0.25)
      ],
      (u) => 0.38 + Math.sin(u * Math.PI) * 0.14,
      { tubularSegments: 14, radialSegments: 14, scaleX: 1.0, scaleY: 0.9 }
    );
    this.addMesh(this.mountGroup, chestGeo, scaleMat);

    const bellyGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.16, -0.54),
        new THREE.Vector3(0, -0.18, -0.15),
        new THREE.Vector3(0, -0.16, 0.22)
      ],
      (u) => 0.26 + Math.sin(u * Math.PI) * 0.1,
      { tubularSegments: 12, radialSegments: 10, scaleX: 1.0, scaleY: 0.65 }
    );
    this.addMesh(this.mountGroup, bellyGeo, bellyMat);

    const neckGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.04, -0.45),
        new THREE.Vector3(0, 0.22, -0.72),
        new THREE.Vector3(0, 0.35, -0.96)
      ],
      (u) => THREE.MathUtils.lerp(0.36, 0.25, u),
      { tubularSegments: 14, radialSegments: 14, scaleX: 0.94, scaleY: 1.0 }
    );
    this.addMesh(this.mountGroup, neckGeo, scaleMat);

    // Dorsal neck flame spines
    const spineGeo = createFlamePetalGeo(0.24, 0.1, 0.03, 0.12);
    for (let i = 0; i < 3; i++) {
      const sp = this.addMesh(this.mountGroup, spineGeo, i % 2 === 0 ? redMat : goldMat);
      sp.position.set(0, 0.3 + i * 0.08, -0.52 - i * 0.16);
      sp.rotation.x = 0.25;
    }

    // Expressive Barong / Celestial Naga Head
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.36, -0.98);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    const cranium = this.addMesh(headPivot, new THREE.SphereGeometry(0.31, 16, 14), scaleMat);
    cranium.scale.set(1.04, 0.92, 1.15);

    // Sculpted Dragon Snout + Flared Nostrils + Lower Jaw with Fangs & Glowing Ember Throat
    const snoutGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.02, -0.16),
        new THREE.Vector3(0, 0.01, -0.38),
        new THREE.Vector3(0, 0.04, -0.58)
      ],
      (u) => THREE.MathUtils.lerp(0.24, 0.13, u),
      { tubularSegments: 12, radialSegments: 12, scaleX: 1.12, scaleY: 0.72 }
    );
    this.addMesh(headPivot, snoutGeo, scaleMat);

    const noseScroll = this.addMesh(
      headPivot,
      createFlamePetalGeo(0.16, 0.1, 0.04, 0.12),
      goldMat
    );
    noseScroll.position.set(0, 0.08, -0.52);
    noseScroll.rotation.x = -0.35;

    const lowerJawGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.12, -0.14),
        new THREE.Vector3(0, -0.16, -0.36),
        new THREE.Vector3(0, -0.14, -0.52)
      ],
      (u) => THREE.MathUtils.lerp(0.2, 0.1, u),
      { tubularSegments: 10, radialSegments: 10, scaleX: 1.05, scaleY: 0.55 }
    );
    this.addMesh(headPivot, lowerJawGeo, scaleMat);

    const emberThroat = this.addMesh(
      headPivot,
      new THREE.SphereGeometry(0.11, 8, 8),
      emberMat,
      false
    );
    emberThroat.scale.set(0.9, 0.5, 1.3);
    emberThroat.position.set(0, -0.07, -0.32);

    this.addMythicalEyes(headPivot, 0.19, 0.09, -0.18, 0xffb703, 1.18, true, 0xfbbf24);

    // Fangs & Nostrils
    for (const side of [-1, 1] as const) {
      const nostril = this.addMesh(headPivot, new THREE.SphereGeometry(0.05, 8, 8), goldMat);
      nostril.position.set(side * 0.095, 0.07, -0.52);

      const upperFang = this.addMesh(
        headPivot,
        new THREE.ConeGeometry(0.025, 0.1, 6),
        ivoryFangMat,
        false
      );
      upperFang.rotation.x = Math.PI;
      upperFang.position.set(side * 0.1, -0.05, -0.46);

      const lowerFang = this.addMesh(
        headPivot,
        new THREE.ConeGeometry(0.02, 0.08, 6),
        ivoryFangMat,
        false
      );
      lowerFang.position.set(side * 0.08, -0.11, -0.44);
    }

    // Balinese Gelungan Crown + S-Curved Branching Golden Dragon Antlers
    const gelungan = this.addMesh(
      headPivot,
      createFlamePetalGeo(0.26, 0.18, 0.04, 0.1),
      goldMat
    );
    gelungan.position.set(0, 0.24, -0.04);
    gelungan.rotation.x = 0.2;
    const crownRuby = this.addMesh(headPivot, new THREE.OctahedronGeometry(0.055, 0), redMat, false);
    crownRuby.position.set(0, 0.27, -0.1);

    for (const side of [-1, 1] as const) {
      const antlerGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(side * 0.12, 0.2, 0.04),
          new THREE.Vector3(side * 0.22, 0.36, 0.18),
          new THREE.Vector3(side * 0.18, 0.48, 0.38),
          new THREE.Vector3(side * 0.25, 0.6, 0.5)
        ],
        (u) => THREE.MathUtils.lerp(0.055, 0.014, u),
        { tubularSegments: 16, radialSegments: 8, ridgeCount: 5, ridgeAmp: 0.12 }
      );
      this.addMesh(headPivot, antlerGeo, goldMat);

      const prongGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(side * 0.21, 0.37, 0.2),
          new THREE.Vector3(side * 0.31, 0.48, 0.16),
          new THREE.Vector3(side * 0.33, 0.57, 0.2)
        ],
        (u) => THREE.MathUtils.lerp(0.032, 0.01, u),
        { tubularSegments: 8, radialSegments: 6 }
      );
      this.addMesh(headPivot, prongGeo, goldMat);

      // Long S-Curved Flowing Golden Whiskers
      const whiskerPivot = new THREE.Group();
      whiskerPivot.position.set(side * 0.16, -0.02, -0.46);
      headPivot.add(whiskerPivot);
      this.rig.whiskerPivots.push(whiskerPivot);

      const whiskerGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.24, -0.02, 0.14),
          new THREE.Vector3(side * 0.38, 0.08, 0.44),
          new THREE.Vector3(side * 0.3, 0.15, 0.72)
        ],
        (u) => THREE.MathUtils.lerp(0.026, 0.006, u),
        { tubularSegments: 14, radialSegments: 6 }
      );
      this.addMesh(whiskerPivot, whiskerGeo, goldMat, false);
    }

    // Lush Radial Barong Flame-Mane Ruff (12 overlapping curved flame-petals)
    const ruffPetalGeo = createFlamePetalGeo(0.32, 0.15, 0.032, 0.14);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const petal = this.addMesh(
        headPivot,
        ruffPetalGeo,
        i % 3 === 0 ? goldMat : redMat
      );
      petal.position.set(Math.cos(ang) * 0.25, Math.sin(ang) * 0.24, 0.12);
      petal.rotation.z = ang - Math.PI / 2;
      petal.rotation.x = 0.48;
    }

    // Mega Mendung Cloud-Scroll Spirit Wings
    const makeCloudWing = (side: -1 | 1): THREE.Group => {
      const p = new THREE.Group();
      p.position.set(side * 0.42, 0.14, -0.14);
      const specs = [
        { len: 0.78, w: 0.28, z: 0.02, yaw: 0.22, mat: goldMat },
        { len: 0.94, w: 0.26, z: 0.16, yaw: 0.34, mat: redMat },
        { len: 0.72, w: 0.22, z: 0.32, yaw: 0.48, mat: goldMat }
      ];
      for (let i = 0; i < specs.length; i++) {
        const s = specs[i];
        this.addWingFeather(
          p,
          side,
          s.len,
          s.w,
          0.038,
          0.08,
          0.16,
          0,
          i * 0.02,
          s.z,
          s.yaw,
          0.12 - i * 0.04,
          s.mat
        );
      }
      return p;
    };
    const wingL = makeCloudWing(-1);
    const wingR = makeCloudWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 8.4;
    this.rig.wingFlapAmp = 0.26;
    this.rig.wingBaseZ = 0.12;

    // 4 Articulated 2-Segment Clawed Dragon Legs
    const legSpecs = [
      [-0.35, -0.14, -0.34],
      [0.35, -0.14, -0.34],
      [-0.32, -0.14, 0.24],
      [0.32, -0.14, 0.24]
    ] as const;
    for (const [lx, ly, lz] of legSpecs) {
      const side = lx < 0 ? -1 : 1;
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, ly, lz);
      const limbGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.08, -0.16, 0.08),
          new THREE.Vector3(side * 0.06, -0.26, -0.06)
        ],
        (u) => THREE.MathUtils.lerp(0.11, 0.065, u),
        { tubularSegments: 10, radialSegments: 8 }
      );
      this.addMesh(legPivot, limbGeo, scaleMat);
      for (let c = -1; c <= 1; c++) {
        const claw = this.addMesh(legPivot, new THREE.ConeGeometry(0.022, 0.095, 5), goldMat, false);
        claw.position.set(side * 0.06 + c * 0.032, -0.28, -0.1);
        claw.rotation.x = -Math.PI * 0.65;
      }
      this.mountGroup.add(legPivot);
      this.rig.legPivots.push(legPivot);
    }

    // 7 Overlapping Tapered Sinuous Serpent Body Segments (continuous silhouette!)
    const segSpineGeo = createFlamePetalGeo(0.28, 0.095, 0.03, 0.14);
    for (let i = 0; i < 7; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, 0, 0.32 + i * 0.24);
      const r = 0.34 - i * 0.036;

      const cyl = this.addMesh(
        seg,
        new THREE.CapsuleGeometry(r, 0.2, 6, 12),
        scaleMat
      );
      cyl.rotation.x = Math.PI / 2;

      const plate = this.addMesh(
        seg,
        new THREE.SphereGeometry(r * 0.8, 10, 8),
        bellyMat
      );
      plate.scale.set(0.95, 0.55, 1.2);
      plate.position.y = -r * 0.52;

      const fin = this.addMesh(
        seg,
        segSpineGeo,
        i % 2 === 0 ? redMat : goldMat
      );
      fin.scale.setScalar(1 - i * 0.08);
      fin.position.set(0, r * 0.72, 0);
      fin.rotation.x = 0.35;

      // Blazing lotus flame-fan on tail tip
      if (i === 6) {
        const tailFanGeo = createFlamePetalGeo(0.56, 0.22, 0.03, 0.12);
        for (let f = -1; f <= 1; f++) {
          const flame = this.addMesh(seg, tailFanGeo, f === 0 ? emberMat : redMat, false);
          flame.position.set(f * 0.05, 0.04, 0.14);
          flame.rotation.x = Math.PI / 2 - 0.12;
          flame.rotation.z = -f * 0.35;
        }
      }

      this.mountGroup.add(seg);
      this.rig.snakeSegments.push(seg);
    }

    // Orbiting Mustika Spirit Pearl Aura around neck/chest
    const pearlHalo = new THREE.Group();
    pearlHalo.position.set(0, 0.25, -0.68);
    const ring = this.addMesh(
      pearlHalo,
      new THREE.TorusGeometry(0.48, 0.014, 6, 28),
      goldMat,
      false
    );
    ring.rotation.x = Math.PI * 0.15;
    const pearl = this.addMesh(pearlHalo, new THREE.SphereGeometry(0.08, 12, 10), pearlMat, false);
    pearl.position.set(0.48, 0, 0);
    this.mountGroup.add(pearlHalo);
    this.rig.haloPivots.push(pearlHalo);

    // Ornate Temple Saddle & Heroic Udeng Bali Rider
    const saddle = this.buildOrnateSaddle(redMat, goldMat, 0.54, 0.48);
    saddle.position.set(0, 0.37, -0.13);
    this.mountGroup.add(saddle);
    const rider = this.buildHeroicRider('udeng', {
      stance: 'riding',
      reinTarget: new THREE.Vector3(0, -0.02, -0.64)
    });
    rider.position.set(0, 0.39, -0.12);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.26, 0.24, 0.12);
    this.wingtipRightAnchor.position.set(1.26, 0.24, 0.12);
    this.cannonLeftAnchor.position.set(-0.55, 0.04, -0.82);
    this.cannonRightAnchor.position.set(0.55, 0.04, -0.82);
    this.thrusterLeftAnchor.position.set(-0.28, -0.05, 0.78);
    this.thrusterRightAnchor.position.set(0.28, -0.05, 0.78);
    this.rig.flameScaleBase = 0.5;
  }

  // 3. KUDA SEMBRANI — Winged Celestial Nusantara Pegasus-Unicorn + Pelangi Rider
  private buildUnicornSembrani(): void {
    const pearlMat = this.makeMat({
      color: 0xf8fafc,
      emissive: 0xe2e8f0,
      emissiveIntensity: 0.12,
      roughness: 0.34,
      metalness: 0.1
    });
    const wingFeatherMat = this.makeFeatherMat(0xffffff, {
      emissive: 0xe0e7ff,
      emissiveIntensity: 0.1,
      roughness: 0.42
    });
    const muzzleMat = this.makeMat({ color: 0xfce7f3, roughness: 0.52 });
    const goldMat = this.makeGoldMat(0.18);
    const hornGlowMat = this.makeMat({
      color: 0xfef08a,
      emissive: 0xff66c4,
      emissiveIntensity: 1.28,
      roughness: 0.22
    });
    const starHaloMat = this.makeMat({
      color: 0xf9a8d4,
      emissive: 0xa855f7,
      emissiveIntensity: 1.15
    });
    const saddleMat = this.makeMat({ color: 0x9333ea, roughness: 0.42 });
    const rainbowCols = [0xff4d6d, 0xff9f1c, 0xfacc15, 0x34d399, 0x38bdf8, 0xa855f7];

    // True Anatomical Equine Torso (broad chest -> tapered waist -> rounded hindquarters)
    const bodyGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.02, -0.62),
        new THREE.Vector3(0, 0.04, -0.28),
        new THREE.Vector3(0, 0.01, 0.12),
        new THREE.Vector3(0, 0.05, 0.48),
        new THREE.Vector3(0, 0.0, 0.74)
      ],
      (u) => {
        if (u < 0.25) return THREE.MathUtils.lerp(0.24, 0.41, u / 0.25);
        if (u < 0.6) return THREE.MathUtils.lerp(0.41, 0.34, (u - 0.25) / 0.35);
        if (u < 0.85) return THREE.MathUtils.lerp(0.34, 0.4, (u - 0.6) / 0.25);
        return THREE.MathUtils.lerp(0.4, 0.16, (u - 0.85) / 0.15);
      },
      { tubularSegments: 22, radialSegments: 16, scaleX: 0.88, scaleY: 1.0 }
    );
    this.addMesh(this.mountGroup, bodyGeo, pearlMat);

    // Graceful S-Curved Arched Equine Neck
    const neckGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.08, -0.46),
        new THREE.Vector3(0, 0.34, -0.68),
        new THREE.Vector3(0, 0.62, -0.78),
        new THREE.Vector3(0, 0.76, -0.84)
      ],
      (u) => THREE.MathUtils.lerp(0.29, 0.17, u),
      { tubularSegments: 16, radialSegments: 14, scaleX: 0.78, scaleY: 1.05 }
    );
    this.addMesh(this.mountGroup, neckGeo, pearlMat);

    // Sculpted Horse Head + Tapered Muzzle + Ears + Siger Diadem + Spiraled Crystal Horn
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.76, -0.86);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    // Sculpted equine cranium-to-muzzle loft (pitched downward gracefully)
    const headGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.06, 0.08),
        new THREE.Vector3(0, 0.03, -0.1),
        new THREE.Vector3(0, -0.07, -0.28),
        new THREE.Vector3(0, -0.16, -0.42)
      ],
      (u) => {
        if (u < 0.4) return THREE.MathUtils.lerp(0.18, 0.21, u / 0.4);
        return THREE.MathUtils.lerp(0.21, 0.105, (u - 0.4) / 0.6);
      },
      { tubularSegments: 14, radialSegments: 12, scaleX: 0.78, scaleY: 1.0 }
    );
    this.addMesh(headPivot, headGeo, pearlMat);

    const muzzleTip = this.addMesh(headPivot, new THREE.SphereGeometry(0.115, 12, 10), muzzleMat);
    muzzleTip.scale.set(0.84, 0.85, 1.15);
    muzzleTip.position.set(0, -0.16, -0.4);

    // Cheekbones & Side Horse Eyes
    this.addMythicalEyes(headPivot, 0.145, 0.05, -0.12, 0xa855f7, 0.95, false, 0xfbbf24);

    // Forward-pricked horse ears + Golden Siger Nusantara Forehead Diadem
    for (const side of [-1, 1] as const) {
      const ear = this.addMesh(headPivot, new THREE.ConeGeometry(0.052, 0.19, 6), pearlMat);
      ear.position.set(side * 0.11, 0.22, 0.04);
      ear.rotation.z = -side * 0.22;
      ear.rotation.x = 0.28;

      const bridle = this.addMesh(
        headPivot,
        new THREE.BoxGeometry(0.018, 0.025, 0.34),
        goldMat,
        false
      );
      bridle.position.set(side * 0.115, -0.05, -0.22);
      bridle.rotation.x = 0.4;
    }

    const siger = this.addMesh(
      headPivot,
      createFlamePetalGeo(0.16, 0.12, 0.025, 0.05),
      goldMat
    );
    siger.position.set(0, 0.17, -0.11);
    siger.rotation.x = 0.35;

    // Helically Spiraled Unicorn Horn + Rotating Starlight Ring
    const hornGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.18, -0.14),
        new THREE.Vector3(0, 0.34, -0.26),
        new THREE.Vector3(0, 0.52, -0.39)
      ],
      (u) => Math.max(0.008, 0.052 * (1 - u * 0.88)),
      { tubularSegments: 20, radialSegments: 12, twistTurns: 2.5, ridgeCount: 4, ridgeAmp: 0.18 }
    );
    this.addMesh(headPivot, hornGeo, hornGlowMat, false);

    const hornRing = buildMythicalHaloGroup(
      this.regGeo,
      starHaloMat,
      goldMat,
      0.16,
      0.012,
      6,
      0.06
    );
    hornRing.position.set(0, 0.36, -0.27);
    hornRing.rotation.x = -0.68;
    headPivot.add(hornRing);
    this.rig.haloPivots.push(hornRing);

    // Flowing Sculpted Rainbow-Gold Mane Locks along arched neck
    const maneLockGeo = createFlamePetalGeo(0.26, 0.11, 0.032, 0.15);
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const mMat = this.makeMat({
        color: rainbowCols[i % rainbowCols.length],
        emissive: rainbowCols[i % rainbowCols.length],
        emissiveIntensity: 0.14,
        roughness: 0.42
      });
      const lock = this.addMesh(this.mountGroup, maneLockGeo, mMat);
      lock.position.set(
        (i % 2 === 0 ? -1 : 1) * 0.03,
        THREE.MathUtils.lerp(0.84, 0.28, t),
        THREE.MathUtils.lerp(-0.8, -0.36, t)
      );
      lock.rotation.x = Math.PI * 0.55;
      lock.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.25;
    }

    // 4 Articulated 2-Segment Galloping Horse Legs + Golden Hooves
    const legSpecs = [
      [-0.21, -0.16, -0.44],
      [0.21, -0.16, -0.44],
      [-0.21, -0.16, 0.48],
      [0.21, -0.16, 0.48]
    ] as const;
    for (const [lx, ly, lz] of legSpecs) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, ly, lz);
      const legGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, -0.2, 0.03),
          new THREE.Vector3(0, -0.38, -0.02)
        ],
        (u) => THREE.MathUtils.lerp(0.088, 0.052, u),
        { tubularSegments: 10, radialSegments: 8 }
      );
      this.addMesh(legPivot, legGeo, pearlMat);
      const fetlock = this.addMesh(legPivot, new THREE.SphereGeometry(0.068, 8, 8), goldMat);
      fetlock.position.set(0, -0.35, -0.01);
      const hoof = this.addMesh(legPivot, new THREE.CylinderGeometry(0.055, 0.072, 0.09, 8), goldMat);
      hoof.position.set(0, -0.42, -0.02);
      this.mountGroup.add(legPivot);
      this.rig.legPivots.push(legPivot);
    }

    // Grand Feathered Pegasus Wings (pearl-white sculpted feathers + rainbow glowing tips)
    const makePegasusWing = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.34, 0.24, -0.16);

      const armGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.44, 0.08, -0.04),
          new THREE.Vector3(side * 0.88, 0.05, 0.08)
        ],
        (u) => THREE.MathUtils.lerp(0.14, 0.07, u),
        { tubularSegments: 12, radialSegments: 8, scaleY: 0.65 }
      );
      this.addMesh(pivot, armGeo, pearlMat);

      for (let i = 0; i < 4; i++) {
        this.addWingFeather(
          pivot,
          side,
          0.95 - i * 0.05,
          0.26,
          0.036,
          0.07,
          0.12,
          side * (0.08 + i * 0.19),
          0.02,
          0.08 + i * 0.03,
          0.32 + i * 0.06,
          0.06,
          wingFeatherMat
        );
      }

      const tipPivot = new THREE.Group();
      tipPivot.position.set(side * 0.8, 0.04, 0.08);
      pivot.add(tipPivot);
      if (side === -1) this.rig.wingTipLeftPivot = tipPivot;
      else this.rig.wingTipRightPivot = tipPivot;

      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const pLen = 1.05 - t * 0.22;
        const yaw = 0.0 + t * 0.64;
        const dihedral = 0.22 - t * 0.14;
        const tipColor = rainbowCols[i % rainbowCols.length];
        const fMat = this.makeFeatherMat(i % 2 === 0 ? 0xffffff : 0xfdf2f8, {
          emissive: tipColor,
          emissiveIntensity: 0.22
        });
        this.addWingFeather(
          tipPivot,
          side,
          pLen,
          0.2,
          0.026,
          0.07,
          0.12,
          0,
          0,
          i * 0.03,
          yaw,
          dihedral,
          fMat
        );
      }
      return pivot;
    };

    const wingL = makePegasusWing(-1);
    const wingR = makePegasusWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 7.6;
    this.rig.wingFlapAmp = 0.34;
    this.rig.wingBaseZ = 0.12;

    // Lush Multi-Strand S-Curved Rainbow Celestial Tail
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.12, 0.68);
    this.mountGroup.add(tailPivot);
    this.rig.tailPivot = tailPivot;
    for (let i = 0; i < 6; i++) {
      const tMat = this.makeMat({
        color: rainbowCols[i],
        emissive: rainbowCols[i],
        emissiveIntensity: 0.22,
        roughness: 0.4
      });
      const xOff = (i - 2.5) * 0.055;
      const strandGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(xOff * 0.4, 0, 0),
          new THREE.Vector3(xOff * 1.1, 0.08 - (i % 2) * 0.05, 0.24),
          new THREE.Vector3(xOff * 1.6, -0.05, 0.56),
          new THREE.Vector3(xOff * 1.2, -0.14, 0.82)
        ],
        (u) => THREE.MathUtils.lerp(0.068, 0.018, u),
        { tubularSegments: 12, radialSegments: 8 }
      );
      this.addMesh(tailPivot, strandGeo, tMat);
    }

    // Ornate Royal Pelana Saddle & Heroic Pelangi Rider
    const saddle = this.buildOrnateSaddle(saddleMat, goldMat, 0.52, 0.5);
    saddle.position.set(0, 0.41, 0.04);
    this.mountGroup.add(saddle);
    const rider = this.buildHeroicRider('pelangi', {
      stance: 'riding',
      reinTarget: new THREE.Vector3(0, 0.12, -0.68)
    });
    rider.position.set(0, 0.43, 0.04);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.82, 0.35, 0.22);
    this.wingtipRightAnchor.position.set(1.82, 0.35, 0.22);
    this.cannonLeftAnchor.position.set(-0.52, 0.14, -0.68);
    this.cannonRightAnchor.position.set(0.52, 0.14, -0.68);
    this.thrusterLeftAnchor.position.set(-0.26, 0.0, 0.86);
    this.thrusterRightAnchor.position.set(0.26, 0.0, 0.86);
    this.rig.flameScaleBase = 0.46;
  }

  // 4. PHINISI TERBANG BUGIS — Authentic Flying Wooden Schooner + Billowing Sails + Songkok Recca Captain
  private buildPhinisiBugis(): void {
    const woodMat = this.makeMat({
      color: 0x92400e,
      map: this.textures.woodPBR.map,
      normalMap: this.textures.woodPBR.normalMap,
      roughnessMap: this.textures.woodPBR.roughnessMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.54,
      metalness: 0.08
    });
    const darkWoodMat = this.makeMat({
      color: 0x451a03,
      map: this.textures.woodPBR.map,
      roughness: 0.62
    });
    const deckMat = this.makeMat({
      color: 0xd97706,
      map: this.textures.woodPBR.map,
      roughness: 0.52
    });
    const sailMat = this.makeMat({
      color: 0xfef3c7,
      roughness: 0.62,
      side: THREE.DoubleSide
    });
    const crimsonSailMat = this.makeMat({
      color: 0xe11d48,
      emissive: 0x9f1239,
      emissiveIntensity: 0.1,
      roughness: 0.55,
      side: THREE.DoubleSide
    });
    const brassMat = this.makeGoldMat(0.16);
    const runeCyanMat = this.makeMat({
      color: 0x38bdf8,
      emissive: 0x00e5ff,
      emissiveIntensity: 1.15,
      roughness: 0.2
    });
    const lanternMat = this.makeMat({
      color: 0xfef08a,
      emissive: 0xffb703,
      emissiveIntensity: 1.4
    });

    // Multi-Station Curved Wooden Phinisi Hull
    this.addMesh(this.mountGroup, createPhinisiHullGeo(), woodMat);

    // Raised Gunwale Rails + Glowing Levitation Waterline Runes
    for (const side of [-1, 1] as const) {
      const railGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0.37, -1.28),
          new THREE.Vector3(side * 0.36, 0.27, -0.7),
          new THREE.Vector3(side * 0.49, 0.24, -0.15),
          new THREE.Vector3(side * 0.44, 0.27, 0.42),
          new THREE.Vector3(side * 0.26, 0.39, 0.96)
        ],
        () => 0.032,
        { tubularSegments: 16, radialSegments: 6 }
      );
      this.addMesh(this.mountGroup, railGeo, darkWoodMat);

      const runeStripeGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(side * 0.18, 0.06, -0.98),
          new THREE.Vector3(side * 0.46, 0.05, -0.2),
          new THREE.Vector3(side * 0.41, 0.09, 0.56),
          new THREE.Vector3(side * 0.24, 0.16, 0.92)
        ],
        () => 0.022,
        { tubularSegments: 14, radialSegments: 6 }
      );
      this.addMesh(this.mountGroup, runeStripeGeo, runeCyanMat, false);
    }

    // Long Soaring Bowsprit (-Z) + Golden Figurehead Crest + Hanging Spirit Lantern
    const bowsprit = this.addMesh(
      this.mountGroup,
      new THREE.CylinderGeometry(0.026, 0.052, 1.18, 8),
      darkWoodMat
    );
    bowsprit.rotation.x = Math.PI / 2 - 0.26;
    bowsprit.position.set(0, 0.42, -1.62);

    const figurehead = this.addMesh(
      this.mountGroup,
      createFlamePetalGeo(0.28, 0.12, 0.05, 0.14),
      brassMat
    );
    figurehead.position.set(0, 0.22, -1.26);
    figurehead.rotation.x = -0.75;

    const lanternPivot = new THREE.Group();
    lanternPivot.position.set(0, 0.56, -2.14);
    this.mountGroup.add(lanternPivot);
    this.rig.lanternPivot = lanternPivot;
    const lanternCap = this.addMesh(
      lanternPivot,
      new THREE.ConeGeometry(0.08, 0.08, 6),
      brassMat,
      false
    );
    lanternCap.position.y = -0.08;
    const lantern = this.addMesh(
      lanternPivot,
      new THREE.OctahedronGeometry(0.088, 0),
      lanternMat,
      false
    );
    lantern.position.y = -0.17;

    // Raised Ornate Stern Poop-Cabin with Glowing Golden Cabin Windows + Helm Wheel
    const cabin = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.66, 0.26, 0.46), darkWoodMat);
    cabin.position.set(0, 0.42, 0.68);
    const cabinRoof = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.72, 0.05, 0.5), deckMat);
    cabinRoof.position.set(0, 0.56, 0.68);

    for (let w = -1; w <= 1; w++) {
      const win = this.addMesh(
        this.mountGroup,
        new THREE.BoxGeometry(0.11, 0.1, 0.03),
        lanternMat,
        false
      );
      win.position.set(w * 0.18, 0.43, 0.92);
    }

    const helmStand = this.addMesh(
      this.mountGroup,
      new THREE.BoxGeometry(0.08, 0.38, 0.08),
      darkWoodMat
    );
    helmStand.position.set(0, 0.43, -0.22);
    const helmWheel = this.addMesh(
      this.mountGroup,
      new THREE.TorusGeometry(0.115, 0.018, 6, 12),
      brassMat
    );
    helmWheel.position.set(0, 0.62, -0.25);

    // Authentic Phinisi Schooner Rig: Tall Mainmast + Shorter Mizzenmast + Gaffs + Billowing Sails
    const mainMast = this.addMesh(
      this.mountGroup,
      new THREE.CylinderGeometry(0.03, 0.048, 1.48, 8),
      darkWoodMat
    );
    mainMast.position.set(0, 0.96, -0.58);
    mainMast.rotation.x = 0.05;

    const mizzenMast = this.addMesh(
      this.mountGroup,
      new THREE.CylinderGeometry(0.025, 0.04, 1.15, 8),
      darkWoodMat
    );
    mizzenMast.position.set(0, 0.82, 0.48);
    mizzenMast.rotation.x = 0.08;

    // Main Gaff Sail (cream-gold, slanted gaff top, curved wind belly)
    const mainGaffSail = this.addMesh(
      this.mountGroup,
      createBillowingSailGeo(0.84, 0.62, 0.72, 0.2, 0.18, false),
      sailMat
    );
    mainGaffSail.position.set(0, 0.52, -0.61);
    this.rig.sailMeshes.push(mainGaffSail);

    // Triangular Main Topsail above main gaff
    const mainTopsail = this.addMesh(
      this.mountGroup,
      createBillowingSailGeo(0.56, 0.02, 0.42, 0.11, 0, true),
      sailMat
    );
    mainTopsail.position.set(0, 1.24, -0.6);
    this.rig.sailMeshes.push(mainTopsail);

    // Mizzen Gaff Sail (royal crimson-gold)
    const mizzenSail = this.addMesh(
      this.mountGroup,
      createBillowingSailGeo(0.68, 0.5, 0.56, 0.16, 0.14, false),
      crimsonSailMat
    );
    mizzenSail.position.set(0, 0.58, 0.45);
    this.rig.sailMeshes.push(mizzenSail);

    // Twin Triangular Foresails / Jibs stretched along bowsprit stay (-Z)
    for (let j = 0; j < 2; j++) {
      const jib = this.addMesh(
        this.mountGroup,
        createBillowingSailGeo(0.46 - j * 0.1, 0.02, 0.58 - j * 0.08, 0.12, 0, true),
        j === 0 ? sailMat : crimsonSailMat
      );
      jib.rotation.y = Math.PI / 2;
      jib.rotation.z = -0.36;
      jib.position.set(0, 0.56 + j * 0.06, -1.04 - j * 0.36);
      this.rig.sailMeshes.push(jib);
    }

    // Merah-Putih Pennant atop Mainmast
    const flagRed = this.addMesh(
      this.mountGroup,
      new THREE.BoxGeometry(0.025, 0.075, 0.22),
      crimsonSailMat
    );
    flagRed.position.set(0, 1.72, -0.45);
    const flagWhite = this.addMesh(
      this.mountGroup,
      new THREE.BoxGeometry(0.025, 0.075, 0.22),
      sailMat
    );
    flagWhite.position.set(0, 1.645, -0.45);

    // Gilded Sky-Outrigger Wind-Vanes + Brass Nacelles + 4-Blade Spinning Propellers
    for (const side of [-1, 1] as const) {
      const vaneGeo = createFeatherGeo(0.92, 0.34, 0.065, 0.06, side * 0.1);
      const vane = this.addMesh(this.mountGroup, vaneGeo, woodMat);
      vane.position.set(side * 0.36, 0.08, 0.02);
      vane.rotation.y = side === 1 ? -0.18 : Math.PI + 0.18;

      const runeStrip = this.addMesh(
        this.mountGroup,
        new THREE.BoxGeometry(0.68, 0.025, 0.05),
        runeCyanMat,
        false
      );
      runeStrip.position.set(side * 0.72, 0.11, -0.02);
      runeStrip.rotation.y = -side * 0.18;

      const nac = this.addMesh(
        this.mountGroup,
        new THREE.CylinderGeometry(0.11, 0.125, 0.48, 10),
        brassMat
      );
      nac.rotation.x = Math.PI / 2;
      nac.position.set(side * 1.16, 0.09, 0.06);

      const propHub = new THREE.Group();
      propHub.position.set(side * 1.16, 0.09, -0.2);
      this.mountGroup.add(propHub);
      this.rig.propellers.push(propHub);

      for (let b = 0; b < 2; b++) {
        const blade = this.addMesh(propHub, new THREE.BoxGeometry(0.46, 0.055, 0.02), brassMat);
        blade.rotation.z = (b * Math.PI) / 2;
      }
    }

    // Subtle Celestial Wind-Compass Ring underneath the Keel
    const keelHalo = buildMythicalHaloGroup(
      this.regGeo,
      runeCyanMat,
      brassMat,
      0.72,
      0.016,
      8,
      0.1
    );
    keelHalo.rotation.x = Math.PI / 2;
    keelHalo.position.set(0, -0.32, -0.05);
    this.mountGroup.add(keelHalo);
    this.rig.haloPivots.push(keelHalo);

    // Songkok Recca Captain Rider standing at the Helm (between masts)
    const rider = this.buildHeroicRider('songkok_recca', { stance: 'captain' });
    rider.position.set(0, 0.24, -0.02);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.38, 0.14, 0.1);
    this.wingtipRightAnchor.position.set(1.38, 0.14, 0.1);
    this.cannonLeftAnchor.position.set(-0.56, 0.18, -0.82);
    this.cannonRightAnchor.position.set(0.56, 0.18, -0.82);
    this.thrusterLeftAnchor.position.set(-0.28, 0.12, 0.98);
    this.thrusterRightAnchor.position.set(0.28, 0.12, 0.98);
    this.rig.flameScaleBase = 0.62;
  }

  // 5. CENDERAWASIH PAPUA — Bird of Paradise with Cascading Flank Plumes & Wire Racket Tail
  private buildCenderawasihPapua(): void {
    const chestnutMat = this.makeFeatherMat(0xb91c1c, {
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.1,
      roughness: 0.48
    });
    const yellowCrownMat = this.makeFeatherMat(0xfacc15, {
      emissive: 0xca8a04,
      emissiveIntensity: 0.12,
      roughness: 0.42
    });
    const emeraldMat = this.makeFeatherMat(0x10b981, {
      emissive: 0x059669,
      emissiveIntensity: 0.18,
      roughness: 0.32,
      metalness: 0.32
    });
    const plumeGoldMat = this.makeMat({
      color: 0xfde047,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.28,
      roughness: 0.42,
      side: THREE.DoubleSide
    });
    const plumeOrangeMat = this.makeMat({
      color: 0xfb923c,
      emissive: 0xea580c,
      emissiveIntensity: 0.24,
      roughness: 0.44,
      side: THREE.DoubleSide
    });
    const plumeCreamMat = this.makeMat({
      color: 0xfef9c3,
      emissive: 0xfde047,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      side: THREE.DoubleSide
    });
    const beakBlueMat = this.makeMat({ color: 0x38bdf8, roughness: 0.28, metalness: 0.2 });
    const racketGlowMat = this.makeMat({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 1.15,
      roughness: 0.25
    });

    // Sleek Sculpted Avian Body + Iridescent Emerald Throat Shield
    const bodyGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.02, -0.72),
        new THREE.Vector3(0, 0.03, -0.3),
        new THREE.Vector3(0, 0.01, 0.22),
        new THREE.Vector3(0, 0.04, 0.74)
      ],
      (u) => {
        if (u < 0.32) return 0.19 + Math.sin((u / 0.32) * (Math.PI * 0.5)) * 0.28;
        return 0.47 * (1 - ((u - 0.32) / 0.68) * 0.7);
      },
      { tubularSegments: 20, radialSegments: 16, scaleX: 0.94, scaleY: 0.92 }
    );
    this.addMesh(this.mountGroup, bodyGeo, chestnutMat);

    const breastGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.1, -0.74),
        new THREE.Vector3(0, -0.11, -0.4),
        new THREE.Vector3(0, -0.14, 0.02)
      ],
      (u) => 0.14 + Math.sin(u * Math.PI) * 0.26,
      { tubularSegments: 12, radialSegments: 12, scaleX: 0.92, scaleY: 0.75 }
    );
    this.addMesh(this.mountGroup, breastGeo, emeraldMat);

    // Slender Arched Golden-Emerald Neck
    const neckGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.05, -0.58),
        new THREE.Vector3(0, 0.24, -0.74),
        new THREE.Vector3(0, 0.42, -0.84)
      ],
      (u) => THREE.MathUtils.lerp(0.28, 0.19, u),
      { tubularSegments: 12, radialSegments: 12, scaleX: 0.92, scaleY: 1.0 }
    );
    this.addMesh(this.mountGroup, neckGeo, yellowCrownMat);

    // Head + Gracefully Decurved Sky-Blue Beak + 3-Plume Crown Crest
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.44, -0.86);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    const skull = this.addMesh(headPivot, new THREE.SphereGeometry(0.25, 16, 12), yellowCrownMat);
    skull.scale.set(0.95, 0.96, 1.12);
    this.addMythicalEyes(headPivot, 0.145, 0.04, -0.14, 0x10b981, 1.0, false, 0x059669);

    const upperBeakGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.01, -0.22),
        new THREE.Vector3(0, -0.01, -0.38),
        new THREE.Vector3(0, -0.06, -0.52)
      ],
      (u) => Math.max(0.01, 0.068 * (1 - u * 0.85)),
      { tubularSegments: 10, radialSegments: 8, scaleX: 0.78, scaleY: 0.9 }
    );
    this.addMesh(headPivot, upperBeakGeo, beakBlueMat);

    const lowerBeakGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.04, -0.21),
        new THREE.Vector3(0, -0.055, -0.36),
        new THREE.Vector3(0, -0.075, -0.47)
      ],
      (u) => Math.max(0.008, 0.048 * (1 - u * 0.82)),
      { tubularSegments: 8, radialSegments: 6, scaleX: 0.75, scaleY: 0.7 }
    );
    this.addMesh(headPivot, lowerBeakGeo, beakBlueMat);

    const crownCrestGeo = createFeatherGeo(0.32, 0.08, 0.022, 0.04, 0.05);
    for (let i = -1; i <= 1; i++) {
      const cf = this.addMesh(headPivot, crownCrestGeo, i === 0 ? emeraldMat : plumeGoldMat);
      cf.position.set(i * 0.04, 0.21, 0.04);
      cf.rotation.y = -Math.PI / 2 + i * 0.22;
      cf.rotation.z = 0.55;
    }

    // Layered Tropical Emerald-Chestnut-Gold Wings
    const makeParadiseWing = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.36, 0.16, -0.14);

      const armGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.45, 0.06, -0.03),
          new THREE.Vector3(side * 0.86, 0.03, 0.08)
        ],
        (u) => THREE.MathUtils.lerp(0.14, 0.07, u),
        { tubularSegments: 10, radialSegments: 8, scaleY: 0.62 }
      );
      this.addMesh(pivot, armGeo, emeraldMat);

      for (let i = 0; i < 4; i++) {
        this.addWingFeather(
          pivot,
          side,
          0.95 - i * 0.05,
          0.26,
          0.034,
          0.06,
          0.12,
          side * (0.08 + i * 0.18),
          0.01,
          0.06 + i * 0.03,
          0.32 + i * 0.05,
          0.05,
          i % 2 === 0 ? emeraldMat : chestnutMat
        );
      }

      const tipPivot = new THREE.Group();
      tipPivot.position.set(side * 0.8, 0.03, 0.08);
      pivot.add(tipPivot);
      if (side === -1) this.rig.wingTipLeftPivot = tipPivot;
      else this.rig.wingTipRightPivot = tipPivot;

      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        this.addWingFeather(
          tipPivot,
          side,
          0.96 - t * 0.2,
          0.19,
          0.024,
          0.06,
          0.1,
          0,
          0,
          i * 0.03,
          0.04 + t * 0.62,
          0.18 - t * 0.1,
          i % 2 === 0 ? yellowCrownMat : emeraldMat
        );
      }
      return pivot;
    };

    const wingL = makeParadiseWing(-1);
    const wingR = makeParadiseWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 8.2;
    this.rig.wingFlapAmp = 0.34;
    this.rig.wingBaseZ = 0.1;

    // Iconic Cascading Silky Flank Plumes (5 arching plumes per flank spraying out & back!)
    const plumeMats = [plumeOrangeMat, plumeGoldMat, plumeCreamMat, plumeGoldMat, plumeOrangeMat];
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 5; i++) {
        const plumePivot = new THREE.Group();
        plumePivot.position.set(side * 0.32, 0.02 + (i - 2) * 0.035, 0.24 + i * 0.04);
        this.mountGroup.add(plumePivot);

        const len = 1.25 + (i % 3) * 0.22;
        const plumeGeo = createFlamePetalGeo(len, 0.14, 0.02, 0.34);
        const plume = this.addMesh(plumePivot, plumeGeo, plumeMats[i], false);
        plume.rotation.x = Math.PI / 2 - 0.12 - (i - 2) * 0.05;
        plume.rotation.z = -side * (0.28 + i * 0.09);

        if (side === -1) this.rig.plumePivotsL.push(plumePivot);
        else this.rig.plumePivotsR.push(plumePivot);
      }
    }

    // Iconic Twin Long Articulated Tail-Wires terminating in Curled Emerald Racket Tips
    for (const side of [-1, 1] as const) {
      let parent: THREE.Object3D = this.mountGroup;
      for (let i = 0; i < 5; i++) {
        const seg = new THREE.Group();
        seg.position.set(
          i === 0 ? side * 0.16 : side * 0.025,
          i === 0 ? 0.05 : -0.01,
          i === 0 ? 0.72 : 0.34
        );
        const wire = this.addMesh(
          seg,
          new THREE.CylinderGeometry(0.012, 0.015, 0.36, 6),
          emeraldMat,
          false
        );
        wire.rotation.x = Math.PI / 2;
        wire.position.z = 0.18;

        if (i === 4) {
          const racket = this.addMesh(
            seg,
            createFlamePetalGeo(0.24, 0.15, 0.024, 0.1),
            racketGlowMat,
            false
          );
          racket.rotation.x = Math.PI / 2 + 0.15;
          racket.rotation.z = -side * 0.35;
          racket.position.set(side * 0.02, 0, 0.34);
        }

        parent.add(seg);
        if (side === -1) this.rig.ribbonSegmentsL.push(seg);
        else this.rig.ribbonSegmentsR.push(seg);
        parent = seg;
      }
    }

    // Delicate Golden Paradise Halo behind rider
    const paradiseHalo = buildMythicalHaloGroup(
      this.regGeo,
      plumeCreamMat,
      plumeGoldMat,
      0.62,
      0.018,
      10,
      0.13
    );
    paradiseHalo.position.set(0, 0.82, 0.36);
    this.mountGroup.add(paradiseHalo);
    this.rig.haloPivots.push(paradiseHalo);

    // Ornate Saddle & Heroic Mahkota Papua Rider
    const saddle = this.buildOrnateSaddle(emeraldMat, plumeGoldMat, 0.52, 0.48);
    saddle.position.set(0, 0.39, 0.02);
    this.mountGroup.add(saddle);
    const rider = this.buildHeroicRider('mahkota_papua', {
      stance: 'riding',
      reinTarget: new THREE.Vector3(0, -0.06, -0.66)
    });
    rider.position.set(0, 0.41, 0.03);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.78, 0.25, 0.3);
    this.wingtipRightAnchor.position.set(1.78, 0.25, 0.3);
    this.cannonLeftAnchor.position.set(-0.55, 0.06, -0.62);
    this.cannonRightAnchor.position.set(0.55, 0.06, -0.62);
    this.thrusterLeftAnchor.position.set(-0.24, -0.05, 0.85);
    this.thrusterRightAnchor.position.set(0.24, -0.05, 0.85);
    this.rig.flameScaleBase = 0.45;
  }

  // 6. ENGGANG DAYAK — Sacred Kalimantan Rhinoceros Hornbill + Upward-Curling Casque + Topi Dayak Rider
  private buildEnggangDayak(): void {
    const blackMat = this.makeFeatherMat(0x111827, {
      roughness: 0.44,
      metalness: 0.22
    });
    const whiteMat = this.makeFeatherMat(0xf8fafc, {
      roughness: 0.46,
      metalness: 0.06
    });
    const orangeBeakMat = this.makeMat({
      color: 0xff6b00,
      emissive: 0xd9480f,
      emissiveIntensity: 0.12,
      roughness: 0.32,
      metalness: 0.14
    });
    const beakTipGoldMat = this.makeMat({
      color: 0xfde047,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.28,
      roughness: 0.32
    });
    const redCasqueMat = this.makeMat({
      color: 0xdc2626,
      emissive: 0x991b1b,
      emissiveIntensity: 0.15,
      roughness: 0.32,
      metalness: 0.15
    });
    const goldMat = this.makeGoldMat(0.18);
    const sunHaloMat = this.makeMat({
      color: 0xfef08a,
      emissive: 0xff7b00,
      emissiveIntensity: 1.15
    });

    // Sleek Sculpted Obsidian Hornbill Torso + Arched Ivory Neck
    const bodyGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.02, -0.74),
        new THREE.Vector3(0, 0.03, -0.32),
        new THREE.Vector3(0, 0.02, 0.24),
        new THREE.Vector3(0, 0.04, 0.82)
      ],
      (u) => {
        if (u < 0.35) return 0.21 + Math.sin((u / 0.35) * (Math.PI * 0.5)) * 0.31;
        return 0.52 * (1 - ((u - 0.35) / 0.65) * 0.68);
      },
      { tubularSegments: 20, radialSegments: 16, scaleX: 0.94, scaleY: 0.9 }
    );
    this.addMesh(this.mountGroup, bodyGeo, blackMat);

    // Ceremonial Dayak Red-Gold Collar at Neck Base
    const collar = this.addMesh(
      this.mountGroup,
      new THREE.TorusGeometry(0.32, 0.048, 8, 18),
      redCasqueMat
    );
    collar.rotation.x = Math.PI / 2 - 0.35;
    collar.position.set(0, 0.12, -0.58);
    const collarTrim = this.addMesh(
      this.mountGroup,
      new THREE.TorusGeometry(0.33, 0.02, 6, 18),
      goldMat
    );
    collarTrim.rotation.x = Math.PI / 2 - 0.35;
    collarTrim.position.set(0, 0.1, -0.6);

    const neckGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.08, -0.56),
        new THREE.Vector3(0, 0.28, -0.74),
        new THREE.Vector3(0, 0.48, -0.84)
      ],
      (u) => THREE.MathUtils.lerp(0.3, 0.21, u),
      { tubularSegments: 12, radialSegments: 12, scaleX: 0.92, scaleY: 1.0 }
    );
    this.addMesh(this.mountGroup, neckGeo, whiteMat);

    // Hornbill Head + Massive Curved Scimitar Beak + Iconic Upward-Curling Rhinoceros Casque!
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.5, -0.86);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    const skull = this.addMesh(headPivot, new THREE.SphereGeometry(0.26, 16, 12), blackMat);
    skull.scale.set(0.92, 0.94, 1.12);
    this.addMythicalEyes(headPivot, 0.155, 0.04, -0.14, 0xff4500, 1.05, true, 0xfacc15);

    // Massive Curved Scimitar Upper Beak
    const upperBeakGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.02, -0.2),
        new THREE.Vector3(0, 0.02, -0.46),
        new THREE.Vector3(0, -0.04, -0.72),
        new THREE.Vector3(0, -0.14, -0.92)
      ],
      (u) => {
        if (u < 0.25) return THREE.MathUtils.lerp(0.145, 0.13, u / 0.25);
        return Math.max(0.012, 0.13 * (1 - ((u - 0.25) / 0.75) * 0.9));
      },
      { tubularSegments: 18, radialSegments: 10, scaleX: 0.64, scaleY: 1.0 }
    );
    this.addMesh(headPivot, upperBeakGeo, orangeBeakMat);

    // Luminous ivory-gold beak tip
    const beakTip = this.addMesh(headPivot, new THREE.SphereGeometry(0.036, 8, 8), beakTipGoldMat);
    beakTip.scale.set(0.7, 0.8, 1.6);
    beakTip.position.set(0, -0.13, -0.9);

    // Curved Lower Mandible
    const lowerBeakGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, -0.07, -0.18),
        new THREE.Vector3(0, -0.09, -0.44),
        new THREE.Vector3(0, -0.12, -0.68),
        new THREE.Vector3(0, -0.15, -0.84)
      ],
      (u) => Math.max(0.01, 0.105 * (1 - u * 0.88)),
      { tubularSegments: 14, radialSegments: 8, scaleX: 0.62, scaleY: 0.68 }
    );
    this.addMesh(headPivot, lowerBeakGeo, orangeBeakMat);

    // Iconic Upward-Curling Crimson-Gold Rhinoceros Hornbill Casque (Cula Rangkong)
    const casqueGeo = createTaperedLoftGeo(
      [
        new THREE.Vector3(0, 0.13, -0.14),
        new THREE.Vector3(0, 0.17, -0.38),
        new THREE.Vector3(0, 0.23, -0.58),
        new THREE.Vector3(0, 0.36, -0.66),
        new THREE.Vector3(0, 0.44, -0.56)
      ],
      (u) => {
        if (u < 0.5) return THREE.MathUtils.lerp(0.095, 0.088, u / 0.5);
        return Math.max(0.014, 0.088 * (1 - (u - 0.5) * 1.6));
      },
      { tubularSegments: 18, radialSegments: 10, scaleX: 0.72, scaleY: 1.05 }
    );
    this.addMesh(headPivot, casqueGeo, redCasqueMat);

    const casqueScroll = this.addMesh(
      headPivot,
      new THREE.SphereGeometry(0.042, 8, 8),
      goldMat,
      false
    );
    casqueScroll.position.set(0, 0.42, -0.57);

    // Broad Powerful Sculpted Hornbill Wings (obsidian coverts + snow-white band + 7 black-white primaries)
    const makeHornbillWing = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.4, 0.16, -0.16);

      const armGeo = createTaperedLoftGeo(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.5, 0.07, -0.05),
          new THREE.Vector3(side * 1.0, 0.04, 0.08)
        ],
        (u) => THREE.MathUtils.lerp(0.16, 0.08, u),
        { tubularSegments: 12, radialSegments: 8, scaleY: 0.65 }
      );
      this.addMesh(pivot, armGeo, goldMat);

      // Black upper coverts
      for (let i = 0; i < 4; i++) {
        this.addWingFeather(
          pivot,
          side,
          0.95 - i * 0.05,
          0.3,
          0.038,
          0.06,
          0.1,
          side * (0.08 + i * 0.2),
          0.02,
          0.05 + i * 0.03,
          0.28 + i * 0.05,
          0.05,
          blackMat
        );
      }

      // Bold Snow-White Trailing Secondary Band
      for (let i = 0; i < 5; i++) {
        this.addWingFeather(
          pivot,
          side,
          1.16 - i * 0.04,
          0.28,
          0.032,
          0.05,
          0.14,
          side * (0.08 + i * 0.19),
          -0.01,
          0.18 + i * 0.035,
          0.42 + i * 0.05,
          0.02,
          whiteMat
        );
      }

      // 7 Long Splayed Upturned Primary Finger-Feathers
      const tipPivot = new THREE.Group();
      tipPivot.position.set(side * 0.92, 0.03, 0.08);
      pivot.add(tipPivot);
      if (side === -1) this.rig.wingTipLeftPivot = tipPivot;
      else this.rig.wingTipRightPivot = tipPivot;

      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const pLen = 1.15 - t * 0.22;
        const yaw = -0.04 + t * 0.68;
        const dihedral = 0.24 - t * 0.14;
        this.addWingFeather(
          tipPivot,
          side,
          pLen,
          0.21,
          0.026,
          0.06,
          0.12,
          0,
          0,
          i * 0.032,
          yaw,
          dihedral,
          i % 2 === 0 ? blackMat : whiteMat
        );
      }

      return pivot;
    };

    const wingL = makeHornbillWing(-1);
    const wingR = makeHornbillWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 6.9;
    this.rig.wingFlapAmp = 0.32;
    this.rig.wingBaseZ = 0.09;

    // Iconic 7-Feather Fanned White Tail with Bold Obsidian-Black Crossbar
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.05, 0.78);
    this.mountGroup.add(tailPivot);
    this.rig.tailPivot = tailPivot;
    const tailFeatherGeo = createFeatherGeo(0.84, 0.2, 0.03, 0.04, 0.02);
    for (let i = -3; i <= 3; i++) {
      const tf = this.addMesh(tailPivot, tailFeatherGeo, whiteMat);
      tf.rotation.y = -Math.PI / 2 + i * 0.16;
      tf.position.set(i * 0.045, Math.abs(i) * 0.006, 0);
    }
    const blackBar = this.addMesh(
      tailPivot,
      new THREE.BoxGeometry(0.76, 0.042, 0.18),
      blackMat
    );
    blackBar.position.set(0, 0.03, 0.44);

    // Dayak Sacred Sun Halo behind rider
    const sunHalo = buildMythicalHaloGroup(
      this.regGeo,
      sunHaloMat,
      redCasqueMat,
      0.66,
      0.02,
      10,
      0.15
    );
    sunHalo.position.set(0, 0.84, 0.38);
    this.mountGroup.add(sunHalo);
    this.rig.haloPivots.push(sunHalo);

    // Ornate Saddle & Heroic Topi Dayak Rider
    const saddle = this.buildOrnateSaddle(redCasqueMat, goldMat, 0.54, 0.48);
    saddle.position.set(0, 0.41, 0.04);
    this.mountGroup.add(saddle);
    const rider = this.buildHeroicRider('topi_dayak', {
      stance: 'riding',
      reinTarget: new THREE.Vector3(0, -0.08, -0.64)
    });
    rider.position.set(0, 0.43, 0.05);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-2.08, 0.28, 0.32);
    this.wingtipRightAnchor.position.set(2.08, 0.28, 0.32);
    this.cannonLeftAnchor.position.set(-0.62, 0.04, -0.68);
    this.cannonRightAnchor.position.set(0.62, 0.04, -0.68);
    this.thrusterLeftAnchor.position.set(-0.28, -0.05, 0.88);
    this.thrusterRightAnchor.position.set(0.28, -0.05, 0.88);
    this.rig.flameScaleBase = 0.48;
  }
}
