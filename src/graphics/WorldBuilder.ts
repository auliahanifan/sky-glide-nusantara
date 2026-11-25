import * as THREE from 'three';
import type { ProceduralTexturePack } from './ProceduralTextures';

export interface IslandVariant {
  group: THREE.Group;
  windmillBlades: THREE.Object3D[];
  collisionRadius: number;
}

export class WorldBuilder {
  private readonly grassMat: THREE.MeshStandardMaterial;
  private readonly cliffMat: THREE.MeshStandardMaterial;
  private readonly treeCanopyMat: THREE.MeshStandardMaterial;
  private readonly treeCanopyWarmMat: THREE.MeshStandardMaterial;
  private readonly trunkMat: THREE.MeshStandardMaterial;
  private readonly roofMat: THREE.MeshStandardMaterial;
  private readonly wallMat: THREE.MeshStandardMaterial;
  private readonly woodMat: THREE.MeshStandardMaterial;
  private readonly waterfallMat: THREE.MeshStandardMaterial;
  private readonly cloudMat: THREE.MeshStandardMaterial;
  private readonly thunderCloudMat: THREE.MeshStandardMaterial;
  private readonly lightningMat: THREE.MeshBasicMaterial;
  private readonly goldMat: THREE.MeshStandardMaterial;
  private readonly starMat: THREE.MeshStandardMaterial;
  private readonly heartMat: THREE.MeshStandardMaterial;
  private readonly shieldMat: THREE.MeshStandardMaterial;
  private readonly textures: ProceduralTexturePack;

  // Shared geometries for fast instancing/cloning on mobile
  private readonly ringGeo = new THREE.TorusGeometry(2.75, 0.32, 12, 32);
  private readonly starGeo = new THREE.OctahedronGeometry(0.62, 0);
  private readonly sphereUnitGeo = new THREE.SphereGeometry(1, 14, 12);
  private readonly coneUnitGeo = new THREE.ConeGeometry(1, 1, 10);

