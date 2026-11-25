import type { AviatorId, TrailId, UpgradeId, WingId } from '../types/game';

export interface UpgradeSpec {
  id: UpgradeId;
  name: string;
  icon: string;
  description: string;
  maxLevel: number;
  costs: number[];
  effectLabel: (level: number) => string;
}

export interface WingSpec {
  id: WingId;
  name: string;
  icon: string;
  description: string;
  cost: number;
  primaryColor: number;
  trimColor: number;
  emissiveColor: number;
  swatch: string;
}

export interface TrailSpec {
  id: TrailId;
  name: string;
  icon: string;
  description: string;
  cost: number;
  swatch: string;
}

export interface AviatorSpec {
  id: AviatorId;
  name: string;
  icon: string;
  description: string;
  cost: number;
  jacketColor: number;
  scarfColor: number;
  helmetColor: number;
  swatch: string;
}

export const PILOT_AVATARS = ['🦊', '🐻', '🦉', '🐱', '🐰', '🐼', '🦁', '🚀'] as const;

export const UPGRADE_CATALOG: UpgradeSpec[] = [
  {
    id: 'magnet',
    name: 'Star Magnet',
    icon: '🧲',
    description: 'Pulls nearby golden stars smoothly toward your glider.',
    maxLevel: 5,
    costs: [50, 120, 220, 360, 540],
    effectLabel: (lv) => `${3.5 + lv * 1.4}m pull radius`
  },
  {
    id: 'turbo',
    name: 'Turbo Thrusters',
    icon: '🔥',
    description: 'Increases Turbo capacity & recharges faster through rings.',
    maxLevel: 5,
    costs: [60, 140, 250, 400, 600],
    effectLabel: (lv) => `+${lv * 18}% turbo duration`
  },
  {
    id: 'shield',
    name: 'Cloud Shield',
    icon: '🫧',
    description: 'Start flights with +1 extra Heart at Lv.3 & Lv.5, plus more shields.',
    maxLevel: 5,
    costs: [75, 160, 290, 460, 680],
    effectLabel: (lv) => `${3 + (lv >= 3 ? 1 : 0) + (lv >= 5 ? 1 : 0)} Max Hearts`
  },
  {
    id: 'combo',
    name: 'Combo Charm',
    icon: '✨',
    description: 'Keeps your Ring-Rush combo timer alive longer between chains.',
    maxLevel: 5,
    costs: [55, 130, 240, 380, 560],
    effectLabel: (lv) => `${(4.5 + lv * 0.7).toFixed(1)}s combo window`
  }
];

export const WING_CATALOG: WingSpec[] = [
  {
    id: 'classic_wood',
    name: 'Timber & Brass',
    icon: '🪵',
    description: 'Hand-carved toy glider wings with polished brass trim.',
    cost: 0,
    primaryColor: 0xd98c4a,
    trimColor: 0xfbbf24,
    emissiveColor: 0x000000,
    swatch: '#d98c4a'
  },
  {
    id: 'sky_dragon',
    name: 'Sky Dragon',
    icon: '🐉',
    description: 'Swept emerald & gold soaring fins built for sharp turns.',
    cost: 180,
    primaryColor: 0x10b981,
    trimColor: 0xfde047,
    emissiveColor: 0x064e3b,
    swatch: '#10b981'
  },
  {
    id: 'starlight_prism',
    name: 'Starlight Prism',
    icon: '💎',
    description: 'Crystal sky-glass wings that shimmer in golden sunlight.',
    cost: 340,
    primaryColor: 0x38bdf8,
    trimColor: 0xe0f2fe,
    emissiveColor: 0x0284c7,
    swatch: '#38bdf8'
  },
  {
    id: 'royal_cruiser',
    name: 'Royal Biplane',
    icon: '👑',
    description: 'Double-deck ruby & ivory cloud cruiser wings.',
    cost: 520,
    primaryColor: 0xf43f5e,
    trimColor: 0xfef3c7,
    emissiveColor: 0x881337,
    swatch: '#f43f5e'
  }
];

export const TRAIL_CATALOG: TrailSpec[] = [
  {
    id: 'golden_dust',
    name: 'Golden Sparkle',
    icon: '✨',
    description: 'Warm swirling sun-gold pixie dust behind your jetpack.',
    cost: 0,
    swatch: '#fbbf24'
  },
  {
    id: 'rainbow_ribbon',
    name: 'Rainbow Prism',
    icon: '🌈',
    description: 'Playful shifting rainbow ribbons across the clouds.',
    cost: 150,
    swatch: '#ec4899'
  },
  {
    id: 'bubble_pop',
    name: 'Sky Bubbles',
    icon: '🫧',
    description: 'Iridescent floating soap bubbles tumbling in your wake.',
    cost: 280,
    swatch: '#67e8f9'
  },
  {
    id: 'comet_flame',
    name: 'Comet Flare',
    icon: '☄️',
    description: 'Vibrant solar-orange and turquoise turbo embers.',
    cost: 440,
    swatch: '#fb923c'
  }
];

export const AVIATOR_CATALOG: AviatorSpec[] = [
  {
    id: 'classic_pilot',
    name: 'Sky Explorer',
    icon: '🧣',
    description: 'Cobalt flight jacket, leather helmet & bright red scarf.',
    cost: 0,
    jacketColor: 0x2563eb,
    scarfColor: 0xef4444,
    helmetColor: 0x7c3f1d,
    swatch: '#2563eb'
  },
  {
    id: 'mint_explorer',
    name: 'Mint Adventurer',
    icon: '🧭',
    description: 'Fresh teal coat, cream aviator cap & sunny coral scarf.',
    cost: 140,
    jacketColor: 0x0d9488,
    scarfColor: 0xfb7185,
    helmetColor: 0xb45309,
    swatch: '#0d9488'
  },
  {
    id: 'sunny_bee',
    name: 'Sunbeam Ace',
    icon: '🌻',
    description: 'Bright honey-gold jacket with royal sky-blue scarf.',
    cost: 260,
    jacketColor: 0xf59e0b,
    scarfColor: 0x0284c7,
    helmetColor: 0x78350f,
    swatch: '#f59e0b'
  },
  {
    id: 'cosmic_captain',
    name: 'Star Captain',
    icon: '🌟',
    description: 'Plum-violet star jacket, pearly helmet & golden scarf.',
    cost: 400,
    jacketColor: 0x7c3aed,
    scarfColor: 0xfacc15,
    helmetColor: 0xf8fafc,
    swatch: '#7c3aed'
  }
];

export function getWingSpec(id: WingId): WingSpec {
  return WING_CATALOG.find((w) => w.id === id) ?? WING_CATALOG[0];
}

export function getTrailSpec(id: TrailId): TrailSpec {
  return TRAIL_CATALOG.find((t) => t.id === id) ?? TRAIL_CATALOG[0];
}

export function getAviatorSpec(id: AviatorId): AviatorSpec {
  return AVIATOR_CATALOG.find((a) => a.id === id) ?? AVIATOR_CATALOG[0];
}

export function getMaxHearts(shieldLevel: number): number {
  return 3 + (shieldLevel >= 3 ? 1 : 0) + (shieldLevel >= 5 ? 1 : 0);
}
