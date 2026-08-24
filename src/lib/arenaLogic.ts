import {
  BOARD_SIZE,
  CARDINAL_DIRS,
  DIR_DELTA,
  DIRECTIONS,
  MAX_WALK_STEPS,
  PLAYER_HUES,
  STARTING_HP,
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

export const WEAPON_STATS: Record<WeaponKind, { range: number; damage: number }> = {
  pistol: { range: Number.POSITIVE_INFINITY, damage: 1 },
  shotgun: { range: 3, damage: 2 },
  bomb: { range: 2, damage: 1 },
  knife: { range: 1, damage: 2 },
};

const KNIFE_FAN: Record<CardinalDir, Direction[]> = {
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

export function dealHand(): PlanCard[] {
  const pool = [...WEAPON_KINDS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [
    { id: crypto.randomUUID(), kind: 'move' },
    { id: crypto.randomUUID(), kind: pool[0] },
    { id: crypto.randomUUID(), kind: pool[1] },
  ];
}

export function dealHands(players: Player[]): Player[] {
  return players.map((player) => ({
    ...player,
    planSubmitted: false,
    hand: isAlive(player) ? dealHand() : [],
  }));
}

export function hideOtherHands(players: Player[], viewerId: string): Player[] {
  return players.map((player) => (player.id === viewerId ? player : { ...player, hand: [] }));
}

export function viewStateFor(state: GameState, viewerId: string): PublicGameState {
  const { localPlayerId: _, ...publicState } = state;
  return {
    ...publicState,
    players: hideOtherHands(publicState.players, viewerId),
  };
}

export function knifeFanCells(from: Cell, dir: Direction): Cell[] {
  if (!isCardinalDir(dir)) return [];
  return KNIFE_FAN[dir]
    .map((facing) => {
      const delta = DIR_DELTA[facing];
      return { row: from.row + delta.dr, col: from.col + delta.dc };
    })
    .filter(isOnBoard);
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
    if (action.weapon === 'knife' && !isCardinalDir(action.dir)) return null;
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
      hand: dealHand(),
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
    players,
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
  }));
}

export interface ResolveResult {
  players: Player[];
  timeline: PlaybackEvent[];
  outcome: MatchOutcome;
  eggStains: Cell[];
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

export function resolveRound(
  players: Player[],
  plans: Map<string, [ArenaAction, ArenaAction]>,
  mapObjects: Cell[],
  eggStains: Cell[] = [],
): ResolveResult {
  let nextPlayers = players.map((player) => ({ ...player }));
  const timeline: PlaybackEvent[] = [];
  const nextStains = eggStains.map((cell) => ({ ...cell }));

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

      if (beat !== 0) continue;

      const snapshot = nextPlayers.map((player) => ({ ...player }));
      const hits = new Map<string, number>();

      for (const player of living(snapshot)) {
        const action = plans.get(player.id)?.[actionIndex];
        if (action?.type !== 'shoot') continue;
        const from = { row: player.row, col: player.col };

        if (action.weapon === 'knife') {
          const fan = knifeFanCells(from, action.dir);
          const struck = fan
            .map((cell) => occupantAt(snapshot, cell, player.id))
            .filter((target): target is Player => Boolean(target));
          timeline.push({
            type: 'shot',
            shooterId: player.id,
            weapon: 'knife',
            dir: action.dir,
            from,
            end: fan[1] ?? fan[0] ?? from,
            fan,
            hitPlayerId: struck[0]?.id,
          });
          for (const target of struck) {
            addHit(hits, target.id, WEAPON_STATS.knife.damage);
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
            if (splashed) addHit(hits, splashed.id, 1);
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
  };
}

export function applyResolvedRound(state: GameState, result: ResolveResult): GameState {
  const roundStart = snapshotTokens(state.players);
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
    },
    eggStains: result.eggStains,
    players: result.players,
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
