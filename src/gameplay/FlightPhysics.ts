import * as THREE from 'three';
import type { Difficulty, StageId, WingId } from '../types/game';

interface WingAeroProfile {
  mass: number;
  liftCoeff: number;
  dragCoeff: number;
  rollRate: number;
  pitchRate: number;
  thrustScale: number;
}

const WING_AERO: Record<WingId, WingAeroProfile> = {
  garuda_nusantara: {
    mass: 1.0,
    liftCoeff: 1.06,
    dragCoeff: 0.0108,
    rollRate: 11.8,
    pitchRate: 11.0,
    thrustScale: 1.02
  },
  naga_barong: {
    mass: 0.94,
    liftCoeff: 1.08,
    dragCoeff: 0.0098,
    rollRate: 13.4,
    pitchRate: 12.0,
    thrustScale: 1.04
  },
  unicorn_sembrani: {
    mass: 0.96,
    liftCoeff: 1.18,
    dragCoeff: 0.0102,
    rollRate: 12.4,
    pitchRate: 12.8,
    thrustScale: 1.03
  },
  phinisi_bugis: {
    mass: 1.22,
    liftCoeff: 1.0,
    dragCoeff: 0.0115,
    rollRate: 9.8,
    pitchRate: 9.5,
    thrustScale: 1.08
  },
  cenderawasih_papua: {
    mass: 0.86,
    liftCoeff: 1.15,
    dragCoeff: 0.0094,
    rollRate: 14.2,
    pitchRate: 13.4,
    thrustScale: 1.05
  },
  enggang_dayak: {
    mass: 1.06,
    liftCoeff: 1.12,
    dragCoeff: 0.0096,
    rollRate: 11.4,
    pitchRate: 11.2,
    thrustScale: 1.07
  }
};

const FIXED_DT = 1 / 60;
const GRAVITY = 9.81;
const MACH_1_SPEED = 48.0;

export interface FlightStepInput {
  steerX: number;
  steerY: number;
  boosting: boolean;
  feverActive: boolean;
  phaseDashActive: boolean;
  distanceMeters: number;
  stageId: StageId;
  difficulty: Difficulty;
  wingId: WingId;
}

export class FlightPhysics {
  readonly position = new THREE.Vector3(0, 1.5, 0);
  readonly renderPosition = new THREE.Vector3(0, 1.5, 0);
  readonly velocity = new THREE.Vector3(0, 0, -31);

  bankAngle = 0;
  pitchAngle = 0;
  wobbleZ = 0;
  wobbleX = 0;

  renderBankAngle = 0;
  renderPitchAngle = 0;
  renderWobbleZ = 0;
  renderWobbleX = 0;

  airspeed = 31;
  mach = 0.65;
  gForce = 1.0;
  altitude = 459;

  inSlipstream = false;
  inUpdraft = false;
  justBrokeMach = false;

  private readonly prevPosition = new THREE.Vector3(0, 1.5, 0);
  private prevBankAngle = 0;
  private prevPitchAngle = 0;
  private prevWobbleZ = 0;
  private prevWobbleX = 0;
  private smoothedSteerX = 0;
  private smoothedSteerY = 0;

  private sonicArmed = true;
  private accumulator = 0;
  private elapsed = 0;
  private extAccelX = 0;
  private extAccelY = 0;
  private extAccelZ = 0;

  reset(initialSpeed = 31): void {
    this.position.set(0, 1.5, 0);
    this.prevPosition.copy(this.position);
    this.renderPosition.copy(this.position);
    this.velocity.set(0, 0, -initialSpeed);
    this.bankAngle = 0;
    this.pitchAngle = 0;
    this.wobbleZ = 0;
    this.wobbleX = 0;
    this.prevBankAngle = 0;
    this.prevPitchAngle = 0;
    this.prevWobbleZ = 0;
    this.prevWobbleX = 0;
    this.renderBankAngle = 0;
    this.renderPitchAngle = 0;
    this.renderWobbleZ = 0;
    this.renderWobbleX = 0;
    this.smoothedSteerX = 0;
    this.smoothedSteerY = 0;
    this.airspeed = initialSpeed;
    this.mach = initialSpeed / MACH_1_SPEED;
    this.gForce = 1.0;
    this.altitude = Math.max(50, Math.round((this.position.y + 24) * 18));
    this.inSlipstream = false;
    this.inUpdraft = false;
    this.justBrokeMach = false;
    this.sonicArmed = true;
    this.accumulator = 0;
    this.elapsed = 0;
    this.clearExternalForces();
  }

  clearExternalForces(): void {
    this.extAccelX = 0;
    this.extAccelY = 0;
    this.extAccelZ = 0;
  }

