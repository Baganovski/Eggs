import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  BOARD_SIZE,
  DIR_DELTA,
  MAX_WALK_STEPS,
  STARTING_HP,
  type ArenaAction,
  type Cell,
  type GameState,
  type PlanCard,
  type PlaybackEvent,
  type RoundStartToken,
} from '../types/game';
import {
  bombSplashCells,
  cellsEqual,
  directionFromRay,
  eventDurationMs,
  formatAction,
  formatWeapon,
  groupTimeline,
  isAdjacent8,
  isAlive,
  isCardinalDir,
  isObjectCell,
  isOnBoard,
  knifeFanCells,
  neighbors8,
  parseAndValidatePlan,
  plannedPositionAfter,
  playerColor,
  shotRayCells,
  WEAPON_STATS,
} from '../lib/arenaLogic';
import { PlayerToken } from './PlayerToken';

interface ArenaProps {
  state: GameState;
  isHost: boolean;
  onSubmitPlan: (plan: { cardIds: [string, string]; actions: [ArenaAction, ArenaAction] }) => void;
  onReturnToLobby: () => void;
}

type OverlayTone = 'active' | 'muted';

interface Beam {
  from: Cell;
  end: Cell;
  shooterId: string;
}

interface TokenBump {
  dr: number;
  dc: number;
}

interface Token {
  id: string;
  name: string;
  joinOrder: number;
  row: number;
  col: number;
  hp: number;
  connected: boolean;
  isBot: boolean;
  planSubmitted: boolean;
  isYou: boolean;
  isHost: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function tokensFromState(state: GameState): Token[] {
  return state.players.map((player) => ({
    id: player.id,
    name: player.name,
    joinOrder: player.joinOrder,
    row: player.row,
    col: player.col,
    hp: player.hp,
    connected: player.connected,
    isBot: player.isBot,
    planSubmitted: player.planSubmitted,
    isYou: player.id === state.localPlayerId,
    isHost: player.id === state.hostPlayerId,
  }));
}

function tokensFromSnapshot(state: GameState, snapshot: RoundStartToken[] | null): Token[] {
  const byId = new Map(state.players.map((player) => [player.id, player]));
  if (!snapshot) return tokensFromState(state);
  return snapshot.map((token) => {
    const player = byId.get(token.id);
    return {
      id: token.id,
      name: player?.name ?? 'Player',
      joinOrder: player?.joinOrder ?? 0,
      row: token.row,
      col: token.col,
      hp: token.hp,
      connected: player?.connected ?? true,
      isBot: player?.isBot ?? false,
      planSubmitted: player?.planSubmitted ?? false,
      isYou: token.id === state.localPlayerId,
      isHost: token.id === state.hostPlayerId,
    };
  });
}

function shotCaption(tokens: Token[], frame: PlaybackEvent[], actionIndex: number): string {
  const shots = frame.flatMap((event) => (event.type === 'shot' ? [event] : []));
  if (shots.length === 0) return `Move ${actionIndex + 1} · shots`;
  const labels = shots.map((shot) => {
    const name = tokens.find((token) => token.id === shot.shooterId)?.name ?? 'Someone';
    return `${name} ${shot.dir}`;
  });
  return `Move ${actionIndex + 1} · ${labels.join(' · ')}`;
}

const WALK_STEPS_AFTER_SIT = 2;

function planBeatNumbers(
  start: Cell,
  actions: [ArenaAction | null, ArenaAction | null],
  leadSit: [boolean, boolean] = [false, false],
): Map<string, number> {
  const numbers = new Map<string, number>();
  let n = 0;
  let pos = start;
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (!action) break;
    if (action.type === 'stay' || (action.type === 'walk' && leadSit[index])) {
      n += 1;
      numbers.set(`${pos.row},${pos.col}`, n);
    }
    if (action.type === 'walk') {
      for (const step of action.path) {
        n += 1;
        numbers.set(`${step.row},${step.col}`, n);
        pos = step;
      }
    } else if (action.type === 'shoot') {
      n += 1;
    }
  }
  return numbers;
}

