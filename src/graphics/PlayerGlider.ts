import * as THREE from 'three';
import { getAviatorSpec, getWingSpec } from '../data/catalog';
import type { AviatorId, WingId } from '../types/game';
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
  wingFlapSpeed: number;
  wingFlapAmp: number;
  wingBaseZ: number;
  tailPivot?: THREE.Object3D;
  headPivot?: THREE.Object3D;
  lanternPivot?: THREE.Object3D;
  snakeSegments: THREE.Object3D[];
  ribbonSegmentsL: THREE.Object3D[];
  ribbonSegmentsR: THREE.Object3D[];
  legPivots: THREE.Object3D[];
  propellers: THREE.Object3D[];
  sailMeshes: THREE.Object3D[];
  riderScarfSegments: THREE.Object3D[];
  flameScaleBase: number;
}

export class PlayerGlider {
  readonly root = new THREE.Group();
  readonly visualPivot = new THREE.Group();

  // Shared rider & facial materials (never disposed on mount swap)
  private readonly riderOutfitMat: THREE.MeshStandardMaterial;
  private readonly riderScarfMat: THREE.MeshStandardMaterial;
  private readonly riderHatAccentMat: THREE.MeshStandardMaterial;
  private readonly skinMat: THREE.MeshStandardMaterial;
  private readonly hairMat: THREE.MeshStandardMaterial;
  private readonly eyeWhiteMat: THREE.MeshBasicMaterial;
  private readonly eyePupilMat: THREE.MeshStandardMaterial;
  private readonly blushMat: THREE.MeshStandardMaterial;

  // Per-mount container & disposal tracking
  private readonly mountGroup = new THREE.Group();
  private mountGeos: THREE.BufferGeometry[] = [];
  private mountMats: THREE.Material[] = [];

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