  /**
   * Accumulates Newtonian forces (thermal updrafts, slipstreams, gravity wells) before stepping.
   */
  addExternalAcceleration(ax: number, ay: number, az: number): void {
    this.extAccelX += ax;
    this.extAccelY += ay;
    this.extAccelZ += az;
  }

  /**
   * Real normal-based collision momentum transfer + restitution bounce.
   */
  applyCollisionImpulse(sourcePos: THREE.Vector3, wingId: WingId, restitution = 0.68): void {
    const profile = WING_AERO[wingId];
    const dx = this.position.x - sourcePos.x;
    const dy = this.position.y - sourcePos.y;
    const len = Math.max(0.15, Math.hypot(dx, dy));
    const nx = dx / len;
    const ny = dy / len;

    const impulseMag = (17.5 * (1 + restitution)) / Math.sqrt(profile.mass);
    this.velocity.x = nx * impulseMag + (Math.abs(nx) < 0.2 ? (nx >= 0 ? 1 : -1) * 9 : 0);
    this.velocity.y = ny * impulseMag * 0.62 + 3.2;
    this.velocity.z *= 0.86; // Momentary impact speed loss

    this.wobbleZ += (nx >= 0 ? -1 : 1) * 0.42;
    this.wobbleX += 0.24;
  }

  step(frameDt: number, input: FlightStepInput): void {
    this.justBrokeMach = false;
    this.accumulator = Math.min(this.accumulator + frameDt, FIXED_DT * 4);

    let substeps = 0;
    while (this.accumulator >= FIXED_DT && substeps < 4) {
      this.prevPosition.copy(this.position);
      this.prevBankAngle = this.bankAngle;
      this.prevPitchAngle = this.pitchAngle;
      this.prevWobbleZ = this.wobbleZ;
      this.prevWobbleX = this.wobbleX;

      this.stepFixed(FIXED_DT, input);
      this.accumulator -= FIXED_DT;
      substeps++;
    }

    const alpha = THREE.MathUtils.clamp(this.accumulator / FIXED_DT, 0, 1);
    this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
    this.renderBankAngle = THREE.MathUtils.lerp(this.prevBankAngle, this.bankAngle, alpha);
    this.renderPitchAngle = THREE.MathUtils.lerp(this.prevPitchAngle, this.pitchAngle, alpha);
    this.renderWobbleZ = THREE.MathUtils.lerp(this.prevWobbleZ, this.wobbleZ, alpha);
    this.renderWobbleX = THREE.MathUtils.lerp(this.prevWobbleX, this.wobbleX, alpha);

    this.clearExternalForces();
  }

