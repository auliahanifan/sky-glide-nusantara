import * as THREE from 'three';

export interface PBRTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap?: THREE.CanvasTexture;
}

export interface ProceduralTexturePack {
  hullPanel: THREE.CanvasTexture;
  hullPBR: PBRTextureSet;
  pylonPBR: PBRTextureSet;
  minePBR: PBRTextureSet;
  featherPBR: PBRTextureSet;
  scalePBR: PBRTextureSet;
  woodPBR: PBRTextureSet;
  neonGrid: THREE.CanvasTexture;
  pylonTech: THREE.CanvasTexture;
  energyStream: THREE.CanvasTexture;
  softGlow: THREE.CanvasTexture;
  sparkleParticle: THREE.CanvasTexture;
  cloudWisp: THREE.CanvasTexture;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [canvas, ctx];
}

function toTexture(
  canvas: HTMLCanvasElement,
  options: { repeat?: boolean; srgb?: boolean } = {}
): THREE.CanvasTexture {
  const { repeat = false, srgb = true } = options;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Deterministic fast hash for subtle micro-grain and architectural variation.
 */
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Converts a grayscale height canvas into a linear tangent-space normal map using a 3x3 Sobel filter.
 */
function heightCanvasToNormalTexture(
  heightCanvas: HTMLCanvasElement,
  strength: number,
  repeat = true
): THREE.CanvasTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d');
  if (!srcCtx) throw new Error('2D canvas unavailable');
  const src = srcCtx.getImageData(0, 0, w, h).data;

  const [outCanvas, outCtx] = makeCanvas(w, h);
  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const nz = 1.0;
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + nz * nz);

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return toTexture(outCanvas, { repeat, srgb: false });
}

function createHullPBRSet(): PBRTextureSet {
  const size = 512;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [heightC, hCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);

  // Neutral brushed aerospace titanium base (tinted cleanly by material.color)
  aCtx.fillStyle = '#d4dde8';
  aCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#868686';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#4c4c4c'; // ~0.30 base metallic satin roughness
  rCtx.fillRect(0, 0, size, size);

  // Subtle anisotropic brushed titanium streaks & carbon weave micro-texture
  for (let y = 0; y < size; y += 2) {
    const streak = 205 + Math.floor(hash2(y, 13) * 34);
    aCtx.fillStyle = `rgba(${streak}, ${streak + 6}, ${streak + 12}, 0.14)`;
    aCtx.fillRect(0, y, size, 1);

    const rh = 132 + Math.floor(hash2(y, 47) * 14);
    hCtx.fillStyle = `rgb(${rh}, ${rh}, ${rh})`;
    hCtx.fillRect(0, y, size, 1);
  }

  // Distinct armor panel blocks with subtle tonal/roughness variance
  const panels: Array<[number, number, number, number, string, string]> = [
    [0, 0, 256, 256, 'rgba(255,255,255,0.06)', '#444444'],
    [256, 0, 256, 256, 'rgba(15,23,42,0.08)', '#5a5a5a'],
    [0, 256, 256, 256, 'rgba(15,23,42,0.05)', '#525252'],
    [256, 256, 256, 256, 'rgba(255,255,255,0.08)', '#404040'],
    [64, 64, 128, 128, 'rgba(226,232,240,0.08)', '#3a3a3a'],
    [300, 300, 156, 156, 'rgba(15,23,42,0.09)', '#646464']
  ];
  for (const [x, y, w, h, tint, rough] of panels) {
    aCtx.fillStyle = tint;
    aCtx.fillRect(x, y, w, h);
    rCtx.fillStyle = rough;
    rCtx.fillRect(x + 3, y + 3, w - 6, h - 6);

    // Beveled seam groove
    aCtx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
    aCtx.lineWidth = 3;
    aCtx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);

    hCtx.strokeStyle = '#303030';
    hCtx.lineWidth = 4;
    hCtx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);

    rCtx.strokeStyle = '#c8c8c8'; // worn matte seam (~0.78)
    rCtx.lineWidth = 4;
    rCtx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }

  // Diagonal maintenance hatch & louver vents
  for (let i = 0; i < 6; i++) {
    const vx = 32 + i * 14;
    aCtx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    aCtx.fillRect(vx, 320, 8, 56);
    hCtx.fillStyle = '#222222';
    hCtx.fillRect(vx, 320, 8, 56);
    rCtx.fillStyle = '#b4b4b4';
    rCtx.fillRect(vx, 320, 8, 56);
  }

  // Crisp aerospace rivet rows along seams
  const drawRivet = (rx: number, ry: number) => {
    aCtx.fillStyle = 'rgba(255,255,255,0.45)';
    aCtx.beginPath();
    aCtx.arc(rx, ry, 2.1, 0, Math.PI * 2);
    aCtx.fill();

    hCtx.fillStyle = '#d4d4d4';
    hCtx.beginPath();
    hCtx.arc(rx, ry, 2.2, 0, Math.PI * 2);
    hCtx.fill();

    rCtx.fillStyle = '#2b2b2b';
    rCtx.beginPath();
    rCtx.arc(rx, ry, 2.2, 0, Math.PI * 2);
    rCtx.fill();
  };

  for (let i = 18; i < size - 12; i += 24) {
    drawRivet(i, 10);
    drawRivet(i, 246);
    drawRivet(i, 266);
    drawRivet(10, i);
    drawRivet(246, i);
    drawRivet(266, i);
  }

  return {
    map: toTexture(albedoC, { repeat: true, srgb: true }),
    normalMap: heightCanvasToNormalTexture(heightC, 2.4, true),
    roughnessMap: toTexture(roughC, { repeat: true, srgb: false })
  };
}

