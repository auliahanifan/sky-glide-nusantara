import * as THREE from 'three';
import { getAviatorSpec, getWingSpec } from '../data/catalog';
import type { AviatorId, WingId } from '../types/game';
import type { ProceduralTexturePack } from './ProceduralTextures';

export class PlayerGlider {
  readonly root = new THREE.Group();
  readonly visualPivot = new THREE.Group();

  private readonly jacketMat: THREE.MeshStandardMaterial;
  private readonly helmetMat: THREE.MeshStandardMaterial;
  private readonly scarfMat: THREE.MeshStandardMaterial;
  private readonly wingPrimaryMat: THREE.MeshStandardMaterial;
  private readonly wingTrimMat: THREE.MeshStandardMaterial;

  private readonly wingGroup = new THREE.Group();
  private readonly scarfSegments: THREE.Mesh[] = [];
  private readonly flameLeft: THREE.Mesh;
  private readonly flameRight: THREE.Mesh;
  private readonly shieldBubble: THREE.Mesh;
  private readonly thrusterGlowLeft: THREE.Sprite;
  private readonly thrusterGlowRight: THREE.Sprite;

  private currentWingId: WingId = 'classic_wood';
  private rollAngle = 0; // Barrel roll animation progress (0..2PI)
  private isRolling = false;
  private elapsed = 0;

