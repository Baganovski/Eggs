import { describe, expect, it } from 'vitest';
import { cartonSpec, type ArenaAction, type PlanCard, type Player } from '../types/game';
import {
  applyResolvedRound,
  bombLandingCell,
  bombThrowCells,
  emptyArenaFields,
  mixColors,
  orderShotsForPlayback,
  parseAndValidatePlan,
  playerColor,
  resolveRound,
  pickPresentSpawn,
  shrinkDestroyedCells,
  shrinkRings,
  shrinkSafeLane,
  shrinkWarningCells,
  SHRINK_LANE_INDEX,
  startArenaMatch,
} from './arenaLogic';
import { createHostLobbyState, createInitialPlayer } from './gameLogic';

const carton = cartonSpec('full');

function makePlayer(partial: Partial<Player> & Pick<Player, 'id'>): Player {
  return {
    name: partial.id,
    connected: true,
    isBot: false,
    joinOrder: 0,
    planSubmitted: false,
    hp: 3,
    row: 0,
    col: 0,
    hand: [],
    spareWeapon: null,
    ...partial,
  };
}

function cards(...kinds: PlanCard['kind'][]): PlanCard[] {
  return kinds.map((kind, index) => ({ id: `card-${index}`, kind }));
}

function stayStay(): [ArenaAction, ArenaAction] {
  return [{ type: 'stay' }, { type: 'stay' }];
}

describe('bomb throw', () => {
  it('only offers the cell exactly 2 squares away', () => {
    expect(bombThrowCells({ row: 3, col: 3 }, 'N', carton)).toEqual([{ row: 1, col: 3 }]);
    expect(bombLandingCell({ row: 0, col: 0 }, 'N', carton)).toBeNull();
    expect(bombThrowCells({ row: 0, col: 0 }, 'N', carton)).toEqual([]);
  });

  it('rejects a 1-square bomb and a landing on an obstacle', () => {
    const player = makePlayer({
      id: 'a',
      row: 3,
      col: 3,
      hand: cards('bomb', 'move'),
    });
    const short = parseAndValidatePlan(
      player,
      [
        { type: 'shoot', weapon: 'bomb', dir: 'N', steps: 1 },
        { type: 'stay' },
      ],
      ['card-0', 'card-1'],
      [],
      carton,
    );
    expect(short).toBeNull();

    const ontoRock = parseAndValidatePlan(
      player,
      [
        { type: 'shoot', weapon: 'bomb', dir: 'N', steps: 2 },
        { type: 'stay' },
      ],
      ['card-0', 'card-1'],
      [{ row: 1, col: 3 }],
      carton,
    );
    expect(ontoRock).toBeNull();
  });

  it('does not splash the thrower when the bomb lands 2 squares away', () => {
    const thrower = makePlayer({ id: 'a', row: 3, col: 3, joinOrder: 0 });
    const target = makePlayer({ id: 'b', row: 1, col: 3, joinOrder: 1 });
    const plans = new Map<string, [ArenaAction, ArenaAction]>([
      [
        'a',
        [
          { type: 'shoot', weapon: 'bomb', dir: 'N', steps: 2 },
          { type: 'stay' },
        ],
      ],
      ['b', stayStay()],
    ]);
    const result = resolveRound([thrower, target], plans, [], [], [], carton);
    expect(result.players.find((player) => player.id === 'a')?.hp).toBe(3);
    expect(result.players.find((player) => player.id === 'b')?.hp).toBe(1);
  });
});

