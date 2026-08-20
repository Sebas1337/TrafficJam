// All simulation constants (spec §4). Units: metres, seconds.
// Nothing outside this file may hardcode these values inline.

export const GRID_CELL = 20; // m, one map cell
export const CAR_LENGTH = 4.5; // m
export const MIN_GAP = 2.0; // m, IDM s0 — jam spacing = 6.5 m
export const LANE_WIDTH = 3.2; // m

export const SPEED_LOCAL = 8.3; // m/s (30 km/h)
export const SPEED_ARTERIAL = 13.9; // m/s (50 km/h)

export const IDM_ACCEL = 1.5; // m/s^2 (a)
export const IDM_COMFORT_BRAKE = 2.0; // m/s^2 (b)
export const IDM_HEADWAY = 1.2; // s (T)
export const IDM_DELTA = 4;
export const IDM_EMERGENCY_BRAKE = 6.0; // m/s^2, hard cap to prevent overlap

export const YELLOW = 3.0; // s
export const ALL_RED = 1.5; // s
export const CYCLE_MIN = 40; // s
export const CYCLE_MAX = 120; // s
export const CYCLE_DEFAULT = 60; // s
export const MIN_GREEN = 6.0; // s

export const GAP_ACCEPT_CROSS = 5.0; // s, unsignalised/permissive crossing
export const GAP_ACCEPT_MERGE = 3.5; // s, merging / right turn
export const PROGRESSION_FACTOR = 0.85; // green-wave design speed factor

export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ; // s, fixed timestep

// Intersection box half-size: how far lanes are trimmed back from the node
// centre at intersections, creating the "box" that turn connections cross.
export const NODE_BOX_RADIUS = 8; // m

// Comfortable lateral acceleration used to derive turn speed caps.
export const LATERAL_ACCEL = 1.8; // m/s^2

// Slice-1 map extent: 16 × 24 cells, portrait-oriented for phone screens.
export const MAP_W = 16 * GRID_CELL; // 320 m
export const MAP_H = 24 * GRID_CELL; // 480 m

// Demand (spec §7.7, slice-1 tuning).
export const DEMAND_BASE = 6; // cars/min at t = 0
export const DEMAND_DOUBLE_EVERY = 240; // s — rate doubles every 4 min
export const DEMAND_CAP = 45; // cars/min
export const PORTAL_QUEUE_LIMIT = 12; // queued cars considered "overflowing"

// Frustration meter (spec §10): fills on sustained stoppage, drains on flow.
export const FRUSTRATION_STOP_THRESHOLD = 0.35; // fraction of cars stopped
export const FRUSTRATION_FILL_RATE = 0.022; // per s at 100% over threshold
export const FRUSTRATION_QUEUE_RATE = 0.012; // per s at full portal queues
export const FRUSTRATION_DRAIN_FAST = 0.02; // per s when flowing freely
export const FRUSTRATION_DRAIN_SLOW = 0.005; // per s otherwise

// Economy (spec §10). Rewards scale with how little a car was delayed.
export const START_MONEY = 600;
export const REWARD_BASE = 6;
export const REWARD_BONUS = 10;
export const ROAD_COST_PER_M = 2;
export const UPGRADE_EDGE_COST = 300; // second lane each way + arterial speed
export const SIGNAL_COST = 400;
export const STOP_COST = 100;
export const ROUNDABOUT_COST = 600;
export const AUTOTUNE_COST = 150;
export const DEMOLISH_REFUND = 0.5;
export const MIN_ROAD_LEN = 40; // m

// Pedestrians (slice 7): an optional all-red walk phase per signal.
export const PED_PHASE_SECONDS = 8;
export const PED_WAIT_LIMIT = 8; // waiting peds beyond this feed frustration
export const PED_BASE_RATE = 1.2; // peds/min per signal once demand starts
export const PED_START_TIME = 240; // s into an endless run

// Destination colours (spec §12).
export const PORTAL_COLORS: readonly string[] = [
  '#E8912A', // A
  '#3B82F6', // B
  '#14B8A6', // C
  '#A855F7', // D
  '#EC4899', // E
  '#84CC16', // F
];
export const PORTAL_LABELS = 'ABCDEF';