function applyEvent(tokens: Token[], event: PlaybackEvent): Token[] {
  switch (event.type) {
    case 'move':
      return tokens.map((token) =>
        token.id === event.playerId ? { ...token, row: event.to.row, col: event.to.col } : token,
      );
    case 'hit':
      return tokens.map((token) =>
        token.id === event.playerId ? { ...token, hp: event.hpAfter } : token,
      );
    default:
      return tokens;
  }
}

async function runPlayback(options: {
  timeline: PlaybackEvent[];
  startTokens: Token[];
  cancelled: () => boolean;
  setTokens: (tokens: Token[]) => void;
  setBeams: (beams: Beam[]) => void;
  setBumps: (bumps: Record<string, TokenBump>) => void;
  setFlashIds: (ids: string[]) => void;
  setShootingIds: (ids: string[]) => void;
  setStatus: (status: string) => void;
}): Promise<void> {
  let current = options.startTokens;
  let actionIndex = 0;
  for (const frame of groupTimeline(options.timeline)) {
    if (options.cancelled()) return;
    const first = frame[0];
    if (first.type === 'actionStart') {
      actionIndex = first.actionIndex;
      options.setShootingIds([]);
      options.setBumps({});
      options.setStatus(`Move ${actionIndex + 1}`);
    } else if (first.type === 'beat') {
      actionIndex = first.actionIndex;
      options.setBeams([]);
      options.setFlashIds([]);
      options.setShootingIds([]);
      options.setBumps({});
      options.setStatus(`Move ${actionIndex + 1} · step ${first.beat + 1}`);
    } else if (first.type === 'shot') {
      const shots = frame.flatMap((event) =>
        event.type === 'shot'
          ? [{ from: event.from, end: event.end, shooterId: event.shooterId }]
          : [],
      );
      options.setBeams(shots);
      options.setShootingIds(shots.map((shot) => shot.shooterId));
      options.setStatus(shotCaption(current, frame, actionIndex));
    } else if (first.type === 'hit' || first.type === 'death') {
      options.setFlashIds(
        frame.flatMap((event) =>
          event.type === 'hit' || event.type === 'death' ? [event.playerId] : [],
        ),
      );
    }

    const blocked = frame.flatMap((event) => (event.type === 'blocked' ? [event] : []));
    current = frame.reduce(applyEvent, current);
    options.setTokens(current);

    if (blocked.length > 0) {
      const names = blocked.map((event) => {
        const name = current.find((token) => token.id === event.playerId)?.name ?? 'Someone';
        return name;
      });
      options.setStatus(`Move ${actionIndex + 1} · ${names.join(' · ')} bounce`);
      options.setBumps(
        Object.fromEntries(
          blocked.map((event) => [
            event.playerId,
            {
              dr: event.attempted.row - event.from.row,
              dc: event.attempted.col - event.from.col,
            },
          ]),
        ),
      );
      const duration = Math.max(...frame.map(eventDurationMs));
      await sleep(duration / 2);
      if (options.cancelled()) return;
      options.setBumps({});
      await sleep(duration / 2);
      if (options.cancelled()) return;
      continue;
    }

    const duration = Math.max(...frame.map(eventDurationMs));
    if (duration > 0) await sleep(duration);
    if (options.cancelled()) return;
  }
}

function onRay(from: Cell, end: Cell, cell: Cell): boolean {
  const dir = directionFromRay(from, end);
  if (!dir) return cellsEqual(from, cell);
  let cursor = { ...from };
  const seen = new Set<string>();
  while (isOnBoard(cursor) && !seen.has(`${cursor.row},${cursor.col}`)) {
    if (cellsEqual(cursor, cell) && !cellsEqual(cursor, from)) return true;
    if (cellsEqual(cursor, end)) break;
    seen.add(`${cursor.row},${cursor.col}`);
    const delta = DIR_DELTA[dir];
    cursor = { row: cursor.row + delta.dr, col: cursor.col + delta.dc };
  }
  return false;
}

