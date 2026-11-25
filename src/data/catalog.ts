import type {
  ActiveBounty,
  ActiveSkillId,
  AviatorId,
  BountyMetric,
  StageId,
  TrailId,
  UpgradeId,
  WingId
} from '../types/game';

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
  origin: string;
  description: string;
  cost: number;
  primaryColor: number;
  trimColor: number;
  emissiveColor: number;
  swatch: string;
  skillId: ActiveSkillId;
  skillName: string;
  skillIcon: string;
  skillCooldown: number;
  skillDesc: string;
  passiveLabel: string;
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

export interface StageSpec {
  id: StageId;
  name: string;
  subtitle: string;
  lengthMeters: number;
  bossName: string;
  bossSubtitle: string;
  bossHp: number;
  accentHex: string;
  primaryColor: number;
  secondaryColor: number;
  sRankScore: number;
  aRankScore: number;
  bRankScore: number;
}

export interface PilotRankSpec {
  level: number;
  title: string;
  minXp: number;
  badge: string;
}

export interface AchievementSpec {
  id: string;
  icon: string;
  name: string;
  description: string;
  rewardStars: number;
}

export interface BountyTemplate {
  metric: BountyMetric;
  title: (target: number) => string;
  targets: [number, number, number];
  rewardStars: [number, number, number];
  rewardXp: [number, number, number];
}

export const PILOT_AVATARS = ['⚡', '🦊', '🐉', '💀', '🤖', '🦅', '👾', '☄️'] as const;

export const UPGRADE_CATALOG: UpgradeSpec[] = [
  {
    id: 'magnet',
    name: 'Data Vacuum',
    icon: '🧲',
    description: 'Expands plasma tractor radius for pulling data-shard stars.',
    maxLevel: 5,
    costs: [50, 120, 220, 360, 540],
    effectLabel: (lv) => `${(4.0 + lv * 1.4).toFixed(1)}m pull radius`
  },
  {
    id: 'turbo',
    name: 'Plasma Thrusters',
    icon: '🔥',
    description: 'Boosts afterburner tank capacity & ring recharge speed.',
    maxLevel: 5,
    costs: [60, 140, 250, 400, 600],
    effectLabel: (lv) => `+${lv * 20}% boost cap & regen`
  },
  {
    id: 'shield',
    name: 'Hull Plating',
    icon: '🛡️',
    description: 'Grants +1 Armor Core at Lv.3 & Lv.5 and higher Shield Core drops.',
    maxLevel: 5,
    costs: [75, 160, 290, 460, 680],
    effectLabel: (lv) => `${3 + (lv >= 3 ? 1 : 0) + (lv >= 5 ? 1 : 0)} Armor Cores`
  },
  {
    id: 'combo',
    name: 'Overclock Core',
    icon: '⚡',
    description: 'Extends chain combo timer & cuts Active Wing Skill cooldown.',
    maxLevel: 5,
    costs: [55, 130, 240, 380, 560],
    effectLabel: (lv) => `${(4.5 + lv * 0.7).toFixed(1)}s combo · -${lv * 7}% CD`
  }
];