function createPylonPBRSet(): PBRTextureSet {
  const size = 512;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [heightC, hCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);
  const [emissiveC, eCtx] = makeCanvas(size, size);

  // Architectural steel & dark basalt-concrete structural frame
  aCtx.fillStyle = '#1b2436';
  aCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#9c9c9c';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#c4c4c4'; // Matte concrete/steel structural mullions (~0.77)
  rCtx.fillRect(0, 0, size, size);
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, size, size);

  // Horizontal floor slab spandrel bands + recessed curtain-wall windows
  const cols = 8;
  const rows = 12;
  const cellW = size / cols;
  const cellH = size / rows;

  for (let r = 0; r < rows; r++) {
    const y = r * cellH;
    // Heavy floor spandrel beam
    aCtx.fillStyle = r % 4 === 0 ? '#27344d' : '#1e293b';
    aCtx.fillRect(0, y, size, 10);
    hCtx.fillStyle = '#d4d4d4';
    hCtx.fillRect(0, y, size, 10);
    rCtx.fillStyle = '#b0b0b0';
    rCtx.fillRect(0, y, size, 10);

    for (let c = 0; c < cols; c++) {
      const x = c * cellW;
      const wx = x + 6;
      const wy = y + 11;
      const ww = cellW - 12;
      const wh = cellH - 15;

      const rnd = hash2(c + 11, r + 31);
      // Dark reflective glass pane with subtle interior tint
      const glassGrad = aCtx.createLinearGradient(wx, wy, wx, wy + wh);
      glassGrad.addColorStop(0, '#0d1b2e');
      glassGrad.addColorStop(1, '#162c47');
      aCtx.fillStyle = glassGrad;
      aCtx.fillRect(wx, wy, ww, wh);

      // Glass is recessed and smooth (glossy specular reflection!)
      hCtx.fillStyle = '#484848';
      hCtx.fillRect(wx, wy, ww, wh);
      rCtx.fillStyle = '#202020'; // ~0.12 roughness on architectural glass
      rCtx.fillRect(wx, wy, ww, wh);

      // Realistic lit office/reactor windows in emissiveMap
      if (rnd > 0.56) {
        const warmOrCool = hash2(c * 3, r * 7);
        const litColor =
          warmOrCool > 0.68
            ? 'rgba(255, 224, 170, 0.92)' // Warm tungsten office glow
            : warmOrCool > 0.3
              ? 'rgba(165, 232, 255, 0.85)' // Cool crisp architectural daylight
              : 'rgba(120, 210, 255, 0.55)'; // Dim interior ambient
        eCtx.fillStyle = litColor;
        eCtx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        aCtx.fillStyle = litColor;
        aCtx.globalAlpha = 0.28;
        aCtx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        aCtx.globalAlpha = 1;
      }
    }
  }

  // Vertical structural steel pilasters every 2 columns
  for (let c = 0; c <= cols; c += 2) {
    const px = c * cellW - 3;
    aCtx.fillStyle = '#2b3952';
    aCtx.fillRect(px, 0, 6, size);
    hCtx.fillStyle = '#e4e4e4';
    hCtx.fillRect(px, 0, 6, size);
    rCtx.fillStyle = '#9a9a9a';
    rCtx.fillRect(px, 0, 6, size);
  }

  return {
    map: toTexture(albedoC, { repeat: true, srgb: true }),
    normalMap: heightCanvasToNormalTexture(heightC, 2.8, true),
    roughnessMap: toTexture(roughC, { repeat: true, srgb: false }),
    emissiveMap: toTexture(emissiveC, { repeat: true, srgb: true })
  };
}

