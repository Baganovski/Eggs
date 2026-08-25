import {
  BOARD_SIZE,
  CARDINAL_DIRS,
  DIR_DELTA,
  DIRECTIONS,
  MAX_WALK_STEPS,
  PLAN_TIME_MS,
  PLAYER_HUES,
  STARTING_HP,
  PICKUP_WEAPON_KINDS,
  WEAPON_KINDS,
  type ArenaAction,
  type CardinalDir,
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

export const START_CORNERS: Cell[] = [
  { row: 0, col: 0 },
  { row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 },
  { row: BOARD_SIZE - 1, col: 0 },
  { row: 0, col: BOARD_SIZE - 1 },
];

export const OBSTACLE_COUNT = 3;
export const MAX_PRESENTS = 2;

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

export function slapFanCells(from: Cell, dir: Direction): Cell[] {
  if (!isCardinalDir(dir)) return [];
  return SLAP_FAN[dir]
    .map((facing) => {
      const delta = DIR_DELTA[facing];
      return { row: from.row + delta.dr, col: from.col + delta.dc };
    })
    .filter(isOnBoard);
}

export function flameCells(from: Cell, dir: Direction): Cell[] {
  if (!isCardinalDir(dir)) return [];
  const forward = DIR_DELTA[dir];
  const side = dir === 'N' || dir === 'S' ? { dr: 0, dc: 1 } : { dr: 1, dc: 0 };
  const first = { row: from.row + forward.dr, col: from.col + forward.dc };
  const second = { row: from.row + forward.dr * 2, col: from.col + forward.dc * 2 };
  const left = { row: second.row - side.dr, col: second.col - side.dc };
  const right = { row: second.row + side.dr, col: second.col + side.dc };
  return [first, second, left, right].filter(isOnBoard);
}

export function weaponFanCells(weapon: WeaponKind, from: Cell, dir: Direction): Cell[] | null {
  if (weapon === 'slap') return slapFanCells(from, dir);
  if (weapon === 'flamethrower') return flameCells(from, dir);
  return null;
}

export function isCardinalWeapon(weapon: WeaponKind): boolean {
  return weapon === 'slap' || weapon === 'flamethrower';
}

export function bombSplashCells(epicenter: Cell): Cell[] {
  return CARDINAL_DIRS.map((dir) => {
    const delta = DIR_DELTA[dir];
    return { row: epicenter.row + delta.dr, col: epicenter.col + delta.dc };
  }).filter(isOnBoard);
}

function chebyshevDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

function isWithinOneSquare(cell: Cell, other: Cell): boolean {
  return chebyshevDistance(cell, other) <= 1;
}

export function generateMapObjects(playerPositions: Cell[]): Cell[] {
  const candidates: Cell[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = { row, col };
      const tooClose = playerPositions.some((pos) => isWithinOneSquare(cell, pos));
      if (!tooClose) candidates.push(cell);
    }
  }

  let pool = [...candidates];
  const objects: Cell[] = [];
  const count = Math.min(OBSTACLE_COUNT, pool.length);
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
};

export function playerColor(joinOrder: number): string {
  return PLAYER_HUES[joinOrder % PLAYER_HUES.length];
}

export function isAlive(player: Player): boolean {
  return player.hp > 0;
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.row === b.row && a.col === b.col;
}

export function isOnBoard(cell: Cell): boolean {
  return (
    cell.row >= 0 &&
    cell.row < BOARD_SIZE &&
    cell.col >= 0 &&
    cell.col < BOARD_SIZE
  );
}

export function isObjectCell(cell: Cell, mapObjects: Cell[]): boolean {
  return mapObjects.some((object) => cellsEqual(object, cell));
}