export const WING_CATALOG: WingSpec[] = [
  {
    id: 'garuda_nusantara',
    name: 'Garuda Nusantara',
    icon: '🦅',
    origin: 'Nusantara',
    description: 'Burung Garuda emas yang gagah dan lucu, ditemani penunggang cilik berblangkon!',
    cost: 0,
    primaryColor: 0xf59e0b,
    trimColor: 0xffd000,
    emissiveColor: 0xe11d48,
    swatch: '#fbbf24',
    skillId: 'pulse_nova',
    skillName: 'TERIAKAN GARUDA',
    skillIcon: '🦅',
    skillCooldown: 11,
    skillDesc: 'Gelombang emas menyapu rintangan, menyedot bintang & beri 2 DMG ke Boss.',
    passiveLabel: '+15% Isi Ulang Turbo'
  },
  {
    id: 'naga_barong',
    name: 'Naga Barong',
    icon: '🐉',
    origin: 'Bali & Jawa',
    description: 'Naga lucu berkumis emas yang meliuk lincah di langit bersama penunggang berudeng Bali!',
    cost: 0,
    primaryColor: 0x10b981,
    trimColor: 0x00ff9d,
    emissiveColor: 0xef4444,
    swatch: '#10b981',
    skillId: 'phase_dash',
    skillName: 'SERBUAN NAGA',
    skillIcon: '🔥',
    skillCooldown: 10,
    skillDesc: '1.8 detik melesat kebal menabrak ranjau & menghantam Boss (2 DMG).',
    passiveLabel: '+25% Radius & Bonus Graze'
  },
  {
    id: 'unicorn_sembrani',
    name: 'Kuda Sembrani',
    icon: '🦄',
    origin: 'Fantasi Nusantara',
    description: 'Unicorn bersayap pelangi yang gemoy dengan tanduk bercahaya dan surai warna-warni!',
    cost: 0,
    primaryColor: 0xf8fafc,
    trimColor: 0xff66c4,
    emissiveColor: 0xa855f7,
    swatch: '#ff66c4',
    skillId: 'overdrive_surge',
    skillName: 'SINAR PELANGI',
    skillIcon: '🌈',
    skillCooldown: 12,
    skillDesc: 'Isi +45% Fever Gauge & tembak 3 kilat pelangi pencari target!',
    passiveLabel: '+28% Area Bullseye Cincin'
  },
  {
    id: 'phinisi_bugis',
    name: 'Phinisi Terbang',
    icon: '⛵',
    origin: 'Bugis · Sulawesi',
    description: 'Kapal kayu Phinisi mini dengan layar mengembang & baling-baling kuningan, dinakhodai kapten bersongkok recca!',
    cost: 0,
    primaryColor: 0xb45309,
    trimColor: 0x38bdf8,
    emissiveColor: 0xf59e0b,
    swatch: '#38bdf8',
    skillId: 'aegis_matrix',
    skillName: 'BENTENG PHINISI',
    skillIcon: '🛡️',
    skillCooldown: 13,
    skillDesc: 'Aktifkan Perisai + Magnet Super 3.5 detik + meriam berat 2 DMG ke Boss.',
    passiveLabel: '+1 Inti Pelindung Awal'
  },
  {
    id: 'cenderawasih_papua',
    name: 'Cenderawasih Papua',
    icon: '🦜',
    origin: 'Papua',
    description: 'Burung surga warna emas-zamrud dengan ekor pita berkibar, ditunggangi sahabat bermahkota bulu Papua!',
    cost: 0,
    primaryColor: 0xfacc15,
    trimColor: 0x34d399,
    emissiveColor: 0xf97316,
    swatch: '#34d399',
    skillId: 'paradise_dance',
    skillName: 'TARIAN SURGA',
    skillIcon: '✨',
    skillCooldown: 12,
    skillDesc: 'Tarik semua bintang, aktifkan 2X Bintang 4.5 detik & sapu ranjau sekitar!',
    passiveLabel: '+2.5m Radius Magnet Bintang'
  },
  {
    id: 'enggang_dayak',
    name: 'Enggang Dayak',
    icon: '🪶',
    origin: 'Dayak · Kalimantan',
    description: 'Burung Enggang Kalimantan berparuh oranye unik, terbang gagah bersama penunggang bertopi manik Dayak!',
    cost: 0,
    primaryColor: 0x1e293b,
    trimColor: 0xff7b00,
    emissiveColor: 0xfacc15,
    swatch: '#ff7b00',
    skillId: 'hornbill_gale',
    skillName: 'BADAI ENGGANG',
    skillIcon: '🌪️',
    skillCooldown: 11.5,
    skillDesc: 'Angin topan hancurkan musuh di depan, isi +50% Turbo & beri 2 DMG Boss!',
    passiveLabel: '+20% Skor Cincin & Combo +1.2d'
  }
];

