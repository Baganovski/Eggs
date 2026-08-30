import {
  CARDINAL_DIRS,
  DIR_DELTA,
  DIRECTIONS,
  MAX_WALK_STEPS,
  PLAN_TIME_MS,
  PLAYER_HUES,
  STARTING_HP,
  PICKUP_WEAPON_KINDS,
  WEAPON_KINDS,
  cartonSpec,
  type ArenaAction,
  type CardinalDir,
  type CartonSpec,
  type Cell,
  type Direction,
  type GameState,
  type MatchOutcome,
  type PlanCard,
  type PlaybackEvent,
  type Player,
  type PublicGameState,
  type RoundStartToken,
  type WeaponKind,
} from '../types/game';

export const WEAPON_STATS: Record<WeaponKind, { range: number; damage: number }> = {
  pistol: { range: 3, damage: 1 },
  rifle: { range: Number.POSITIVE_INFINITY, damage: 2 },
  shotgun: { range: 3, damage: 2 },
  bomb: { range: 2, damage: 2 },
  slap: { range: 1, damage: 2 },
  flamethrower: { range: 2, damage: 2 },
};

const SLAP_FAN: Record<CardinalDir, Direction[]> = {
  N: ['NW', 'N', 'NE'],
  E: ['NE', 'E', 'SE'],
  S: ['SE', 'S', 'SW'],
  W: ['SW', 'W', 'NW'],
};

export function isCardinalDir(value: unknown): value is CardinalDir {
  return CARDINAL_DIRS.includes(value as CardinalDir);
}

export function isWeaponKind(value: unknown): value is WeaponKind {
  return WEAPON_KINDS.includes(value as WeaponKind);
}

export function formatWeapon(kind: WeaponKind): string {
  return kind[0].toUpperCase() + kind.slice(1);
}

export function isReusableCard(card: PlanCard): boolean {
  return card.kind === 'move' || card.kind === 'pistol';
}

export function randomPickupWeapon(): WeaponKind {
  const index = Math.floor(Math.random() * PICKUP_WEAPON_KINDS.length);
  return PICKUP_WEAPON_KINDS[index] ?? 'rifle';
}

export function dealHand(spareWeapon: WeaponKind | null = null): PlanCard[] {
  const cards: PlanCard[] = [
    { id: crypto.randomUUID(), kind: 'move' },
    { id: crypto.randomUUID(), kind: 'pistol' },
  ];
  if (spareWeapon) {
    cards.push({ id: crypto.randomUUID(), kind: spareWeapon });
  }
  return cards;
}

export function dealHands(players: Player[]): Player[] {
  return players.map((player) => {
    const spareWeapon = player.spareWeapon ?? null;
    return {
      ...player,
      planSubmitted: false,
      spareWeapon: isAlive(player) ? spareWeapon : null,
      hand: isAlive(player) ? dealHand(spareWeapon) : [],
    };
  });
}

export function hideOtherHands(players: Player[], viewerId: string): Player[] {
  return players.map((player) =>
    player.id === viewerId ? player : { ...player, hand: [], spareWeapon: null },
  );
}

export function viewStateFor(state: GameState, viewerId: string): PublicGameState {
  const { localPlayerId: _, ...publicState } = state;
  return {
    ...publicState,
    players: hideOtherHands(publicState.players, viewerId),
  };
}

export function slapFanCells(
  from: Cell,
  dir: Direction,
  carton: CartonSpec,
  mapObjects: Cell[] = [],
): Cell[] {
  if (!isCardinalDir(dir)) return [];
  const forwardDelta = DIR_DELTA[dir];
  const forward = { row: from.row + forwardDelta.dr, col: from.col + forwardDelta.dc };
  if (isObjectCell(forward, mapObjects)) return [];
  return SLAP_FAN[dir]
    .map((facing) => {
      const delta = DIR_DELTA[facing];
      return { row: from.row + delta.dr, col: from.col + delta.dc };
    })
    .filter((cell) => isOnBoard(cell, carton) && !isObjectCell(cell, mapObjects));
}

export function flameCells(
  from: Cell,
  dir: Direction,
  carton: CartonSpec,
  mapObjects: Cell[] = [],
): Cell[] {
  if (!isCardinalDir(dir)) return [];
  const forward = DIR_DELTA[dir];
  const side = dir === 'N' || dir === 'S' ? { dr: 0, dc: 1 } : { dr: 1, dc: 0 };
  const first = { row: from.row + forward.dr, col: from.col + forward.dc };
  if (isObjectCell(first, mapObjects)) return [];
  const second = { row: from.row + forward.dr * 2, col: from.col + forward.dc * 2 };
  const left = { row: second.row - side.dr, col: second.col - side.dc };
  const right = { row: second.row + side.dr, col: second.col + side.dc };
  return [first, second, left, right].filter(
    (cell) => isOnBoard(cell, carton) && !isObjectCell(cell, mapObjects),
  );
}

export function weaponFanCells(
  weapon: WeaponKind,
  from: Cell,
  dir: Direction,
  carton: CartonSpec,
  mapObjects: Cell[] = [],
): Cell[] | null {
  if (weapon === 'slap') return slapFanCells(from, dir, carton, mapObjects);
  if (weapon === 'flamethrower') return flameCells(from, dir, carton, mapObjects);
  return null;
}

export function isCardinalWeapon(weapon: WeaponKind): boolean {
  return weapon === 'slap' || weapon === 'flamethrower';
}

export function bombSplashCells(
  epicenter: Cell,
  carton: CartonSpec,
  mapObjects: Cell[] = [],
): Cell[] {
  return CARDINAL_DIRS.map((dir) => {
    const delta = DIR_DELTA[dir];
    return { row: epicenter.row + delta.dr, col: epicenter.col + delta.dc };
  }).filter((cell) => isOnBoard(cell, carton) && !isObjectCell(cell, mapObjects));
}

export function bombLandingCell(from: Cell, dir: Direction, carton: CartonSpec): Cell | null {
  const range = WEAPON_STATS.bomb.range;
  const { dr, dc } = DIR_DELTA[dir];
  const end = { row: from.row + dr * range, col: from.col + dc * range };
  if (!isOnBoard(end, carton)) return null;
  return end;
}

