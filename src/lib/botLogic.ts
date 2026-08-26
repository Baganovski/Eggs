import {
  CARDINAL_DIRS,
  MAX_WALK_STEPS,
  type ArenaAction,
  type CartonSpec,
  type Cell,
  type Direction,
  type Player,
  type WeaponKind,
} from '../types/game';
import {
  directionFromRay,
  isAlive,
  isCardinalWeapon,
  isObjectCell,
  isReusableCard,
  isOnBoard,
  neighbors8,
  plannedPositionAfter,
  shotRayCells,
  weaponFanCells,
  WEAPON_STATS,
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

function occupantAtCell(players: Player[], cell: Cell, exceptId: string): Player | undefined {
  return players.find(
    (player) =>
      player.id !== exceptId && isAlive(player) && player.row === cell.row && player.col === cell.col,
  );
}

function bestShotForWeapon(
  from: Cell,
  weapon: WeaponKind,
  others: Player[],
  selfId: string,
  mapObjects: Cell[],
  carton: CartonSpec,
): Direction | null {
  if (isCardinalWeapon(weapon)) {
    for (const dir of CARDINAL_DIRS) {
      const cells = weaponFanCells(weapon, from, dir, carton, mapObjects) ?? [];
      if (cells.some((cell) => occupantAtCell(others, cell, selfId))) return dir;
    }
    return null;
  }

  const range = WEAPON_STATS[weapon].range;
  if (weapon === 'bomb') {
    const lined = others
      .filter((player) => player.id !== selfId && isAlive(player))
      .map((player) => ({
        player,
        dir: directionFromRay(from, player),
        dist: chebyshev(from, player),
      }))
      .filter((entry): entry is { player: Player; dir: Direction; dist: number } => {
        if (!entry.dir) return false;
        return entry.dist >= 1 && entry.dist <= range;
      })
      .sort((a, b) => a.dist - b.dist);
    return lined[0]?.dir ?? null;
  }

  const lined = others
    .filter((player) => player.id !== selfId && isAlive(player))
    .map((player) => ({
      player,
      dir: directionFromRay(from, player),
      dist: chebyshev(from, player),
    }))
    .filter((entry): entry is { player: Player; dir: Direction; dist: number } => {
      if (!entry.dir) return false;
      const ray = shotRayCells(from, entry.dir, mapObjects, carton, range);
      const blocked = ray.findIndex((cell) => isObjectCell(cell, mapObjects));
      const target = ray.findIndex(
        (cell) => cell.row === entry.player.row && cell.col === entry.player.col,
      );
      if (target < 0) return false;
      if (blocked >= 0 && blocked <= target) return false;
      return true;
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
  carton: CartonSpec,
): ArenaAction {
  const stepsWanted = Math.min(MAX_WALK_STEPS, Math.max(1, chebyshev(from, target)));
  const path: Cell[] = [];
  let cursor = from;

  for (let step = 0; step < stepsWanted; step += 1) {
    const options = neighbors8(cursor, carton)
      .filter((cell) => !occupiedByOthers(cell, others, selfId, mapObjects))
      .sort((a, b) => {
        const da = chebyshev(a, target);
        const db = chebyshev(b, target);
        if (da !== db) return da - db;
        return Math.random() - 0.5;
      });

    const next = options[0];
    if (!next || (next.row === cursor.row && next.col === cursor.col)) break;
    if (!isOnBoard(next, carton)) break;
    path.push(next);
    cursor = next;
    if (chebyshev(cursor, target) === 0) break;
  }

  if (path.length === 0) return { type: 'stay' };
  return { type: 'walk', path };
}

function actionForWeapon(
  from: Cell,
  weapon: WeaponKind,
  others: Player[],
  selfId: string,
  mapObjects: Cell[],
  carton: CartonSpec,
): ArenaAction | null {
  const dir = bestShotForWeapon(from, weapon, others, selfId, mapObjects, carton);
  if (!dir) return null;
  if (weapon === 'bomb') {
    const target = others.find(
      (player) =>
        player.id !== selfId &&
        isAlive(player) &&
        directionFromRay(from, player) === dir,
    );
    const steps = target ? chebyshev(from, target) : WEAPON_STATS.bomb.range;
    return { type: 'shoot', weapon, dir, steps };
  }
  return { type: 'shoot', weapon, dir };
}

export function chooseBotPlan(
  bot: Player,
  players: Player[],
  mapObjects: Cell[],
  presents: Cell[] = [],
  carton: CartonSpec,
): { cardIds: [string, string]; actions: [ArenaAction, ArenaAction] } {
  const moveCard = bot.hand.find((card) => card.kind === 'move');
  const actionCards = bot.hand.filter((card) => card.kind !== 'move');
  const fallbackStay: [ArenaAction, ArenaAction] = [{ type: 'stay' }, { type: 'stay' }];
  if (!moveCard) {
    return { cardIds: [bot.hand[0]?.id ?? '', bot.hand[1]?.id ?? ''], actions: fallbackStay };
  }

  const nearestPresent = (from: Cell): Cell | null => {
    if (presents.length === 0) return null;
    return [...presents].sort((a, b) => chebyshev(from, a) - chebyshev(from, b))[0] ?? null;
  };

  const pickSlot = (from: Cell, usedActionId: string | null): { cardId: string; action: ArenaAction } => {
    const enemy = nearestEnemy(from, players, bot.id);
    const unused = actionCards.filter(
      (card) => card.id !== usedActionId || isReusableCard(card),
    );
    if (enemy) {
      for (const card of unused) {
        const shot = actionForWeapon(from, card.kind, players, bot.id, mapObjects, carton);
        if (shot && Math.random() < 0.8) {
          return { cardId: card.id, action: shot };
        }
      }
    }
    const present = !bot.spareWeapon ? nearestPresent(from) : null;
    const walkTarget = present ?? enemy;
    if (walkTarget) {
      return { cardId: moveCard.id, action: walkToward(from, walkTarget, players, bot.id, mapObjects, carton) };
    }
    return { cardId: moveCard.id, action: { type: 'stay' } };
  };

  const first = pickSlot(bot, null);
  const after = plannedPositionAfter(bot, first.action);
  const second = pickSlot(after, first.cardId === moveCard.id ? null : first.cardId);
  return {
    cardIds: [first.cardId, second.cardId],
    actions: [first.action, second.action],
  };
}