  constructor(textures: ProceduralTexturePack) {
    this.textures = textures;

    this.grassMat = new THREE.MeshStandardMaterial({
      map: textures.grassTop,
      roughness: 0.78,
      metalness: 0.02
    });
    this.cliffMat = new THREE.MeshStandardMaterial({
      map: textures.cliffRock,
      roughness: 0.88,
      metalness: 0.02
    });
    this.treeCanopyMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      roughness: 0.65,
      metalness: 0.02
    });
    this.treeCanopyWarmMat = new THREE.MeshStandardMaterial({
      color: 0x84cc16,
      roughness: 0.65,
      metalness: 0.02
    });
    this.trunkMat = new THREE.MeshStandardMaterial({
      color: 0x92400e,
      roughness: 0.82
    });
    this.roofMat = new THREE.MeshStandardMaterial({
      map: textures.cottageRoof,
      roughness: 0.62
    });
    this.wallMat = new THREE.MeshStandardMaterial({
      map: textures.cottageWall,
      roughness: 0.68
    });
    this.woodMat = new THREE.MeshStandardMaterial({
      map: textures.woodWing,
      roughness: 0.52
    });
    this.waterfallMat = new THREE.MeshStandardMaterial({
      map: textures.waterfall,
      roughness: 0.25,
      metalness: 0.05,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.92
    });
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
      emissive: 0xe0f2fe,
      emissiveIntensity: 0.12
    });
    this.thunderCloudMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.88,
      emissive: 0x312e81,
      emissiveIntensity: 0.28
    });
    this.lightningMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a
    });
    this.goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.82
    });
    this.starMat = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      emissive: 0xfacc15,
      emissiveIntensity: 0.65,
      roughness: 0.18,
      metalness: 0.65
    });
    this.heartMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xe11d48,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.2
    });
    this.shieldMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.65,
      roughness: 0.12,
      metalness: 0.35,
      transparent: true,
      opacity: 0.86
    });
  }

  animateSharedTextures(dt: number): void {
    this.textures.waterfall.offset.y -= dt * 1.45;
  }

  createFloatingIsland(variantIndex: number, scale = 1): IslandVariant {
    const group = new THREE.Group();
    const windmillBlades: THREE.Object3D[] = [];

    // Tapered floating rock base + rounded grassy top cap
    const baseRock = new THREE.Mesh(
      new THREE.ConeGeometry(7.2, 10.5, 9),
      this.cliffMat
    );
    baseRock.rotation.x = Math.PI;
    baseRock.position.y = -5.2;
    baseRock.castShadow = true;
    baseRock.receiveShadow = true;
    group.add(baseRock);

    const grassCap = new THREE.Mesh(
      new THREE.CylinderGeometry(7.5, 6.8, 1.8, 12),
      this.grassMat
    );
    grassCap.position.y = 0.2;
    grassCap.receiveShadow = true;
    grassCap.castShadow = true;
    group.add(grassCap);

    // Toy rounded trees on every island
    const treeCount = 4 + (variantIndex % 3);
    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + variantIndex;
      const dist = 3.6 + (i % 2) * 1.9;
      const tree = this.createToyTree(i % 2 === 0);
      tree.position.set(Math.cos(angle) * dist, 1.0, Math.sin(angle) * dist);
      group.add(tree);
    }

    if (variantIndex % 3 === 0) {
      // Variant 0: Windmill Village Island
      const windmill = this.createWindmill();
      windmill.root.position.set(-1.5, 1.1, -1.0);
      group.add(windmill.root);
      windmillBlades.push(windmill.blades);

      const cottage = this.createCottage();
      cottage.position.set(2.2, 1.1, 1.2);
      cottage.rotation.y = -0.5;
      group.add(cottage);
    } else if (variantIndex % 3 === 1) {
      // Variant 1: Waterfall Sanctuary Island
      const stream = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 0.35, 4.6),
        this.waterfallMat
      );
      stream.position.set(0, 1.05, 2.5);
      group.add(stream);

      const fall = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 15.5),
        this.waterfallMat
      );
      fall.material = this.waterfallMat.clone();
      fall.material.side = THREE.DoubleSide;
      fall.position.set(0, -6.7, 5.1);
      group.add(fall);

      // Cloud splash mist at bottom of waterfall
      const mist = this.createFluffyCloud(1.3);
      mist.position.set(0, -13.5, 5.1);
      group.add(mist);

      const cottage = this.createCottage();
      cottage.position.set(-2.2, 1.1, -1.6);
      cottage.rotation.y = 0.6;
      group.add(cottage);
    } else {
      // Variant 2: Twin Windmill Lookout
      const millA = this.createWindmill();
      millA.root.position.set(1.6, 1.1, -1.4);
      millA.root.scale.setScalar(0.92);
      group.add(millA.root);
      windmillBlades.push(millA.blades);

      const pond = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 2.2, 0.2, 14),
        this.waterfallMat
      );
      pond.position.set(-2.1, 1.12, 1.5);
      group.add(pond);
    }

    group.scale.setScalar(scale);
    return {
      group,
      windmillBlades,
      collisionRadius: 7.4 * scale
    };
  }

  createFluffyCloud(scale = 1): THREE.Group {
    const grp = new THREE.Group();
    const puffs: Array<[number, number, number, number]> = [
      [0, 0, 0, 2.1],
      [-1.7, -0.35, 0.2, 1.55],
      [1.75, -0.3, -0.15, 1.65],
      [0.45, 0.7, 0.35, 1.45],
      [-0.75, 0.5, -0.3, 1.35]
    ];
    for (const [x, y, z, r] of puffs) {
      const m = new THREE.Mesh(this.sphereUnitGeo, this.cloudMat);
      m.position.set(x, y, z);
      m.scale.setScalar(r);
      grp.add(m);
    }
    grp.scale.setScalar(scale);
    return grp;
  }

  createHotAirBalloon(paletteIdx: number): THREE.Group {
    const colors = [0xf43f5e, 0xf59e0b, 0x06b6d4, 0x8b5cf6, 0x10b981];
    const grp = new THREE.Group();

    const balloonMat = new THREE.MeshStandardMaterial({
      color: colors[paletteIdx % colors.length],
      roughness: 0.42
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xfef9c3,
      roughness: 0.48
    });

    const envelope = new THREE.Mesh(this.sphereUnitGeo, balloonMat);
    envelope.scale.set(2.3, 2.8, 2.3);
    envelope.position.y = 2.4;
    grp.add(envelope);

    const band = new THREE.Mesh(new THREE.TorusGeometry(2.26, 0.24, 8, 20), stripeMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 2.3;
    grp.add(band);

    const basket = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), this.woodMat);
    basket.position.y = -1.3;
    grp.add(basket);

    const ropeGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5);
    for (const sx of [-0.45, 0.45]) {
      for (const sz of [-0.45, 0.45]) {
        const rope = new THREE.Mesh(ropeGeo, this.trunkMat);
        rope.position.set(sx, -0.2, sz);
        grp.add(rope);
      }
    }
    return grp;
  }

  createGoldenRing(): THREE.Group {
    const grp = new THREE.Group();
    const torus = new THREE.Mesh(this.ringGeo, this.goldMat);
    grp.add(torus);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textures.softGlow,
        color: 0xfef08a,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    glow.scale.setScalar(7.8);
    grp.add(glow);
    return grp;
  }

  createStar(): THREE.Group {
    const grp = new THREE.Group();
    const star = new THREE.Mesh(this.starGeo, this.starMat);
    star.scale.set(1, 1.2, 0.55);
    grp.add(star);

    const glint = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textures.softGlow,
        color: 0xfef08a,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    glint.scale.setScalar(2.4);
    grp.add(glint);
    return grp;
  }

  createHeartPickup(): THREE.Group {
    const grp = new THREE.Group();
    const lobeA = new THREE.Mesh(this.sphereUnitGeo, this.heartMat);
    lobeA.scale.setScalar(0.42);
    lobeA.position.set(-0.28, 0.2, 0);
    const lobeB = lobeA.clone();
    lobeB.position.x = 0.28;
    const tip = new THREE.Mesh(this.coneUnitGeo, this.heartMat);
    tip.rotation.x = Math.PI;
    tip.scale.set(0.66, 0.85, 0.42);
    tip.position.y = -0.22;
    grp.add(lobeA, lobeB, tip);
    return grp;
  }

  createShieldPickup(): THREE.Group {
    const grp = new THREE.Group();
    const orb = new THREE.Mesh(this.sphereUnitGeo, this.shieldMat);
    orb.scale.setScalar(0.85);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), this.goldMat);
    grp.add(orb, core);
    return grp;
  }

  createThundercloud(): THREE.Group {
    const grp = new THREE.Group();
    const puffs: Array<[number, number, number, number]> = [
      [0, 0.2, 0, 1.9],
      [-1.5, -0.1, 0.2, 1.4],
      [1.5, -0.1, -0.2, 1.4],
      [0.3, 0.8, 0.3, 1.3],
      [-0.5, 0.6, -0.3, 1.25]
    ];
    for (const [x, y, z, r] of puffs) {
      const m = new THREE.Mesh(this.sphereUnitGeo, this.thunderCloudMat);
      m.position.set(x, y, z);
      m.scale.setScalar(r);
      grp.add(m);
    }

    // Bright cartoon lightning bolt underneath for clear kid-friendly readability
    const boltA = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.2, 0.25), this.lightningMat);
    boltA.position.set(-0.2, -1.25, 0);
    boltA.rotation.z = -0.32;
    const boltB = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.15, 0.25), this.lightningMat);
    boltB.position.set(0.15, -2.0, 0);
    boltB.rotation.z = 0.28;
    grp.add(boltA, boltB);

    return grp;
  }

  private createToyTree(warmGreen: boolean): THREE.Group {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.3, 7), this.trunkMat);
    trunk.position.y = 0.65;
    trunk.castShadow = true;
    tree.add(trunk);

    const mat = warmGreen ? this.treeCanopyWarmMat : this.treeCanopyMat;
    const canopy = new THREE.Mesh(this.sphereUnitGeo, mat);
    canopy.scale.set(1.05, 1.15, 1.05);
    canopy.position.y = 1.75;
    canopy.castShadow = true;
    tree.add(canopy);
    return tree;
  }

  private createCottage(): THREE.Group {
    const grp = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.6, 2.0), this.wallMat);
    walls.position.y = 0.8;
    walls.castShadow = true;
    grp.add(walls);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.3, 4), this.roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.2;
    roof.castShadow = true;
    grp.add(roof);

    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), this.cliffMat);
    chimney.position.set(0.55, 2.35, -0.35);
    grp.add(chimney);

    return grp;
  }

  private createWindmill(): { root: THREE.Group; blades: THREE.Group } {
    const root = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.25, 3.8, 10), this.wallMat);
    tower.position.y = 1.9;
    tower.castShadow = true;
    root.add(tower);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.1, 10), this.roofMat);
    cap.position.y = 4.35;
    cap.castShadow = true;
    root.add(cap);

    const blades = new THREE.Group();
    blades.position.set(0, 3.45, 0.98);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;

      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.1, 0.08), this.trunkMat);
      spar.position.y = 1.05;
      const sail = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.55, 0.04), this.cloudMat);
      sail.position.set(0.24, 1.25, 0.02);
      arm.add(spar, sail);
      blades.add(arm);
    }
    root.add(blades);

    return { root, blades };
  }
}