export const ALL_WING_IDS: WingId[] = WING_CATALOG.map((w) => w.id);

export const TRAIL_CATALOG: TrailSpec[] = [
  {
    id: 'golden_dust',
    name: 'Solar Ion',
    icon: '✨',
    description: 'High-energy golden plasma sparks streaking from twin exhausts.',
    cost: 0,
    swatch: '#ffd000'
  },
  {
    id: 'rainbow_ribbon',
    name: 'Prism Synth',
    icon: '🌈',
    description: 'Chromatic synthwave light ribbons cycling across the grid.',
    cost: 150,
    swatch: '#ec4899'
  },
  {
    id: 'bubble_pop',
    name: 'Quantum Pulse',
    icon: '💠',
    description: 'Electric cyan quantum particles warping in your slipstream.',
    cost: 280,
    swatch: '#00f0ff'
  },
  {
    id: 'comet_flame',
    name: 'Crimson Nova',
    icon: '☄️',
    description: 'Superheated magenta & solar-orange afterburner embers.',
    cost: 440,
    swatch: '#ff2a85'
  }
];

export const AVIATOR_CATALOG: AviatorSpec[] = [
  {
    id: 'classic_pilot',
    name: 'Merah Putih',
    icon: '🇮🇩',
    description: 'Baju merah menyala dengan syal putih berkibar semangat Nusantara.',
    cost: 0,
    jacketColor: 0xe11d48,
    scarfColor: 0xf8fafc,
    helmetColor: 0xfbbf24,
    swatch: '#e11d48'
  },
  {
    id: 'mint_explorer',
    name: 'Zamrud Khatulistiwa',
    icon: '🌿',
    description: 'Kostum hijau zamrud tropis dengan syal emas ceria.',
    cost: 140,
    jacketColor: 0x059669,
    scarfColor: 0xfde047,
    helmetColor: 0x34d399,
    swatch: '#10b981'
  },
  {
    id: 'sunny_bee',
    name: 'Batik Emas',
    icon: '🏺',
    description: 'Busana nuansa batik sogan hangat dengan selendang kuning kunyit.',
    cost: 260,
    jacketColor: 0x92400e,
    scarfColor: 0xfbbf24,
    helmetColor: 0xf97316,
    swatch: '#f59e0b'
  },
  {
    id: 'cosmic_captain',
    name: 'Pelangi Nusantara',
    icon: '🌈',
    description: 'Kostum ungu cerah dengan syal biru langit penuh bintang.',
    cost: 400,
    jacketColor: 0x7c3aed,
    scarfColor: 0x38bdf8,
    helmetColor: 0xf472b6,
    swatch: '#a855f7'
  }
];

export const STAGE_CATALOG: StageSpec[] = [
  {
    id: 1,
    name: 'NEON METROPOLIS',
    subtitle: 'Orbital Spire Corridor',
    lengthMeters: 1500,
    bossName: 'SENTINEL DRONE-X',
    bossSubtitle: 'Orbital Enforcement Unit',
    bossHp: 6,
    accentHex: '#00f0ff',
    primaryColor: 0x00f0ff,
    secondaryColor: 0x6366f1,
    sRankScore: 85000,
    aRankScore: 55000,
    bRankScore: 32000
  },
  {
    id: 2,
    name: 'SOLAR FOUNDRY',
    subtitle: 'Molten Reactor Trench',
    lengthMeters: 1800,
    bossName: 'HELIOS CORE',
    bossSubtitle: 'Thermonuclear Dynamo',
    bossHp: 8,
    accentHex: '#ff7b00',
    primaryColor: 0xff8c00,
    secondaryColor: 0xf43f5e,
    sRankScore: 115000,
    aRankScore: 75000,
    bRankScore: 45000
  },
  {
    id: 3,
    name: 'STORM CITADEL',
    subtitle: 'High-Voltage Stratosphere',
    lengthMeters: 2100,
    bossName: 'TEMPEST LEVIATHAN',
    bossSubtitle: 'Ion Storm Sovereign',
    bossHp: 10,
    accentHex: '#a855f7',
    primaryColor: 0xa855f7,
    secondaryColor: 0x38bdf8,
    sRankScore: 150000,
    aRankScore: 100000,
    bRankScore: 60000
  },
  {
    id: 4,
    name: 'ASTRAL SINGULARITY',
    subtitle: 'Event Horizon Rift',
    lengthMeters: 2400,
    bossName: 'OMEGA ARCHITECT',
    bossSubtitle: 'Apex Void Construct',
    bossHp: 12,
    accentHex: '#ff2a85',
    primaryColor: 0xff2a85,
    secondaryColor: 0xffd000,
    sRankScore: 195000,
    aRankScore: 130000,
    bRankScore: 80000
  }
];

