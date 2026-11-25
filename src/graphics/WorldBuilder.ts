import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getStageSpec } from '../data/catalog';
import type { StageId } from '../types/game';
import type { ProceduralTexturePack } from './ProceduralTextures';

export interface PylonVariant {
  group: THREE.Group;
  collisionRadius: number;
}

interface LaserWallSlot {
  group: THREE.Group;
  field: THREE.Mesh;
  bars: THREE.Mesh[];
}

interface LaserGateRig {
  orientation: 'horizontal' | 'vertical';
  posts: THREE.Mesh[];
  walls: [LaserWallSlot, LaserWallSlot];
}

interface BoltMaterialSet {
  sheath: THREE.MeshBasicMaterial;
  glow: THREE.SpriteMaterial;
}

interface PlasmaBoltRig {
  sheath: THREE.Mesh;
  glow: THREE.Sprite;
}

/**
 * Safely merges indexed or non-indexed Three.js geometries into one BufferGeometry.
 */
function mergeNormalized(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized: THREE.BufferGeometry[] = [];
  for (const g of geometries) {
    const nonIdx = g.index ? g.toNonIndexed() : g.clone();
    for (const key of Object.keys(nonIdx.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        nonIdx.deleteAttribute(key);
      }
    }
    if (!nonIdx.attributes.normal) {
      nonIdx.computeVertexNormals();
    }
    normalized.push(nonIdx);
    g.dispose();
  }
  const merged = mergeGeometries(normalized, false);
  for (const ng of normalized) {
    ng.dispose();
  }
  if (!merged) {
    throw new Error('Failed to merge normalized geometries');
  }
  return merged;
}

export class WorldBuilder {
  private readonly textures: ProceduralTexturePack;

  private readonly titaniumMat: THREE.MeshStandardMaterial;
  private readonly darkChassisMat: THREE.MeshStandardMaterial;
  private readonly pylonBodyMat: THREE.MeshStandardMaterial;
  private readonly glassCasingMat: THREE.MeshPhysicalMaterial;
  private readonly streamMat: THREE.MeshStandardMaterial;

  private readonly neonCyanMat: THREE.MeshStandardMaterial;
  private readonly neonGoldMat: THREE.MeshStandardMaterial;
  private readonly neonEmeraldMat: THREE.MeshStandardMaterial;
  private readonly neonMagentaMat: THREE.MeshStandardMaterial;

  private readonly mineCoreMat: THREE.MeshStandardMaterial;
  private readonly mineDangerMat: THREE.MeshStandardMaterial;
  private readonly laserCoreMat: THREE.MeshBasicMaterial;
  private readonly laserGlowMat: THREE.MeshBasicMaterial;

  private readonly starMat: THREE.MeshStandardMaterial;
  private readonly repairMat: THREE.MeshStandardMaterial;
  private readonly shieldMat: THREE.MeshStandardMaterial;
  private readonly frenzyMat: THREE.MeshStandardMaterial;
  private readonly overchargeMat: THREE.MeshStandardMaterial;
  private readonly aviationBeaconMat: THREE.MeshBasicMaterial;

  private readonly ringGoldGlowMat: THREE.SpriteMaterial;
  private readonly ringEmeraldGlowMat: THREE.SpriteMaterial;
  private readonly ringCyanGlowMat: THREE.SpriteMaterial;
  private readonly starGlintMat: THREE.SpriteMaterial;
  private readonly thermalColMat: THREE.MeshBasicMaterial;
  private readonly slipHoopMat: THREE.MeshBasicMaterial;
  private readonly slipShellMat: THREE.MeshBasicMaterial;
  private readonly cargoGlowMat: THREE.SpriteMaterial;
  private readonly gravitySingularityMat: THREE.MeshBasicMaterial;
  private readonly gravityGlowMat: THREE.SpriteMaterial;
  private readonly lockReticleMat: THREE.MeshBasicMaterial;
  private readonly boltCoreMat: THREE.MeshBasicMaterial;

  private readonly biomeAccentMats = new Map<StageId, THREE.MeshStandardMaterial>();
  private readonly boltMatsByColor = new Map<number, BoltMaterialSet>();

  // Shared & pre-merged geometries
  private readonly ringOuterGeo: THREE.TorusGeometry;
  private readonly ringInnerPlasmaGeo: THREE.TorusGeometry;
  private readonly bullseyeInnerGeo: THREE.TorusGeometry;
  private readonly ringBracketsMergedGeo: THREE.BufferGeometry;