    // Shared rider materials
    this.riderOutfitMat = new THREE.MeshStandardMaterial({
      color: 0xe11d48,
      roughness: 0.55,
      metalness: 0.08
    });
    this.riderScarfMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.5,
      metalness: 0.06
    });
    this.riderHatAccentMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.38,
      metalness: 0.25
    });
    this.skinMat = new THREE.MeshStandardMaterial({
      color: 0xd99b66,
      roughness: 0.65,
      metalness: 0.04
    });
    this.hairMat = new THREE.MeshStandardMaterial({
      color: 0x1e1b18,
      roughness: 0.7,
      metalness: 0.05
    });
    this.eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.eyePupilMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.15,
      metalness: 0.1
    });
    this.blushMat = new THREE.MeshStandardMaterial({
      color: 0xff7b9c,
      emissive: 0xff4d79,
      emissiveIntensity: 0.2,
      roughness: 0.6,
      metalness: 0.02
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
      snakeSegments: [],
      ribbonSegmentsL: [],
      ribbonSegmentsR: [],
      legPivots: [],
      propellers: [],
      sailMeshes: [],
      riderScarfSegments: [],
      flameScaleBase: 0.55
    };
  }

  private makeMat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.12,
      ...params
    });
    this.mountMats.push(mat);
    return mat;
  }

  private addMesh(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    castShadow = true
  ): THREE.Mesh {
    this.mountGeos.push(geo);
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
    this.mountGeos = [];
    this.mountMats = [];
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
    }

    if (this.rig.tailPivot) {
      this.rig.tailPivot.rotation.x = Math.sin(this.elapsed * 5.5) * 0.14 + 0.08;
      this.rig.tailPivot.rotation.y = Math.cos(this.elapsed * 3.8) * 0.08;
    }

    if (this.rig.headPivot) {
      this.rig.headPivot.rotation.x = Math.sin(this.elapsed * 3.4) * 0.06;
    }

    if (this.rig.lanternPivot) {
      this.rig.lanternPivot.rotation.z = Math.sin(this.elapsed * 4.2) * 0.18;
      this.rig.lanternPivot.rotation.x = Math.cos(this.elapsed * 3.1) * 0.12 + 0.12;
    }

    // Naga Barong undulating body wave
    for (let i = 0; i < this.rig.snakeSegments.length; i++) {
      const seg = this.rig.snakeSegments[i];
      const phase = this.elapsed * (hot ? 9.0 : 6.2) - i * 0.72;
      seg.position.x = Math.sin(phase) * (0.055 + i * 0.032);
      seg.position.y = -0.02 + Math.cos(phase * 0.85) * (0.035 + i * 0.016);
      seg.rotation.y = Math.cos(phase) * 0.18;
    }

    // Cenderawasih trailing ribbons
    for (let i = 0; i < this.rig.ribbonSegmentsL.length; i++) {
      const wave = Math.sin(this.elapsed * 7.5 - i * 0.85);
      const lift = Math.cos(this.elapsed * 5.2 - i * 0.65);
      this.rig.ribbonSegmentsL[i].rotation.y = wave * 0.24;
      this.rig.ribbonSegmentsL[i].rotation.x = lift * 0.14;
      this.rig.ribbonSegmentsR[i].rotation.y = -wave * 0.24;
      this.rig.ribbonSegmentsR[i].rotation.x = -lift * 0.14;
    }

    // Kuda Sembrani sky gallop
    for (let i = 0; i < this.rig.legPivots.length; i++) {
      const isFront = i < 2;
      const sideOffset = i % 2 === 0 ? 0 : 0.45;
      const phase = this.elapsed * (hot ? 12 : 8.5) + (isFront ? 0 : Math.PI) + sideOffset;
      this.rig.legPivots[i].rotation.x = Math.sin(phase) * 0.42 - 0.18;
    }

    // Phinisi spinning brass propellers & billowing sails
    for (const prop of this.rig.propellers) {
      prop.rotation.z += dt * (hot ? 30 : 18);
    }
    for (let i = 0; i < this.rig.sailMeshes.length; i++) {
      const puff = 1 + Math.sin(this.elapsed * 4.5 + i * 1.1) * 0.045;
      this.rig.sailMeshes[i].scale.z = puff;
    }

    // Rider fluttering scarf
    for (let i = 0; i < this.rig.riderScarfSegments.length; i++) {
      const seg = this.rig.riderScarfSegments[i];
      seg.rotation.x = Math.sin(this.elapsed * (hot ? 16 : 10) - i * 0.9) * 0.22 + 0.15;
      seg.rotation.y = Math.cos(this.elapsed * 8 - i * 0.7) * 0.16;
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

  private addCuteEyes(parent: THREE.Object3D, x: number, y: number, z: number, scale = 1): void {
    for (const side of [-1, 1] as const) {
      const white = this.addMesh(
        parent,
        new THREE.SphereGeometry(0.068 * scale, 10, 8),
        this.eyeWhiteMat,
        false
      );
      white.position.set(side * x, y, z);
      white.scale.set(0.9, 1.08, 0.72);

      const pupil = this.addMesh(
        parent,
        new THREE.SphereGeometry(0.044 * scale, 10, 8),
        this.eyePupilMat,
        false
      );
      pupil.position.set(side * (x + 0.008 * scale), y, z - 0.028 * scale);

      const glint = this.addMesh(
        parent,
        new THREE.SphereGeometry(0.017 * scale, 6, 6),
        this.eyeWhiteMat,
        false
      );
      glint.position.set(side * (x + 0.018 * scale), y + 0.02 * scale, z - 0.056 * scale);

      const blush = this.addMesh(
        parent,
        new THREE.SphereGeometry(0.052 * scale, 8, 8),
        this.blushMat,
        false
      );
      blush.scale.set(1.2, 0.65, 0.55);
      blush.position.set(side * (x + 0.04 * scale), y - 0.065 * scale, z + 0.025 * scale);
    }
  }

  private buildCuteRider(headgear: HeadgearStyle): THREE.Group {
    const rider = new THREE.Group();

    // Chubby torso
    const torsoGeo = new THREE.CapsuleGeometry(0.15, 0.18, 6, 12);
    const torso = this.addMesh(rider, torsoGeo, this.riderOutfitMat);
    torso.position.set(0, 0.22, 0);
    torso.rotation.x = 0.16;

    // Gold waist sash
    const sash = this.addMesh(
      rider,
      new THREE.CylinderGeometry(0.16, 0.165, 0.06, 12),
      this.riderHatAccentMat
    );
    sash.position.set(0, 0.13, 0.01);

    // Legs hugging mount sides + boots
    const bootMat = this.makeMat({ color: 0x3b2314, roughness: 0.75 });
    for (const side of [-1, 1] as const) {
      const leg = this.addMesh(
        rider,
        new THREE.CapsuleGeometry(0.06, 0.16, 4, 8),
        this.riderOutfitMat
      );
      leg.position.set(side * 0.17, 0.04, -0.02);
      leg.rotation.z = side * 0.42;
      leg.rotation.x = -0.35;

      const boot = this.addMesh(rider, new THREE.SphereGeometry(0.068, 8, 8), bootMat);
      boot.scale.set(0.9, 0.85, 1.3);
      boot.position.set(side * 0.24, -0.05, -0.08);

      // Arms reaching forward
      const arm = this.addMesh(
        rider,
        new THREE.CapsuleGeometry(0.048, 0.16, 4, 8),
        this.riderOutfitMat
      );
      arm.position.set(side * 0.17, 0.26, -0.11);
      arm.rotation.x = Math.PI * 0.34;
      arm.rotation.z = -side * 0.22;

      const hand = this.addMesh(rider, new THREE.SphereGeometry(0.052, 8, 8), this.skinMat);
      hand.position.set(side * 0.13, 0.2, -0.23);
    }

    // Flowing two-segment scarf
    const scarfCollar = this.addMesh(
      rider,
      new THREE.TorusGeometry(0.125, 0.038, 8, 14),
      this.riderScarfMat
    );
    scarfCollar.rotation.x = Math.PI / 2;
    scarfCollar.position.set(0, 0.36, -0.02);

    const scarfPivot1 = new THREE.Group();
    scarfPivot1.position.set(0, 0.36, 0.1);
    rider.add(scarfPivot1);
    const scarfPiece1 = this.addMesh(
      scarfPivot1,
      new THREE.BoxGeometry(0.11, 0.032, 0.28),
      this.riderScarfMat
    );
    scarfPiece1.position.set(0, 0, 0.13);

    const scarfPivot2 = new THREE.Group();
    scarfPivot2.position.set(0, 0, 0.26);
    scarfPivot1.add(scarfPivot2);
    const scarfPiece2 = this.addMesh(
      scarfPivot2,
      new THREE.BoxGeometry(0.095, 0.028, 0.26),
      this.riderScarfMat
    );
    scarfPiece2.position.set(0, 0, 0.12);
    this.rig.riderScarfSegments.push(scarfPivot1, scarfPivot2);

    // Big cute chibi head
    const head = new THREE.Group();
    head.position.set(0, 0.53, -0.04);
    rider.add(head);

    this.addMesh(head, new THREE.SphereGeometry(0.185, 16, 14), this.skinMat);
    const hairCap = this.addMesh(
      head,
      new THREE.SphereGeometry(0.19, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      this.hairMat
    );
    hairCap.rotation.x = 0.25;

    this.addCuteEyes(head, 0.072, -0.01, -0.155, 0.85);

    // Nusantara Regional Headgear
    if (headgear === 'blangkon') {
      const soganMat = this.makeMat({ color: 0x78350f, roughness: 0.65 });
      const cap = this.addMesh(
        head,
        new THREE.CylinderGeometry(0.185, 0.2, 0.13, 14),
        soganMat
      );
      cap.position.set(0, 0.12, 0);
      const mondolan = this.addMesh(head, new THREE.SphereGeometry(0.085, 10, 10), soganMat);
      mondolan.position.set(0, 0.08, 0.19);
      const badge = this.addMesh(
        head,
        new THREE.OctahedronGeometry(0.04, 0),
        this.riderHatAccentMat
      );
      badge.position.set(0, 0.12, -0.195);
    } else if (headgear === 'udeng') {
      const whiteCloth = this.makeMat({ color: 0xf8fafc, roughness: 0.55 });
      const wrap = this.addMesh(
        head,
        new THREE.TorusGeometry(0.18, 0.052, 8, 16),
        whiteCloth
      );
      wrap.rotation.x = Math.PI / 2 - 0.12;
      wrap.position.set(0, 0.1, 0);
      const knot = this.addMesh(head, new THREE.ConeGeometry(0.075, 0.14, 4), whiteCloth);
      knot.position.set(0, 0.21, -0.13);
      knot.rotation.x = 0.2;
      const goldTrim = this.addMesh(
        head,
        new THREE.TorusGeometry(0.182, 0.018, 6, 16),
        this.riderHatAccentMat
      );
      goldTrim.rotation.x = Math.PI / 2 - 0.12;
      goldTrim.position.set(0, 0.07, 0);
    } else if (headgear === 'pelangi') {
      const band = this.addMesh(
        head,
        new THREE.TorusGeometry(0.182, 0.036, 8, 16),
        this.riderHatAccentMat
      );
      band.rotation.x = Math.PI / 2 - 0.15;
      band.position.set(0, 0.11, 0);
      const starGem = this.addMesh(
        head,
        new THREE.OctahedronGeometry(0.055, 0),
        this.makeMat({
          color: 0xff66c4,
          emissive: 0xff66c4,
          emissiveIntensity: 1.2
        })
      );
      starGem.position.set(0, 0.16, -0.185);
    } else if (headgear === 'songkok_recca') {
      const songkokMat = this.makeMat({ color: 0x1e1b18, roughness: 0.6 });
      const cyl = this.addMesh(
        head,
        new THREE.CylinderGeometry(0.165, 0.182, 0.16, 14),
        songkokMat
      );
      cyl.position.set(0, 0.14, 0.01);
      const band = this.addMesh(
        head,
        new THREE.CylinderGeometry(0.175, 0.184, 0.05, 14),
        this.riderHatAccentMat
      );
      band.position.set(0, 0.09, 0.01);
    } else if (headgear === 'mahkota_papua') {
      const band = this.addMesh(
        head,
        new THREE.TorusGeometry(0.18, 0.035, 8, 16),
        this.riderHatAccentMat
      );
      band.rotation.x = Math.PI / 2 - 0.1;
      band.position.set(0, 0.11, 0);
      const featherCols = [0xef4444, 0xfacc15, 0x10b981, 0xfacc15, 0xef4444];
      for (let i = 0; i < featherCols.length; i++) {
        const fMat = this.makeMat({ color: featherCols[i], roughness: 0.45 });
        const feather = this.addMesh(
          head,
          new THREE.ConeGeometry(0.03, 0.22, 6),
          fMat
        );
        const fan = (i - 2) * 0.28;
        feather.position.set(Math.sin(fan) * 0.14, 0.24 + Math.cos(fan) * 0.04, 0.04);
        feather.rotation.z = -fan * 0.85;
        feather.rotation.x = -0.2;
      }
    } else {
      // topi_dayak
      const dayakRed = this.makeMat({ color: 0xdc2626, roughness: 0.5 });
      const cap = this.addMesh(
        head,
        new THREE.CylinderGeometry(0.16, 0.185, 0.13, 14),
        dayakRed
      );
      cap.position.set(0, 0.13, 0);
      const beadBand = this.addMesh(
        head,
        new THREE.CylinderGeometry(0.188, 0.19, 0.04, 14),
        this.riderHatAccentMat
      );
      beadBand.position.set(0, 0.08, 0);
      const whiteFeather = this.makeMat({ color: 0xf8fafc, roughness: 0.45 });
      const tipBlack = this.makeMat({ color: 0x0f172a, roughness: 0.5 });
      for (const side of [-1, 1] as const) {
        const f = this.addMesh(head, new THREE.BoxGeometry(0.035, 0.28, 0.07), whiteFeather);
        f.position.set(side * 0.14, 0.27, 0.06);
        f.rotation.z = -side * 0.35;
        f.rotation.x = -0.25;
        const tip = this.addMesh(f, new THREE.BoxGeometry(0.038, 0.08, 0.072), tipBlack);
        tip.position.y = 0.09;
      }
    }

    return rider;
  }

  // 1. GARUDA NUSANTARA — Plump Golden Eagle + Blangkon Rider
  private buildGarudaNusantara(): void {
    const goldMat = this.makeMat({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 0.1, roughness: 0.42, metalness: 0.22 });
    const creamMat = this.makeMat({ color: 0xfef3c7, roughness: 0.5, metalness: 0.06 });
    const crimsonMat = this.makeMat({ color: 0xe11d48, emissive: 0xbe123c, emissiveIntensity: 0.08, roughness: 0.45 });
    const amberMat = this.makeMat({ color: 0xffb703, roughness: 0.35, metalness: 0.15 });
    const jewelMat = this.makeMat({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 1.3 });

    // Plump oval body
    const body = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.56, 20, 16), goldMat);
    body.scale.set(1.0, 0.92, 1.55);

    const chest = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.46, 16, 14), creamMat);
    chest.scale.set(0.92, 0.85, 1.15);
    chest.position.set(0, -0.08, -0.35);

    // Proud Garuda Head + Beak + Jamang Crown
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.36, -0.82);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    this.addMesh(headPivot, new THREE.SphereGeometry(0.32, 16, 14), goldMat);
    this.addCuteEyes(headPivot, 0.145, 0.05, -0.23, 1.1);

    const beakUpper = this.addMesh(headPivot, new THREE.ConeGeometry(0.11, 0.32, 10), amberMat);
    beakUpper.rotation.x = -Math.PI / 2 + 0.18;
    beakUpper.position.set(0, -0.02, -0.36);

    const crown = this.addMesh(headPivot, new THREE.ConeGeometry(0.18, 0.28, 6), amberMat);
    crown.position.set(0, 0.32, 0.02);
    const jewel = this.addMesh(headPivot, new THREE.OctahedronGeometry(0.055, 0), jewelMat, false);
    jewel.position.set(0, 0.25, -0.14);

    for (let i = 0; i < 3; i++) {
      const crest = this.addMesh(
        headPivot,
        new THREE.ConeGeometry(0.055, 0.24, 6),
        i === 1 ? creamMat : crimsonMat
      );
      crest.position.set(0, 0.26 - i * 0.05, 0.16 + i * 0.08);
      crest.rotation.x = -0.65 - i * 0.15;
    }

    // Articulated Multi-Feather Wings
    const buildWing = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.45, 0.16, -0.05);
      const specs = [
        { len: 1.35, chord: 0.46, zOff: -0.06, yRot: -side * 0.12, mat: goldMat },
        { len: 1.55, chord: 0.38, zOff: 0.2, yRot: -side * 0.25, mat: crimsonMat },
        { len: 1.25, chord: 0.3, zOff: 0.42, yRot: -side * 0.36, mat: creamMat }
      ];
      for (const s of specs) {
        const feather = this.addMesh(
          pivot,
          new THREE.BoxGeometry(s.len, 0.075, s.chord),
          s.mat
        );
        feather.position.set(side * (s.len * 0.5), 0, s.zOff);
        feather.rotation.y = s.yRot;
      }
      return pivot;
    };

    const wingL = buildWing(-1);
    const wingR = buildWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 7.4;
    this.rig.wingFlapAmp = 0.32;
    this.rig.wingBaseZ = 0.1;

    // Fanned Tail Feathers
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.04, 0.8);
    this.mountGroup.add(tailPivot);
    this.rig.tailPivot = tailPivot;
    for (let i = -2; i <= 2; i++) {
      const tMat = Math.abs(i) % 2 === 0 ? goldMat : crimsonMat;
      const tailFeather = this.addMesh(
        tailPivot,
        new THREE.BoxGeometry(0.18, 0.05, 0.68),
        tMat
      );
      tailFeather.position.set(i * 0.14, 0, 0.28);
      tailFeather.rotation.y = i * 0.22;
    }

    // Saddle & Rider with Blangkon
    const saddle = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.54, 0.1, 0.52), crimsonMat);
    saddle.position.set(0, 0.46, 0.04);
    const rider = this.buildCuteRider('blangkon');
    rider.position.set(0, 0.48, 0.05);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.9, 0.25, 0.35);
    this.wingtipRightAnchor.position.set(1.9, 0.25, 0.35);
    this.cannonLeftAnchor.position.set(-0.65, 0.05, -0.65);
    this.cannonRightAnchor.position.set(0.65, 0.05, -0.65);
    this.thrusterLeftAnchor.position.set(-0.34, -0.06, 0.92);
    this.thrusterRightAnchor.position.set(0.34, -0.06, 0.92);
    this.rig.flameScaleBase = 0.48;
  }

  // 2. NAGA BARONG — Cute Emerald Nusantara Dragon + Udeng Rider
  private buildNagaBarong(): void {
    const scaleMat = this.makeMat({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.1, roughness: 0.45 });
    const bellyMat = this.makeMat({ color: 0xfde047, roughness: 0.5 });
    const redMat = this.makeMat({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.08, roughness: 0.45 });
    const goldMat = this.makeMat({ color: 0xfbbf24, roughness: 0.35, metalness: 0.25 });
    const tailFlameMat = this.makeMat({ color: 0xff7b00, emissive: 0xff5500, emissiveIntensity: 1.35 });

    // Front Dragon Chest + Rider Saddle
    const chest = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.5, 18, 14), scaleMat);
    chest.scale.set(1.0, 0.9, 1.35);
    chest.position.set(0, 0, -0.18);

    const belly = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.42, 14, 12), bellyMat);
    belly.scale.set(0.86, 0.65, 1.25);
    belly.position.set(0, -0.15, -0.18);

    // Expressive Barong / Dragon Head
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.28, -0.96);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    this.addMesh(headPivot, new THREE.SphereGeometry(0.34, 16, 14), scaleMat);
    const snout = this.addMesh(headPivot, new THREE.BoxGeometry(0.34, 0.22, 0.32), scaleMat);
    snout.position.set(0, -0.06, -0.28);
    this.addCuteEyes(headPivot, 0.16, 0.07, -0.22, 1.15);

    // Festive red-gold Barong mane ruff & twin horns & golden whiskers
    const ruff = this.addMesh(headPivot, new THREE.TorusGeometry(0.33, 0.085, 8, 16), redMat);
    ruff.position.set(0, 0.02, 0.14);

    for (const side of [-1, 1] as const) {
      const horn = this.addMesh(headPivot, new THREE.ConeGeometry(0.055, 0.34, 8), goldMat);
      horn.position.set(side * 0.15, 0.32, 0.08);
      horn.rotation.x = -0.52;
      horn.rotation.z = -side * 0.24;

      const whisker = this.addMesh(headPivot, new THREE.CylinderGeometry(0.014, 0.025, 0.45, 6), goldMat);
      whisker.position.set(side * 0.26, -0.05, -0.22);
      whisker.rotation.z = side * 1.15;
      whisker.rotation.y = side * 0.35;
    }

    // Small golden cloud-wings on flanks
    const makeCloudWing = (side: -1 | 1): THREE.Group => {
      const p = new THREE.Group();
      p.position.set(side * 0.44, 0.14, -0.1);
      for (let i = 0; i < 3; i++) {
        const w = this.addMesh(
          p,
          new THREE.BoxGeometry(0.42 - i * 0.08, 0.06, 0.28),
          i === 1 ? redMat : goldMat
        );
        w.position.set(side * (0.28 + i * 0.22), 0.04 * i, i * 0.12);
        w.rotation.y = -side * 0.28;
      }
      return p;
    };
    const wingL = makeCloudWing(-1);
    const wingR = makeCloudWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 9.0;
    this.rig.wingFlapAmp = 0.24;
    this.rig.wingBaseZ = 0.12;

    // 4 cute stubby dragon paws
    for (const zOff of [-0.45, 0.28]) {
      for (const side of [-1, 1] as const) {
        const paw = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.12, 10, 8), scaleMat);
        paw.scale.set(1, 0.75, 1.3);
        paw.position.set(side * 0.42, -0.32, zOff);
      }
    }

    // 5 Articulated Slithering Tail Segments
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, 0, 0.42 + i * 0.36);
      const r = 0.34 - i * 0.048;
      this.addMesh(seg, new THREE.SphereGeometry(r, 12, 10), scaleMat);
      const plate = this.addMesh(seg, new THREE.SphereGeometry(r * 0.78, 10, 8), bellyMat);
      plate.position.y = -r * 0.36;
      const fin = this.addMesh(seg, new THREE.ConeGeometry(r * 0.28, r * 0.9, 5), redMat);
      fin.position.set(0, r * 0.92, 0);
      fin.rotation.x = -0.3;

      if (i === 4) {
        const tailFlame = this.addMesh(seg, new THREE.ConeGeometry(0.18, 0.46, 8), tailFlameMat, false);
        tailFlame.rotation.x = Math.PI / 2;
        tailFlame.position.set(0, 0.04, 0.28);
      }

      this.mountGroup.add(seg);
      this.rig.snakeSegments.push(seg);
    }

    // Saddle & Rider with Udeng Bali
    const saddle = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.52, 0.1, 0.48), redMat);
    saddle.position.set(0, 0.4, -0.12);
    const rider = this.buildCuteRider('udeng');
    rider.position.set(0, 0.43, -0.1);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.15, 0.22, 0.05);
    this.wingtipRightAnchor.position.set(1.15, 0.22, 0.05);
    this.cannonLeftAnchor.position.set(-0.55, 0.02, -0.82);
    this.cannonRightAnchor.position.set(0.55, 0.02, -0.82);
    this.thrusterLeftAnchor.position.set(-0.28, -0.05, 0.78);
    this.thrusterRightAnchor.position.set(0.28, -0.05, 0.78);
    this.rig.flameScaleBase = 0.5;
  }

  // 3. KUDA SEMBRANI — Winged Rainbow Unicorn + Pelangi Rider
  private buildUnicornSembrani(): void {
    const whiteMat = this.makeMat({ color: 0xf8fafc, emissive: 0xe2e8f0, emissiveIntensity: 0.08, roughness: 0.42 });
    const pinkMuzzleMat = this.makeMat({ color: 0xfbcfe8, roughness: 0.5 });
    const goldMat = this.makeMat({ color: 0xfacc15, roughness: 0.3, metalness: 0.35 });
    const hornGlowMat = this.makeMat({ color: 0xffd000, emissive: 0xff66c4, emissiveIntensity: 1.25 });
    const saddleMat = this.makeMat({ color: 0xc026d3, roughness: 0.45 });
    const rainbowCols = [0xff4d6d, 0xff9f1c, 0xfacc15, 0x34d399, 0x38bdf8, 0xa855f7];

    // Plump Horse Body
    const body = this.addMesh(this.mountGroup, new THREE.CapsuleGeometry(0.42, 0.86, 8, 16), whiteMat);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0.02, 0.05);

    // Arched Neck + Head
    const neck = this.addMesh(this.mountGroup, new THREE.CylinderGeometry(0.2, 0.28, 0.56, 12), whiteMat);
    neck.position.set(0, 0.36, -0.58);
    neck.rotation.x = 0.45;

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.62, -0.84);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    this.addMesh(headPivot, new THREE.SphereGeometry(0.26, 14, 12), whiteMat);
    const muzzle = this.addMesh(headPivot, new THREE.SphereGeometry(0.18, 12, 10), pinkMuzzleMat);
    muzzle.scale.set(0.95, 0.82, 1.2);
    muzzle.position.set(0, -0.06, -0.22);

    this.addCuteEyes(headPivot, 0.135, 0.05, -0.16, 1.0);

    // Pointy ears & glowing Unicorn horn
    for (const side of [-1, 1] as const) {
      const ear = this.addMesh(headPivot, new THREE.ConeGeometry(0.06, 0.16, 6), whiteMat);
      ear.position.set(side * 0.14, 0.24, 0.05);
      ear.rotation.z = -side * 0.28;
    }
    const horn = this.addMesh(headPivot, new THREE.ConeGeometry(0.058, 0.44, 10), hornGlowMat, false);
    horn.position.set(0, 0.28, -0.18);
    horn.rotation.x = -0.58;

    // Rainbow Mane Tufts
    for (let i = 0; i < 5; i++) {
      const mMat = this.makeMat({ color: rainbowCols[i], roughness: 0.45 });
      const tuft = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.11, 8, 8), mMat);
      tuft.position.set(0, 0.68 - i * 0.1, -0.66 + i * 0.08);
    }

    // 4 Galloping Legs with Golden Hooves
    const legSpecs = [
      [-0.22, -0.22, -0.38],
      [0.22, -0.22, -0.38],
      [-0.22, -0.22, 0.44],
      [0.22, -0.22, 0.44]
    ] as const;
    for (const [lx, ly, lz] of legSpecs) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, ly, lz);
      const leg = this.addMesh(legPivot, new THREE.CylinderGeometry(0.075, 0.065, 0.36, 8), whiteMat);
      leg.position.y = -0.16;
      const hoof = this.addMesh(legPivot, new THREE.CylinderGeometry(0.07, 0.08, 0.09, 8), goldMat);
      hoof.position.y = -0.35;
      this.mountGroup.add(legPivot);
      this.rig.legPivots.push(legPivot);
    }

    // Fluffy Angel Wings with Rainbow Tips
    const makeAngelWing = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.36, 0.22, -0.08);
      const mainWing = this.addMesh(
        pivot,
        new THREE.BoxGeometry(1.15, 0.08, 0.54),
        whiteMat
      );
      mainWing.position.set(side * 0.58, 0, 0.12);
      mainWing.rotation.y = -side * 0.22;

      for (let i = 0; i < 3; i++) {
        const tipMat = this.makeMat({ color: rainbowCols[i * 2], roughness: 0.45 });
        const featherTip = this.addMesh(
          pivot,
          new THREE.BoxGeometry(0.45, 0.065, 0.16),
          tipMat
        );
        featherTip.position.set(side * (1.02 - i * 0.08), -0.01, -0.04 + i * 0.16);
        featherTip.rotation.y = -side * 0.28;
      }
      return pivot;
    };

    const wingL = makeAngelWing(-1);
    const wingR = makeAngelWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 7.8;
    this.rig.wingFlapAmp = 0.34;
    this.rig.wingBaseZ = 0.14;

    // Flowing Rainbow Tail
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.12, 0.68);
    this.mountGroup.add(tailPivot);
    this.rig.tailPivot = tailPivot;
    for (let i = 0; i < 4; i++) {
      const tMat = this.makeMat({ color: rainbowCols[i + 1], roughness: 0.45 });
      const strand = this.addMesh(tailPivot, new THREE.CapsuleGeometry(0.06, 0.46, 4, 8), tMat);
      strand.rotation.x = Math.PI / 2 - 0.15;
      strand.position.set((i - 1.5) * 0.065, -i * 0.02, 0.26);
    }

    // Saddle & Rider with Pelangi Headband
    const saddle = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.48, 0.09, 0.46), saddleMat);
    saddle.position.set(0, 0.42, 0.02);
    const rider = this.buildCuteRider('pelangi');
    rider.position.set(0, 0.44, 0.04);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.55, 0.35, 0.15);
    this.wingtipRightAnchor.position.set(1.55, 0.35, 0.15);
    this.cannonLeftAnchor.position.set(-0.52, 0.12, -0.68);
    this.cannonRightAnchor.position.set(0.52, 0.12, -0.68);
    this.thrusterLeftAnchor.position.set(-0.26, 0.0, 0.84);
    this.thrusterRightAnchor.position.set(0.26, 0.0, 0.84);
    this.rig.flameScaleBase = 0.46;
  }

  // 4. PHINISI TERBANG BUGIS — Flying Wooden Sailship + Brass Props + Songkok Recca Captain
  private buildPhinisiBugis(): void {
    const woodMat = this.makeMat({ color: 0x92400e, roughness: 0.58, metalness: 0.08 });
    const darkWoodMat = this.makeMat({ color: 0x451a03, roughness: 0.65 });
    const deckMat = this.makeMat({ color: 0xd97706, roughness: 0.55 });
    const sailMat = this.makeMat({ color: 0xfef9c3, roughness: 0.55, side: THREE.DoubleSide });
    const crimsonSailMat = this.makeMat({ color: 0xe11d48, roughness: 0.5 });
    const brassMat = this.makeMat({ color: 0xfbbf24, roughness: 0.3, metalness: 0.55 });
    const trimCyanMat = this.makeMat({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.12, roughness: 0.35 });
    const lanternMat = this.makeMat({ color: 0xfef08a, emissive: 0xffb703, emissiveIntensity: 1.4 });

    // Boat Hull
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-0.46, 0.18);
    hullShape.lineTo(0.46, 0.18);
    hullShape.lineTo(0.32, -0.28);
    hullShape.lineTo(-0.32, -0.28);
    hullShape.closePath();

    const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
      depth: 1.56,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.06,
      bevelSegments: 2
    });
    hullGeo.translate(0, 0, -0.78);
    this.addMesh(this.mountGroup, hullGeo, woodMat);

    // Tapered Boat Prow + Bowsprit (-Z)
    const prow = this.addMesh(this.mountGroup, new THREE.ConeGeometry(0.42, 0.92, 5), woodMat);
    prow.rotation.x = -Math.PI / 2;
    prow.scale.set(1.0, 1.0, 0.65);
    prow.position.set(0, -0.02, -1.16);

    const bowsprit = this.addMesh(this.mountGroup, new THREE.CylinderGeometry(0.032, 0.055, 1.05, 8), darkWoodMat);
    bowsprit.rotation.x = Math.PI / 2 - 0.24;
    bowsprit.position.set(0, 0.22, -1.42);

    // Hanging glowing bow lantern
    const lanternPivot = new THREE.Group();
    lanternPivot.position.set(0, 0.3, -1.85);
    this.mountGroup.add(lanternPivot);
    this.rig.lanternPivot = lanternPivot;
    const lantern = this.addMesh(lanternPivot, new THREE.OctahedronGeometry(0.095, 0), lanternMat, false);
    lantern.position.y = -0.14;

    // Deck & Turquoise Waterline Trim + Raised Stern Cabin
    const deck = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.84, 0.06, 1.48), deckMat);
    deck.position.set(0, 0.21, 0);

    for (const side of [-1, 1] as const) {
      const trim = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.045, 0.07, 1.56), trimCyanMat);
      trim.position.set(side * 0.45, 0.06, 0);
    }

    const cabin = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.76, 0.26, 0.48), darkWoodMat);
    cabin.position.set(0, 0.34, 0.56);
    const helmWheel = this.addMesh(this.mountGroup, new THREE.TorusGeometry(0.11, 0.018, 6, 12), brassMat);
    helmWheel.position.set(0, 0.42, -0.3);

    // Twin Phinisi Masts + Billowing Sails
    const mastConfigs = [
      { z: -0.52, height: 1.28, sailW: 0.72, sailH: 0.72 },
      { z: 0.42, height: 1.05, sailW: 0.58, sailH: 0.56 }
    ];
    for (let i = 0; i < mastConfigs.length; i++) {
      const mc = mastConfigs[i];
      const mast = this.addMesh(
        this.mountGroup,
        new THREE.CylinderGeometry(0.032, 0.046, mc.height, 8),
        darkWoodMat
      );
      mast.position.set(0, 0.22 + mc.height * 0.5, mc.z);

      const sail = this.addMesh(
        this.mountGroup,
        new THREE.BoxGeometry(mc.sailW, mc.sailH, 0.05),
        i === 0 ? sailMat : crimsonSailMat
      );
      sail.position.set(0, 0.42 + mc.height * 0.45, mc.z - 0.04);
      this.rig.sailMeshes.push(sail);
    }

    // Little Merah-Putih Pennant Flag on top of main mast
    const flagRed = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.03, 0.08, 0.22), crimsonSailMat);
    flagRed.position.set(0, 1.48, -0.4);
    const flagWhite = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.03, 0.08, 0.22), sailMat);
    flagWhite.position.set(0, 1.4, -0.4);

    // Side Outrigger Wings + Spinning Brass Propellers
    for (const side of [-1, 1] as const) {
      const outrigger = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.75, 0.08, 0.36), woodMat);
      outrigger.position.set(side * 0.78, 0.05, 0.02);

      const nac = this.addMesh(this.mountGroup, new THREE.CylinderGeometry(0.11, 0.12, 0.46, 10), brassMat);
      nac.rotation.x = Math.PI / 2;
      nac.position.set(side * 1.12, 0.06, 0);

      const propHub = new THREE.Group();
      propHub.position.set(side * 1.12, 0.06, -0.26);
      this.mountGroup.add(propHub);
      this.rig.propellers.push(propHub);

      for (let b = 0; b < 2; b++) {
        const blade = this.addMesh(propHub, new THREE.BoxGeometry(0.46, 0.055, 0.02), brassMat);
        blade.rotation.z = (b * Math.PI) / 2;
      }
    }

    // Bugis Captain Rider with Songkok Recca
    const rider = this.buildCuteRider('songkok_recca');
    rider.position.set(0, 0.24, -0.05);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.35, 0.1, 0.05);
    this.wingtipRightAnchor.position.set(1.35, 0.1, 0.05);
    this.cannonLeftAnchor.position.set(-0.55, 0.14, -0.78);
    this.cannonRightAnchor.position.set(0.55, 0.14, -0.78);
    this.thrusterLeftAnchor.position.set(-0.28, 0.06, 0.94);
    this.thrusterRightAnchor.position.set(0.28, 0.06, 0.94);
    this.rig.flameScaleBase = 0.65;
  }

  // 5. CENDERAWASIH PAPUA — Emerald & Gold Bird of Paradise + Mahkota Papua Rider
  private buildCenderawasihPapua(): void {
    const chestnutMat = this.makeMat({ color: 0xb91c1c, emissive: 0x991b1b, emissiveIntensity: 0.08, roughness: 0.46 });
    const yellowHeadMat = this.makeMat({ color: 0xfacc15, roughness: 0.42 });
    const emeraldMat = this.makeMat({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.12, roughness: 0.38 });
    const plumeGoldMat = this.makeMat({ color: 0xfb923c, emissive: 0xf59e0b, emissiveIntensity: 0.12, roughness: 0.45 });
    const beakBlueMat = this.makeMat({ color: 0x38bdf8, roughness: 0.35 });

    // Plump Bird of Paradise Body
    const body = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.48, 18, 14), chestnutMat);
    body.scale.set(0.95, 0.9, 1.48);

    const breast = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.4, 14, 12), emeraldMat);
    breast.scale.set(0.92, 0.85, 1.1);
    breast.position.set(0, -0.06, -0.35);

    // Golden-Yellow Head + Cute Sky-Blue Beak
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.35, -0.76);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    this.addMesh(headPivot, new THREE.SphereGeometry(0.29, 14, 12), yellowHeadMat);
    this.addCuteEyes(headPivot, 0.135, 0.04, -0.21, 1.05);

    const beak = this.addMesh(headPivot, new THREE.ConeGeometry(0.08, 0.28, 8), beakBlueMat);
    beak.rotation.x = -Math.PI / 2 + 0.08;
    beak.position.set(0, -0.03, -0.33);

    // Layered Emerald & Gold Wings
    const makeParadiseWing = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.4, 0.14, -0.06);
      const topLayer = this.addMesh(
        pivot,
        new THREE.BoxGeometry(1.32, 0.065, 0.44),
        emeraldMat
      );
      topLayer.position.set(side * 0.66, 0, 0.08);
      topLayer.rotation.y = -side * 0.18;

      const plumeLayer = this.addMesh(
        pivot,
        new THREE.BoxGeometry(1.48, 0.055, 0.32),
        yellowHeadMat
      );
      plumeLayer.position.set(side * 0.72, -0.02, 0.32);
      plumeLayer.rotation.y = -side * 0.3;
      return pivot;
    };

    const wingL = makeParadiseWing(-1);
    const wingR = makeParadiseWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 8.4;
    this.rig.wingFlapAmp = 0.36;
    this.rig.wingBaseZ = 0.12;

    // Iconic Twin Long Articulated Flowing Tail Streamers
    for (const side of [-1, 1] as const) {
      let parent: THREE.Object3D = this.mountGroup;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Group();
        seg.position.set(i === 0 ? side * 0.2 : 0, i === 0 ? 0.04 : 0, i === 0 ? 0.72 : 0.36);
        this.addMesh(
          seg,
          new THREE.BoxGeometry(0.11 - i * 0.015, 0.03, 0.38),
          i % 2 === 0 ? plumeGoldMat : yellowHeadMat
        ).position.z = 0.18;
        parent.add(seg);
        if (side === -1) this.rig.ribbonSegmentsL.push(seg);
        else this.rig.ribbonSegmentsR.push(seg);
        parent = seg;
      }
    }

    // Saddle & Rider with Mahkota Papua
    const saddle = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.48, 0.09, 0.46), emeraldMat);
    saddle.position.set(0, 0.41, 0.04);
    const rider = this.buildCuteRider('mahkota_papua');
    rider.position.set(0, 0.44, 0.05);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.78, 0.25, 0.3);
    this.wingtipRightAnchor.position.set(1.78, 0.25, 0.3);
    this.cannonLeftAnchor.position.set(-0.55, 0.06, -0.62);
    this.cannonRightAnchor.position.set(0.55, 0.06, -0.62);
    this.thrusterLeftAnchor.position.set(-0.24, -0.05, 0.85);
    this.thrusterRightAnchor.position.set(0.24, -0.05, 0.85);
    this.rig.flameScaleBase = 0.45;
  }

  // 6. ENGGANG DAYAK — Kalimantan Hornbill + Topi Dayak Rider
  private buildEnggangDayak(): void {
    const blackMat = this.makeMat({ color: 0x1e293b, roughness: 0.48, metalness: 0.12 });
    const whiteMat = this.makeMat({ color: 0xf8fafc, roughness: 0.45 });
    const orangeBeakMat = this.makeMat({ color: 0xff7b00, emissive: 0xea580c, emissiveIntensity: 0.1, roughness: 0.35 });
    const redCasqueMat = this.makeMat({ color: 0xef4444, roughness: 0.38 });
    const goldMat = this.makeMat({ color: 0xfacc15, roughness: 0.38 });

    // Sleek Black Hornbill Body + Cream-White Neck
    const body = this.addMesh(this.mountGroup, new THREE.SphereGeometry(0.52, 18, 14), blackMat);
    body.scale.set(0.95, 0.9, 1.52);

    const neck = this.addMesh(this.mountGroup, new THREE.CylinderGeometry(0.24, 0.34, 0.45, 12), whiteMat);
    neck.position.set(0, 0.24, -0.56);
    neck.rotation.x = 0.55;

    // Hornbill Head + Iconic Giant Curved Orange Beak + Red Casque
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.44, -0.82);
    this.mountGroup.add(headPivot);
    this.rig.headPivot = headPivot;

    this.addMesh(headPivot, new THREE.SphereGeometry(0.29, 14, 12), blackMat);
    this.addCuteEyes(headPivot, 0.14, 0.04, -0.2, 1.05);

    const beak = this.addMesh(headPivot, new THREE.ConeGeometry(0.115, 0.56, 10), orangeBeakMat);
    beak.rotation.x = -Math.PI / 2 + 0.16;
    beak.scale.set(0.85, 1.0, 1.2);
    beak.position.set(0, -0.05, -0.48);

    const casque = this.addMesh(headPivot, new THREE.BoxGeometry(0.12, 0.16, 0.34), redCasqueMat);
    casque.position.set(0, 0.14, -0.35);
    casque.rotation.x = -0.25;
    const casqueTip = this.addMesh(headPivot, new THREE.ConeGeometry(0.065, 0.16, 6), goldMat);
    casqueTip.position.set(0, 0.23, -0.45);
    casqueTip.rotation.x = -0.35;

    // Broad Sweeping Black Wings with Bold White Band
    const makeHornbillWing = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.42, 0.14, -0.05);
      const baseWing = this.addMesh(pivot, new THREE.BoxGeometry(1.48, 0.07, 0.44), blackMat);
      baseWing.position.set(side * 0.74, 0, 0.08);
      baseWing.rotation.y = -side * 0.18;

      const whiteBand = this.addMesh(pivot, new THREE.BoxGeometry(1.42, 0.065, 0.18), whiteMat);
      whiteBand.position.set(side * 0.74, -0.005, 0.34);
      whiteBand.rotation.y = -side * 0.22;

      const goldAccent = this.addMesh(pivot, new THREE.BoxGeometry(0.9, 0.08, 0.07), goldMat);
      goldAccent.position.set(side * 0.48, 0.02, -0.1);
      goldAccent.rotation.y = -side * 0.15;
      return pivot;
    };

    const wingL = makeHornbillWing(-1);
    const wingR = makeHornbillWing(1);
    this.mountGroup.add(wingL, wingR);
    this.rig.wingLeftPivot = wingL;
    this.rig.wingRightPivot = wingR;
    this.rig.wingFlapSpeed = 7.0;
    this.rig.wingFlapAmp = 0.32;
    this.rig.wingBaseZ = 0.1;

    // Iconic White Fanned Tail with Black Center Stripe
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.05, 0.76);
    this.mountGroup.add(tailPivot);
    this.rig.tailPivot = tailPivot;
    const whiteTail = this.addMesh(tailPivot, new THREE.BoxGeometry(0.68, 0.05, 0.66), whiteMat);
    whiteTail.position.z = 0.3;
    const blackStripe = this.addMesh(tailPivot, new THREE.BoxGeometry(0.7, 0.058, 0.18), blackMat);
    blackStripe.position.z = 0.34;

    // Saddle & Rider with Topi Dayak
    const saddle = this.addMesh(this.mountGroup, new THREE.BoxGeometry(0.5, 0.09, 0.48), redCasqueMat);
    saddle.position.set(0, 0.42, 0.05);
    const rider = this.buildCuteRider('topi_dayak');
    rider.position.set(0, 0.45, 0.06);
    this.mountGroup.add(rider);

    this.wingtipLeftAnchor.position.set(-1.86, 0.24, 0.3);
    this.wingtipRightAnchor.position.set(1.86, 0.24, 0.3);
    this.cannonLeftAnchor.position.set(-0.62, 0.04, -0.68);
    this.cannonRightAnchor.position.set(0.62, 0.04, -0.68);
    this.thrusterLeftAnchor.position.set(-0.28, -0.05, 0.88);
    this.thrusterRightAnchor.position.set(0.28, -0.05, 0.88);
    this.rig.flameScaleBase = 0.48;
  }
}
