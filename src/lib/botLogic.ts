import {
  MAX_WALK_STEPS,
  type ArenaAction,
  type Cell,
  type Direction,
  type Player,
} from '../types/game';
import {
  directionFromRay,
  isAlive,
  isObjectCell,
  isOnBoard,
  neighbors8,
  plannedPositionAfter,
  shotRayCells,
} from './arenaLogic';

function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

function occupiedByOthers(
  cell: Cell,
  others: Player[],
  selfId: string,
  mapObjects: Cell[],
): boolean {
  if (isObjectCell(cell, mapObjects)) return true;
  return others.some(
    (player) =>
      player.id !== selfId && isAlive(player) && player.row === cell.row && player.col === cell.col,
  );
}

function nearestEnemy(from: Cell, others: Player[], selfId: string): Player | null {
  const enemies = others.filter((player) => player.id !== selfId && isAlive(player));
  if (enemies.length === 0) return null;
  return [...enemies].sort((a, b) => chebyshev(from, a) - chebyshev(from, b))[0] ?? null;
}

function bestShot(
  from: Cell,
  others: Player[],
  selfId: string,
  mapObjects: Cell[],
): Direction | null {
  const lined = others
    .filter((player) => player.id !== selfId && isAlive(player))
    .map((player) => ({
      player,
      dir: directionFromRay(from, player),
      dist: chebyshev(from, player),
    }))
    .filter((entry): entry is { player: Player; dir: Direction; dist: number } => {
      if (!entry.dir) return false;
      const ray = shotRayCells(from, entry.dir, mapObjects);
      const blocked = ray.findIndex((cell) => isObjectCell(cell, mapObjects));
      const target = ray.findIndex(
        (cell) => cell.row === entry.player.row && cell.col === entry.player.col,
      );
      if (target < 0) return false;
      return blocked < 0 || blocked > target;
    })
    .sort((a, b) => a.dist - b.dist);
  return lined[0]?.dir ?? null;
}

function walkToward(
  from: Cell,
  target: Cell,
  others: Player[],
  selfId: string,
  mapObjects: Cell[],
): ArenaAction {
  const stepsWanted = Math.min(MAX_WALK_STEPS, Math.max(1, chebyshev(from, target)));
  const path: Cell[] = [];
  let cursor = from;

  for (let step = 0; step < stepsWanted; step += 1) {
    const options = neighbors8(cursor)
      .filter((cell) => !occupiedByOthers(cell, others, selfId, mapObjects))
      .sort((a, b) => {
        const da = chebyshev(a, target);
        const db = chebyshev(b, target);
        if (da !== db) return da - db;
        return Math.random() - 0.5;
      });

    const next = options[0];
    if (!next || (next.row === cursor.row && next.col === cursor.col)) break;
    if (!isOnBoard(next)) break;
    path.push(next);
    cursor = next;
    if (chebyshev(cursor, target) === 0) break;
  }

  if (path.length === 0) return { type: 'stay' };
  return { type: 'walk', path };
}

function pickAction(
  from: Cell,
  others: Player[],
  selfId: string,
  mapObjects: Cell[],
): ArenaAction {
  const enemy = nearestEnemy(from, others, selfId);
  if (!enemy) return { type: 'stay' };

  const shot = bestShot(from, others, selfId, mapObjects);
  const range = chebyshev(from, enemy);

  if (shot && range <= 4 && Math.random() < 0.85) {
    return { type: 'shoot', dir: shot };
  }
  if (shot && Math.random() < 0.45) {
    return { type: 'shoot', dir: shot };
  }
  return walkToward(from, enemy, others, selfId, mapObjects);
}

export function chooseBotPlan(
  bot: Player,
  players: Player[],
  mapObjects: Cell[],
): [ArenaAction, ArenaAction] {
  const first = pickAction(bot, players, bot.id, mapObjects);
  const after = plannedPositionAfter(bot, first);
  const second = pickAction(after, players, bot.id, mapObjects);
  return [first, second];
}
