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

// Slice-1 map extent (spec §15): 30 × 22 cells.
export const MAP_W = 30 * GRID_CELL; // 600 m
export const MAP_H = 22 * GRID_CELL; // 440 m

// Demand (spec §7.7, slice-1 tuning).
export const DEMAND_BASE = 6; // cars/min at t = 0
export const DEMAND_DOUBLE_EVERY = 240; // s — rate doubles every 4 min
export const DEMAND_CAP = 45; // cars/min
export const PORTAL_QUEUE_LIMIT = 12; // queued cars considered "overflowing"

// Frustration meter (spec §10): fills on sustained stoppage, drains on flow.
export const FRUSTRATION_STOP_THRESHOLD = 0.35; // fraction of cars stopped
export const FRUSTRATION_FILL_RATE = 0.05; // per s at 100% over threshold
export const FRUSTRATION_QUEUE_RATE = 0.03; // per s at full portal queues
export const FRUSTRATION_DRAIN_FAST = 0.015; // per s when flowing freely
export const FRUSTRATION_DRAIN_SLOW = 0.004; // per s otherwise

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
