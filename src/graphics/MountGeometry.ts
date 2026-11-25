import * as THREE from 'three';

export interface TaperedLoftOptions {
  tubularSegments?: number;
  radialSegments?: number;
  scaleX?: number;
  scaleY?: number;
  capStart?: boolean;
  capEnd?: boolean;
  twistTurns?: number;
  ridgeCount?: number;
  ridgeAmp?: number;
  upHint?: THREE.Vector3;
}

/**
 * Sweeps a shaped elliptical (optionally spiraled/ridged) cross-section along a
 * CatmullRomCurve3 using a stable parallel-transport frame so near-straight spines
 * never suffer Frenet frame flips.
 */
export function createTaperedLoftGeo(
  points: THREE.Vector3[],
  radiusFn: (u: number) => number,
  options: TaperedLoftOptions = {}
): THREE.BufferGeometry {
  const {
    tubularSegments = 20,
    radialSegments = 14,
    scaleX = 1,
    scaleY = 1,
    capStart = true,
    capEnd = true,
    twistTurns = 0,
    ridgeCount = 0,
    ridgeAmp = 0,
    upHint = new THREE.Vector3(0, 1, 0)
  } = options;

  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const ringStride = radialSegments + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const tangent = new THREE.Vector3();
  const prevTangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const rotAxis = new THREE.Vector3();
  const pt = new THREE.Vector3();

  // Initialize parallel-transport frame at u = 0
  curve.getTangent(0, tangent).normalize();
  if (Math.abs(tangent.dot(upHint)) > 0.94) {
    normal.set(1, 0, 0);
  } else {
    normal.copy(upHint);
  }
  // Gram-Schmidt orthogonalize normal against tangent, then binormal = T x N (right-handed N, B, T)
  normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
  binormal.crossVectors(tangent, normal).normalize();
  prevTangent.copy(tangent);

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    curve.getPoint(u, pt);
    curve.getTangent(u, tangent).normalize();

    if (i > 0) {
      rotAxis.crossVectors(prevTangent, tangent);
      const sinA = rotAxis.length();
      if (sinA > 1e-6) {
        rotAxis.divideScalar(sinA);
        const cosA = THREE.MathUtils.clamp(prevTangent.dot(tangent), -1, 1);
        const angle = Math.atan2(sinA, cosA);
        normal.applyAxisAngle(rotAxis, angle).normalize();
      }
      // Re-orthogonalize to prevent floating-point drift
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
      binormal.crossVectors(tangent, normal).normalize();
      prevTangent.copy(tangent);
    }

    const baseR = Math.max(0.001, radiusFn(u));
    const twist = u * twistTurns * Math.PI * 2;

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const theta = v * Math.PI * 2;
      const ridge =
        ridgeCount > 0 && ridgeAmp > 0
          ? 1 + Math.sin((theta + twist) * ridgeCount) * ridgeAmp
          : 1;

      const rx = baseR * scaleX * ridge * Math.cos(theta);
      const ry = baseR * scaleY * ridge * Math.sin(theta);

      const vx = pt.x + normal.x * rx + binormal.x * ry;
      const vy = pt.y + normal.y * rx + binormal.y * ry;
      const vz = pt.z + normal.z * rx + binormal.z * ry;

      positions.push(vx, vy, vz);
      uvs.push(v, u);
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringStride + j;
      const b = i * ringStride + j + 1;
      const c = (i + 1) * ringStride + j;
      const d = (i + 1) * ringStride + j + 1;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  if (capStart) {
    const startPt = curve.getPoint(0);
    const centerIdx = positions.length / 3;
    positions.push(startPt.x, startPt.y, startPt.z);
    uvs.push(0.5, 0);
    for (let j = 0; j < radialSegments; j++) {
      indices.push(centerIdx, j + 1, j);
    }
  }

  if (capEnd) {
    const endPt = curve.getPoint(1);
    const centerIdx = positions.length / 3;
    positions.push(endPt.x, endPt.y, endPt.z);
    uvs.push(0.5, 1);
    const baseRing = tubularSegments * ringStride;
    for (let j = 0; j < radialSegments; j++) {
      indices.push(centerIdx, baseRing + j, baseRing + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted cambered feather blade extending along +X (mirror with scale.x = -1 or rotation)
 * with tapered tip, subtle central quill ridge, arch, and backward sweep.
 */
export function createFeatherGeo(
  length: number,
  width: number,
  thickness = 0.036,
  archY = 0.08,
  sweepZ = 0.14
): THREE.BufferGeometry {
  const uSteps = 12;
  const vSteps = 8; // Closed cross-section around perimeter
  const ringStride = vSteps + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= uSteps; i++) {
    const u = i / uSteps;
    const x = u * length;
    // Organic feather silhouette: narrow base -> full mid-vane -> graceful tapered tip
    const widthProfile =
      u < 0.12
        ? 0.35 + (u / 0.12) * 0.65
        : Math.pow(Math.sin(((u - 0.06) / 0.94) * Math.PI * 0.5 + Math.PI * 0.5 * (u - 0.12)), 0.72);
    const wEnv = Math.max(0.06, Math.sin(Math.pow(u, 0.62) * Math.PI) * 1.05 + (1 - u) * 0.18);
    const halfW = width * 0.5 * Math.min(1.05, Math.max(wEnv, widthProfile * 0.3));
    const halfT = thickness * 0.5 * (1 - u * 0.75);

    const centerY = Math.sin(u * Math.PI) * archY - u * u * archY * 0.35;
    const centerZ = u * u * sweepZ;

    for (let j = 0; j <= vSteps; j++) {
      const v = j / vSteps;
      const theta = v * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Slight central quill ridge along top/bottom center (cosT near 0)
      const quillBump = Math.exp(-cosT * cosT * 10) * halfT * 0.65;
      const localZ = centerZ + cosT * halfW;
      const localY = centerY + sinT * (halfT + quillBump);

      positions.push(x, localY, localZ);
      uvs.push(u, v);
    }
  }

  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      const a = i * ringStride + j;
      const b = i * ringStride + j + 1;
      const c = (i + 1) * ringStride + j;
      const d = (i + 1) * ringStride + j + 1;
      // Tangent is +X, normal is +Z (cosT), binormal is +Y (sinT) -> X = Z x Y, wait: dTheta at 0 is +Y, dU is +X; Y x X = -Z (inward!), so flip winding:
      indices.push(a, d, b);
      indices.push(a, c, d);
    }
  }

  // Cap root and tip
  const rootCenter = positions.length / 3;
  positions.push(0, 0, 0);
  uvs.push(0, 0.5);
  for (let j = 0; j < vSteps; j++) {
    indices.push(rootCenter, j, j + 1);
  }

  const tipCenter = positions.length / 3;
  const tipY = -archY * 0.35;
  positions.push(length, tipY, sweepZ);
  uvs.push(1, 0.5);
  const tipBase = uSteps * ringStride;
  for (let j = 0; j < vSteps; j++) {
    indices.push(tipCenter, tipBase + j + 1, tipBase + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Curved flame / Wayang-scroll / silky plume petal extending upward (+Y) and curving by `curl` along +Z.
 */
export function createFlamePetalGeo(
  length: number,
  width: number,
  thickness = 0.032,
  curl = 0.14
): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, length * 0.38, curl * 0.2),
    new THREE.Vector3(0, length * 0.74, curl * 0.65),
    new THREE.Vector3(0, length, curl)
  ];

  const geo = createTaperedLoftGeo(
    pts,
    (u) => {
      const env = Math.sin(Math.pow(u, 0.55) * Math.PI);
      return Math.max(0.015, width * 0.5 * (env * 1.05 + (1 - u) * 0.18));
    },
    {
      tubularSegments: 12,
      radialSegments: 8,
      scaleX: 1,
      scaleY: thickness / Math.max(0.01, width),
      capStart: true,
      capEnd: true,
      upHint: new THREE.Vector3(1, 0, 0)
    }
  );
  return geo;
}

/**
 * Curved wind-billowed sail mesh (grid displaced forward along -Z), supporting
 * slanted gaff-rigged trapezoids and triangular foresails/jibs.
 */
export function createBillowingSailGeo(
  bottomW: number,
  topW: number,
  height: number,
  bellyDepth: number,
  topSlantY = 0,
  isTriangular = false
): THREE.BufferGeometry {
  const segU = 10;
  const segV = 10;
  const cols = segU + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV; // 0 = foot, 1 = head
    const effTopW = isTriangular ? 0.02 : topW;
    const rowW = THREE.MathUtils.lerp(bottomW, effTopW, v);

    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU; // 0 = port, 1 = starboard (or tack to clew)
      const x = (u - 0.5) * rowW;
      const topY = height + (u - 0.5) * topSlantY;
      const y = v * topY;
      const belly = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * bellyDepth;
      const z = -belly;

      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = iv * cols + iu + 1;
      const c = (iv + 1) * cols + iu;
      const d = (iv + 1) * cols + iu + 1;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Multi-station lofted wooden Phinisi schooner hull from sharp upturned bow (-Z)
 * to flared midship and raised counter stern (+Z), with integrated deck surface.
 */
export function createPhinisiHullGeo(): THREE.BufferGeometry {
  interface HullStation {
    z: number;
    halfBeam: number;
    keelY: number;
    deckY: number;
    midFlare: number;
  }

  const stations: HullStation[] = [
    { z: -1.32, halfBeam: 0.015, keelY: 0.14, deckY: 0.36, midFlare: 0.01 }, // Sharp upturned stem
    { z: -1.04, halfBeam: 0.17, keelY: -0.06, deckY: 0.3, midFlare: 0.11 },
    { z: -0.68, halfBeam: 0.38, keelY: -0.22, deckY: 0.25, midFlare: 0.26 },
    { z: -0.22, halfBeam: 0.5, keelY: -0.27, deckY: 0.23, midFlare: 0.38 }, // Broad midship
    { z: 0.28, halfBeam: 0.48, keelY: -0.24, deckY: 0.25, midFlare: 0.36 },
    { z: 0.68, halfBeam: 0.39, keelY: -0.14, deckY: 0.31, midFlare: 0.28 },
    { z: 0.98, halfBeam: 0.26, keelY: 0.02, deckY: 0.38, midFlare: 0.18 } // Tapered raised stern
  ];

  // 9 profile points around each U-shaped cross-section (port deck -> port hull -> keel -> stbd hull -> stbd deck)
  const profCount = 9;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    const vCoord = s / (stations.length - 1);
    const midY = THREE.MathUtils.lerp(st.keelY, st.deckY, 0.48);
    const lowY = THREE.MathUtils.lerp(st.keelY, st.deckY, 0.2);

    const ringPts: Array<[number, number]> = [
      [-st.halfBeam * 0.92, st.deckY],
      [-st.halfBeam, st.deckY - 0.04],
      [-st.halfBeam * 0.94, midY],
      [-st.midFlare, lowY],
      [0, st.keelY],
      [st.midFlare, lowY],
      [st.halfBeam * 0.94, midY],
      [st.halfBeam, st.deckY - 0.04],
      [st.halfBeam * 0.92, st.deckY]
    ];

    for (let p = 0; p < profCount; p++) {
      const [px, py] = ringPts[p];
      positions.push(px, py, st.z);
      uvs.push(p / (profCount - 1), vCoord);
    }
  }

  for (let s = 0; s < stations.length - 1; s++) {
    for (let p = 0; p < profCount - 1; p++) {
      const a = s * profCount + p;
      const b = s * profCount + p + 1;
      const c = (s + 1) * profCount + p;
      const d = (s + 1) * profCount + p + 1;
      // Along +Z (s->s+1), profile goes -X -> -Y -> +X (CCW viewed from -Z, wait: from port to keel to stbd).
      // At keel (p=4): b-a is (+X, +Y), c-a is (+Z). (+X) x (+Z) = -Y (OUTWARD!).
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
    // Close top deck face across port->stbd
    const portA = s * profCount;
    const stbdA = s * profCount + (profCount - 1);
    const portB = (s + 1) * profCount;
    const stbdB = (s + 1) * profCount + (profCount - 1);
    // (stbdA - portA) is +X; (portB - portA) is +Z; (+X) x (+Z) = -Y (downward!). Flip for +Y upward deck normal:
    indices.push(portA, stbdB, stbdA);
    indices.push(portA, portB, stbdB);
  }

  // Stern transom cap (outward normal +Z)
  const sternBase = (stations.length - 1) * profCount;
  const sternCenter = positions.length / 3;
  const last = stations[stations.length - 1];
  positions.push(0, (last.keelY + last.deckY) * 0.5, last.z);
  uvs.push(0.5, 1);
  for (let p = 0; p < profCount - 1; p++) {
    indices.push(sternCenter, sternBase + p, sternBase + p + 1);
  }
  indices.push(sternCenter, sternBase + profCount - 1, sternBase);

  // Bow stem cap (outward normal -Z)
  const bowCenter = positions.length / 3;
  const first = stations[0];
  positions.push(0, (first.keelY + first.deckY) * 0.5, first.z);
  uvs.push(0.5, 0);
  for (let p = 0; p < profCount - 1; p++) {
    indices.push(bowCenter, p + 1, p);
  }
  indices.push(bowCenter, 0, profCount - 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Helper building a sacred Nusantara Prabha / celestial halo ring with radiating flame-rays.
 */
export function buildMythicalHaloGroup(
  registerGeo: (geo: THREE.BufferGeometry) => THREE.BufferGeometry,
  ringMat: THREE.Material,
  rayMat: THREE.Material,
  radius: number,
  thickness: number,
  rayCount: number,
  rayLength: number
): THREE.Group {
  const group = new THREE.Group();
  const ringGeo = registerGeo(new THREE.TorusGeometry(radius, thickness, 8, 28));
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  group.add(ringMesh);

  if (rayCount > 0 && rayLength > 0) {
    const rayGeo = registerGeo(new THREE.ConeGeometry(thickness * 1.45, rayLength, 5));
    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2;
      const ray = new THREE.Mesh(rayGeo, rayMat);
      const rDist = radius + rayLength * 0.48;
      ray.position.set(Math.cos(angle) * rDist, Math.sin(angle) * rDist, 0);
      ray.rotation.z = angle - Math.PI / 2;
      group.add(ray);
    }
  }

  return group;
}

/**
 * Curved flowing cloth cape / Selendang segment extending along +Z from 0..length,
 * tapering/flaring from topW to bottomW with transverse camber and gentle wind ripple.
 */
export function createCapeSegmentGeo(
  topW: number,
  bottomW: number,
  length: number,
  archY = 0.025,
  curlY = 0.015
): THREE.BufferGeometry {
  const segU = 8;
  const segV = 6;
  const cols = segU + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    const z = v * length;
    const w = THREE.MathUtils.lerp(topW, bottomW, v);

    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const flank = (u - 0.5) * 2; // -1..1
      const x = flank * w * 0.5;
      const y = -flank * flank * archY + Math.sin(v * Math.PI) * curlY;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = iv * cols + iu + 1;
      const c = (iv + 1) * cols + iu;
      const d = (iv + 1) * cols + iu + 1;
      indices.push(a, c, d);
      indices.push(a, d, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Closed, watertight contoured saddle shell hugging the mount's spine with
 * dipped seat, raised front pommel, and swept rear cantle.
 */
export function createSaddleBaseGeo(
  width: number,
  length: number,
  archDrop = 0.09
): THREE.BufferGeometry {
  const segU = 10;
  const segV = 10;
  const cols = segU + 1;
  const rows = segV + 1;
  const layerVerts = cols * rows;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const evalOffset = (u: number, v: number) => {
    const flank = (u - 0.5) * 2;
    const x = flank * width * 0.5;
    const z = (v - 0.5) * length;
    const yArch = -flank * flank * archDrop;
    const seatDip = -Math.sin(v * Math.PI) * 0.036;
    const cantleLift = Math.pow(Math.max(0, (v - 0.62) / 0.38), 1.6) * 0.088;
    const pommelLift = Math.pow(Math.max(0, (0.32 - v) / 0.32), 1.6) * 0.07;
    const thick = 0.045 * (0.45 + 0.55 * Math.sin(u * Math.PI));
    return { x, z, cy: yArch + seatDip + cantleLift + pommelLift, halfT: thick * 0.5 };
  };

  // Layer 0: Top face
  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const p = evalOffset(u, v);
      positions.push(p.x, p.cy + p.halfT, p.z);
      uvs.push(u, v);
    }
  }
  // Layer 1: Bottom face
  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const p = evalOffset(u, v);
      positions.push(p.x, p.cy - p.halfT, p.z);
      uvs.push(u, v);
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = iv * cols + iu + 1;
      const c = (iv + 1) * cols + iu;
      const d = (iv + 1) * cols + iu + 1;
      // Top (+Y)
      indices.push(a, c, d);
      indices.push(a, d, b);
      // Bottom (-Y)
      const ba = layerVerts + a;
      const bb = layerVerts + b;
      const bc = layerVerts + c;
      const bd = layerVerts + d;
      indices.push(ba, bd, bc);
      indices.push(ba, bb, bd);
    }
  }

  // Front edge (iv = 0, -Z) & Back edge (iv = segV, +Z)
  for (let iu = 0; iu < segU; iu++) {
    const t0 = iu;
    const t1 = iu + 1;
    const b0 = layerVerts + t0;
    const b1 = layerVerts + t1;
    indices.push(t0, t1, b1);
    indices.push(t0, b1, b0);

    const rt0 = segV * cols + iu;
    const rt1 = segV * cols + iu + 1;
    const rb0 = layerVerts + rt0;
    const rb1 = layerVerts + rt1;
    indices.push(rt0, rb1, rt1);
    indices.push(rt0, rb0, rb1);
  }

  // Left edge (iu = 0, -X) & Right edge (iu = segU, +X)
  for (let iv = 0; iv < segV; iv++) {
    const lt0 = iv * cols;
    const lt1 = (iv + 1) * cols;
    const lb0 = layerVerts + lt0;
    const lb1 = layerVerts + lt1;
    indices.push(lt0, lb1, lt1);
    indices.push(lt0, lb0, lb1);

    const rt0 = iv * cols + segU;
    const rt1 = (iv + 1) * cols + segU;
    const rb0 = layerVerts + rt0;
    const rb1 = layerVerts + rt1;
    indices.push(rt0, rt1, rb1);
    indices.push(rt0, rb1, rb0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