export function bombThrowCells(from: Cell, dir: Direction, carton: CartonSpec): Cell[] {
  const end = bombLandingCell(from, dir, carton);
  return end ? [end] : [];
}

export function walkDelay(action: ArenaAction | null | undefined): number {
  return action?.type === 'walk' && action.delay === 1 ? 1 : 0;
}

export function actionMoveBeats(action: ArenaAction | null | undefined): number {
  if (action?.type === 'walk') return walkDelay(action) + action.path.length;
  if (action?.type === 'stay') return 1;
  return 0;
}

function chebyshevDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

function isWithinOneSquare(cell: Cell, other: Cell): boolean {
  return chebyshevDistance(cell, other) <= 1;
}

export function generateMapObjects(playerPositions: Cell[], carton: CartonSpec): Cell[] {
  const candidates: Cell[] = [];
  for (let row = 0; row < carton.rows; row += 1) {
    for (let col = 0; col < carton.cols; col += 1) {
      const cell = { row, col };
      const tooClose = playerPositions.some((pos) => isWithinOneSquare(cell, pos));
      if (!tooClose) candidates.push(cell);
    }
  }

  let pool = [...candidates];
  const objects: Cell[] = [];
  const count = Math.min(carton.obstacleCount, pool.length);
  for (let i = 0; i < count; i += 1) {
    if (pool.length === 0) break;
    const index = Math.floor(Math.random() * pool.length);
    const picked = pool[index];
    objects.push(picked);
    pool = pool.filter((cell) => !isWithinOneSquare(cell, picked));
  }
  return objects;
}

export const STAY_PLAN: [ArenaAction, ArenaAction] = [{ type: 'stay' }, { type: 'stay' }];

const PLAYBACK_MS: Record<PlaybackEvent['type'], number> = {
  actionStart: 400,
  beat: 0,
  shot: 450,
  hit: 220,
  death: 280,
  move: 380,
  eggStain: 0,
  blocked: 400,
  pickup: 280,
  shrinkWarn: 420,
  shrinkDestroy: 450,
};

export function playerColor(joinOrder: number): string {
  return PLAYER_HUES[joinOrder % PLAYER_HUES.length];
}

function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mixColors(colors: string[]): string {
  const unique = [...new Set(colors)];
  if (unique.length === 0) return PLAYER_HUES[0];
  if (unique.length === 1) return unique[0] ?? PLAYER_HUES[0];
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const color of unique) {
    const rgb = parseHexColor(color);
    if (!rgb) continue;
    r += rgb[0];
    g += rgb[1];
    b += rgb[2];
    count += 1;
  }
  if (count === 0) return unique[0] ?? PLAYER_HUES[0];
  const channel = (sum: number) => Math.round(sum / count).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function isAlive(player: Player): boolean {
  return player.hp > 0;
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.row === b.row && a.col === b.col;
}

export function isOnBoard(cell: Cell, carton: CartonSpec): boolean {
  return (
    cell.row >= 0 &&
    cell.row < carton.rows &&
    cell.col >= 0 &&
    cell.col < carton.cols
  );
}

export function cartonShrinks(carton: CartonSpec): boolean {
  return carton.type === 'full';
}

export function shrinkRings(carton: CartonSpec): Cell[][] {
  const rings: Cell[][] = [];
  let top = 0;
  let left = 0;
  let bottom = carton.rows - 1;
  let right = carton.cols - 1;
  while (top <= bottom && left <= right) {
    const ring: Cell[] = [];
    for (let col = left; col <= right; col += 1) ring.push({ row: top, col });
    for (let row = top + 1; row <= bottom; row += 1) ring.push({ row, col: right });
    if (top < bottom) {
      for (let col = right - 1; col >= left; col -= 1) ring.push({ row: bottom, col });
    }
    if (left < right) {
      for (let row = bottom - 1; row > top; row -= 1) ring.push({ row, col: left });
    }
    rings.push(ring);
    top += 1;
    left += 1;
    bottom -= 1;
    right -= 1;
  }
  return rings;
}

export const SHRINK_LANE_INDEX = 4;
const SHRINK_LANE_WARN_INDEX = 3;
const SHRINK_LANE_ROWS = 2;
const SHRINK_LANE_COLS = 3;

export function shrinkSafeLane(carton: CartonSpec): Cell[] {
  const height = Math.min(SHRINK_LANE_ROWS, carton.rows);
  const width = Math.min(SHRINK_LANE_COLS, carton.cols);
  const row0 = Math.floor((carton.rows - height) / 2);
  const col0 = Math.floor((carton.cols - width) / 2);
  const cells: Cell[] = [];
  for (let row = row0; row < row0 + height; row += 1) {
    for (let col = col0; col < col0 + width; col += 1) {
      cells.push({ row, col });
    }
  }
  return cells;
}

function shrinkLaneCutCells(carton: CartonSpec): Cell[] {
  const safe = new Set(shrinkSafeLane(carton).map((cell) => `${cell.row},${cell.col}`));
  return shrinkRings(carton)
    .slice(2)
    .flat()
    .filter((cell) => !safe.has(`${cell.row},${cell.col}`))
    .sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
}

export function shrinkDestroyedCells(index: number, carton: CartonSpec): Cell[] {
  if (!cartonShrinks(carton) || index <= 1) return [];
  if (index >= SHRINK_LANE_INDEX) {
    const safe = new Set(shrinkSafeLane(carton).map((cell) => `${cell.row},${cell.col}`));
    const destroyed: Cell[] = [];
    for (let row = 0; row < carton.rows; row += 1) {
      for (let col = 0; col < carton.cols; col += 1) {
        if (!safe.has(`${row},${col}`)) destroyed.push({ row, col });
      }
    }
    return destroyed;
  }
  return shrinkRings(carton).slice(0, index - 1).flat();
}

export function shrinkWarningCells(index: number, carton: CartonSpec): Cell[] {
  if (!cartonShrinks(carton) || index <= 0 || index >= SHRINK_LANE_INDEX) return [];
  if (index === SHRINK_LANE_WARN_INDEX) return shrinkLaneCutCells(carton);
  return shrinkRings(carton)[index - 1] ?? [];
}