export function Arena({ state, isHost, onSubmitPlan, onReturnToLobby }: ArenaProps) {
  const local = state.players.find((player) => player.id === state.localPlayerId);
  const localAlive = Boolean(local && isAlive(local));
  const planning = state.phase === 'playing' && state.turnPhase === 'planning';

  const [draft, setDraft] = useState<[ArenaAction | null, ArenaAction | null]>([null, null]);
  const [slotCards, setSlotCards] = useState<[string | null, string | null]>([null, null]);
  const [pendingSit, setPendingSit] = useState<[boolean, boolean]>([false, false]);
  const [leadSit, setLeadSit] = useState<[boolean, boolean]>([false, false]);
  const [slot, setSlot] = useState<0 | 1>(0);
  const [localLocked, setLocalLocked] = useState(false);
  const [tokens, setTokens] = useState<Token[]>(() => tokensFromState(state));
  const [beams, setBeams] = useState<Beam[]>([]);
  const [bumps, setBumps] = useState<Record<string, TokenBump>>({});
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const [shootingIds, setShootingIds] = useState<string[]>([]);
  const [replayDone, setReplayDone] = useState(true);
  const [watchingLast, setWatchingLast] = useState(false);
  const [status, setStatus] = useState('');
  const watchGen = useRef(0);
  const canPlan = planning && localAlive && !local?.planSubmitted && !localLocked && !watchingLast;

  useEffect(() => {
    setDraft([null, null]);
    setSlotCards([null, null]);
    setPendingSit([false, false]);
    setLeadSit([false, false]);
    setSlot(0);
    setLocalLocked(false);
  }, [state.round, local?.id]);

  useEffect(() => {
    if (state.turnPhase === 'resolving' && state.timeline.length > 0) return;
    if (watchingLast) return;
    setTokens(tokensFromState(state));
    setBeams([]);
    setBumps({});
    setFlashIds([]);
    setShootingIds([]);
    setReplayDone(true);
    setStatus('');
  }, [state.players, state.turnPhase, state.timeline.length, watchingLast]);

  const playbackKey = `${state.round}:${state.turnPhase}:${JSON.stringify(state.timeline)}`;

  useEffect(() => {
    let cancelled = false;

    if (state.turnPhase !== 'resolving' || state.timeline.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    watchGen.current += 1;
    setWatchingLast(false);
    setReplayDone(false);
    setTokens(tokensFromSnapshot(state, state.roundStart));
    setBeams([]);
    setBumps({});
    setFlashIds([]);
    setShootingIds([]);

    const play = async () => {
      await runPlayback({
        timeline: state.timeline,
        startTokens: tokensFromSnapshot(state, state.roundStart),
        cancelled: () => cancelled,
        setTokens,
        setBeams,
        setBumps,
        setFlashIds,
        setShootingIds,
        setStatus,
      });
      if (cancelled) return;
      setTokens(tokensFromState(state));
      setBeams([]);
      setBumps({});
      setFlashIds([]);
      setShootingIds([]);
      setStatus('');
      setReplayDone(true);
    };

    void play();
    return () => {
      cancelled = true;
    };
  }, [playbackKey]);

  const origin = useMemo<Cell>(() => {
    if (!local) return { row: 0, col: 0 };
    const start = { row: local.row, col: local.col };
    if (slot === 0) return start;
    return plannedPositionAfter(start, draft[0]);
  }, [local, slot, draft]);

  const selectedCard = local?.hand.find((card) => card.id === slotCards[slot]);
  const editingMove = selectedCard?.kind === 'move';
  const editingShoot = Boolean(selectedCard && selectedCard.kind !== 'move');

  const isMoveCard = (cardId: string | null) =>
    Boolean(cardId && local?.hand.find((card) => card.id === cardId)?.kind === 'move');

  const sittingSlot = (index: 0 | 1) =>
    pendingSit[index] || draft[index]?.type === 'stay';

  const resolvedDraft = useMemo<[ArenaAction | null, ArenaAction | null]>(() => {
    const resolve = (index: 0 | 1): ArenaAction | null => {
      if (draft[index]) return draft[index];
      if (pendingSit[index] && isMoveCard(slotCards[index])) return { type: 'stay' };
      return null;
    };
    return [resolve(0), resolve(1)];
  }, [draft, pendingSit, slotCards, local?.hand]);

  const maxWalkFor = (index: 0 | 1) => {
    if (leadSit[index] || sittingSlot(index)) return WALK_STEPS_AFTER_SIT;
    if (index === 1 && sittingSlot(0)) return WALK_STEPS_AFTER_SIT;
    return MAX_WALK_STEPS;
  };

  const walkPath = draft[slot]?.type === 'walk' ? draft[slot].path : [];
  const walkTip = walkPath[walkPath.length - 1] ?? origin;
  const validWalk =
    canPlan && editingMove && walkPath.length < maxWalkFor(slot)
      ? neighbors8(walkTip).filter((cell) => !isObjectCell(cell, state.mapObjects))
      : [];

  const walkTones = useMemo(() => {
    const tones = new Map<string, OverlayTone>();
    if (!local) return tones;
    const start = { row: local.row, col: local.col };
    ([0, 1] as const).forEach((index) => {
      const action = resolvedDraft[index];
      if (!action) return;
      const editingThis = slot === index && editingMove;
      const tone: OverlayTone = editingThis ? 'active' : 'muted';
      const mark = (cell: Cell) => {
        const key = `${cell.row},${cell.col}`;
        if (tone === 'active' || tones.get(key) !== 'active') tones.set(key, tone);
      };
      const from = index === 0 ? start : plannedPositionAfter(start, resolvedDraft[0]);
      if (action.type === 'stay' || (action.type === 'walk' && leadSit[index])) {
        mark(from);
      }
      if (action.type !== 'walk') return;
      for (const cell of action.path) mark(cell);
    });
    return tones;
  }, [resolvedDraft, slot, editingMove, local, leadSit]);

  const aimTones = useMemo(() => {
    const tones = new Map<string, OverlayTone>();
    if (!local) return tones;
    const start = { row: local.row, col: local.col };
    ([0, 1] as const).forEach((index) => {
      const action = draft[index];
      if (action?.type !== 'shoot') return;
      const from = index === 0 ? start : plannedPositionAfter(start, draft[0]);
      const editingThisShot = slot === index && editingShoot;
      const tone: OverlayTone = editingThisShot ? 'active' : 'muted';
      const mark = (cell: Cell) => {
        const key = `${cell.row},${cell.col}`;
        if (tone === 'active' || tones.get(key) !== 'active') tones.set(key, tone);
      };
      if (action.weapon === 'knife') {
        for (const cell of knifeFanCells(from, action.dir)) mark(cell);
        return;
      }
      const ray = shotRayCells(from, action.dir, state.mapObjects, WEAPON_STATS[action.weapon].range);
      if (action.weapon === 'bomb') {
        const end = ray[ray.length - 1];
        if (end) {
          mark(end);
          for (const cell of bombSplashCells(end)) mark(cell);
        }
        return;
      }
      for (const cell of ray) mark(cell);
    });
    return tones;
  }, [draft, slot, local, editingShoot, state.mapObjects]);

  const cardIds: [string, string] | null =
    slotCards[0] && slotCards[1] ? [slotCards[0], slotCards[1]] : null;
  const legalPlan =
    local && cardIds ? parseAndValidatePlan(local, resolvedDraft, cardIds, state.mapObjects) : null;
  const beatNumbers = useMemo(() => {
    if (!local) return new Map<string, number>();
    return planBeatNumbers({ row: local.row, col: local.col }, resolvedDraft, leadSit);
  }, [local, resolvedDraft, leadSit]);
  const livingCount = state.players.filter(isAlive).length;
  const submittedCount =
    state.players.filter((player) => isAlive(player) && player.planSubmitted).length +
    (localLocked && localAlive && !local?.planSubmitted ? 1 : 0);

  const setFlag = (
    setter: Dispatch<SetStateAction<[boolean, boolean]>>,
    index: 0 | 1,
    value: boolean,
  ) => {
    setter((current) => {
      if (current[index] === value) return current;
      const next: [boolean, boolean] = [...current];
      next[index] = value;
      return next;
    });
  };

  const setAction = (index: 0 | 1, action: ArenaAction | null) => {
    if (action?.type === 'walk' || action?.type === 'shoot' || action === null) {
      setFlag(setPendingSit, index, false);
    }
    if (action === null || action.type === 'stay' || action.type === 'shoot') {
      setFlag(setLeadSit, index, false);
    }
    let clearSecondCard = false;
    setDraft((current) => {
      const next: [ArenaAction | null, ArenaAction | null] = [...current];
      next[index] = action;
      if (index === 0 && current[1]?.type === 'walk' && local) {
        const start = { row: local.row, col: local.col };
        const after = plannedPositionAfter(start, action);
        const firstStep = current[1].path[0];
        if (!firstStep || !isAdjacent8(after, firstStep)) {
          next[1] = null;
          clearSecondCard = true;
        }
      }
      return next;
    });
    if (clearSecondCard) {
      setSlotCards((current) => [current[0], null]);
      setFlag(setPendingSit, 1, false);
      setFlag(setLeadSit, 1, false);
    }
  };

  const commitLeavingSlot = (index: 0 | 1) => {
    if (!pendingSit[index] || draft[index]) return;
    setAction(index, { type: 'stay' });
  };

  const goToSlot = (nextSlot: 0 | 1) => {
    if (nextSlot !== slot) commitLeavingSlot(slot);
    setSlot(nextSlot);
  };

  const chooseCard = (card: PlanCard) => {
    if (!canPlan) return;
    const other = slot === 0 ? 1 : 0;
    if (card.kind !== 'move' && slotCards[other] === card.id) return;

    const current = draft[slot];
    const slotFilled = current !== null || pendingSit[slot];
    const firstFilled =
      slot === 0 && slotFilled && slotCards[0] !== card.id && draft[1] === null && !pendingSit[1];

    if (firstFilled) {
      commitLeavingSlot(0);
      setSlot(1);
      setSlotCards((ids) => [ids[0], card.id]);
      setAction(1, null);
      return;
    }

    setSlotCards((ids) => {
      const next: [string | null, string | null] = [...ids];
      next[slot] = card.id;
      return next;
    });
    if (card.kind === 'move') {
      if (current?.type === 'shoot') setAction(slot, null);
    } else if (current?.type !== 'shoot' || current.weapon !== card.kind) {
      setAction(slot, null);
    }
  };

  const handleCellClick = (cell: Cell) => {
    if (!canPlan || !selectedCard) return;
    if (selectedCard.kind === 'move') {
      if (cellsEqual(cell, origin)) {
        if (draft[slot]?.type === 'walk') {
          if (walkPath.length >= maxWalkFor(slot)) return;
          if (!isAdjacent8(walkTip, cell) || isObjectCell(cell, state.mapObjects)) return;
          setAction(slot, { type: 'walk', path: [...walkPath, cell] });
          return;
        }
        setFlag(setPendingSit, slot, true);
        return;
      }
      if (sittingSlot(slot)) {
        if (!isAdjacent8(origin, cell) || !isOnBoard(cell) || isObjectCell(cell, state.mapObjects)) {
          return;
        }
        setFlag(setLeadSit, slot, true);
        setAction(slot, { type: 'walk', path: [cell] });
        return;
      }
      if (walkPath.length >= maxWalkFor(slot)) return;
      if (!isAdjacent8(walkTip, cell) || !isOnBoard(cell) || isObjectCell(cell, state.mapObjects)) {
        return;
      }
      setAction(slot, { type: 'walk', path: [...walkPath, cell] });
      return;
    }

    if (selectedCard.kind === 'knife') {
      const dir = directionFromRay(origin, cell);
      if (dir && isCardinalDir(dir)) {
        setAction(slot, { type: 'shoot', weapon: 'knife', dir });
      }
      return;
    }

    const dir = directionFromRay(origin, cell);
    if (!dir) return;
    const ray = shotRayCells(origin, dir, state.mapObjects, WEAPON_STATS[selectedCard.kind].range);
    if (!ray.some((step) => cellsEqual(step, cell))) return;
    setAction(slot, { type: 'shoot', weapon: selectedCard.kind, dir });
  };

  const resetAction = () => {
    if (!canPlan) return;
    setAction(slot, null);
    setFlag(setPendingSit, slot, false);
    setFlag(setLeadSit, slot, false);
    setSlotCards((ids) => {
      const next: [string | null, string | null] = [...ids];
      next[slot] = null;
      return next;
    });
  };

  const lockIn = () => {
    if (!legalPlan || !slotCards[0] || !slotCards[1]) return;
    setLocalLocked(true);
    onSubmitPlan({ cardIds: [slotCards[0], slotCards[1]], actions: legalPlan });
  };

  const watchLastTurn = () => {
    const replay = state.lastReplay;
    if (!replay || watchingLast) return;
    const gen = watchGen.current + 1;
    watchGen.current = gen;
    setWatchingLast(true);
    setReplayDone(false);
    setBeams([]);
    setBumps({});
    setFlashIds([]);
    setShootingIds([]);
    const startTokens = tokensFromSnapshot(state, replay.roundStart);
    setTokens(startTokens);
    void (async () => {
      await runPlayback({
        timeline: replay.timeline,
        startTokens,
        cancelled: () => watchGen.current !== gen,
        setTokens,
        setBeams,
        setBumps,
        setFlashIds,
        setShootingIds,
        setStatus,
      });
      if (watchGen.current !== gen) return;
      setTokens(tokensFromState(state));
      setBeams([]);
      setBumps({});
      setFlashIds([]);
      setShootingIds([]);
      setStatus('');
      setWatchingLast(false);
      setReplayDone(true);
    })();
  };

  const showOutcome = state.phase === 'finished' && replayDone && !watchingLast;
  const winnerId = state.outcome.kind === 'winner' ? state.outcome.playerId : null;
  const winner = winnerId
    ? state.players.find((player) => player.id === winnerId)
    : undefined;
  const canReplayLast =
    Boolean(state.lastReplay) &&
    (planning || (state.phase === 'finished' && replayDone)) &&
    !watchingLast;

  const plannerHint = !localAlive
    ? 'You’re out. Watch the rest of the grid.'
    : local?.planSubmitted || localLocked
      ? 'Locked. Waiting on the rest.'
      : watchingLast
        ? status || 'Watching the last round…'
        : !planning
          ? status || 'Watching the grid…'
          : selectedCard?.kind === 'move'
            ? 'Tap yourself to sit, then up to 2 squares to walk this move. Sit locks only if you open the next move or lock in. Walls block movement and shots.'
            : selectedCard?.kind === 'knife'
              ? 'Tap north, east, south, or west. The knife hits the three squares in that facing. Two damage.'
              : selectedCard?.kind === 'bomb'
                ? 'Tap a cell on the line, up to 2 squares. The bomb hits that cell and the four cardinal neighbors.'
                : selectedCard?.kind === 'shotgun'
                  ? 'Tap a cell on the line, up to 3 squares. Two damage.'
                  : selectedCard?.kind === 'pistol'
                    ? 'Tap a cell on the line you want. Unlimited range, one damage.'
                    : 'Pick a card for this move.';

  const showPlanner = state.phase === 'playing';

  return (
    <div className="arena">
      <div className="arena-status-row">
        <p className="arena-kicker">
          {state.phase === 'finished'
            ? 'That’s a wrap'
            : planning
              ? `Round ${state.round}`
              : `Round ${state.round} · playing out`}
        </p>
        <p className="arena-meta-inline">
          {watchingLast
            ? status || `Watching round ${state.lastReplay?.round ?? ''}`
            : planning
              ? `${submittedCount}/${livingCount} locked`
              : status || (replayDone ? 'Moves played out' : 'Watching the grid…')}
        </p>
      </div>

      <ul className="arena-hud">
        {tokens.map((player) => (
          <li
            key={player.id}
            className={`arena-hud-seat${player.isYou ? ' is-you' : ''}${
              player.hp <= 0 ? ' is-down' : ''
            }${shootingIds.includes(player.id) ? ' is-shooting' : ''}`}
          >
            <span
              className="arena-hud-swatch"
              style={{ background: playerColor(player.joinOrder) }}
            />
            <span className="arena-hud-name">
              {player.name}
              {player.isYou ? ' (you)' : ''}
            </span>
            <span className="arena-hp" aria-label={`${player.hp} HP`}>
              {Array.from({ length: STARTING_HP }, (_, index) => (
                <span key={index} className={index < player.hp ? 'pip on' : 'pip'} />
              ))}
            </span>
            <span className="arena-hud-note">
              {shootingIds.includes(player.id)
                ? 'shooting'
                : !player.connected
                  ? 'away'
                  : planning && (player.planSubmitted || (player.isYou && localLocked))
                    ? 'locked'
                    : player.isBot
                      ? 'bot'
                      : ''}
            </span>
          </li>
        ))}
      </ul>

      <div className="arena-board-wrap">
        <div className="arena-board" style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}>
          {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
            const row = Math.floor(index / BOARD_SIZE);
            const col = index % BOARD_SIZE;
            const cell = { row, col };
            const cellKey = `${row},${col}`;
            const walkTone = walkTones.get(cellKey);
            const aimTone = aimTones.get(cellKey);
            const pathIndex = beatNumbers.get(cellKey) ?? 0;
            const isValid = validWalk.some((step) => cellsEqual(step, cell));
            const isOrigin = canPlan && cellsEqual(origin, cell);
            const hasBlock = isObjectCell(cell, state.mapObjects);
            const occupants = tokens
              .filter((token) => token.row === row && token.col === col)
              .sort((a, b) => a.hp - b.hp);
            const beam = beams.find((ray) => onRay(ray.from, ray.end, cell));
            const beamShooter = beam
              ? tokens.find((token) => token.id === beam.shooterId)
              : undefined;

            return (
              <button
                key={`${row}-${col}`}
                type="button"
                className={`arena-cell${(row + col) % 2 === 0 ? ' shade' : ''}${
                  walkTone === 'muted' ? ' on-path-muted' : ''
                }${aimTone === 'muted' ? ' on-aim-muted' : ''}${
                  walkTone === 'active' ? ' on-path' : ''
                }${aimTone === 'active' ? ' on-aim' : ''}${
                  isValid ? ' is-valid' : ''
                }${isOrigin ? ' is-origin' : ''}${beam ? ' on-beam' : ''}${
                  hasBlock ? ' has-block' : ''
                }`}
                style={
                  beamShooter
                    ? ({ '--beam': playerColor(beamShooter.joinOrder) } as React.CSSProperties)
                    : undefined
                }
                onClick={() => handleCellClick(cell)}
                disabled={!canPlan}
              >
                {pathIndex > 0 && <span className="path-index">{pathIndex}</span>}
                {hasBlock && <BlockMark />}
                {occupants.map((token) => (
                  <PlayerToken
                    key={token.id}
                    joinOrder={token.joinOrder}
                    name={token.name}
                    isYou={token.isYou}
                    isDown={token.hp <= 0}
                    isHit={flashIds.includes(token.id)}
                    isShooting={shootingIds.includes(token.id)}
                    bump={bumps[token.id]}
                  />
                ))}
              </button>
            );
          })}
        </div>
      </div>

      {showPlanner && (
        <div className="arena-planner">
          <div className="action-slots">
            {([0, 1] as const).map((index) => (
              <button
                key={index}
                type="button"
                className={`action-slot${slot === index ? ' is-active' : ''}`}
                disabled={!canPlan}
                onClick={() => goToSlot(index)}
              >
                <span className="action-slot-label">Move {index + 1}</span>
                <span>{formatAction(resolvedDraft[index])}</span>
              </button>
            ))}
          </div>

          <div className="hand-row">
            {(local?.hand ?? []).map((card, cardIndex) => {
              const other = slot === 0 ? 1 : 0;
              const usedElsewhere = card.kind !== 'move' && slotCards[other] === card.id;
              const selected = slotCards[slot] === card.id;
              const label = card.kind === 'move' ? 'Move' : `Action ${cardIndex}`;
              const title = card.kind === 'move' ? 'Move' : formatWeapon(card.kind);
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`plan-card${selected ? ' is-selected' : ''}${
                    usedElsewhere ? ' is-spent' : ''
                  }`}
                  disabled={!canPlan || usedElsewhere}
                  onClick={() => chooseCard(card)}
                >
                  <span className="plan-card-label">{label}</span>
                  <span>{title}</span>
                </button>
              );
            })}
          </div>

          <p className="arena-hint">{plannerHint}</p>

          <div className="planner-actions">
            <div className="planner-tools">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canPlan}
                onClick={resetAction}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canReplayLast}
                onClick={watchLastTurn}
              >
                Replay
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canPlan || !legalPlan}
              onClick={lockIn}
            >
              Lock it in
            </button>
          </div>
        </div>
      )}

      {showOutcome && (
        <div className="arena-outcome">
          <p className="arena-kicker">
            {state.outcome.kind === 'winner'
              ? `${winner?.name ?? 'Someone'} called it`
              : 'Dead heat'}
          </p>
          <p className="arena-copy">
            {state.outcome.kind === 'winner'
              ? `${winner?.hp ?? 0} HP still on the board.`
              : 'Last survivors dropped on the same beat.'}
          </p>
        </div>
      )}

      {state.phase === 'finished' && isHost && replayDone && !watchingLast && (
        <div className="replay-row">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!canReplayLast}
            onClick={watchLastTurn}
          >
            Replay
          </button>
          <button type="button" className="btn btn-primary" onClick={onReturnToLobby}>
            Back to the room
          </button>
        </div>
      )}

      {state.phase === 'finished' && !isHost && replayDone && !watchingLast && (
        <div className="replay-row">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!canReplayLast}
            onClick={watchLastTurn}
          >
            Replay
          </button>
          <p className="arena-copy">Host is sending everyone back to the room.</p>
        </div>
      )}
    </div>
  );
}

function BlockMark() {
  return (
    <span className="arena-block" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <rect x="2" y="2" width="28" height="28" rx="3" fill="#7a756f" stroke="#111" strokeWidth="2.4" />
        <path
          d="M2 11 H30 M2 20 H30 M11 2 V11 M22 11 V20 M11 20 V30 M22 2 V11"
          fill="none"
          stroke="#111"
          strokeWidth="1.6"
        />
        <rect x="4" y="4" width="6" height="6" rx="1" fill="#959089" />
        <rect x="13" y="13" width="6" height="6" rx="1" fill="#959089" />
        <rect x="22" y="22" width="6" height="6" rx="1" fill="#959089" />
      </svg>
    </span>
  );
}