export const PILOT_RANKS: PilotRankSpec[] = [
  { level: 1, title: 'ROOKIE', minXp: 0, badge: '🪽' },
  { level: 2, title: 'STRIKER', minXp: 350, badge: '⚡' },
  { level: 3, title: 'VANGUARD', minXp: 900, badge: '🔷' },
  { level: 4, title: 'ACE', minXp: 1700, badge: '🦅' },
  { level: 5, title: 'PHANTOM', minXp: 2800, badge: '💠' },
  { level: 6, title: 'APEX', minXp: 4300, badge: '🔥' },
  { level: 7, title: 'OVERLORD', minXp: 6500, badge: '👑' }
];

export const ACHIEVEMENT_CATALOG: AchievementSpec[] = [
  {
    id: 'first_boss',
    icon: '🤖',
    name: 'System Breaker',
    description: 'Defeat your first Stage Boss.',
    rewardStars: 80
  },
  {
    id: 'campaign_clear',
    icon: '🌌',
    name: 'Singularity Conqueror',
    description: 'Clear all 4 Campaign Sectors.',
    rewardStars: 250
  },
  {
    id: 's_rank_ace',
    icon: '🏅',
    name: 'S-Rank Precision',
    description: 'Achieve an S-Rank on any Campaign Stage.',
    rewardStars: 140
  },
  {
    id: 'overclocked_clear',
    icon: '💀',
    name: 'Overclocked Survivor',
    description: 'Defeat any Stage Boss on Overclocked difficulty.',
    rewardStars: 200
  },
  {
    id: 'untouchable_boss',
    icon: '🛡️',
    name: 'Untouchable Duelist',
    description: 'Defeat a Boss without taking hull damage during the duel.',
    rewardStars: 180
  },
  {
    id: 'bullseye_25',
    icon: '🎯',
    name: 'Deadeye Threader',
    description: 'Score 25 career Bullseye ring passes.',
    rewardStars: 100
  },
  {
    id: 'graze_30',
    icon: '⚡',
    name: 'Razor Edge',
    description: 'Perform 30 career Near-Miss Grazes.',
    rewardStars: 110
  },
  {
    id: 'combo_x10',
    icon: '🔥',
    name: 'Max Multiplier',
    description: 'Reach a x10 Ring Chain Combo in flight.',
    rewardStars: 120
  }
];