export function closedMapObjects(
  mapObjects: Cell[],
  shrinkIndex: number,
  carton: CartonSpec,
): Cell[] {
  const destroyed = shrinkDestroyedCells(shrinkIndex, carton);
  if (destroyed.length === 0) return mapObjects;
  return [...mapObjects, ...destroyed];
}

export function isObjectCell(cell: Cell, mapObjects: Cell[]): boolean {
  return mapObjects.some((object) => cellsEqual(object, cell));
}

export function shotRayCells(
  from: Cell,
  dir: Direction,
  mapObjects: Cell[],
  carton: CartonSpec,
  maxRange = Number.POSITIVE_INFINITY,
): Cell[] {
  const { dr, dc } = DIR_DELTA[dir];
  const cells: Cell[] = [];
  let row = from.row + dr;
  let col = from.col + dc;
  while (isOnBoard({ row, col }, carton) && cells.length < maxRange) {
    const cell = { row, col };
    cells.push(cell);
    if (isObjectCell(cell, mapObjects)) break;
    row += dr;
    col += dc;
  }
  return cells;
}

export function validShootCells(
  weapon: WeaponKind,
  from: Cell,
  carton: CartonSpec,
  mapObjects: Cell[] = [],
): Cell[] {
  const seen = new Set<string>();
  const cells: Cell[] = [];
  const add = (cell: Cell) => {
    if (isObjectCell(cell, mapObjects)) return;
    const key = `${cell.row},${cell.col}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push(cell);
  };

  const dirs = isCardinalWeapon(weapon) ? CARDINAL_DIRS : DIRECTIONS;
  for (const dir of dirs) {
    if (isCardinalWeapon(weapon)) {
      const fan = weaponFanCells(weapon, from, dir, carton, mapObjects);
      if (!fan?.length) continue;
    }
    const ray =
      weapon === 'bomb'
        ? bombThrowCells(from, dir, carton)
        : shotRayCells(from, dir, mapObjects, carton, WEAPON_STATS[weapon].range);
    for (const cell of ray) add(cell);
  }
  return cells;
}

export function isAdjacent8(a: Cell, b: Cell): boolean {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return dr <= 1 && dc <= 1 && (dr !== 0 || dc !== 0);
}

export function isDirection(value: unknown): value is Direction {
  return DIRECTIONS.includes(value as Direction);
}

export function directionFromRay(from: Cell, to: Cell): Direction | null {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (dr === 0 && dc === 0) return null;
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  if (dr !== 0 && dc !== 0 && adr !== adc) return null;
  const udr = dr === 0 ? 0 : dr / adr;
  const udc = dc === 0 ? 0 : dc / adc;
  const match = DIRECTIONS.find((dir) => {
    const delta = DIR_DELTA[dir];
    return delta.dr === udr && delta.dc === udc;
  });
  return match ?? null;
}

export function cellsOnRay(from: Cell, end: Cell, carton: CartonSpec): Cell[] {
  const dir = directionFromRay(from, end);
  if (!dir) return cellsEqual(from, end) ? [] : [{ ...end }];
  const cells: Cell[] = [];
  let cursor = { ...from };
  const seen = new Set<string>();
  while (isOnBoard(cursor, carton) && !seen.has(`${cursor.row},${cursor.col}`)) {
    if (!cellsEqual(cursor, from)) cells.push({ ...cursor });
    if (cellsEqual(cursor, end)) break;
    seen.add(`${cursor.row},${cursor.col}`);
    const delta = DIR_DELTA[dir];
    cursor = { row: cursor.row + delta.dr, col: cursor.col + delta.dc };
  }
  return cells;
}

export function shotPlaybackCells(
  shot: {
    weapon: WeaponKind;
    from: Cell;
    end: Cell;
    dir: Direction;
    fan?: Cell[];
    splash?: Cell[];
  },
  carton: CartonSpec,
): Cell[] {
  const fan = weaponFanCells(shot.weapon, shot.from, shot.dir, carton, []);
  if (fan) {
    return shot.fan ?? fan;
  }
  if (shot.weapon === 'bomb') {
    return [shot.end, ...(shot.splash ?? bombSplashCells(shot.end, carton))];
  }
  return cellsOnRay(shot.from, shot.end, carton);
}

export function neighbors8(cell: Cell, carton: CartonSpec): Cell[] {
  return DIRECTIONS.map((dir) => {
    const delta = DIR_DELTA[dir];
    return { row: cell.row + delta.dr, col: cell.col + delta.dc };
  }).filter((step) => isOnBoard(step, carton));
}

export function plannedPositionAfter(start: Cell, action: ArenaAction | null): Cell {
  if (action?.type === 'walk' && action.path.length > 0) {
    return action.path[action.path.length - 1];
  }
  return start;
}

function isCell(value: unknown, carton: CartonSpec): value is Cell {
  if (!value || typeof value !== 'object') return false;
  const cell = value as Cell;
  return Number.isInteger(cell.row) && Number.isInteger(cell.col) && isOnBoard(cell, carton);
}

function isWalkLegal(
  from: Cell,
  path: Cell[],
  mapObjects: Cell[],
  carton: CartonSpec,
  delay = 0,
): boolean {
  if (delay !== 0 && delay !== 1) return false;
  if (path.length < 1 || path.length + delay > MAX_WALK_STEPS) return false;
  let current = from;
  for (const step of path) {
    if (!isOnBoard(step, carton) || isObjectCell(step, mapObjects) || !isAdjacent8(current, step)) {
      return false;
    }
    current = step;
  }
  return true;
}

function parseAction(value: unknown, carton: CartonSpec): ArenaAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as ArenaAction;
  if (action.type === 'stay') return { type: 'stay' };
  if (action.type === 'shoot' && isWeaponKind(action.weapon) && isDirection(action.dir)) {
    if (isCardinalWeapon(action.weapon) && !isCardinalDir(action.dir)) return null;
    const parsed: ArenaAction = { type: 'shoot', weapon: action.weapon, dir: action.dir };
    if (action.weapon === 'bomb') {
      const steps = action.steps;
      if (steps !== undefined && (!Number.isInteger(steps) || steps !== WEAPON_STATS.bomb.range)) {
        return null;
      }
      parsed.steps = WEAPON_STATS.bomb.range;
    }
    return parsed;
  }
  if (action.type === 'walk' && Array.isArray(action.path) && action.path.every((cell) => isCell(cell, carton))) {
    const delay = action.delay;
    if (delay !== undefined && delay !== 0 && delay !== 1) return null;
    const path = action.path.map((cell) => ({ row: cell.row, col: cell.col }));
    return delay === 1 ? { type: 'walk', path, delay: 1 } : { type: 'walk', path };
  }
  return null;
}

function actionMatchesCard(action: ArenaAction, card: PlanCard): boolean {
  if (card.kind === 'move') return action.type === 'stay' || action.type === 'walk';
  return action.type === 'shoot' && action.weapon === card.kind;
}

export function parseAndValidatePlan(
  player: Player,
  actions: unknown,
  cardIds: unknown,
  mapObjects: Cell[],
  carton: CartonSpec,
): [ArenaAction, ArenaAction] | null {
  if (!isAlive(player) || !Array.isArray(actions) || actions.length !== 2) return null;
  if (!Array.isArray(cardIds) || cardIds.length !== 2) return null;
  const firstId = cardIds[0];
  const secondId = cardIds[1];
  if (typeof firstId !== 'string' || typeof secondId !== 'string') return null;

  const firstCard = player.hand.find((card) => card.id === firstId);
  const secondCard = player.hand.find((card) => card.id === secondId);
  if (!firstCard || !secondCard) return null;
  if (firstId === secondId && !isReusableCard(firstCard)) return null;

  const first = parseAction(actions[0], carton);
  const second = parseAction(actions[1], carton);
  if (!first || !second) return null;
  if (!actionMatchesCard(first, firstCard) || !actionMatchesCard(second, secondCard)) return null;

  let position = { row: player.row, col: player.col };
  for (const action of [first, second]) {
    if (action.type === 'walk') {
      if (!isWalkLegal(position, action.path, mapObjects, carton, walkDelay(action))) return null;
      position = action.path[action.path.length - 1];
    }
    if (action.type === 'shoot' && action.weapon === 'bomb') {
      const end = bombLandingCell(position, action.dir, carton);
      if (!end || isObjectCell(end, mapObjects)) return null;
    }
  }
  return [first, second];
}

function cardForAction(
  player: Player,
  action: ArenaAction,
  preferredId: string | null,
): PlanCard | null {
  const preferred = preferredId
    ? player.hand.find((card) => card.id === preferredId)
    : undefined;
  if (preferred && actionMatchesCard(action, preferred)) return preferred;
  return player.hand.find((card) => actionMatchesCard(action, card)) ?? null;
}

export function completePartialPlan(
  player: Player,
  actions: [ArenaAction | null, ArenaAction | null],
  cardIds: [string | null, string | null],
  mapObjects: Cell[],
  carton: CartonSpec,
): { cardIds: [string, string]; actions: [ArenaAction, ArenaAction] } | null {
  const resolved: [ArenaAction, ArenaAction] = [{ type: 'stay' }, { type: 'stay' }];
  let position = { row: player.row, col: player.col };
  for (const index of [0, 1] as const) {
    const action = actions[index] ?? { type: 'stay' };
    if (action.type === 'walk') {
      if (
        cardForAction(player, action, cardIds[index]) &&
        isWalkLegal(position, action.path, mapObjects, carton, walkDelay(action))
      ) {
        resolved[index] = action;
        position = action.path[action.path.length - 1];
      }
      continue;
    }
    if (action.type === 'shoot' && cardForAction(player, action, cardIds[index])) {
      resolved[index] = action;
    }
  }

  const firstCard = cardForAction(player, resolved[0], cardIds[0]);
  const secondCard = cardForAction(player, resolved[1], cardIds[1]);
  if (!firstCard || !secondCard) return null;
  const plan = parseAndValidatePlan(
    player,
    resolved,
    [firstCard.id, secondCard.id],
    mapObjects,
    carton,
  );
  if (!plan) return null;
  return { cardIds: [firstCard.id, secondCard.id], actions: plan };
}

export function emptyArenaFields(): Pick<
  GameState,
  | 'turnPhase'
  | 'round'
  | 'outcome'
  | 'timeline'
  | 'roundStart'
  | 'lastReplay'
  | 'mapObjects'
  | 'eggStains'
  | 'presents'
  | 'shrinkIndex'
  | 'startedPlayerCount'
  | 'planDeadlineAt'
> {
  return {
    turnPhase: 'planning',
    round: 0,
    outcome: { kind: 'none' },
    timeline: [],
    roundStart: null,
    lastReplay: null,
    mapObjects: [],
    eggStains: [],
    presents: [],
    shrinkIndex: 0,
    startedPlayerCount: 0,
    planDeadlineAt: null,
  };
}

export function startArenaMatch(state: GameState): GameState {
  const carton = cartonSpec(state.cartonType);
  const seated = [...state.players]
    .filter((player) => player.connected)
    .sort((a, b) => a.joinOrder - b.joinOrder);
  const startById = new Map(
    seated.map((player, index) => [player.id, carton.starts[index] ?? carton.starts[0]]),
  );
  const players = seated.map((player) => {
    const corner = startById.get(player.id) ?? carton.starts[0];
    return {
      ...player,
      hp: STARTING_HP,
      row: corner.row,
      col: corner.col,
      planSubmitted: false,
      spareWeapon: null,
      hand: dealHand(null),
    };
  });
  const mapObjects = generateMapObjects(
    players.map((player) => ({ row: player.row, col: player.col })),
    carton,
  );

  return {
    ...state,
    phase: 'playing',
    turnPhase: 'planning',
    round: 1,
    outcome: { kind: 'none' },
    timeline: [],
    roundStart: null,
    lastReplay: null,
    mapObjects,
    eggStains: [],
    presents: [],
    shrinkIndex: 0,
    startedPlayerCount: players.length,
    players,
    planDeadlineAt: Date.now() + PLAN_TIME_MS,
  };
}

export function snapshotTokens(players: Player[]): RoundStartToken[] {
  return players.map((player) => ({
    id: player.id,
    row: player.row,
    col: player.col,
    hp: player.hp,
  }));
}

export function beginPlanningRound(state: GameState): GameState {
  return {
    ...state,
    phase: 'playing',
    turnPhase: 'planning',
    round: state.round + 1,
    timeline: [],
    roundStart: null,
    players: dealHands(state.players),
    planDeadlineAt: Date.now() + PLAN_TIME_MS,
  };
}

export function resetPlanningAfterHandoff(state: GameState): GameState {
  return {
    ...state,
    turnPhase: state.phase === 'playing' ? 'planning' : state.turnPhase,
    timeline: [],
    roundStart: null,
    players: state.phase === 'playing' ? dealHands(state.players) : state.players.map((player) => ({
      ...player,
      planSubmitted: false,
    })),
    planDeadlineAt: state.phase === 'playing' ? Date.now() + PLAN_TIME_MS : null,
  };
}

export function resetArenaPlayers(players: Player[]): Player[] {
  return players.map((player) => ({
    ...player,
    planSubmitted: false,
    hp: STARTING_HP,
    row: 0,
    col: 0,
    hand: [],
    spareWeapon: null,
  }));
}

export interface ResolveResult {
  players: Player[];
  timeline: PlaybackEvent[];
  outcome: MatchOutcome;
  eggStains: Cell[];
  presents: Cell[];
  shrinkIndex: number;
}

function living(players: Player[]): Player[] {
  return players.filter(isAlive);
}

function occupantAt(players: Player[], cell: Cell, exceptId?: string): Player | undefined {
  return living(players).find(
    (player) => player.id !== exceptId && cellsEqual(player, cell),
  );
}

function hasFriedEggAt(players: Player[], cell: Cell): boolean {
  return players.some((player) => player.hp <= 0 && cellsEqual(player, cell));
}

function isOrthogonalMove(from: Cell, to: Cell): boolean {
  const dr = Math.abs(to.row - from.row);
  const dc = Math.abs(to.col - from.col);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

function isDiagonalMove(from: Cell, to: Cell): boolean {
  return Math.abs(to.row - from.row) === 1 && Math.abs(to.col - from.col) === 1;
}

function isDiagonalCross(aFrom: Cell, aTo: Cell, bFrom: Cell, bTo: Cell): boolean {
  if (!isDiagonalMove(aFrom, aTo) || !isDiagonalMove(bFrom, bTo)) return false;
  if (cellsEqual(aFrom, bFrom)) return false;
  return (
    aFrom.row + aTo.row === bFrom.row + bTo.row &&
    aFrom.col + aTo.col === bFrom.col + bTo.col
  );
}

function fireShot(
  players: Player[],
  from: Cell,
  dir: Direction,
  shooterId: string,
  mapObjects: Cell[],
  maxRange: number,
  carton: CartonSpec,
): { end: Cell; hit?: Player } {
  const { dr, dc } = DIR_DELTA[dir];
  let row = from.row + dr;
  let col = from.col + dc;
  let end = from;
  let steps = 0;
  while (isOnBoard({ row, col }, carton) && steps < maxRange) {
    end = { row, col };
    steps += 1;
    if (isObjectCell(end, mapObjects)) return { end };
    const hit = occupantAt(players, end, shooterId);
    if (hit) return { end, hit };
    row += dr;
    col += dc;
  }
  return { end };
}

function addHit(hits: Map<string, number>, playerId: string, damage: number): void {
  hits.set(playerId, (hits.get(playerId) ?? 0) + damage);
}

export interface PlaybackShot {
  shooterId: string;
  joinOrder: number;
  damages: { playerId: string; amount: number }[];
}

export function orderShotsForPlayback<T extends PlaybackShot>(
  shots: T[],
  startHp: Map<string, number>,
): T[] {
  if (shots.length <= 1) return shots;
  const byShooter = new Map(shots.map((shot) => [shot.shooterId, shot]));
  const remaining = new Set(shots.map((shot) => shot.shooterId));
  const hp = new Map(startHp);
  const ordered: T[] = [];
  const queue: string[] = [];

  const takeNext = (): string | undefined => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (id && remaining.has(id)) return id;
    }
    return [...remaining].sort((a, b) => {
      const left = byShooter.get(a)?.joinOrder ?? 0;
      const right = byShooter.get(b)?.joinOrder ?? 0;
      return left - right;
    })[0];
  };

  while (remaining.size > 0) {
    const id = takeNext();
    if (!id) break;
    remaining.delete(id);
    const shot = byShooter.get(id);
    if (!shot) break;
    ordered.push(shot);
    const killed: PlaybackShot[] = [];
    for (const damage of shot.damages) {
      const before = hp.get(damage.playerId) ?? 0;
      const after = Math.max(0, before - damage.amount);
      hp.set(damage.playerId, after);
      if (before > 0 && after === 0) {
        const victim = byShooter.get(damage.playerId);
        if (victim) killed.push(victim);
      }
    }
    killed.sort((a, b) => a.joinOrder - b.joinOrder);
    for (let index = killed.length - 1; index >= 0; index -= 1) {
      const victimId = killed[index]?.shooterId;
      if (victimId && remaining.has(victimId)) queue.unshift(victimId);
    }
  }
  return ordered;
}

interface Intent {
  id: string;
  from: Cell;
  to: Cell;
}

function resolveMovement(
  players: Player[],
  intents: Intent[],
  timeline: PlaybackEvent[],
  mapObjects: Cell[],
  eggStains: Cell[],
): Player[] {
  const byId = new Map(intents.map((intent) => [intent.id, intent]));
  const failed = new Set<string>();

  const destGroups = new Map<string, Intent[]>();
  for (const intent of intents) {
    if (!cellsEqual(intent.from, intent.to) && isObjectCell(intent.to, mapObjects)) {
      failed.add(intent.id);
    }
    const key = `${intent.to.row},${intent.to.col}`;
    const group = destGroups.get(key) ?? [];
    group.push(intent);
    destGroups.set(key, group);
  }
  for (const group of destGroups.values()) {
    const movers = group.filter((intent) => !cellsEqual(intent.from, intent.to));
    const occupied = group.some((intent) => cellsEqual(intent.from, intent.to));
    if (occupied) {
      for (const intent of movers) failed.add(intent.id);
      continue;
    }
    if (movers.length < 2) continue;
    const straight = movers.filter((intent) => isOrthogonalMove(intent.from, intent.to));
    if (straight.length === 1) {
      for (const intent of movers) {
        if (intent.id !== straight[0].id) failed.add(intent.id);
      }
      continue;
    }
    for (const intent of movers) failed.add(intent.id);
  }

  for (let i = 0; i < intents.length; i += 1) {
    for (let j = i + 1; j < intents.length; j += 1) {
      const a = intents[i];
      const b = intents[j];
      const swapping =
        !cellsEqual(a.from, a.to) &&
        cellsEqual(a.to, b.from) &&
        cellsEqual(b.to, a.from);
      if (swapping || isDiagonalCross(a.from, a.to, b.from, b.to)) {
        failed.add(a.id);
        failed.add(b.id);
      }
    }
  }

  const isLeaving = (playerId: string): boolean => {
    const intent = byId.get(playerId);
    if (!intent || failed.has(playerId)) return false;
    return !cellsEqual(intent.from, intent.to);
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const intent of intents) {
      if (failed.has(intent.id) || cellsEqual(intent.from, intent.to)) continue;
      const blocker = occupantAt(players, intent.to, intent.id);
      if (blocker && !isLeaving(blocker.id)) {
        failed.add(intent.id);
        changed = true;
      }
    }
  }

  const nextPlayers = players.map((player) => {
    const intent = byId.get(player.id);
    if (!intent) return player;
    if (failed.has(player.id) || cellsEqual(intent.from, intent.to)) return player;
    return { ...player, row: intent.to.row, col: intent.to.col };
  });

  for (const player of players) {
    const intent = byId.get(player.id);
    if (!intent || cellsEqual(intent.from, intent.to) || failed.has(player.id)) continue;
    timeline.push({
      type: 'move',
      playerId: player.id,
      from: intent.from,
      to: intent.to,
    });
    if (hasFriedEggAt(players, intent.from)) {
      const stain = { row: intent.from.row, col: intent.from.col };
      eggStains.push(stain);
      timeline.push({ type: 'eggStain', cell: stain });
    }
  }
  for (const player of players) {
    const intent = byId.get(player.id);
    if (!intent || cellsEqual(intent.from, intent.to) || !failed.has(player.id)) continue;
    timeline.push({
      type: 'blocked',
      playerId: player.id,
      from: intent.from,
      attempted: intent.to,
    });
  }

  return nextPlayers;
}

function outcomeFrom(players: Player[]): MatchOutcome {
  const alive = living(players);
  if (alive.length === 1) return { kind: 'winner', playerId: alive[0].id };
  if (alive.length === 0) return { kind: 'draw' };
  return { kind: 'none' };
}

function isPresentBlocked(
  cell: Cell,
  players: Player[],
  mapObjects: Cell[],
  presents: Cell[],
): boolean {
  if (isObjectCell(cell, mapObjects)) return true;
  if (presents.some((present) => cellsEqual(present, cell))) return true;
  return players.some((player) => cellsEqual(player, cell));
}

const PRESENT_SPAWN_DISTANCE = 2;

function cellsAtChebyshev(from: Cell, distance: number, carton: CartonSpec): Cell[] {
  const cells: Cell[] = [];
  for (let dr = -distance; dr <= distance; dr += 1) {
    for (let dc = -distance; dc <= distance; dc += 1) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== distance) continue;
      const cell = { row: from.row + dr, col: from.col + dc };
      if (isOnBoard(cell, carton)) cells.push(cell);
    }
  }
  return cells;
}

export function pickPresentSpawn(
  players: Player[],
  mapObjects: Cell[],
  presents: Cell[],
  carton: CartonSpec,
): Cell | null {
  if (presents.length >= carton.maxPresents) return null;
  const pool: Cell[] = [];
  const seen = new Set<string>();
  for (const player of living(players)) {
    for (const cell of cellsAtChebyshev(player, PRESENT_SPAWN_DISTANCE, carton)) {
      const key = `${cell.row},${cell.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isPresentBlocked(cell, players, mapObjects, presents)) pool.push(cell);
    }
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export function spawnEndOfTurnPresent(
  players: Player[],
  mapObjects: Cell[],
  presents: Cell[],
  carton: CartonSpec,
): Cell[] {
  const next = presents.map((cell) => ({ ...cell }));
  const spawned = pickPresentSpawn(players, mapObjects, next, carton);
  if (!spawned) return next;
  return [...next, spawned];
}

function withSpareWeapon(player: Player, weapon: WeaponKind): Player {
  const kept = player.hand.filter((card) => card.kind === 'move' || card.kind === 'pistol');
  return {
    ...player,
    spareWeapon: weapon,
    hand: [...kept, { id: crypto.randomUUID(), kind: weapon }],
  };
}

function collectPresents(
  players: Player[],
  presents: Cell[],
  timeline: PlaybackEvent[],
): { players: Player[]; presents: Cell[] } {
  let nextPresents = presents.map((cell) => ({ ...cell }));
  let nextPlayers = players;
  for (const player of living(nextPlayers)) {
    const index = nextPresents.findIndex((cell) => cellsEqual(cell, player));
    if (index < 0) continue;
    const cell = nextPresents[index];
    nextPresents = nextPresents.filter((_, presentIndex) => presentIndex !== index);
    const weapon = randomPickupWeapon();
    timeline.push({ type: 'pickup', playerId: player.id, cell, weapon });
    nextPlayers = nextPlayers.map((entry) =>
      entry.id === player.id ? withSpareWeapon(entry, weapon) : entry,
    );
  }
  return { players: nextPlayers, presents: nextPresents };
}

const DUEL_SHRINK_ROUND = 3;

function applyEndOfRoundShrink(
  players: Player[],
  presents: Cell[],
  timeline: PlaybackEvent[],
  shrinkIndex: number,
  carton: CartonSpec,
  round: number,
  startedPlayerCount: number,
): { players: Player[]; presents: Cell[]; shrinkIndex: number } {
  if (!cartonShrinks(carton) || living(players).length !== 2) {
    return { players, presents, shrinkIndex };
  }
  if (
    shrinkIndex === 0 &&
    startedPlayerCount <= 2 &&
    round < DUEL_SHRINK_ROUND
  ) {
    return { players, presents, shrinkIndex };
  }
  if (shrinkIndex >= SHRINK_LANE_INDEX) {
    return { players, presents, shrinkIndex };
  }

  const nextIndex = shrinkIndex + 1;
  let nextPlayers = players;
  const nextPresents = presents;

  if (shrinkIndex >= 1) {
    const doomed = shrinkWarningCells(shrinkIndex, carton);
    if (doomed.length > 0) {
      timeline.push({ type: 'shrinkDestroy', cells: doomed });
      const killed: string[] = [];
      nextPlayers = nextPlayers.map((player) => {
        if (!isAlive(player) || !doomed.some((closed) => cellsEqual(closed, player))) {
          return player;
        }
        killed.push(player.id);
        return { ...player, hp: 0 };
      });
      for (const playerId of killed) {
        timeline.push({ type: 'hit', playerId, hpAfter: 0 });
        timeline.push({ type: 'death', playerId });
      }
    }
  }

  const warned = shrinkWarningCells(nextIndex, carton);
  if (warned.length > 0) {
    timeline.push({ type: 'shrinkWarn', cells: warned });
  }

  return { players: nextPlayers, presents: nextPresents, shrinkIndex: nextIndex };
}

export function resolveRound(
  players: Player[],
  plans: Map<string, [ArenaAction, ArenaAction]>,
  mapObjects: Cell[],
  eggStains: Cell[] = [],
  presents: Cell[] = [],
  carton: CartonSpec,
  shrinkIndex = 0,
  round = 1,
  startedPlayerCount = players.length,
): ResolveResult {
  let nextPlayers = players.map((player) => ({ ...player }));
  const timeline: PlaybackEvent[] = [];
  const nextStains = eggStains.map((cell) => ({ ...cell }));
  let nextPresents = presents.map((cell) => ({ ...cell }));
  const closed = closedMapObjects(mapObjects, shrinkIndex, carton);

  const takePresents = () => {
    const collected = collectPresents(nextPlayers, nextPresents, timeline);
    nextPlayers = collected.players;
    nextPresents = collected.presents;
  };

  for (const actionIndex of [0, 1] as const) {
    const actors = living(nextPlayers);
    if (actors.length === 0) break;

    timeline.push({ type: 'actionStart', actionIndex });

    const moveBeats = Math.max(
      0,
      ...actors.map((player) => actionMoveBeats(plans.get(player.id)?.[actionIndex])),
    );
    const walkNext = new Map<string, number>();
    const walkStopped = new Set<string>();

    const fireShots = () => {
      const snapshot = nextPlayers.map((player) => ({ ...player }));
      const hits = new Map<string, number>();
      const built: (PlaybackShot & { event: Extract<PlaybackEvent, { type: 'shot' }> })[] = [];

      const recordDamage = (damages: Map<string, number>, playerId: string, amount: number) => {
        damages.set(playerId, (damages.get(playerId) ?? 0) + amount);
        addHit(hits, playerId, amount);
      };

      for (const player of living(snapshot)) {
        const action = plans.get(player.id)?.[actionIndex];
        if (action?.type !== 'shoot') continue;
        const from = { row: player.row, col: player.col };
        const damages = new Map<string, number>();

        const fan = weaponFanCells(action.weapon, from, action.dir, carton, closed);
        if (fan) {
          const struck = fan
            .map((cell) => occupantAt(snapshot, cell, player.id))
            .filter((target): target is Player => Boolean(target));
          const delta = DIR_DELTA[action.dir];
          const second = { row: from.row + delta.dr * 2, col: from.col + delta.dc * 2 };
          const tip =
            action.weapon === 'flamethrower' && isOnBoard(second, carton)
              ? second
              : (fan[1] ?? fan[0] ?? from);
          for (const target of struck) {
            recordDamage(damages, target.id, WEAPON_STATS[action.weapon].damage);
          }
          built.push({
            shooterId: player.id,
            joinOrder: player.joinOrder,
            damages: [...damages.entries()].map(([playerId, amount]) => ({ playerId, amount })),
            event: {
              type: 'shot',
              shooterId: player.id,
              weapon: action.weapon,
              dir: action.dir,
              from,
              end: tip,
              fan,
              hitPlayerId: struck[0]?.id,
            },
          });
          continue;
        }

        if (action.weapon === 'bomb') {
          const stats = WEAPON_STATS.bomb;
          const end = bombLandingCell(from, action.dir, carton);
          if (!end || isObjectCell(end, closed)) continue;
          const splash = bombSplashCells(end, carton, closed);
          const landed = occupantAt(snapshot, end);
          if (landed) recordDamage(damages, landed.id, stats.damage);
          for (const cell of splash) {
            const splashed = occupantAt(snapshot, cell);
            if (splashed) recordDamage(damages, splashed.id, stats.damage);
          }
          built.push({
            shooterId: player.id,
            joinOrder: player.joinOrder,
            damages: [...damages.entries()].map(([playerId, amount]) => ({ playerId, amount })),
            event: {
              type: 'shot',
              shooterId: player.id,
              weapon: action.weapon,
              dir: action.dir,
              from,
              end,
              splash,
              hitPlayerId: landed?.id,
            },
          });
          continue;
        }

        const stats = WEAPON_STATS[action.weapon];
        const { end, hit } = fireShot(
          snapshot,
          from,
          action.dir,
          player.id,
          closed,
          stats.range,
          carton,
        );
        if (hit) recordDamage(damages, hit.id, stats.damage);
        built.push({
          shooterId: player.id,
          joinOrder: player.joinOrder,
          damages: [...damages.entries()].map(([playerId, amount]) => ({ playerId, amount })),
          event: {
            type: 'shot',
            shooterId: player.id,
            weapon: action.weapon,
            dir: action.dir,
            from,
            end,
            hitPlayerId: hit?.id,
          },
        });
      }

      if (hits.size > 0) {
        nextPlayers = nextPlayers.map((player) => {
          const damage = hits.get(player.id);
          if (!damage) return player;
          return { ...player, hp: Math.max(0, player.hp - damage) };
        });
      }

      const startHp = new Map(snapshot.map((player) => [player.id, player.hp]));
      let runningHp = new Map(startHp);
      for (const shot of orderShotsForPlayback(built, startHp)) {
        timeline.push(shot.event);
        for (const damage of shot.damages) {
          const before = runningHp.get(damage.playerId) ?? 0;
          const after = Math.max(0, before - damage.amount);
          runningHp.set(damage.playerId, after);
          timeline.push({ type: 'hit', playerId: damage.playerId, hpAfter: after });
          if (before > 0 && after === 0) {
            timeline.push({ type: 'death', playerId: damage.playerId });
          }
        }
      }
    };

    for (let beat = 0; beat < moveBeats; beat += 1) {
      timeline.push({ type: 'beat', actionIndex, beat });
      const movers = living(nextPlayers);
      const intents: Intent[] = movers.map((player) => {
        const action = plans.get(player.id)?.[actionIndex];
        const from = { row: player.row, col: player.col };
        if (action?.type !== 'walk' || walkStopped.has(player.id)) {
          return { id: player.id, from, to: from };
        }
        if (beat < walkDelay(action)) {
          return { id: player.id, from, to: from };
        }
        const nextIndex = walkNext.get(player.id) ?? 0;
        const step = action.path[nextIndex];
        if (
          !step ||
          !isOnBoard(step, carton) ||
          isObjectCell(step, closed) ||
          !isAdjacent8(from, step)
        ) {
          walkStopped.add(player.id);
          return { id: player.id, from, to: from };
        }
        return { id: player.id, from, to: step };
      });

      nextPlayers = resolveMovement(nextPlayers, intents, timeline, closed, nextStains);

      for (const intent of intents) {
        if (cellsEqual(intent.from, intent.to)) continue;
        const after = nextPlayers.find((player) => player.id === intent.id);
        if (after && cellsEqual(after, intent.to)) {
          walkNext.set(intent.id, (walkNext.get(intent.id) ?? 0) + 1);
        } else {
          walkStopped.add(intent.id);
        }
      }

      takePresents();
    }
    fireShots();
    takePresents();
  }

  const shrunk = applyEndOfRoundShrink(
    nextPlayers,
    nextPresents,
    timeline,
    shrinkIndex,
    carton,
    round,
    startedPlayerCount,
  );
  nextPlayers = shrunk.players;
  nextPresents = shrunk.presents;

  return {
    players: nextPlayers.map((player) => ({ ...player, planSubmitted: false })),
    timeline,
    outcome: outcomeFrom(nextPlayers),
    eggStains: nextStains,
    presents: nextPresents,
    shrinkIndex: shrunk.shrinkIndex,
  };
}

export function applyResolvedRound(state: GameState, result: ResolveResult): GameState {
  const roundStart = snapshotTokens(state.players);
  const startPresents = (state.presents ?? []).map((cell) => ({ ...cell }));
  const carton = cartonSpec(state.cartonType);
  const startShrinkIndex = state.shrinkIndex ?? 0;
  const shrinkIndex = result.shrinkIndex;
  const blockers = closedMapObjects(state.mapObjects, shrinkIndex, carton);
  const presents =
    result.outcome.kind === 'none'
      ? spawnEndOfTurnPresent(result.players, blockers, result.presents, carton)
      : result.presents;
  return {
    ...state,
    phase: result.outcome.kind === 'none' ? 'playing' : 'finished',
    turnPhase: 'resolving',
    outcome: result.outcome,
    timeline: result.timeline,
    roundStart,
    lastReplay: {
      round: state.round,
      timeline: result.timeline,
      roundStart,
      startEggStains: (state.eggStains ?? []).map((cell) => ({ ...cell })),
      startPresents,
      startShrinkIndex,
    },
    eggStains: result.eggStains,
    presents,
    shrinkIndex,
    players: result.players,
    planDeadlineAt: null,
  };
}

export function groupTimeline(timeline: PlaybackEvent[]): PlaybackEvent[][] {
  const frames: PlaybackEvent[][] = [];
  let current: PlaybackEvent[] = [];
  let currentKind: string | null = null;

  const kindOf = (event: PlaybackEvent): string => {
    switch (event.type) {
      case 'move':
      case 'eggStain':
        return 'step';
      case 'blocked':
        return 'blocked';
      case 'shot':
        return 'shot';
      case 'hit':
      case 'death':
        return 'hit';
      default:
        return event.type;
    }
  };

  for (const event of timeline) {
    const kind = kindOf(event);
    if (
      kind === 'actionStart' ||
      kind === 'beat' ||
      kind === 'shot' ||
      kind === 'shrinkWarn' ||
      kind === 'shrinkDestroy'
    ) {
      if (current.length > 0) {
        frames.push(current);
        current = [];
        currentKind = null;
      }
      frames.push([event]);
      continue;
    }
    if (currentKind !== null && kind !== currentKind) {
      frames.push(current);
      current = [];
    }
    currentKind = kind;
    current.push(event);
  }
  if (current.length > 0) frames.push(current);
  return frames;
}

export function playbackDurationMs(timeline: PlaybackEvent[]): number {
  const total = groupTimeline(timeline).reduce(
    (sum, frame) => sum + Math.max(...frame.map(eventDurationMs)),
    0,
  );
  return total + 600;
}

export function eventDurationMs(event: PlaybackEvent): number {
  return PLAYBACK_MS[event.type];
}

export function formatAction(action: ArenaAction | null): string {
  if (!action) return 'Pick one';
  if (action.type === 'stay') return 'Sit tight';
  if (action.type === 'shoot') return `${formatWeapon(action.weapon)} ${action.dir}`;
  if (walkDelay(action)) return `Sit, walk ${action.path.length}`;
  return `Walk ${action.path.length}`;
}