describe('plan validation', () => {
  it('allows reusing pistol twice and forbids reusing a spare twice', () => {
    const pistolHand = makePlayer({
      id: 'a',
      row: 3,
      col: 3,
      hand: cards('pistol', 'move'),
    });
    const doublePistol = parseAndValidatePlan(
      pistolHand,
      [
        { type: 'shoot', weapon: 'pistol', dir: 'E' },
        { type: 'shoot', weapon: 'pistol', dir: 'W' },
      ],
      ['card-0', 'card-0'],
      [],
      carton,
    );
    expect(doublePistol).not.toBeNull();

    const rifleHand = makePlayer({
      id: 'a',
      row: 3,
      col: 3,
      hand: cards('rifle', 'move'),
    });
    const doubleRifle = parseAndValidatePlan(
      rifleHand,
      [
        { type: 'shoot', weapon: 'rifle', dir: 'E' },
        { type: 'shoot', weapon: 'rifle', dir: 'W' },
      ],
      ['card-0', 'card-0'],
      [],
      carton,
    );
    expect(doubleRifle).toBeNull();
  });

  it('rejects a walk that steps onto an obstacle or skips a square', () => {
    const player = makePlayer({
      id: 'a',
      row: 3,
      col: 3,
      hand: cards('move', 'pistol'),
    });
    const ontoRock = parseAndValidatePlan(
      player,
      [
        { type: 'walk', path: [{ row: 3, col: 4 }] },
        { type: 'stay' },
      ],
      ['card-0', 'card-1'],
      [{ row: 3, col: 4 }],
      carton,
    );
    expect(ontoRock).toBeNull();

    const skip = parseAndValidatePlan(
      player,
      [
        { type: 'walk', path: [{ row: 3, col: 5 }] },
        { type: 'stay' },
      ],
      ['card-0', 'card-1'],
      [],
      carton,
    );
    expect(skip).toBeNull();
  });
});

describe('movement conflicts', () => {
  function walkTo(id: string, to: { row: number; col: number }): [string, [ArenaAction, ArenaAction]] {
    return [id, [{ type: 'walk', path: [to] }, { type: 'stay' }]];
  }

  it('blocks two movers claiming the same empty cell', () => {
    const a = makePlayer({ id: 'a', row: 2, col: 2 });
    const b = makePlayer({ id: 'b', row: 2, col: 4, joinOrder: 1 });
    const plans = new Map<string, [ArenaAction, ArenaAction]>([
      walkTo('a', { row: 2, col: 3 }),
      walkTo('b', { row: 2, col: 3 }),
    ]);
    const result = resolveRound([a, b], plans, [], [], [], carton);
    expect(result.players.find((player) => player.id === 'a')).toMatchObject({ row: 2, col: 2 });
    expect(result.players.find((player) => player.id === 'b')).toMatchObject({ row: 2, col: 4 });
    expect(result.timeline.some((event) => event.type === 'blocked')).toBe(true);
  });

  it('lets an orthogonal step beat a diagonal into the same cell', () => {
    const a = makePlayer({ id: 'a', row: 1, col: 0 });
    const b = makePlayer({ id: 'b', row: 0, col: 0, joinOrder: 1 });
    const plans = new Map<string, [ArenaAction, ArenaAction]>([
      walkTo('a', { row: 1, col: 1 }),
      walkTo('b', { row: 1, col: 1 }),
    ]);
    const result = resolveRound([a, b], plans, [], [], [], carton);
    expect(result.players.find((player) => player.id === 'a')).toMatchObject({ row: 1, col: 1 });
    expect(result.players.find((player) => player.id === 'b')).toMatchObject({ row: 0, col: 0 });
  });

  it('blocks swaps and crossing diagonals', () => {
    const a = makePlayer({ id: 'a', row: 2, col: 2 });
    const b = makePlayer({ id: 'b', row: 2, col: 3, joinOrder: 1 });
    const swap = resolveRound(
      [a, b],
      new Map([walkTo('a', { row: 2, col: 3 }), walkTo('b', { row: 2, col: 2 })]),
      [],
      [],
      [],
      carton,
    );
    expect(swap.players.find((player) => player.id === 'a')).toMatchObject({ row: 2, col: 2 });
    expect(swap.players.find((player) => player.id === 'b')).toMatchObject({ row: 2, col: 3 });

    const c = makePlayer({ id: 'c', row: 0, col: 0 });
    const d = makePlayer({ id: 'd', row: 0, col: 1, joinOrder: 1 });
    const cross = resolveRound(
      [c, d],
      new Map([
        walkTo('c', { row: 1, col: 1 }),
        walkTo('d', { row: 1, col: 0 }),
      ]),
      [],
      [],
      [],
      carton,
    );
    expect(cross.players.find((player) => player.id === 'c')).toMatchObject({ row: 0, col: 0 });
    expect(cross.players.find((player) => player.id === 'd')).toMatchObject({ row: 0, col: 1 });
  });

  it('allows a chain of steps when the lead square leaves', () => {
    const a = makePlayer({ id: 'a', row: 2, col: 2 });
    const b = makePlayer({ id: 'b', row: 2, col: 3, joinOrder: 1 });
    const result = resolveRound(
      [a, b],
      new Map([
        walkTo('a', { row: 2, col: 3 }),
        walkTo('b', { row: 2, col: 4 }),
      ]),
      [],
      [],
      [],
      carton,
    );
    expect(result.players.find((player) => player.id === 'a')).toMatchObject({ row: 2, col: 3 });
    expect(result.players.find((player) => player.id === 'b')).toMatchObject({ row: 2, col: 4 });
  });
});