export const BOUNTY_POOL: BountyTemplate[] = [
  {
    metric: 'bullseyes',
    title: (t) => `Hit ${t} Bullseye Rings`,
    targets: [5, 10, 18],
    rewardStars: [55, 95, 150],
    rewardXp: [90, 150, 240]
  },
  {
    metric: 'grazes',
    title: (t) => `Perform ${t} Near-Miss Grazes`,
    targets: [4, 9, 16],
    rewardStars: [60, 105, 165],
    rewardXp: [95, 160, 250]
  },
  {
    metric: 'deflects',
    title: (t) => `Counter-Deflect ${t} Boss Orbs`,
    targets: [2, 4, 7],
    rewardStars: [70, 120, 185],
    rewardXp: [110, 180, 270]
  },
  {
    metric: 'max_combo',
    title: (t) => `Reach x${t} Ring Combo in 1 Run`,
    targets: [5, 7, 10],
    rewardStars: [55, 100, 160],
    rewardXp: [90, 160, 250]
  },
  {
    metric: 'fever_triggers',
    title: (t) => `Activate Overdrive Fever ${t}x`,
    targets: [2, 4, 7],
    rewardStars: [65, 115, 175],
    rewardXp: [100, 170, 260]
  },
  {
    metric: 'boss_kills',
    title: (t) => `Destroy ${t} Sector Boss(es)`,
    targets: [1, 2, 3],
    rewardStars: [85, 150, 240],
    rewardXp: [140, 240, 360]
  },
  {
    metric: 'stars',
    title: (t) => `Collect ${t} Data Stars`,
    targets: [45, 90, 160],
    rewardStars: [50, 90, 145],
    rewardXp: [80, 140, 220]
  },
  {
    metric: 'distance',
    title: (t) => `Fly ${t.toLocaleString()}m Total`,
    targets: [2500, 5000, 9000],
    rewardStars: [55, 100, 160],
    rewardXp: [85, 150, 240]
  },
  {
    metric: 'skill_uses',
    title: (t) => `Trigger Wing Skill ${t}x`,
    targets: [4, 8, 14],
    rewardStars: [50, 85, 135],
    rewardXp: [80, 135, 210]
  }
];

export function rollNewBounty(excludeMetrics: BountyMetric[], tierHint = 0): ActiveBounty {
  const candidates = BOUNTY_POOL.filter((b) => !excludeMetrics.includes(b.metric));
  const pool = candidates.length > 0 ? candidates : BOUNTY_POOL;
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  const tier = Math.max(0, Math.min(2, tierHint + (Math.random() < 0.4 ? 1 : 0)));
  const target = tpl.targets[tier];
  return {
    id: `bounty_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    metric: tpl.metric,
    title: tpl.title(target),
    target,
    progress: 0,
    rewardStars: tpl.rewardStars[tier],
    rewardXp: tpl.rewardXp[tier],
    completed: false
  };
}

export function getWingSpec(id: WingId): WingSpec {
  return WING_CATALOG.find((w) => w.id === id) ?? WING_CATALOG[0];
}

export function getTrailSpec(id: TrailId): TrailSpec {
  return TRAIL_CATALOG.find((t) => t.id === id) ?? TRAIL_CATALOG[0];
}

export function getAviatorSpec(id: AviatorId): AviatorSpec {
  return AVIATOR_CATALOG.find((a) => a.id === id) ?? AVIATOR_CATALOG[0];
}

export function getStageSpec(id: StageId): StageSpec {
  return STAGE_CATALOG.find((s) => s.id === id) ?? STAGE_CATALOG[0];
}

export function getMaxHearts(shieldLevel: number, wingId: WingId = 'garuda_nusantara'): number {
  const base = 3 + (shieldLevel >= 3 ? 1 : 0) + (shieldLevel >= 5 ? 1 : 0);
  return base + (wingId === 'phinisi_bugis' ? 1 : 0);
}

export function getPilotRankInfo(xp: number): {
  current: PilotRankSpec;
  next: PilotRankSpec | null;
  progressRatio: number;
} {
  let current = PILOT_RANKS[0];
  let next: PilotRankSpec | null = PILOT_RANKS[1] ?? null;
  for (let i = 0; i < PILOT_RANKS.length; i++) {
    if (xp >= PILOT_RANKS[i].minXp) {
      current = PILOT_RANKS[i];
      next = PILOT_RANKS[i + 1] ?? null;
    }
  }
  const progressRatio = next
    ? Math.max(0, Math.min(1, (xp - current.minXp) / Math.max(1, next.minXp - current.minXp)))
    : 1;
  return { current, next, progressRatio };
}