  private readonly starGeo: THREE.OctahedronGeometry;
  private readonly starGyroGeo: THREE.TorusGeometry;

  private readonly pickupGlassGeo: THREE.SphereGeometry;
  private readonly pickupCapGeo: THREE.CylinderGeometry;
  private readonly pickupShieldRingGeo: THREE.TorusGeometry;
  private readonly pickupHeartMergedGeo: THREE.BufferGeometry;
  private readonly pickupFrenzyCoreGeo: THREE.OctahedronGeometry;
  private readonly pickupOverchargeBoltGeo: THREE.CylinderGeometry;
  private readonly pickupOverchargeRingGeo: THREE.TorusGeometry;

  private readonly mineSpikeBasesMergedGeo: THREE.BufferGeometry;
  private readonly mineAccentMergedGeo: THREE.BufferGeometry;

  private readonly pylonPodiumGeo: THREE.BoxGeometry;
  private readonly pylonShaftGeo: THREE.BoxGeometry;
  private readonly pylonCrownGeo: THREE.BoxGeometry;
  private readonly pylonTrimBandGeo: THREE.BoxGeometry;
  private readonly pylonSpireGeo: THREE.CylinderGeometry;
  private readonly pylonBeaconGeo: THREE.SphereGeometry;
  private readonly pylonBaseCylGeo: THREE.CylinderGeometry;
  private readonly pylonColCylGeo: THREE.CylinderGeometry;
  private readonly pylonCoreStripGeo: THREE.CylinderGeometry;
  private readonly pylonRibsMergedGeo: THREE.BufferGeometry;
  private readonly pylonHaloGeo: THREE.TorusGeometry;
  private readonly pylonCollarGeo: THREE.BoxGeometry;
  private readonly pylonCrystalGeo: THREE.OctahedronGeometry;

  private readonly boltCoreGeo: THREE.CylinderGeometry;
  private readonly boltSheathGeo: THREE.CylinderGeometry;

  private readonly thermalColGeo: THREE.CylinderGeometry;
  private readonly thermalRingsMergedGeo: THREE.BufferGeometry;

  private readonly slipHoopsMergedGeo: THREE.BufferGeometry;
  private readonly slipShellGeo: THREE.CylinderGeometry;

  private readonly dronePodGeo: THREE.OctahedronGeometry;
  private readonly droneWingsMergedGeo: THREE.BufferGeometry;
  private readonly droneAccentsMergedGeo: THREE.BufferGeometry;

  private readonly cargoCrateGeo: THREE.BoxGeometry;
  private readonly cargoFrameGeo: THREE.BoxGeometry;
  private readonly cargoBandGeo: THREE.BoxGeometry;

  private readonly gravitySingularityGeo: THREE.SphereGeometry;
  private readonly gravityHorizonGeo: THREE.TorusGeometry;
  private readonly gravityOuterGeo: THREE.TorusGeometry;

  private readonly lockReticleGeo: THREE.RingGeometry;
  private readonly sphereUnitGeo = new THREE.SphereGeometry(1, 18, 14);
  private readonly boxUnitGeo = new THREE.BoxGeometry(1, 1, 1);