function createMinePBRSet(): PBRTextureSet {
  const size = 256;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [heightC, hCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);

  aCtx.fillStyle = '#263142';
  aCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#888888';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#585858';
  rCtx.fillRect(0, 0, size, size);

  // Cast steel plates & diagonal hazard band
  aCtx.strokeStyle = '#0f172a';
  aCtx.lineWidth = 4;
  for (let i = 0; i < size; i += 64) {
    aCtx.strokeRect(i + 2, 2, 60, size - 4);
    hCtx.strokeStyle = '#323232';
    hCtx.lineWidth = 4;
    hCtx.strokeRect(i + 2, 2, 60, size - 4);
  }

  // Hazard chevrons near equator
  aCtx.save();
  aCtx.beginPath();
  aCtx.rect(0, 108, size, 40);
  aCtx.clip();
  aCtx.fillStyle = '#d97706';
  for (let x = -40; x < size + 40; x += 28) {
    aCtx.beginPath();
    aCtx.moveTo(x, 108);
    aCtx.lineTo(x + 14, 108);
    aCtx.lineTo(x - 6, 148);
    aCtx.lineTo(x - 20, 148);
    aCtx.closePath();
    aCtx.fill();
  }
  aCtx.restore();

  rCtx.fillStyle = '#929292';
  rCtx.fillRect(0, 108, size, 40);

  return {
    map: toTexture(albedoC, { repeat: true, srgb: true }),
    normalMap: heightCanvasToNormalTexture(heightC, 2.2, true),
    roughnessMap: toTexture(roughC, { repeat: true, srgb: false })
  };
}

function createFeatherPBRSet(): PBRTextureSet {
  const size = 256;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [heightC, hCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);

  // Neutral bright base so material.color tints cleanly to gold, crimson, emerald, pearl, or obsidian
  aCtx.fillStyle = '#efefef';
  aCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#787878'; // Satin feather sheen (~0.47)
  rCtx.fillRect(0, 0, size, size);

  // Overlapping scalloped feather rows with central rachis & fine barb streaks
  const rows = 6;
  const cols = 4;
  const cellW = size / cols;
  const cellH = size / rows;

  for (let r = -1; r <= rows; r++) {
    const xOffset = (r % 2 === 0 ? 0 : cellW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const cx = c * cellW + xOffset;
      const cy = r * cellH;
      const rad = cellW * 0.62;
      const shade = 228 + Math.floor(hash2(c + 5, r + 9) * 24);

      // Feather vane body
      aCtx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
      aCtx.beginPath();
      aCtx.arc(cx, cy, rad, 0, Math.PI);
      aCtx.closePath();
      aCtx.fill();

      // Height mound per overlapping feather
      const gradH = hCtx.createRadialGradient(cx, cy + rad * 0.25, 2, cx, cy + rad * 0.25, rad);
      gradH.addColorStop(0, '#dcdcdc');
      gradH.addColorStop(0.75, '#9a9a9a');
      gradH.addColorStop(1, '#4a4a4a');
      hCtx.fillStyle = gradH;
      hCtx.beginPath();
      hCtx.arc(cx, cy, rad, 0, Math.PI);
      hCtx.closePath();
      hCtx.fill();

      // Subtle barb grooves radiating from shaft
      aCtx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      aCtx.lineWidth = 1;
      for (let b = -3; b <= 3; b++) {
        aCtx.beginPath();
        aCtx.moveTo(cx, cy + 4);
        aCtx.lineTo(cx + b * 8, cy + rad * 0.85);
        aCtx.stroke();
      }

      // Central quill highlight
      hCtx.strokeStyle = '#f2f2f2';
      hCtx.lineWidth = 2;
      hCtx.beginPath();
      hCtx.moveTo(cx, cy);
      hCtx.lineTo(cx, cy + rad * 0.9);
      hCtx.stroke();

      rCtx.fillStyle = '#626262';
      rCtx.beginPath();
      rCtx.arc(cx, cy, rad * 0.72, 0, Math.PI);
      rCtx.fill();
    }
  }

  return {
    map: toTexture(albedoC, { repeat: true, srgb: true }),
    normalMap: heightCanvasToNormalTexture(heightC, 2.0, true),
    roughnessMap: toTexture(roughC, { repeat: true, srgb: false })
  };
}