  constructor(textures: ProceduralTexturePack) {
    this.root.add(this.visualPivot);

    // Core Toy-PBR Materials
    this.jacketMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.48,
      metalness: 0.05
    });
    this.helmetMat = new THREE.MeshStandardMaterial({
      color: 0x7c3f1d,
      roughness: 0.36,
      metalness: 0.1
    });
    this.scarfMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.55,
      metalness: 0.02
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xfcd5b5,
      roughness: 0.55,
      metalness: 0.0
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x9a7b56,
      roughness: 0.72,
      metalness: 0.02
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x4b2c17,
      roughness: 0.45,
      metalness: 0.08
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.24,
      metalness: 0.78
    });
    const goggleGlassMat = new THREE.MeshStandardMaterial({
      color: 0x67e8f9,
      roughness: 0.12,
      metalness: 0.3,
      emissive: 0x0284c7,
      emissiveIntensity: 0.25
    });

    this.wingPrimaryMat = new THREE.MeshStandardMaterial({
      map: textures.woodWing,
      color: 0xffffff,
      roughness: 0.44,
      metalness: 0.08
    });
    this.wingTrimMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.26,
      metalness: 0.72
    });

    // 1. Kid Explorer Body (horizontal flying pose along -Z)
    const bodyGroup = new THREE.Group();
    bodyGroup.position.set(0, 0.16, 0.05);
    this.visualPivot.add(bodyGroup);

    // Torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.48, 8, 14), this.jacketMat);
    torso.rotation.x = Math.PI * 0.46;
    torso.castShadow = true;
    bodyGroup.add(torso);

    // Head + Helmet
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.14, -0.46);
    bodyGroup.add(headGroup);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 14), skinMat);
    head.castShadow = true;
    headGroup.add(head);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.295, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.64),
      this.helmetMat
    );
    helmet.rotation.x = -0.18;
    helmet.castShadow = true;
    headGroup.add(helmet);

    // Ear flaps
    const flapGeo = new THREE.SphereGeometry(0.11, 10, 10);
    const leftFlap = new THREE.Mesh(flapGeo, this.helmetMat);
    leftFlap.scale.set(0.45, 1.1, 0.9);
    leftFlap.position.set(-0.27, -0.04, 0.02);
    const rightFlap = leftFlap.clone();
    rightFlap.position.x = 0.27;
    headGroup.add(leftFlap, rightFlap);

    // Aviator Goggles perched on helmet front
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.032, 8, 20), bootMat);
    strap.rotation.x = Math.PI * 0.44;
    strap.position.y = 0.05;
    headGroup.add(strap);

    const lensGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.06, 12);
    const rimGeo = new THREE.TorusGeometry(0.088, 0.018, 8, 14);
    for (const side of [-1, 1]) {
      const goggle = new THREE.Group();
      goggle.position.set(side * 0.11, 0.14, -0.25);
      goggle.rotation.x = -0.35;
      goggle.rotation.y = side * 0.22;

      const lens = new THREE.Mesh(lensGeo, goggleGlassMat);
      lens.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(rimGeo, brassMat);
      rim.position.z = -0.025;
      goggle.add(lens, rim);
      headGroup.add(goggle);
    }

    // Arms reaching forward/outward
    const armGeo = new THREE.CapsuleGeometry(0.09, 0.34, 6, 10);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.jacketMat);
      arm.position.set(side * 0.32, -0.02, -0.22);
      arm.rotation.z = side * 0.65;
      arm.rotation.x = 0.95;
      arm.castShadow = true;
      bodyGroup.add(arm);

      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 10), bootMat);
      glove.position.set(side * 0.45, -0.1, -0.36);
      bodyGroup.add(glove);
    }

    // Legs & Boots trailing behind
    const legGeo = new THREE.CapsuleGeometry(0.11, 0.34, 6, 10);
    const bootGeo = new THREE.CapsuleGeometry(0.115, 0.16, 6, 10);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, pantsMat);
      leg.position.set(side * 0.14, -0.08, 0.46);
      leg.rotation.x = Math.PI * 0.48 + (side === 1 ? 0.14 : -0.08);
      leg.castShadow = true;
      bodyGroup.add(leg);

      const boot = new THREE.Mesh(bootGeo, bootMat);
      boot.position.set(side * 0.15, -0.12, 0.72);
      boot.rotation.x = Math.PI * 0.35;
      boot.castShadow = true;
      bodyGroup.add(boot);
    }

    // 2. Flowing Multi-Segment Red Scarf
    const scarfAnchor = new THREE.Group();
    scarfAnchor.position.set(0, 0.14, -0.24);
    bodyGroup.add(scarfAnchor);
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.068 - i * 0.008, 0.18, 6, 8),
        this.scarfMat
      );
      seg.rotation.x = Math.PI / 2;
      seg.position.set(0, 0.04 + i * 0.015, 0.12 + i * 0.18);
      seg.castShadow = true;
      scarfAnchor.add(seg);
      this.scarfSegments.push(seg);
    }

    // 3. Wooden-and-Brass Twin Jetpack
    const jetpackGroup = new THREE.Group();
    jetpackGroup.position.set(0, 0.34, 0.12);
    this.visualPivot.add(jetpackGroup);

    const woodTankMat = new THREE.MeshStandardMaterial({
      map: textures.woodWing,
      roughness: 0.45,
      metalness: 0.08
    });
    const tankGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.68, 14);
    const bandGeo = new THREE.CylinderGeometry(0.175, 0.175, 0.08, 14);
    const nozzleGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.18, 14);

    for (const side of [-1, 1]) {
      const tank = new THREE.Mesh(tankGeo, woodTankMat);
      tank.rotation.x = Math.PI * 0.48;
      tank.position.set(side * 0.21, 0, 0);
      tank.castShadow = true;
      jetpackGroup.add(tank);

      const bandFront = new THREE.Mesh(bandGeo, brassMat);
      bandFront.rotation.x = Math.PI * 0.48;
      bandFront.position.set(side * 0.21, 0.02, -0.18);
      const bandBack = bandFront.clone();
      bandBack.position.set(side * 0.21, -0.02, 0.18);
      jetpackGroup.add(bandFront, bandBack);

      const nozzle = new THREE.Mesh(nozzleGeo, brassMat);
      nozzle.rotation.x = Math.PI * 0.48;
      nozzle.position.set(side * 0.21, -0.04, 0.38);
      jetpackGroup.add(nozzle);
    }

    // Center brass bridge
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.28), brassMat);
    jetpackGroup.add(bridge);

    // Thruster flames + glows
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.92
    });
    const flameGeo = new THREE.ConeGeometry(0.13, 0.55, 10);
    flameGeo.rotateX(Math.PI / 2);

    this.flameLeft = new THREE.Mesh(flameGeo, flameMat);
    this.flameLeft.position.set(-0.21, -0.05, 0.68);
    this.flameRight = new THREE.Mesh(flameGeo, flameMat);
    this.flameRight.position.set(0.21, -0.05, 0.68);
    jetpackGroup.add(this.flameLeft, this.flameRight);

    const glowMat = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.thrusterGlowLeft = new THREE.Sprite(glowMat);
    this.thrusterGlowLeft.position.set(-0.21, -0.05, 0.52);
    this.thrusterGlowLeft.scale.setScalar(0.85);
    this.thrusterGlowRight = new THREE.Sprite(glowMat);
    this.thrusterGlowRight.position.set(0.21, -0.05, 0.52);
    this.thrusterGlowRight.scale.setScalar(0.85);
    jetpackGroup.add(this.thrusterGlowLeft, this.thrusterGlowRight);

    // 4. Swappable Wing Assembly
    this.wingGroup.position.set(0, 0.24, 0.04);
    this.visualPivot.add(this.wingGroup);
    this.rebuildWingGeometry('classic_wood');

    // 5. Bubble Shield Sphere
    const shieldGeo = new THREE.SphereGeometry(1.55, 22, 18);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x67e8f9,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.5,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    this.shieldBubble = new THREE.Mesh(shieldGeo, shieldMat);
    this.shieldBubble.visible = false;
    this.visualPivot.add(this.shieldBubble);
  }

  applyCosmetics(wingId: WingId, aviatorId: AviatorId): void {
    const wing = getWingSpec(wingId);
    const aviator = getAviatorSpec(aviatorId);

    this.jacketMat.color.setHex(aviator.jacketColor);
    this.scarfMat.color.setHex(aviator.scarfColor);
    this.helmetMat.color.setHex(aviator.helmetColor);

    this.wingPrimaryMat.color.setHex(wingId === 'classic_wood' ? 0xffffff : wing.primaryColor);
    this.wingPrimaryMat.emissive.setHex(wing.emissiveColor);
    this.wingPrimaryMat.emissiveIntensity = wing.emissiveColor ? 0.28 : 0;
    this.wingTrimMat.color.setHex(wing.trimColor);

    if (wingId !== this.currentWingId) {
      this.currentWingId = wingId;
      this.rebuildWingGeometry(wingId);
    }
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

  getThrusterWorldPositions(outLeft: THREE.Vector3, outRight: THREE.Vector3): void {
    this.flameLeft.getWorldPosition(outLeft);
    this.flameRight.getWorldPosition(outRight);
  }

  update(
    dt: number,
    steerX: number,
    steerY: number,
    boosting: boolean,
    invincibleTimer: number,
    shieldActive: boolean
  ): void {
    this.elapsed += dt;

    // Smooth bank & pitch response
    const targetBank = -steerX * 0.62;
    const targetPitch = steerY * 0.36;

    if (this.isRolling) {
      this.rollAngle += dt * Math.PI * 4.4; // ~0.45s crisp spin
      if (this.rollAngle >= Math.PI * 2) {
        this.rollAngle = 0;
        this.isRolling = false;
      }
    }

    const baseRoll = THREE.MathUtils.lerp(this.visualPivot.rotation.z, targetBank, Math.min(1, dt * 10));
    this.visualPivot.rotation.z = this.isRolling ? baseRoll + this.rollAngle : baseRoll;
    this.visualPivot.rotation.x = THREE.MathUtils.lerp(
      this.visualPivot.rotation.x,
      targetPitch,
      Math.min(1, dt * 9)
    );
    this.visualPivot.position.y = Math.sin(this.elapsed * 4.2) * 0.06;

    // Animated scarf flutter
    const flutterSpeed = boosting ? 22 : 12;
    for (let i = 0; i < this.scarfSegments.length; i++) {
      const seg = this.scarfSegments[i];
      const wave = Math.sin(this.elapsed * flutterSpeed - i * 0.9);
      seg.position.x = wave * (0.04 + i * 0.025) - steerX * (0.03 * i);
      seg.position.y = 0.04 + i * 0.015 + Math.cos(this.elapsed * (flutterSpeed * 0.8) - i) * 0.025;
    }

    // Animated thruster flame cones
    const flicker = 0.88 + Math.sin(this.elapsed * 42) * 0.16;
    const lenScale = (boosting ? 2.15 : 1.0) * flicker;
    const radScale = boosting ? 1.35 : 0.95;
    this.flameLeft.scale.set(radScale, radScale, lenScale);
    this.flameRight.scale.set(radScale, radScale, lenScale);

    const glowScale = (boosting ? 1.45 : 0.82) * flicker;
    this.thrusterGlowLeft.scale.setScalar(glowScale);
    this.thrusterGlowRight.scale.setScalar(glowScale);

    // Friendly invincibility blink
    if (invincibleTimer > 0) {
      this.visualPivot.visible = Math.floor(invincibleTimer * 14) % 2 === 0;
    } else {
      this.visualPivot.visible = true;
    }

    // Shield bubble pulse
    this.shieldBubble.visible = shieldActive;
    if (shieldActive) {
      const s = 1 + Math.sin(this.elapsed * 5) * 0.04;
      this.shieldBubble.scale.setScalar(s);
    }
  }

  private rebuildWingGeometry(wingId: WingId): void {
    while (this.wingGroup.children.length > 0) {
      const child = this.wingGroup.children[0];
      this.wingGroup.remove(child);
    }

    const createPanel = (span: number, chord: number, thickness: number, sweep: number, dihedral: number) => {
      const grp = new THREE.Group();
      for (const side of [-1, 1]) {
        const wingPivot = new THREE.Group();
        wingPivot.position.set(side * 0.22, 0, 0);
        wingPivot.rotation.z = side * dihedral;
        wingPivot.rotation.y = -side * sweep;

        const plank = new THREE.Mesh(
          new THREE.BoxGeometry(span, thickness, chord),
          this.wingPrimaryMat
        );
        plank.position.set(side * (span * 0.5), 0, 0);
        plank.castShadow = true;
        wingPivot.add(plank);

        const tipTrim = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, thickness * 1.15, chord * 0.92),
          this.wingTrimMat
        );
        tipTrim.position.set(side * (span + 0.05), 0, 0.03);
        wingPivot.add(tipTrim);

        const leadingBar = new THREE.Mesh(
          new THREE.CylinderGeometry(thickness * 0.65, thickness * 0.65, span, 10),
          this.wingTrimMat
        );
        leadingBar.rotation.z = Math.PI / 2;
        leadingBar.position.set(side * (span * 0.5), 0, -chord * 0.48);
        wingPivot.add(leadingBar);

        grp.add(wingPivot);
      }
      return grp;
    };

    if (wingId === 'classic_wood') {
      this.wingGroup.add(createPanel(1.38, 0.58, 0.075, 0.18, 0.08));
    } else if (wingId === 'sky_dragon') {
      const main = createPanel(1.52, 0.52, 0.065, 0.36, 0.14);
      const tailFin = createPanel(0.55, 0.28, 0.05, 0.45, -0.1);
      tailFin.position.set(0, 0.05, 0.48);
      this.wingGroup.add(main, tailFin);
    } else if (wingId === 'starlight_prism') {
      const main = createPanel(1.48, 0.56, 0.06, 0.28, 0.12);
      // Add shimmering crystal wingtips
      for (const side of [-1, 1]) {
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), this.wingTrimMat);
        crystal.scale.set(1.6, 0.5, 0.9);
        crystal.position.set(side * 1.78, 0.22, 0.44);
        main.add(crystal);
      }
      this.wingGroup.add(main);
    } else {
      // royal_cruiser: Double-deck biplane wings!
      const lower = createPanel(1.4, 0.5, 0.065, 0.12, 0.05);
      const upper = createPanel(1.46, 0.5, 0.065, 0.12, 0.04);
      upper.position.y = 0.46;
      for (const side of [-1, 1]) {
        const strut = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 0.46, 8),
          this.wingTrimMat
        );
        strut.position.set(side * 0.95, 0.23, 0.05);
        this.wingGroup.add(strut);
      }
      this.wingGroup.add(lower, upper);
    }
  }
}