describe('match seating and presents', () => {
  it('drops disconnected players when the match starts', () => {
    let state = createHostLobbyState('NEST12', 'host', 'Host');
    const ghost = { ...createInitialPlayer('ghost', 'Ghost', 1), connected: false };
    state = { ...state, players: [...state.players, ghost] };
    const started = startArenaMatch(state);
    expect(started.players.map((player) => player.id)).toEqual(['host']);
    expect(started.phase).toBe('playing');
  });

  it('picks up a present after a pure-shoot action', () => {
    const shooter = makePlayer({
      id: 'a',
      row: 3,
      col: 3,
      hand: cards('pistol', 'pistol'),
    });
    const dummy = makePlayer({ id: 'b', row: 0, col: 0, joinOrder: 1 });
    const plans = new Map<string, [ArenaAction, ArenaAction]>([
      [
        'a',
        [
          { type: 'shoot', weapon: 'pistol', dir: 'E' },
          { type: 'shoot', weapon: 'pistol', dir: 'W' },
        ],
      ],
      ['b', stayStay()],
    ]);
    const result = resolveRound(
      [shooter, dummy],
      plans,
      [],
      [],
      [{ row: 3, col: 3 }],
      carton,
    );
    expect(result.presents).toEqual([]);
    expect(result.timeline.some((event) => event.type === 'pickup' && event.playerId === 'a')).toBe(
      true,
    );
    expect(result.players.find((player) => player.id === 'a')?.spareWeapon).not.toBeNull();
  });

  it('leaves the egg stain on the corpse cell', () => {
    const fried = makePlayer({ id: 'fried', hp: 0, row: 2, col: 2, joinOrder: 1 });
    const walker = makePlayer({ id: 'walker', row: 2, col: 2 });
    const result = resolveRound(
      [fried, walker],
      new Map([
        [
          'walker',
          [
            { type: 'walk', path: [{ row: 2, col: 3 }] },
            { type: 'stay' },
          ],
        ],
      ]),
      [],
      [],
      [],
      carton,
    );
    expect(result.eggStains).toEqual([{ row: 2, col: 2 }]);
  });
});

describe('outcomes', () => {
  it('declares a winner when one egg remains', () => {
    const winner = makePlayer({ id: 'a', row: 0, col: 0, hp: 1 });
    const loser = makePlayer({ id: 'b', row: 0, col: 3, hp: 1, joinOrder: 1 });
    const result = resolveRound(
      [winner, loser],
      new Map([
        [
          'a',
          [
            { type: 'shoot', weapon: 'pistol', dir: 'E' },
            { type: 'stay' },
          ],
        ],
        ['b', stayStay()],
      ]),
      [],
      [],
      [],
      carton,
    );
    expect(result.outcome).toEqual({ kind: 'winner', playerId: 'a' });
    const finished = applyResolvedRound(
      {
        ...createHostLobbyState('NEST12', 'a', 'A'),
        ...emptyArenaFields(),
        phase: 'playing',
        round: 1,
        players: [winner, loser],
      },
      result,
    );
    expect(finished.phase).toBe('finished');
  });

  it('declares a draw when the last eggs crack together', () => {
    const a = makePlayer({ id: 'a', row: 0, col: 0, hp: 1 });
    const b = makePlayer({ id: 'b', row: 0, col: 3, hp: 1, joinOrder: 1 });
    const result = resolveRound(
      [a, b],
      new Map([
        [
          'a',
          [
            { type: 'shoot', weapon: 'pistol', dir: 'E' },
            { type: 'stay' },
          ],
        ],
        [
          'b',
          [
            { type: 'shoot', weapon: 'pistol', dir: 'W' },
            { type: 'stay' },
          ],
        ],
      ]),
      [],
      [],
      [],
      carton,
    );
    expect(result.outcome).toEqual({ kind: 'draw' });
    const kinds = result.timeline.map((event) => event.type);
    expect(kinds).toEqual([
      'actionStart',
      'shot',
      'hit',
      'death',
      'shot',
      'hit',
      'death',
    ]);
    expect(result.timeline.filter((event) => event.type === 'shot').map((event) => event.shooterId)).toEqual(
      ['a', 'b'],
    );
  });
});

