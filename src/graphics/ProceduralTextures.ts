import * as THREE from 'three';

export interface ProceduralTexturePack {
  woodWing: THREE.CanvasTexture;
  grassTop: THREE.CanvasTexture;
  cliffRock: THREE.CanvasTexture;
  cottageRoof: THREE.CanvasTexture;
  cottageWall: THREE.CanvasTexture;
  waterfall: THREE.CanvasTexture;
  softGlow: THREE.CanvasTexture;
  sparkleParticle: THREE.CanvasTexture;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

function createWoodWingTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 128);
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#c77a3f');
  grad.addColorStop(0.5, '#e8a864');
  grad.addColorStop(1, '#c77a3f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  // Soft stylized wood grain lines
  ctx.strokeStyle = 'rgba(120, 53, 15, 0.18)';
  ctx.lineWidth = 2;
  for (let y = 8; y < 128; y += 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(85, y + 4, 170, y - 4, 256, y);
    ctx.stroke();
  }

  // Painted cyan & gold toy swirl trim
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(14, 96);
  ctx.quadraticCurveTo(64, 34, 118, 72);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(242, 96);
  ctx.quadraticCurveTo(192, 34, 138, 72);
  ctx.stroke();

  ctx.strokeStyle = '#fef08a';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 248, 120);

  return toTexture(c);
}

function createGrassTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#5fd35f';
  ctx.fillRect(0, 0, 128, 128);

  for (let i = 0; i < 65; i++) {
    const x = (i * 47) % 128;
    const y = (i * 83) % 128;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(134, 239, 172, 0.4)' : 'rgba(22, 163, 74, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, 5 + (i % 6), 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, true);
}

function createCliffRockTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#a88b76');
  grad.addColorStop(0.5, '#8c7568');
  grad.addColorStop(1, '#6f6468');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = 'rgba(255, 244, 224, 0.14)';
  for (let y = 14; y < 120; y += 22) {
    ctx.fillRect(0, y, 128, 5);
  }
  return toTexture(c, true);
}

function createCottageRoofTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#f97316';
  ctx.fillRect(0, 0, 128, 128);

  for (let row = 0; row < 8; row++) {
    ctx.fillStyle = row % 2 === 0 ? '#ea580c' : '#fb923c';
    for (let col = 0; col < 8; col++) {
      const ox = col * 16 + (row % 2) * 8;
      ctx.beginPath();
      ctx.arc(ox, row * 16 + 8, 9, 0, Math.PI);
      ctx.fill();
    }
  }
  return toTexture(c, true);
}

function createCottageWallTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(0, 0, 128, 128);

  // Timber frame
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 120, 120);

  // Cozy warm window
  ctx.fillStyle = '#fde047';
  ctx.fillRect(42, 36, 44, 44);
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 5;
  ctx.strokeRect(42, 36, 44, 44);
  ctx.beginPath();
  ctx.moveTo(64, 36);
  ctx.lineTo(64, 80);
  ctx.moveTo(42, 58);
  ctx.lineTo(86, 58);
  ctx.stroke();

  return toTexture(c);
}

function createWaterfallTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 256);
  const grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, '#7dd3fc');
  grad.addColorStop(0.5, '#38bdf8');
  grad.addColorStop(1, '#7dd3fc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);

  // Vertical foam ribbons
  for (let i = 0; i < 16; i++) {
    const x = (i * 19 + 8) % 118;
    const y = (i * 37) % 210;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.fillRect(x, y, 5, 42);
  }
  return toTexture(c, true);
}

function createRadialGlowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.32, 'rgba(255, 244, 180, 0.65)');
  grad.addColorStop(0.7, 'rgba(255, 220, 120, 0.18)');
  grad.addColorStop(1, 'rgba(255, 220, 120, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

function createSparkleTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.72)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

export function createProceduralTextures(): ProceduralTexturePack {
  return {
    woodWing: createWoodWingTexture(),
    grassTop: createGrassTexture(),
    cliffRock: createCliffRockTexture(),
    cottageRoof: createCottageRoofTexture(),
    cottageWall: createCottageWallTexture(),
    waterfall: createWaterfallTexture(),
    softGlow: createRadialGlowTexture(),
    sparkleParticle: createSparkleTexture()
  };
}