  constructor(textures: ProceduralTexturePack) {
    this.textures = textures;

    this.titaniumMat = new THREE.MeshStandardMaterial({
      map: textures.hullPBR.map,
      normalMap: textures.hullPBR.normalMap,
      roughnessMap: textures.hullPBR.roughnessMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      color: 0x3b495e,
      roughness: 0.28,
      metalness: 0.86
    });

    this.darkChassisMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.48,
      metalness: 0.85
    });

    this.pylonBodyMat = new THREE.MeshStandardMaterial({
      map: textures.pylonPBR.map,
      normalMap: textures.pylonPBR.normalMap,
      roughnessMap: textures.pylonPBR.roughnessMap,
      emissiveMap: textures.pylonPBR.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 1.05,
      color: 0xdbeafe,
      roughness: 0.68,
      metalness: 0.42
    });

    this.glassCasingMat = new THREE.MeshPhysicalMaterial({
      color: 0xcffafe,
      roughness: 0.06,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.36
    });

    this.streamMat = new THREE.MeshStandardMaterial({
      map: textures.energyStream,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.45,
      transparent: true,
      opacity: 0.9,
      roughness: 0.2
    });

    this.neonCyanMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.9,
      roughness: 0.16,
      metalness: 0.4
    });
    this.neonGoldMat = new THREE.MeshStandardMaterial({
      color: 0xffd000,
      emissive: 0xff9d00,
      emissiveIntensity: 1.95,
      roughness: 0.16,
      metalness: 0.65
    });
    this.neonEmeraldMat = new THREE.MeshStandardMaterial({
      color: 0x00ff9d,
      emissive: 0x00e676,
      emissiveIntensity: 1.9,
      roughness: 0.16,
      metalness: 0.45
    });
    this.neonMagentaMat = new THREE.MeshStandardMaterial({
      color: 0xff2a85,
      emissive: 0xff2a85,
      emissiveIntensity: 1.9,
      roughness: 0.16,
      metalness: 0.45
    });

    this.mineCoreMat = new THREE.MeshStandardMaterial({
      map: textures.minePBR.map,
      normalMap: textures.minePBR.normalMap,
      roughnessMap: textures.minePBR.roughnessMap,
      color: 0xb8c4d4,
      roughness: 0.42,
      metalness: 0.84
    });
    this.mineDangerMat = new THREE.MeshStandardMaterial({
      color: 0xff1e56,
      emissive: 0xff0044,
      emissiveIntensity: 2.1,
      roughness: 0.2,
      metalness: 0.35
    });
    this.laserCoreMat = new THREE.MeshBasicMaterial({
      color: 0xff2a6d,
      transparent: true,
      opacity: 0.92
    });
    this.laserGlowMat = new THREE.MeshBasicMaterial({
      map: textures.energyStream,
      color: 0xff1e56,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.starMat = new THREE.MeshStandardMaterial({
      color: 0xffe600,
      emissive: 0xffa800,
      emissiveIntensity: 1.65,
      roughness: 0.12,
      metalness: 0.72
    });
    this.repairMat = new THREE.MeshStandardMaterial({
      color: 0x00ff9d,
      emissive: 0x10b981,
      emissiveIntensity: 1.85,
      roughness: 0.18
    });
    this.shieldMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.85,
      roughness: 0.12
    });
    this.frenzyMat = new THREE.MeshStandardMaterial({
      color: 0xff2a85,
      emissive: 0xffb800,
      emissiveIntensity: 1.9,
      roughness: 0.15
    });
    this.overchargeMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0xc084fc,
      emissiveIntensity: 1.95,
      roughness: 0.15
    });
    this.aviationBeaconMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });

    // Shared Sprite & Basic materials
    this.ringGoldGlowMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0xffd000,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.ringEmeraldGlowMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0x00ff9d,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.ringCyanGlowMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.starGlintMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0xffd000,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.thermalColMat = new THREE.MeshBasicMaterial({
      map: textures.energyStream,
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.slipHoopMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.slipShellMat = new THREE.MeshBasicMaterial({
      map: textures.energyStream,
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.cargoGlowMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0xffd000,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.gravitySingularityMat = new THREE.MeshBasicMaterial({ color: 0x020308 });
    this.gravityGlowMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0xa855f7,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.lockReticleMat = new THREE.MeshBasicMaterial({
      color: 0x00ff9d,
      transparent: true,
      opacity: 0.92,
      depthTest: false
    });
    this.boltCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // 1. Cyber Ring geometries
    this.ringOuterGeo = new THREE.TorusGeometry(2.88, 0.24, 12, 36);
    this.ringInnerPlasmaGeo = new THREE.TorusGeometry(2.64, 0.08, 10, 36);
    this.bullseyeInnerGeo = new THREE.TorusGeometry(1.15, 0.06, 10, 28);
    const ringBracketGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const bg = new THREE.BoxGeometry(0.42, 0.56, 0.42);
      bg.rotateZ(a);
      bg.translate(Math.cos(a) * 2.95, Math.sin(a) * 2.95, 0);
      ringBracketGeos.push(bg);
    }
    this.ringBracketsMergedGeo = mergeNormalized(ringBracketGeos);

    // 2. Star geometries
    this.starGeo = new THREE.OctahedronGeometry(0.62, 0);
    this.starGyroGeo = new THREE.TorusGeometry(0.76, 0.04, 6, 20);

    // 3. Pickup geometries
    this.pickupGlassGeo = new THREE.SphereGeometry(1.14, 18, 14);
    this.pickupCapGeo = new THREE.CylinderGeometry(0.45, 0.55, 0.22, 12);
    this.pickupShieldRingGeo = new THREE.TorusGeometry(1.3, 0.06, 8, 24);
    this.pickupHeartMergedGeo = mergeNormalized([
      new THREE.BoxGeometry(1.08, 0.34, 0.34),
      new THREE.BoxGeometry(0.34, 1.08, 0.34)
    ]);
    this.pickupFrenzyCoreGeo = new THREE.OctahedronGeometry(0.75, 0);
    this.pickupOverchargeBoltGeo = new THREE.CylinderGeometry(0.28, 0.62, 1.25, 6);
    this.pickupOverchargeRingGeo = new THREE.TorusGeometry(1.25, 0.065, 8, 24);

    // 4. Plasma Mine merged geometries (15 draw calls -> 3 draw calls per mine)
    const mineBaseParts: THREE.BufferGeometry[] = [];
    const mineAccentParts: THREE.BufferGeometry[] = [
      new THREE.TorusGeometry(1.44, 0.08, 8, 24),
      new THREE.TorusGeometry(2.15, 0.075, 8, 28)
    ];
    const up = new THREE.Vector3(0, 1, 0);
    const dirs: Array<[number, number, number]> = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ];
    const q = new THREE.Quaternion();
    const dirVec = new THREE.Vector3();
    for (const [dx, dy, dz] of dirs) {
      dirVec.set(dx, dy, dz);
      q.setFromUnitVectors(up, dirVec);

      const base = new THREE.CylinderGeometry(0.18, 0.34, 0.55, 8);
      base.applyQuaternion(q);
      base.translate(dx * 1.48, dy * 1.48, dz * 1.48);
      mineBaseParts.push(base);

      const tip = new THREE.ConeGeometry(0.18, 0.58, 8);
      tip.translate(0, 0.54, 0);
      tip.applyQuaternion(q);
      tip.translate(dx * 1.48, dy * 1.48, dz * 1.48);
      mineAccentParts.push(tip);
    }
    this.mineSpikeBasesMergedGeo = mergeNormalized(mineBaseParts);
    this.mineAccentMergedGeo = mergeNormalized(mineAccentParts);

    // 5. Pylon geometries
    this.pylonPodiumGeo = new THREE.BoxGeometry(6.2, 7.5, 6.2);
    this.pylonShaftGeo = new THREE.BoxGeometry(5.0, 20, 5.0);
    this.pylonCrownGeo = new THREE.BoxGeometry(3.6, 4.2, 3.6);
    this.pylonTrimBandGeo = new THREE.BoxGeometry(5.22, 0.42, 5.22);
    this.pylonSpireGeo = new THREE.CylinderGeometry(0.08, 0.28, 4.8, 8);
    this.pylonBeaconGeo = new THREE.SphereGeometry(0.26, 8, 8);
    this.pylonBaseCylGeo = new THREE.CylinderGeometry(4.2, 4.8, 6, 8);
    this.pylonColCylGeo = new THREE.CylinderGeometry(2.8, 3.5, 22, 8);
    this.pylonCoreStripGeo = new THREE.CylinderGeometry(2.96, 2.96, 13, 8);
    const ribParts: THREE.BufferGeometry[] = [];
    for (const ry of [-3, 3, 9]) {
      const rib = new THREE.TorusGeometry(3.65, 0.28, 8, 16);
      rib.rotateX(Math.PI / 2);
      rib.translate(0, ry, 0);
      ribParts.push(rib);
    }
    this.pylonRibsMergedGeo = mergeNormalized(ribParts);
    this.pylonHaloGeo = new THREE.TorusGeometry(4.2, 0.2, 8, 20);
    this.pylonCollarGeo = new THREE.BoxGeometry(4.6, 1.1, 4.6);
    this.pylonCrystalGeo = new THREE.OctahedronGeometry(2.6, 0);

    // 6. Plasma bolt geometries
    this.boltCoreGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.65, 8);
    this.boltCoreGeo.rotateX(Math.PI / 2);
    this.boltSheathGeo = new THREE.CylinderGeometry(0.26, 0.16, 2.2, 8);
    this.boltSheathGeo.rotateX(Math.PI / 2);

    // 7. Thermal Updraft geometries
    this.thermalColGeo = new THREE.CylinderGeometry(3.2, 4.0, 22, 16, 1, true);
    const thermalRingParts: THREE.BufferGeometry[] = [];
    for (let i = -2; i <= 2; i++) {
      const r = new THREE.TorusGeometry(3.3 - Math.abs(i) * 0.2, 0.08, 6, 24);
      r.rotateX(Math.PI / 2);
      r.translate(0, i * 3.8, 0);
      thermalRingParts.push(r);
    }
    this.thermalRingsMergedGeo = mergeNormalized(thermalRingParts);

    // 8. Slipstream Tube geometries
    const slipHoops: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const hoop = new THREE.TorusGeometry(4.2, 0.08, 8, 28);
      hoop.translate(0, 0, -i * 6.5);
      slipHoops.push(hoop);
    }
    this.slipHoopsMergedGeo = mergeNormalized(slipHoops);
    this.slipShellGeo = new THREE.CylinderGeometry(4.25, 4.25, 22, 16, 1, true);
    this.slipShellGeo.rotateX(Math.PI / 2);

    // 9. Scout Drone geometries
    this.dronePodGeo = new THREE.OctahedronGeometry(1.1, 1);
    this.dronePodGeo.scale(1.2, 0.65, 1.45);
    const wingParts: THREE.BufferGeometry[] = [];
    const accentParts: THREE.BufferGeometry[] = [];
    const eyeGeo = new THREE.SphereGeometry(0.45, 12, 10);
    eyeGeo.translate(0, 0.05, 1.05);
    accentParts.push(eyeGeo);
    for (const side of [-1, 1]) {
      const wing = new THREE.BoxGeometry(1.7, 0.1, 0.85);
      wing.rotateZ(-side * 0.22);
      wing.translate(side * 1.45, 0, -0.1);
      wingParts.push(wing);

      const tip = new THREE.BoxGeometry(0.14, 0.28, 0.7);
      tip.translate(side * 2.25, -0.12, -0.1);
      accentParts.push(tip);
    }
    this.droneWingsMergedGeo = mergeNormalized(wingParts);
    this.droneAccentsMergedGeo = mergeNormalized(accentParts);

    // 10. Cargo Pod geometries
    this.cargoCrateGeo = new THREE.BoxGeometry(2.1, 1.6, 2.1);
    this.cargoFrameGeo = new THREE.BoxGeometry(2.22, 0.28, 2.22);
    this.cargoBandGeo = new THREE.BoxGeometry(0.28, 1.72, 2.22);

    // 11. Gravity Well geometries
    this.gravitySingularityGeo = new THREE.SphereGeometry(1.5, 20, 16);
    this.gravityHorizonGeo = new THREE.TorusGeometry(2.4, 0.16, 10, 32);
    this.gravityOuterGeo = new THREE.TorusGeometry(4.2, 0.1, 8, 36);

    // 12. Lock Reticle geometry
    this.lockReticleGeo = new THREE.RingGeometry(1.45, 1.65, 4);
  }

  getTextures(): ProceduralTexturePack {
    return this.textures;
  }

  animateSharedTextures(dt: number): void {
    this.textures.energyStream.offset.y -= dt * 1.95;
  }

  private getBiomeAccentMat(biomeId: StageId): THREE.MeshStandardMaterial {
    let mat = this.biomeAccentMats.get(biomeId);
    if (!mat) {
      const spec = getStageSpec(biomeId);
      mat = new THREE.MeshStandardMaterial({
        color: spec.primaryColor,
        emissive: spec.primaryColor,
        emissiveIntensity: 1.8,
        roughness: 0.2,
        metalness: 0.45
      });
      this.biomeAccentMats.set(biomeId, mat);
    }
    return mat;
  }

  private getBoltMaterials(colorHex: number): BoltMaterialSet {
    let set = this.boltMatsByColor.get(colorHex);
    if (!set) {
      set = {
        sheath: new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        }),
        glow: new THREE.SpriteMaterial({
          map: this.textures.softGlow,
          color: colorHex,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      };
      this.boltMatsByColor.set(colorHex, set);
    }
    return set;
  }

  createCyberRing(kind: 'normal' | 'warp' | 'charge'): THREE.Group {
    const grp = new THREE.Group();
    const plasmaMat =
      kind === 'warp'
        ? this.neonEmeraldMat
        : kind === 'charge'
          ? this.neonCyanMat
          : this.neonGoldMat;
    const glowMat =
      kind === 'warp'
        ? this.ringEmeraldGlowMat
        : kind === 'charge'
          ? this.ringCyanGlowMat
          : this.ringGoldGlowMat;

    const frameTorus = new THREE.Mesh(this.ringOuterGeo, this.titaniumMat);
    grp.add(frameTorus);

    const plasmaRing = new THREE.Mesh(this.ringInnerPlasmaGeo, plasmaMat);
    grp.add(plasmaRing);

    const brackets = new THREE.Mesh(this.ringBracketsMergedGeo, this.darkChassisMat);
    grp.add(brackets);

    const innerRing = new THREE.Mesh(
      this.bullseyeInnerGeo,
      kind === 'charge' ? this.neonGoldMat : this.neonCyanMat
    );
    grp.add(innerRing);

    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(7.2);
    grp.add(glow);
    return grp;
  }

  createStar(): THREE.Group {
    const grp = new THREE.Group();
    const star = new THREE.Mesh(this.starGeo, this.starMat);
    star.scale.set(1, 1.25, 0.55);
    grp.add(star);

    const gyro = new THREE.Mesh(this.starGyroGeo, this.neonGoldMat);
    gyro.rotation.x = Math.PI / 3;
    grp.add(gyro);

    const glint = new THREE.Sprite(this.starGlintMat);
    glint.scale.setScalar(2.6);
    grp.add(glint);
    return grp;
  }

  createPickup(kind: 'heart' | 'shield' | 'frenzy' | 'overcharge'): THREE.Group {
    const grp = new THREE.Group();
    const glassShell = new THREE.Mesh(this.pickupGlassGeo, this.glassCasingMat);
    const capTop = new THREE.Mesh(this.pickupCapGeo, this.titaniumMat);
    capTop.position.y = 1.12;
    const capBot = new THREE.Mesh(this.pickupCapGeo, this.titaniumMat);
    capBot.position.y = -1.12;
    capBot.rotation.x = Math.PI;
    grp.add(glassShell, capTop, capBot);

    if (kind === 'shield') {
      const orb = new THREE.Mesh(this.sphereUnitGeo, this.shieldMat);
      orb.scale.setScalar(0.68);
      const ring = new THREE.Mesh(this.pickupShieldRingGeo, this.neonCyanMat);
      ring.rotation.x = Math.PI / 3;
      grp.add(orb, ring);
    } else if (kind === 'heart') {
      const cross = new THREE.Mesh(this.pickupHeartMergedGeo, this.repairMat);
      grp.add(cross);
    } else if (kind === 'frenzy') {
      const core = new THREE.Mesh(this.pickupFrenzyCoreGeo, this.frenzyMat);
      const halo = new THREE.Mesh(this.pickupShieldRingGeo, this.neonGoldMat);
      grp.add(core, halo);
    } else {
      const bolt = new THREE.Mesh(this.pickupOverchargeBoltGeo, this.overchargeMat);
      const ring = new THREE.Mesh(this.pickupOverchargeRingGeo, this.neonCyanMat);
      ring.rotation.x = Math.PI / 2;
      grp.add(bolt, ring);
    }
    return grp;
  }

  createPlasmaMine(biomeId: StageId): THREE.Group {
    const grp = new THREE.Group();
    const core = new THREE.Mesh(this.sphereUnitGeo, this.mineCoreMat);
    core.scale.setScalar(1.42);
    grp.add(core);

    const accentMat = biomeId === 3 ? this.neonMagentaMat : this.mineDangerMat;
    const spikeBases = new THREE.Mesh(this.mineSpikeBasesMergedGeo, this.darkChassisMat);
    const accents = new THREE.Mesh(this.mineAccentMergedGeo, accentMat);
    grp.add(spikeBases, accents);
    return grp;
  }

  createLaserGate(orientation: 'horizontal' | 'vertical', gapCenter: number, gapHalf = 4.6): THREE.Group {
    const grp = new THREE.Group();
    const spanLimit = 22;

    const posts: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(this.boxUnitGeo, this.pylonBodyMat);
      post.scale.set(1.4, 24, 1.4);
      post.position.set(side * spanLimit, 2, 0);
      grp.add(post);
      posts.push(post);
    }

    const createWallSlot = (): LaserWallSlot => {
      const wg = new THREE.Group();
      const field = new THREE.Mesh(this.boxUnitGeo, this.laserGlowMat);
      wg.add(field);
      const bars: THREE.Mesh[] = [];
      for (let i = 0; i < 4; i++) {
        const bar = new THREE.Mesh(this.boxUnitGeo, this.laserCoreMat);
        wg.add(bar);
        bars.push(bar);
      }
      grp.add(wg);
      return { group: wg, field, bars };
    };

    const walls: [LaserWallSlot, LaserWallSlot] = [createWallSlot(), createWallSlot()];
    grp.userData.laserRig = { orientation, posts, walls } satisfies LaserGateRig;
    this.configureLaserGate(grp, orientation, gapCenter, gapHalf);
    return grp;
  }

  configureLaserGate(
    grp: THREE.Group,
    orientation: 'horizontal' | 'vertical',
    gapCenter: number,
    gapHalf = 4.6
  ): void {
    const rig = grp.userData.laserRig as LaserGateRig | undefined;
    if (!rig) return;
    rig.orientation = orientation;
    const spanLimit = 22;

    for (const p of rig.posts) {
      p.visible = orientation === 'vertical';
    }

    const setupWall = (
      slot: LaserWallSlot,
      visible: boolean,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      isVerticalWall: boolean
    ) => {
      slot.group.visible = visible;
      if (!visible) return;
      slot.group.position.set(x, y, 0);
      slot.field.scale.set(w, h, d);
      const barCount = slot.bars.length;
      for (let i = 0; i < barCount; i++) {
        const bar = slot.bars[i];
        const frac = -0.45 + (i / (barCount - 1)) * 0.9;
        if (isVerticalWall) {
          bar.scale.set(0.24, h, 0.32);
          bar.position.set(w * frac, 0, 0);
        } else {
          bar.scale.set(w, 0.24, 0.32);
          bar.position.set(0, h * frac, 0);
        }
      }
    };

    if (orientation === 'vertical') {
      const topHeight = Math.max(1.5, 13 - (gapCenter + gapHalf));
      const botHeight = Math.max(1.5, gapCenter - gapHalf + 9);
      setupWall(
        rig.walls[0],
        gapCenter + gapHalf < 12.5,
        spanLimit * 2,
        topHeight,
        0.3,
        0,
        gapCenter + gapHalf + topHeight * 0.5,
        false
      );
      setupWall(
        rig.walls[1],
        gapCenter - gapHalf > -8.5,
        spanLimit * 2,
        botHeight,
        0.3,
        0,
        gapCenter - gapHalf - botHeight * 0.5,
        false
      );
    } else {
      const leftWidth = Math.max(2, gapCenter - gapHalf + spanLimit);
      const rightWidth = Math.max(2, spanLimit - (gapCenter + gapHalf));
      setupWall(
        rig.walls[0],
        gapCenter - gapHalf > -spanLimit + 1,
        leftWidth,
        22,
        0.3,
        -spanLimit + leftWidth * 0.5,
        2,
        true
      );
      setupWall(
        rig.walls[1],
        gapCenter + gapHalf < spanLimit - 1,
        rightWidth,
        22,
        0.3,
        gapCenter + gapHalf + rightWidth * 0.5,
        2,
        true
      );
    }
  }

  createCyberPylon(biomeId: StageId, variant: number, scale = 1): PylonVariant {
    const group = new THREE.Group();
    const accentMat = this.getBiomeAccentMat(biomeId);

    if (variant % 3 === 0) {
      const podium = new THREE.Mesh(this.pylonPodiumGeo, this.darkChassisMat);
      podium.position.y = -8.2;

      const shaft = new THREE.Mesh(this.pylonShaftGeo, this.pylonBodyMat);
      shaft.position.y = 1.5;

      const crown = new THREE.Mesh(this.pylonCrownGeo, this.pylonBodyMat);
      crown.position.y = 13.2;

      const trimBand = new THREE.Mesh(this.pylonTrimBandGeo, accentMat);
      trimBand.position.y = 11.4;

      const spire = new THREE.Mesh(this.pylonSpireGeo, this.titaniumMat);
      spire.position.y = 17.6;

      const beacon = new THREE.Mesh(this.pylonBeaconGeo, this.aviationBeaconMat);
      beacon.position.y = 20.1;

      group.add(podium, shaft, crown, trimBand, spire, beacon);
    } else if (variant % 3 === 1) {
      const base = new THREE.Mesh(this.pylonBaseCylGeo, this.darkChassisMat);
      base.position.y = -9;

      const col = new THREE.Mesh(this.pylonColCylGeo, this.pylonBodyMat);
      col.position.y = 2;

      const coreStrip = new THREE.Mesh(this.pylonCoreStripGeo, this.streamMat);
      coreStrip.position.y = 2;

      const ribs = new THREE.Mesh(this.pylonRibsMergedGeo, this.titaniumMat);

      const halo = new THREE.Mesh(this.pylonHaloGeo, accentMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 12.2;
      group.add(base, col, coreStrip, ribs, halo);
    } else {
      const mast = new THREE.Mesh(this.boxUnitGeo, this.pylonBodyMat);
      mast.scale.set(4.1, 22, 4.1);

      const collar = new THREE.Mesh(this.pylonCollarGeo, this.titaniumMat);
      collar.position.y = 11.2;

      const crystal = new THREE.Mesh(this.pylonCrystalGeo, accentMat);
      crystal.position.y = 14.4;

      const beacon = new THREE.Mesh(this.pylonBeaconGeo, this.aviationBeaconMat);
      beacon.scale.setScalar(0.92);
      beacon.position.y = 17.3;

      group.add(mast, collar, crystal, beacon);
    }

    group.scale.setScalar(scale);
    return {
      group,
      collisionRadius: 3.4 * scale
    };
  }

  createPlasmaBolt(colorHex = 0x00f0ff): THREE.Group {
    const grp = new THREE.Group();
    const mats = this.getBoltMaterials(colorHex);
    const core = new THREE.Mesh(this.boltCoreGeo, this.boltCoreMat);
    const sheath = new THREE.Mesh(this.boltSheathGeo, mats.sheath);
    const glow = new THREE.Sprite(mats.glow);
    glow.scale.setScalar(1.8);
    grp.add(core, sheath, glow);
    grp.userData.boltRig = { sheath, glow } satisfies PlasmaBoltRig;
    return grp;
  }

  setPlasmaBoltColor(grp: THREE.Group, colorHex: number): void {
    const rig = grp.userData.boltRig as PlasmaBoltRig | undefined;
    if (!rig) return;
    const mats = this.getBoltMaterials(colorHex);
    rig.sheath.material = mats.sheath;
    rig.glow.material = mats.glow;
  }

  createThermalUpdraft(): THREE.Group {
    const grp = new THREE.Group();
    const column = new THREE.Mesh(this.thermalColGeo, this.thermalColMat);
    const rings = new THREE.Mesh(this.thermalRingsMergedGeo, this.neonEmeraldMat);
    grp.add(column, rings);
    return grp;
  }

  createSlipstreamTube(): THREE.Group {
    const grp = new THREE.Group();
    const hoops = new THREE.Mesh(this.slipHoopsMergedGeo, this.slipHoopMat);
    const shell = new THREE.Mesh(this.slipShellGeo, this.slipShellMat);
    shell.position.z = -10;
    grp.add(hoops, shell);
    return grp;
  }

  createScoutDrone(biomeId: StageId): THREE.Group {
    const grp = new THREE.Group();
    const accentMat = biomeId === 2 ? this.neonGoldMat : this.neonMagentaMat;
    const pod = new THREE.Mesh(this.dronePodGeo, this.titaniumMat);
    const wings = new THREE.Mesh(this.droneWingsMergedGeo, this.darkChassisMat);
    const accents = new THREE.Mesh(this.droneAccentsMergedGeo, accentMat);
    grp.add(pod, wings, accents);
    return grp;
  }

  createCargoPod(): THREE.Group {
    const grp = new THREE.Group();
    const crate = new THREE.Mesh(this.cargoCrateGeo, this.titaniumMat);
    const frame = new THREE.Mesh(this.cargoFrameGeo, this.neonGoldMat);
    const bandV = new THREE.Mesh(this.cargoBandGeo, this.neonCyanMat);
    const glow = new THREE.Sprite(this.cargoGlowMat);
    glow.scale.setScalar(4.8);
    grp.add(crate, frame, bandV, glow);
    return grp;
  }

  createGravityWell(): THREE.Group {
    const grp = new THREE.Group();
    const singularity = new THREE.Mesh(this.gravitySingularityGeo, this.gravitySingularityMat);
    const eventHorizon = new THREE.Mesh(this.gravityHorizonGeo, this.overchargeMat);
    eventHorizon.rotation.x = Math.PI / 3;
    const outerAccretion = new THREE.Mesh(this.gravityOuterGeo, this.neonCyanMat);
    outerAccretion.rotation.x = -Math.PI / 3.5;
    const glow = new THREE.Sprite(this.gravityGlowMat);
    glow.scale.setScalar(11);
    grp.add(singularity, eventHorizon, outerAccretion, glow);
    return grp;
  }

  createLockReticle(): THREE.Group {
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(this.lockReticleGeo, this.lockReticleMat);
    grp.add(ring);
    return grp;
  }
}