export function shotRayCells(
  from: Cell,
  dir: Direction,
  mapObjects: Cell[],
  maxRange = Number.POSITIVE_INFINITY,
): Cell[] {
  const { dr, dc } = DIR_DELTA[dir];
  const cells: Cell[] = [];
  let row = from.row + dr;
  let col = from.col + dc;
  while (isOnBoard({ row, col }) && cells.length < maxRange) {
    const cell = { row, col };
    cells.push(cell);
    if (isObjectCell(cell, mapObjects)) break;
    row += dr;
    col += dc;
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

export function cellsOnRay(from: Cell, end: Cell): Cell[] {
  const dir = directionFromRay(from, end);
  if (!dir) return cellsEqual(from, end) ? [] : [{ ...end }];
  const cells: Cell[] = [];
  let cursor = { ...from };
  const seen = new Set<string>();
  while (isOnBoard(cursor) && !seen.has(`${cursor.row},${cursor.col}`)) {
    if (!cellsEqual(cursor, from)) cells.push({ ...cursor });
    if (cellsEqual(cursor, end)) break;
    seen.add(`${cursor.row},${cursor.col}`);
    const delta = DIR_DELTA[dir];
    cursor = { row: cursor.row + delta.dr, col: cursor.col + delta.dc };
  }
  return cells;
}

export function shotPlaybackCells(shot: {
  weapon: WeaponKind;
  from: Cell;
  end: Cell;
  dir: Direction;
  fan?: Cell[];
  splash?: Cell[];
}): Cell[] {
  const fan = weaponFanCells(shot.weapon, shot.from, shot.dir);
  if (fan) {
    return shot.fan ?? fan;
  }
  if (shot.weapon === 'bomb') {
    return [shot.end, ...(shot.splash ?? bombSplashCells(shot.end))];
  }
  return cellsOnRay(shot.from, shot.end);
}

export function neighbors8(cell: Cell): Cell[] {
  return DIRECTIONS.map((dir) => {
    const delta = DIR_DELTA[dir];
    return { row: cell.row + delta.dr, col: cell.col + delta.dc };
  }).filter(isOnBoard);
}

export function plannedPositionAfter(start: Cell, action: ArenaAction | null): Cell {
  if (action?.type === 'walk' && action.path.length > 0) {
    return action.path[action.path.length - 1];
  }
  return start;
}

function isCell(value: unknown): value is Cell {
  if (!value || typeof value !== 'object') return false;
  const cell = value as Cell;
  return Number.isInteger(cell.row) && Number.isInteger(cell.col) && isOnBoard(cell);
}

function isWalkLegal(from: Cell, path: Cell[], mapObjects: Cell[]): boolean {
  if (path.length < 1 || path.length > MAX_WALK_STEPS) return false;
  let current = from;
  for (const step of path) {
    if (!isOnBoard(step) || isObjectCell(step, mapObjects) || !isAdjacent8(current, step)) {
      return false;
    }
    current = step;
  }
  return true;
}

function parseAction(value: unknown): ArenaAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as ArenaAction;
  if (action.type === 'stay') return { type: 'stay' };
  if (action.type === 'shoot' && isWeaponKind(action.weapon) && isDirection(action.dir)) {
    if (isCardinalWeapon(action.weapon) && !isCardinalDir(action.dir)) return null;
    return { type: 'shoot', weapon: action.weapon, dir: action.dir };
  }
  if (action.type === 'walk' && Array.isArray(action.path) && action.path.every(isCell)) {
    return { type: 'walk', path: action.path.map((cell) => ({ row: cell.row, col: cell.col })) };
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
): [ArenaAction, ArenaAction] | null {
  if (!isAlive(player) || !Array.isArray(actions) || actions.length !== 2) return null;
  if (!Array.isArray(cardIds) || cardIds.length !== 2) return null;
  const firstId = cardIds[0];
  const secondId = cardIds[1];
  if (typeof firstId !== 'string' || typeof secondId !== 'string') return null;

  const firstCard = player.hand.find((card) => card.id === firstId);
  const secondCard = player.hand.find((card) => card.id === secondId);
  if (!firstCard || !secondCard) return null;
  if (firstId === secondId && firstCard.kind !== 'move') return null;

  const first = parseAction(actions[0]);
  const second = parseAction(actions[1]);
  if (!first || !second) return null;
  if (!actionMatchesCard(first, firstCard) || !actionMatchesCard(second, secondCard)) return null;

  let position = { row: player.row, col: player.col };
  for (const action of [first, second]) {
    if (action.type === 'walk') {
      if (!isWalkLegal(position, action.path, mapObjects)) return null;
      position = action.path[action.path.length - 1];
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
): { cardIds: [string, string]; actions: [ArenaAction, ArenaAction] } | null {
  const resolved: [ArenaAction, ArenaAction] = [{ type: 'stay' }, { type: 'stay' }];
  let position = { row: player.row, col: player.col };
  for (const index of [0, 1] as const) {
    const action = actions[index] ?? { type: 'stay' };
    if (action.type === 'walk') {
      if (
        cardForAction(player, action, cardIds[index]) &&
        isWalkLegal(position, action.path, mapObjects)
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
    planDeadlineAt: null,
  };
}

export function startArenaMatch(state: GameState): GameState {
  const players = state.players.map((player) => {
    const corner = START_CORNERS[player.joinOrder] ?? START_CORNERS[0];
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
  const mapObjects = generateMapObjects(players.map((player) => ({ row: player.row, col: player.col })));

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
): { end: Cell; hit?: Player } {
  const { dr, dc } = DIR_DELTA[dir];
  let row = from.row + dr;
  let col = from.col + dc;
  let end = from;
  let steps = 0;
  while (isOnBoard({ row, col }) && steps < maxRange) {
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
    if (group.length < 2) continue;
    for (const intent of group) {
      if (!cellsEqual(intent.from, intent.to)) failed.add(intent.id);
    }
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

  return players.map((player) => {
    const intent = byId.get(player.id);
    if (!intent) return player;
    if (failed.has(player.id) || cellsEqual(intent.from, intent.to)) {
      if (!cellsEqual(intent.from, intent.to)) {
        timeline.push({
          type: 'blocked',
          playerId: player.id,
          from: intent.from,
          attempted: intent.to,
        });
      }
      return player;
    }
    timeline.push({
      type: 'move',
      playerId: player.id,
      from: intent.from,
      to: intent.to,
    });
    if (hasFriedEggAt(players, intent.from)) {
      const stain = { row: intent.to.row, col: intent.to.col };
      eggStains.push(stain);
      timeline.push({ type: 'eggStain', cell: stain });
    }
    return { ...player, row: intent.to.row, col: intent.to.col };
  });
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

export function pickPresentSpawn(
  players: Player[],
  mapObjects: Cell[],
  presents: Cell[],
): Cell | null {
  if (presents.length >= MAX_PRESENTS) return null;
  const adjacent: Cell[] = [];
  const seen = new Set<string>();
  for (const player of living(players)) {
    for (const cell of neighbors8(player)) {
      const key = `${cell.row},${cell.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isPresentBlocked(cell, players, mapObjects, presents)) adjacent.push(cell);
    }
  }
  const pool =
    adjacent.length > 0
      ? adjacent
      : (() => {
          const open: Cell[] = [];
          for (let row = 0; row < BOARD_SIZE; row += 1) {
            for (let col = 0; col < BOARD_SIZE; col += 1) {
              const cell = { row, col };
              if (!isPresentBlocked(cell, players, mapObjects, presents)) open.push(cell);
            }
          }
          return open;
        })();
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export function spawnEndOfTurnPresent(
  players: Player[],
  mapObjects: Cell[],
  presents: Cell[],
): Cell[] {
  const next = presents.map((cell) => ({ ...cell }));
  const spawned = pickPresentSpawn(players, mapObjects, next);
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

export function resolveRound(
  players: Player[],
  plans: Map<string, [ArenaAction, ArenaAction]>,
  mapObjects: Cell[],
  eggStains: Cell[] = [],
  presents: Cell[] = [],
): ResolveResult {
  let nextPlayers = players.map((player) => ({ ...player }));
  const timeline: PlaybackEvent[] = [];
  const nextStains = eggStains.map((cell) => ({ ...cell }));
  let nextPresents = presents.map((cell) => ({ ...cell }));

  const takePresents = () => {
    const collected = collectPresents(nextPlayers, nextPresents, timeline);
    nextPlayers = collected.players;
    nextPresents = collected.presents;
  };

  for (const actionIndex of [0, 1] as const) {
    const actors = living(nextPlayers);
    if (actors.length === 0) break;

    timeline.push({ type: 'actionStart', actionIndex });

    const beatCount = Math.max(
      1,
      ...actors.map((player) => {
        const action = plans.get(player.id)?.[actionIndex];
        return action?.type === 'walk' ? action.path.length : 1;
      }),
    );
    const walkNext = new Map<string, number>();
    const walkStopped = new Set<string>();

    for (let beat = 0; beat < beatCount; beat += 1) {
      timeline.push({ type: 'beat', actionIndex, beat });
      const movers = living(nextPlayers);
      const intents: Intent[] = movers.map((player) => {
        const action = plans.get(player.id)?.[actionIndex];
        const from = { row: player.row, col: player.col };
        if (action?.type !== 'walk' || walkStopped.has(player.id)) {
          return { id: player.id, from, to: from };
        }
        const nextIndex = walkNext.get(player.id) ?? 0;
        const step = action.path[nextIndex];
        if (!step || !isOnBoard(step) || isObjectCell(step, mapObjects) || !isAdjacent8(from, step)) {
          walkStopped.add(player.id);
          return { id: player.id, from, to: from };
        }
        return { id: player.id, from, to: step };
      });

      nextPlayers = resolveMovement(nextPlayers, intents, timeline, mapObjects, nextStains);

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

      if (beat !== 0) continue;

      const snapshot = nextPlayers.map((player) => ({ ...player }));
      const hits = new Map<string, number>();

      for (const player of living(snapshot)) {
        const action = plans.get(player.id)?.[actionIndex];
        if (action?.type !== 'shoot') continue;
        const from = { row: player.row, col: player.col };

        const fan = weaponFanCells(action.weapon, from, action.dir);
        if (fan) {
          const struck = fan
            .map((cell) => occupantAt(snapshot, cell, player.id))
            .filter((target): target is Player => Boolean(target));
          const delta = DIR_DELTA[action.dir];
          const second = { row: from.row + delta.dr * 2, col: from.col + delta.dc * 2 };
          const tip =
            action.weapon === 'flamethrower' && isOnBoard(second)
              ? second
              : (fan[1] ?? fan[0] ?? from);
          timeline.push({
            type: 'shot',
            shooterId: player.id,
            weapon: action.weapon,
            dir: action.dir,
            from,
            end: tip,
            fan,
            hitPlayerId: struck[0]?.id,
          });
          for (const target of struck) {
            addHit(hits, target.id, WEAPON_STATS[action.weapon].damage);
          }
          continue;
        }

        const stats = WEAPON_STATS[action.weapon];
        const { end, hit } = fireShot(
          snapshot,
          from,
          action.dir,
          player.id,
          mapObjects,
          stats.range,
        );
        const splash = action.weapon === 'bomb' ? bombSplashCells(end) : undefined;
        timeline.push({
          type: 'shot',
          shooterId: player.id,
          weapon: action.weapon,
          dir: action.dir,
          from,
          end,
          splash,
          hitPlayerId: hit?.id,
        });
        if (hit) addHit(hits, hit.id, stats.damage);
        if (splash) {
          for (const cell of splash) {
            const splashed = occupantAt(snapshot, cell);
            if (splashed) addHit(hits, splashed.id, stats.damage);
          }
        }
      }

      if (hits.size > 0) {
        nextPlayers = nextPlayers.map((player) => {
          const damage = hits.get(player.id);
          if (!damage) return player;
          const hpAfter = Math.max(0, player.hp - damage);
          timeline.push({ type: 'hit', playerId: player.id, hpAfter });
          if (hpAfter === 0 && player.hp > 0) {
            timeline.push({ type: 'death', playerId: player.id });
          }
          return { ...player, hp: hpAfter };
        });
      }
    }
  }

  return {
    players: nextPlayers.map((player) => ({ ...player, planSubmitted: false })),
    timeline,
    outcome: outcomeFrom(nextPlayers),
    eggStains: nextStains,
    presents: nextPresents,
  };
}

export function applyResolvedRound(state: GameState, result: ResolveResult): GameState {
  const roundStart = snapshotTokens(state.players);
  const startPresents = (state.presents ?? []).map((cell) => ({ ...cell }));
  const presents =
    result.outcome.kind === 'none'
      ? spawnEndOfTurnPresent(result.players, state.mapObjects, result.presents)
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
    },
    eggStains: result.eggStains,
    presents,
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
      case 'blocked':
        return 'step';
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
    if (kind === 'actionStart' || kind === 'beat') {
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
  return `Walk ${action.path.length}`;
}