describe('shot playback order', () => {
  it('keeps join order when nobody is cracked', () => {
    const ordered = orderShotsForPlayback(
      [
        { shooterId: 'b', joinOrder: 1, damages: [] },
        { shooterId: 'a', joinOrder: 0, damages: [] },
        { shooterId: 'c', joinOrder: 2, damages: [] },
      ],
      new Map([
        ['a', 3],
        ['b', 3],
        ['c', 3],
      ]),
    );
    expect(ordered.map((shot) => shot.shooterId)).toEqual(['a', 'b', 'c']);
  });

  it('lets a cracked egg fire back before the next seat', () => {
    const ordered = orderShotsForPlayback(
      [
        { shooterId: 'a', joinOrder: 0, damages: [{ playerId: 'c', amount: 3 }] },
        { shooterId: 'b', joinOrder: 1, damages: [] },
        { shooterId: 'c', joinOrder: 2, damages: [] },
      ],
      new Map([
        ['a', 3],
        ['b', 3],
        ['c', 3],
      ]),
    );
    expect(ordered.map((shot) => shot.shooterId)).toEqual(['a', 'c', 'b']);
  });
});

describe('mixColors', () => {
  it('returns a single colour unchanged', () => {
    expect(mixColors(['#f6c7d4'])).toBe('#f6c7d4');
  });

  it('averages two player hues', () => {
    expect(mixColors([playerColor(0), playerColor(1)])).toBe('#ded6df');
  });
});

