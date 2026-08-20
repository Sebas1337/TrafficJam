// Campaign levels (slice 6, spec §11). Data-driven: each level is a seed +
// constraints + a one-card teach. Stars are self-normalizing: the share of
// spawned cars actually delivered (plus surviving to the end), so thresholds
// don't need per-level demand math. Threshold tuning is deliberately rough
// for now — logged as a known issue.

export interface LevelConfig {
  id: string;
  name: string;
  teach: string; // shown on the intro card
  seed: number;
  demandScale: number;
  duration: number; // seconds of sim time to survive
  money: number;
  buildLocked: boolean;
  controlsLocked: boolean; // control-type changes locked (timing still allowed)
  pedRate: number; // peds/min per signal
  /** Delivered ÷ spawned fractions for 1/2/3 stars. */
  starFractions: [number, number, number];
}

const STARS: [number, number, number] = [0.55, 0.72, 0.88];

export const LEVELS: LevelConfig[] = [
  {
    id: 'l01',
    name: 'First light',
    teach:
      'Cars drive between the lettered portals. Tap the traffic light and drag GREEN SHARE — give the busy street more green. Keep the meter out of the red.',
    seed: 11,
    demandScale: 0.7,
    duration: 180,
    money: 0,
    buildLocked: true,
    controlsLocked: true,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l02',
    name: 'Two lights',
    teach:
      'Two signals now. Each has its own GREEN SHARE — watch where queues grow and rebalance both. Pause any time; edits work while paused.',
    seed: 7,
    demandScale: 0.85,
    duration: 240,
    money: 0,
    buildLocked: true,
    controlsLocked: true,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l03',
    name: 'The wave',
    teach:
      'OFFSET shifts a light\'s schedule in time. Link the signals with 📈, then drag the bands so the diagonal line crosses only green — cars will ride the wave without stopping.',
    seed: 23,
    demandScale: 1,
    duration: 300,
    money: 300,
    buildLocked: true,
    controlsLocked: true,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l04',
    name: 'Cheaper than lights',
    teach:
      'Signals are not always the answer. Tap an intersection to change its control: a STOP sign is cheap and beats a signal when the side street is quiet.',
    seed: 31,
    demandScale: 0.8,
    duration: 240,
    money: 400,
    buildLocked: true,
    controlsLocked: false,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l05',
    name: 'Roundabout',
    teach:
      'A ROUNDABOUT never shows a red light — brilliant at moderate traffic, it chokes when flows get heavy. Try one where a signal feels wasteful.',
    seed: 47,
    demandScale: 0.9,
    duration: 300,
    money: 700,
    buildLocked: true,
    controlsLocked: false,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l06',
    name: 'Open for business',
    teach:
      'The build tool 🛣 is unlocked. Drag from a road or junction to lay new streets. Deliveries earn money — fast deliveries earn more.',
    seed: 53,
    demandScale: 1,
    duration: 300,
    money: 500,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l07',
    name: 'Bypass',
    teach:
      'The main street is drowning. Build a relief road around the worst junction and let through-traffic skip it entirely.',
    seed: 61,
    demandScale: 1.25,
    duration: 300,
    money: 900,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l08',
    name: 'Wider',
    teach:
      'Tap a road to WIDEN it: two lanes each way and a higher speed limit. Widening the spine changes what your signals can swallow.',
    seed: 71,
    demandScale: 1.3,
    duration: 300,
    money: 800,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l09',
    name: 'Two-way street',
    teach:
      'A green wave tuned one way often ruins the other. Watch both ↓ and ↑ percentages in the diagram and find the compromise.',
    seed: 83,
    demandScale: 1.2,
    duration: 360,
    money: 600,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 0,
    starFractions: STARS,
  },
  {
    id: 'l10',
    name: 'Foot traffic',
    teach:
      'Pedestrians! They queue at signals (blue badge). Enable a CROSSWALK PHASE in the signal sheet — it eats green time, but ignoring walkers feeds the meter.',
    seed: 97,
    demandScale: 1,
    duration: 300,
    money: 500,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 2,
    starFractions: STARS,
  },
  {
    id: 'l11',
    name: 'Walk the wave',
    teach:
      'Crosswalks appear in the diagram as blue slots — your green bands must fit around them. Re-tune the wave with pedestrians in the loop.',
    seed: 103,
    demandScale: 1.15,
    duration: 360,
    money: 600,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 2.5,
    starFractions: STARS,
  },
  {
    id: 'l12',
    name: 'Rescue',
    teach:
      'This town is minutes from gridlock and the timing is chaos. Triage: find the worst junction with the heatmap ▦, fix it, then work outward.',
    seed: 113,
    demandScale: 1.5,
    duration: 360,
    money: 700,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 1,
    starFractions: [0.5, 0.65, 0.8],
  },
  {
    id: 'l13',
    name: 'Rush hour',
    teach:
      'Demand climbs relentlessly. Spend early on capacity or bank money for emergencies — you will not have time to do both later.',
    seed: 127,
    demandScale: 1.6,
    duration: 420,
    money: 800,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 2,
    starFractions: [0.5, 0.65, 0.8],
  },
  {
    id: 'l14',
    name: 'The works',
    teach:
      'Everything at once: heavy cars, heavy feet, and a stingy budget. Signals, waves, stops, roundabouts, concrete — use the whole toolbox.',
    seed: 139,
    demandScale: 1.7,
    duration: 420,
    money: 600,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 3,
    starFractions: [0.45, 0.6, 0.78],
  },
  {
    id: 'l15',
    name: 'Masterclass',
    teach:
      'No hints. Keep the town flowing longer than anyone reasonably should.',
    seed: 151,
    demandScale: 1.9,
    duration: 480,
    money: 700,
    buildLocked: false,
    controlsLocked: false,
    pedRate: 3,
    starFractions: [0.45, 0.6, 0.75],
  },
];