  private stepFixed(dt: number, input: FlightStepInput): void {
    this.elapsed += dt;
    const aero = WING_AERO[input.wingId];

    // 1. Subtle input smoothing + control surface attitude response (bank & pitch)
    const steerAlpha = 1 - Math.exp(-dt * 20);
    this.smoothedSteerX = THREE.MathUtils.lerp(this.smoothedSteerX, input.steerX, steerAlpha);
    this.smoothedSteerY = THREE.MathUtils.lerp(this.smoothedSteerY, input.steerY, steerAlpha);
    if (input.steerX === 0 && Math.abs(this.smoothedSteerX) < 0.001) this.smoothedSteerX = 0;
    if (input.steerY === 0 && Math.abs(this.smoothedSteerY) < 0.001) this.smoothedSteerY = 0;

    const targetBank = -this.smoothedSteerX * 0.76;
    const targetPitch = this.smoothedSteerY * 0.42;
    this.bankAngle = THREE.MathUtils.lerp(this.bankAngle, targetBank, 1 - Math.exp(-dt * aero.rollRate));
    this.pitchAngle = THREE.MathUtils.lerp(this.pitchAngle, targetPitch, 1 - Math.exp(-dt * aero.pitchRate));

    // Decay collision tumble wobble
    this.wobbleZ *= Math.exp(-dt * 6.5);
    this.wobbleX *= Math.exp(-dt * 6.5);

    const prevVx = this.velocity.x;
    const prevVy = this.velocity.y;
    const speedFwd = Math.max(18, -this.velocity.z);
    const speedNorm = speedFwd / 34;

    // 2. Lift vectoring from banked wings + crisp fly-by-wire lateral steering
    const liftFactor = (0.65 + 0.35 * speedNorm * speedNorm) * aero.liftCoeff;
    const bankAccelX = -Math.sin(this.bankAngle) * 38.0 * liftFactor;
    const directSteerX = this.smoothedSteerX * 29.0;
    const lateralDrag = -this.velocity.x * (2.6 + (this.inSlipstream ? 0.4 : 0.9));

    // 3. Vertical aerodynamics: Gravity + Fly-by-Wire trim lift + pitch lift
    // Neutral stick trims level; pulling up generates strong climb lift; diving yields real dive acceleration
    const trimLift = GRAVITY;
    const pitchLift = Math.sin(this.pitchAngle) * 44.0 * liftFactor;
    const inducedTurnDrop = -(1 - Math.cos(this.bankAngle)) * 3.8; // Realistic slight sink in steep banks
    const verticalDrag = -this.velocity.y * 3.1;

    // Biome atmospheric turbulence (noticeable in Storm Citadel, subtle elsewhere)
    const turbScale = input.stageId === 3 ? 2.4 : input.stageId === 2 ? 1.15 : 0.45;
    const turbX = Math.sin(this.elapsed * 2.9 + this.position.z * 0.04) * turbScale;
    const turbY = Math.cos(this.elapsed * 3.4 + this.position.x * 0.1) * turbScale * 0.7;

    const accelX = (bankAccelX * 0.48 + directSteerX * 0.8 + lateralDrag + turbX) / aero.mass + this.extAccelX;
    const accelY = (trimLift - GRAVITY + pitchLift + inducedTurnDrop + verticalDrag + turbY) / aero.mass + this.extAccelY;

    // 4. Longitudinal Thrust vs Quadratic Drag + Gravity Dive Energy Transfer
    const diffBase = input.difficulty === 'overclocked' ? 35 : 31;
    const sectorTargetCruise = Math.min(62, diffBase + input.distanceMeters * 0.0082 + (input.stageId - 1) * 2.5);
    const boostMult = input.feverActive
      ? 1.72
      : input.phaseDashActive
        ? 1.65
        : input.boosting
          ? 1.52
          : 1.0;
    const targetCruise = sectorTargetCruise * boostMult * (this.inSlipstream ? 1.24 : 1.0);

    // Quadratic aerodynamic drag scaled so steady-state equilibrium naturally tracks targetCruise
    const effectiveDragCoeff = aero.dragCoeff * (this.inSlipstream ? 0.55 : 1.0);
    const thrustAccel = effectiveDragCoeff * targetCruise * targetCruise * aero.thrustScale;
    const dragAccel = effectiveDragCoeff * speedFwd * speedFwd;

    // Energy conservation: diving (-pitch) accelerates forward, climbing (+pitch) trades speed for height
    const gravityEnergyAccel = -Math.sin(this.pitchAngle) * GRAVITY * 2.15;
    // Induced drag when pulling hard G-turns
    const inducedDrag = Math.abs(this.bankAngle) * 2.4;

    const netForwardAccel = thrustAccel - dragAccel + gravityEnergyAccel - inducedDrag - this.extAccelZ;
    const nextSpeedFwd = THREE.MathUtils.clamp(speedFwd + netForwardAccel * dt, 22, 92);

    this.velocity.x += accelX * dt;
    this.velocity.y += accelY * dt;
    this.velocity.z = -nextSpeedFwd;

    // Integrate positions
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // Soft aerodynamic corridor bounds with damped wall rebound
    if (this.position.x < -19) {
      this.position.x = -19;
      this.velocity.x = Math.max(0, -this.velocity.x * 0.25);
    } else if (this.position.x > 19) {
      this.position.x = 19;
      this.velocity.x = Math.min(0, -this.velocity.x * 0.25);
    }

    if (this.position.y < -8) {
      this.position.y = -8;
      this.velocity.y = Math.max(0, -this.velocity.y * 0.25);
    } else if (this.position.y > 12) {
      this.position.y = 12;
      this.velocity.y = Math.min(0, -this.velocity.y * 0.25);
    }

    // 5. Compute Live Telemetry (Airspeed, Mach, G-Load, Altitude)
    this.airspeed = this.velocity.length();
    this.mach = this.airspeed / MACH_1_SPEED;
    this.altitude = Math.max(50, Math.round((this.position.y + 24) * 18));

    const dvx = (this.velocity.x - prevVx) / dt;
    const dvy = (this.velocity.y - prevVy) / dt;
    const totalLoad = Math.hypot(dvx, dvy + GRAVITY) / GRAVITY;
    this.gForce = THREE.MathUtils.lerp(this.gForce, THREE.MathUtils.clamp(totalLoad, 0.4, 6.8), 0.25);

    if (this.mach >= 1.0 && this.sonicArmed) {
      this.sonicArmed = false;
      this.justBrokeMach = true;
    } else if (this.mach < 0.93) {
      this.sonicArmed = true;
    }
  }
}