function createScalePBRSet(): PBRTextureSet {
  const size = 256;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [heightC, hCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);

  aCtx.fillStyle = '#d8e4df';
  aCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#505050';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#565656'; // Glossy jewel-scale roughness (~0.34)
  rCtx.fillRect(0, 0, size, size);

  const rows = 8;
  const cols = 6;
  const cellW = size / cols;
  const cellH = size / rows;

  for (let r = -1; r <= rows; r++) {
    const xOff = r % 2 === 0 ? 0 : cellW * 0.5;
    for (let c = -1; c <= cols; c++) {
      const cx = c * cellW + xOff;
      const cy = r * cellH;
      const rx = cellW * 0.56;
      const ry = cellH * 0.88;

      const tone = 212 + Math.floor(hash2(c * 3, r * 5) * 34);
      aCtx.fillStyle = `rgb(${tone}, ${tone + 6}, ${tone + 2})`;
      aCtx.beginPath();
      aCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
      aCtx.closePath();
      aCtx.fill();
      aCtx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
      aCtx.lineWidth = 2;
      aCtx.stroke();

      const hGrad = hCtx.createRadialGradient(cx, cy + ry * 0.2, 2, cx, cy + ry * 0.2, rx);
      hGrad.addColorStop(0, '#ededed');
      hGrad.addColorStop(0.7, '#9e9e9e');
      hGrad.addColorStop(1, '#323232');
      hCtx.fillStyle = hGrad;
      hCtx.beginPath();
      hCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
      hCtx.closePath();
      hCtx.fill();

      // Glossy ridge vs matte crevice
      rCtx.fillStyle = '#383838';
      rCtx.beginPath();
      rCtx.ellipse(cx, cy, rx * 0.72, ry * 0.72, 0, 0, Math.PI);
      rCtx.fill();
    }
  }

  return {
    map: toTexture(albedoC, { repeat: true, srgb: true }),
    normalMap: heightCanvasToNormalTexture(heightC, 2.5, true),
    roughnessMap: toTexture(roughC, { repeat: true, srgb: false })
  };
}

function createWoodPBRSet(): PBRTextureSet {
  const size = 256;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [heightC, hCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);

  aCtx.fillStyle = '#e6d6c3';
  aCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#929292';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#888888'; // Warm satin varnished teak (~0.53)
  rCtx.fillRect(0, 0, size, size);

  const planks = 6;
  const plankH = size / planks;
  for (let p = 0; p < planks; p++) {
    const y0 = p * plankH;
    const base = 212 + Math.floor(hash2(p, 19) * 28);
    aCtx.fillStyle = `rgb(${base}, ${Math.round(base * 0.92)}, ${Math.round(base * 0.82)})`;
    aCtx.fillRect(0, y0, size, plankH - 2);

    // Subtle longitudinal wood grain
    for (let g = 0; g < 8; g++) {
      const gy = y0 + 4 + ((g * 5.2) % (plankH - 6));
      aCtx.fillStyle = g % 2 === 0 ? 'rgba(80, 45, 18, 0.1)' : 'rgba(255, 245, 230, 0.09)';
      aCtx.fillRect(0, gy, size, 1.5);
      hCtx.fillStyle = g % 2 === 0 ? '#7c7c7c' : '#a8a8a8';
      hCtx.fillRect(0, gy, size, 1.5);
    }

    // Dark caulked plank seam
    aCtx.fillStyle = 'rgba(38, 20, 8, 0.45)';
    aCtx.fillRect(0, y0 + plankH - 2.5, size, 2.5);
    hCtx.fillStyle = '#383838';
    hCtx.fillRect(0, y0 + plankH - 2.5, size, 2.5);
    rCtx.fillStyle = '#c8c8c8';
    rCtx.fillRect(0, y0 + plankH - 2.5, size, 2.5);
  }

  return {
    map: toTexture(albedoC, { repeat: true, srgb: true }),
    normalMap: heightCanvasToNormalTexture(heightC, 1.9, true),
    roughnessMap: toTexture(roughC, { repeat: true, srgb: false })
  };
}

function createHullPanelTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 256);
  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, '#c8d4e3');
  grad.addColorStop(0.5, '#eef4fb');
  grad.addColorStop(1, '#aebdca');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, 492, 236);
  ctx.beginPath();
  ctx.moveTo(256, 10);
  ctx.lineTo(256, 246);
  ctx.moveTo(10, 128);
  ctx.lineTo(502, 128);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(32, 208);
  ctx.lineTo(172, 52);
  ctx.lineTo(236, 52);
  ctx.moveTo(480, 208);
  ctx.lineTo(340, 52);
  ctx.lineTo(276, 52);
  ctx.stroke();

  return toTexture(c);
}

function createNeonGridTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#040712';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 256, 256);
  return toTexture(c, { repeat: true, srgb: true });
}

function createEnergyStreamTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 512);
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.15)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0.15)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 512);

  for (let i = 0; i < 28; i++) {
    const x = (i * 41 + 18) % 236;
    const y = (i * 73) % 440;
    const g = ctx.createLinearGradient(0, y, 0, y + 68);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 6, 68);
  }
  return toTexture(c, { repeat: true, srgb: true });
}

function createRadialGlowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  const grad = ctx.createRadialGradient(128, 128, 2, 128, 128, 124);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.2, 'rgba(220, 248, 255, 0.78)');
  grad.addColorStop(0.52, 'rgba(90, 200, 255, 0.24)');
  grad.addColorStop(0.8, 'rgba(56, 189, 248, 0.05)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return toTexture(c, { srgb: true });
}

function createSparkleTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.2)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c, { srgb: true });
}

function createCloudWispTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  const lobes: Array<[number, number, number, number]> = [
    [128, 134, 86, 0.42],
    [82, 140, 62, 0.34],
    [176, 142, 64, 0.34],
    [108, 108, 56, 0.3],
    [152, 110, 52, 0.28],
    [128, 152, 74, 0.22]
  ];
  for (const [cx, cy, rad, alpha] of lobes) {
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.55, `rgba(240, 246, 255, ${alpha * 0.45})`);
    grad.addColorStop(1, 'rgba(230, 240, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, { srgb: true });
}

export function applyTextureAnisotropy(pack: ProceduralTexturePack, anisotropy: number): void {
  const level = Math.max(1, anisotropy);
  const list: THREE.Texture[] = [
    pack.hullPanel,
    pack.hullPBR.map,
    pack.hullPBR.normalMap,
    pack.hullPBR.roughnessMap,
    pack.pylonPBR.map,
    pack.pylonPBR.normalMap,
    pack.pylonPBR.roughnessMap,
    pack.minePBR.map,
    pack.minePBR.normalMap,
    pack.minePBR.roughnessMap,
    pack.featherPBR.map,
    pack.featherPBR.normalMap,
    pack.featherPBR.roughnessMap,
    pack.scalePBR.map,
    pack.scalePBR.normalMap,
    pack.scalePBR.roughnessMap,
    pack.woodPBR.map,
    pack.woodPBR.normalMap,
    pack.woodPBR.roughnessMap,
    pack.energyStream
  ];
  if (pack.pylonPBR.emissiveMap) list.push(pack.pylonPBR.emissiveMap);
  for (const tex of list) {
    tex.anisotropy = level;
    tex.needsUpdate = true;
  }
}

export function createProceduralTextures(): ProceduralTexturePack {
  const pylonPBR = createPylonPBRSet();
  return {
    hullPanel: createHullPanelTexture(),
    hullPBR: createHullPBRSet(),
    pylonPBR,
    minePBR: createMinePBRSet(),
    featherPBR: createFeatherPBRSet(),
    scalePBR: createScalePBRSet(),
    woodPBR: createWoodPBRSet(),
    neonGrid: createNeonGridTexture(),
    pylonTech: pylonPBR.map,
    energyStream: createEnergyStreamTexture(),
    softGlow: createRadialGlowTexture(),
    sparkleParticle: createSparkleTexture(),
    cloudWisp: createCloudWispTexture()
  };
}