describe('closing carton', () => {
  const half = cartonSpec('halfDozen');

  function stayPlans(...ids: string[]) {
    return new Map(ids.map((id) => [id, stayStay()]));
  }

  it('closes one full border ring at a time', () => {
    const rings = shrinkRings(carton);
    expect(rings).toHaveLength(4);
    expect(rings[0]).toHaveLength(24);
    expect(rings[0]?.some((cell) => cell.row === 0 && cell.col === 0)).toBe(true);
    expect(rings[0]?.some((cell) => cell.row === 0 && cell.col === 3)).toBe(true);
    expect(rings[0]?.some((cell) => cell.row === 3 && cell.col === 0)).toBe(true);
    expect(rings[0]?.some((cell) => cell.row === 3 && cell.col === 3)).toBe(false);
    expect(shrinkWarningCells(1, carton)).toHaveLength(24);
    expect(shrinkDestroyedCells(1, carton)).toEqual([]);
    expect(shrinkDestroyedCells(2, carton)).toHaveLength(24);
    expect(shrinkWarningCells(2, carton)).toHaveLength(16);
    expect(shrinkWarningCells(3, carton)).toEqual([
      { row: 4, col: 2 },
      { row: 4, col: 3 },
      { row: 4, col: 4 },
    ]);
    expect(shrinkDestroyedCells(3, carton)).toHaveLength(40);
  });

  it('waits until the third scramble in a two-egg start', () => {
    const a = makePlayer({ id: 'a', row: 3, col: 3 });
    const b = makePlayer({ id: 'b', row: 3, col: 4, joinOrder: 1 });
    const early = resolveRound([a, b], stayPlans('a', 'b'), [], [], [], carton, 0, 1, 2);
    expect(early.shrinkIndex).toBe(0);
    expect(early.timeline.some((event) => event.type === 'shrinkWarn')).toBe(false);

    const second = resolveRound([a, b], stayPlans('a', 'b'), [], [], [], carton, 0, 2, 2);
    expect(second.shrinkIndex).toBe(0);

    const third = resolveRound([a, b], stayPlans('a', 'b'), [], [], [], carton, 0, 3, 2);
    expect(third.shrinkIndex).toBe(1);
    const warn = third.timeline.find((event) => event.type === 'shrinkWarn');
    expect(warn?.type === 'shrinkWarn' ? warn.cells : []).toHaveLength(24);
  });

  it('closes straight away when a bigger carton is down to two eggs', () => {
    const a = makePlayer({ id: 'a', row: 3, col: 3 });
    const b = makePlayer({ id: 'b', row: 3, col: 4, joinOrder: 1 });
    const fried = makePlayer({ id: 'c', row: 6, col: 6, joinOrder: 2, hp: 0 });
    const result = resolveRound(
      [a, b, fried],
      stayPlans('a', 'b'),
      [],
      [],
      [],
      carton,
      0,
      1,
      3,
    );
    expect(result.shrinkIndex).toBe(1);
    expect(result.timeline.some((event) => event.type === 'shrinkWarn')).toBe(true);
  });

  it('destroys the warned border next and fries anyone still on it', () => {
    const doomed = makePlayer({ id: 'a', row: 0, col: 0, hp: 3 });
    const safe = makePlayer({ id: 'b', row: 3, col: 3, joinOrder: 1 });
    const result = resolveRound([doomed, safe], stayPlans('a', 'b'), [], [], [], carton, 1);
    expect(result.shrinkIndex).toBe(2);
    expect(result.players.find((player) => player.id === 'a')?.hp).toBe(0);
    expect(result.players.find((player) => player.id === 'b')?.hp).toBe(3);
    expect(result.outcome).toEqual({ kind: 'winner', playerId: 'b' });
    const kinds = result.timeline.map((event) => event.type);
    expect(kinds).toContain('shrinkDestroy');
    expect(kinds).toContain('death');
    expect(kinds).toContain('shrinkWarn');
    expect(kinds.indexOf('shrinkDestroy')).toBeLessThan(kinds.indexOf('shrinkWarn'));
  });

  it('lets an egg walk off the warning before it closes', () => {
    const runner = makePlayer({
      id: 'a',
      row: 0,
      col: 0,
      hand: cards('move', 'pistol'),
    });
    const other = makePlayer({ id: 'b', row: 3, col: 3, joinOrder: 1 });
    const result = resolveRound(
      [runner, other],
      new Map([
        [
          'a',
          [
            { type: 'walk', path: [{ row: 1, col: 1 }] },
            { type: 'stay' },
          ],
        ],
        ['b', stayStay()],
      ]),
      [],
      [],
      [],
      carton,
      1,
    );
    expect(result.players.find((player) => player.id === 'a')?.hp).toBe(3);
    expect(result.players.find((player) => player.id === 'a')).toMatchObject({ row: 1, col: 1 });
    expect(result.outcome).toEqual({ kind: 'none' });
  });

  it('blocks walking onto a destroyed square', () => {
    const walker = makePlayer({
      id: 'a',
      row: 1,
      col: 1,
      hand: cards('move', 'pistol'),
    });
    const blocked = parseAndValidatePlan(
      walker,
      [
        { type: 'walk', path: [{ row: 0, col: 0 }] },
        { type: 'stay' },
      ],
      ['card-0', 'card-1'],
      [{ row: 0, col: 0 }],
      carton,
    );
    expect(blocked).toBeNull();
  });

  it('does not close on the half-dozen carton or while three eggs remain', () => {
    const a = makePlayer({ id: 'a', row: 0, col: 0 });
    const b = makePlayer({ id: 'b', row: 1, col: 2, joinOrder: 1 });
    const halfResult = resolveRound([a, b], stayPlans('a', 'b'), [], [], [], half);
    expect(halfResult.shrinkIndex).toBe(0);
    expect(halfResult.timeline.some((event) => event.type === 'shrinkWarn')).toBe(false);

    const c = makePlayer({ id: 'c', row: 6, col: 6, joinOrder: 2 });
    const trio = resolveRound(
      [a, b, c],
      stayPlans('a', 'b', 'c'),
      [],
      [],
      [],
      carton,
    );
    expect(trio.shrinkIndex).toBe(0);
    expect(trio.timeline.some((event) => event.type === 'shrinkWarn')).toBe(false);
  });

  it('warns the bottom three of the 3×3 before opening the 2×3 lane', () => {
    const a = makePlayer({ id: 'a', row: 3, col: 3 });
    const b = makePlayer({ id: 'b', row: 4, col: 3, joinOrder: 1 });
    const result = resolveRound([a, b], stayPlans('a', 'b'), [], [], [], carton, 2);
    expect(result.shrinkIndex).toBe(3);
    const warn = result.timeline.find((event) => event.type === 'shrinkWarn');
    expect(warn?.type === 'shrinkWarn' ? warn.cells : []).toEqual([
      { row: 4, col: 2 },
      { row: 4, col: 3 },
      { row: 4, col: 4 },
    ]);
    expect(result.players.find((player) => player.id === 'a')?.hp).toBe(3);
    expect(result.players.find((player) => player.id === 'b')?.hp).toBe(3);
    expect(result.players.find((player) => player.id === 'b')).toMatchObject({ row: 4, col: 3 });
  });

  it('opens a 2×3 lane after the bottom three go black', () => {
    const a = makePlayer({ id: 'a', row: 3, col: 3 });
    const b = makePlayer({ id: 'b', row: 2, col: 4, joinOrder: 1 });
    const result = resolveRound([a, b], stayPlans('a', 'b'), [], [], [], carton, 3);
    expect(result.shrinkIndex).toBe(SHRINK_LANE_INDEX);
    expect(result.timeline.some((event) => event.type === 'shrinkDestroy')).toBe(true);
    expect(result.timeline.some((event) => event.type === 'shrinkWarn')).toBe(false);
    const lane = shrinkSafeLane(carton);
    expect(lane).toHaveLength(6);
    expect(lane).toEqual(
      expect.arrayContaining([
        { row: 2, col: 2 },
        { row: 2, col: 4 },
        { row: 3, col: 2 },
        { row: 3, col: 4 },
      ]),
    );
    expect(result.players.find((player) => player.id === 'a')).toMatchObject({ row: 3, col: 3 });
    expect(result.players.find((player) => player.id === 'b')).toMatchObject({ row: 2, col: 4 });
    expect(result.players.every((player) => player.hp === 3)).toBe(true);
  });

  it('fries an egg that stays on the bottom three when the lane closes', () => {
    const a = makePlayer({ id: 'a', row: 3, col: 3 });
    const b = makePlayer({ id: 'b', row: 4, col: 3, joinOrder: 1 });
    const result = resolveRound([a, b], stayPlans('a', 'b'), [], [], [], carton, 3);
    expect(result.shrinkIndex).toBe(SHRINK_LANE_INDEX);
    expect(result.players.find((player) => player.id === 'b')?.hp).toBe(0);
    expect(result.outcome).toEqual({ kind: 'winner', playerId: 'a' });
  });

  it('does not close further after the lane opens', () => {
    const a = makePlayer({ id: 'a', row: 3, col: 3 });
    const b = makePlayer({ id: 'b', row: 3, col: 4, joinOrder: 1 });
    const result = resolveRound([a, b], stayPlans('a', 'b'), [], [], [], carton, SHRINK_LANE_INDEX);
    expect(result.shrinkIndex).toBe(SHRINK_LANE_INDEX);
    expect(
      result.timeline.some(
        (event) => event.type === 'shrinkWarn' || event.type === 'shrinkDestroy',
      ),
    ).toBe(false);
  });
});

describe('present spawn', () => {
  it('only offers a cell two squares from a living egg', () => {
    const a = makePlayer({ id: 'a', row: 3, col: 3 });
    const spawned = pickPresentSpawn([a], [], [], carton);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    expect(Math.max(Math.abs(spawned.row - 3), Math.abs(spawned.col - 3))).toBe(2);
  });

  it('spawns nothing when every two-square cell is blocked', () => {
    const a = makePlayer({ id: 'a', row: 3, col: 3 });
    const ring: { row: number; col: number }[] = [];
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== 2) continue;
        ring.push({ row: 3 + dr, col: 3 + dc });
      }
    }
    expect(pickPresentSpawn([a], ring, [], carton)).toBeNull();
  });
});
