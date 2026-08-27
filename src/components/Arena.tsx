import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  cartonSpec,
  MAX_WALK_STEPS,
  PLAN_TIME_MS,
  STARTING_HP,
  type ArenaAction,
  type CartonSpec,
  type Cell,
  type GameState,
  type PlanCard,
  type PlaybackEvent,
  type RoundStartToken,
} from '../types/game';
import {
  bombSplashCells,
  bombThrowCells,
  cellAlongRay,
  cellsEqual,
  completePartialPlan,
  directionFromRay,
  eventDurationMs,
  formatAction,
  formatWeapon,
  groupTimeline,
  isAdjacent8,
  isAlive,
  isCardinalDir,
  isCardinalWeapon,
  isObjectCell,
  isOnBoard,
  isReusableCard,
  neighbors8,
  parseAndValidatePlan,
  plannedPositionAfter,
  playerColor,
  shotPlaybackCells,
  shotRayCells,
  validShootCells,
  walkDelay,
  weaponFanCells,
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
  shooterId: string;
  cells: Cell[];
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

function FitText({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.fontSize = '';
      const start = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(start)) return;
      let size = start;
      const min = Math.max(10, start * 0.58);
      while (el.scrollWidth > el.clientWidth + 0.5 && size > min) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [children]);

  return (
    <span ref={ref} className="fit-text">
      {children}
    </span>
  );
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

const PLANNER_HINT_WALK_NO_PRESENT =
  'Walk up to 3 squares — or tap yourself to sit, then walk up to 2.';

const PLANNER_HINT_WALK = `${PLANNER_HINT_WALK_NO_PRESENT} Walk onto a present for a spare.`;

const PLANNER_HINT_SIZER =
  'Tap north, east, south, or west. The flame hits two squares ahead, and the sides of the second square. An obstacle in front stops the rest. Two damage.';

function walkAction(path: Cell[], delay = 0): ArenaAction {
  return delay === 1 ? { type: 'walk', path, delay: 1 } : { type: 'walk', path };
}

function planBeatNumbers(
  start: Cell,
  actions: [ArenaAction | null, ArenaAction | null],
): Map<string, number> {
  const numbers = new Map<string, number>();
  let n = 0;
  let pos = start;
  for (const action of actions) {
    if (!action) break;
    if (action.type === 'stay' || (action.type === 'walk' && walkDelay(action))) {
      n += 1;
      numbers.set(`${pos.row},${pos.col}`, n);
    }
    if (action.type === 'walk') {
      for (const step of action.path) {
        n += 1;
        numbers.set(`${step.row},${step.col}`, n);
        pos = step;
      }
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

const EGG_WHITE_PATHS = [
  'M16 48 C14 28 28 18 40 22 C50 12 66 18 70 32 C84 38 78 58 64 62 C50 74 22 70 16 48 Z',
  'M22 50 C12 40 16 22 32 18 C48 8 72 22 70 40 C80 54 64 70 46 66 C28 74 16 64 22 50 Z',
  'M18 40 C14 22 36 10 56 18 C76 24 78 50 60 58 C40 70 16 62 18 40 Z',
  'M20 36 C12 20 32 8 52 16 C74 20 78 48 58 58 C36 70 14 58 20 36 Z',
];

function EggWhiteBlob({ index }: { index: number }) {
  const x = 18 + ((index * 29) % 40);
  const y = 24 + ((index * 17) % 36);
  const tilt = ((index * 37) % 21) - 10;
  return (
    <span
      className="egg-white-blob"
      style={{ left: `${x}%`, top: `${y}%`, transform: `rotate(${tilt}deg)` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 90 80">
        <path
          d={EGG_WHITE_PATHS[index % EGG_WHITE_PATHS.length]}
          fill="none"
          stroke="currentColor"
          strokeWidth="18"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path d={EGG_WHITE_PATHS[index % EGG_WHITE_PATHS.length]} fill="#fffdf8" />
      </svg>
    </span>
  );
}

async function runPlayback(options: {
  timeline: PlaybackEvent[];
  startTokens: Token[];
  startStains: Cell[];
  startPresents: Cell[];
  cancelled: () => boolean;
  setTokens: (tokens: Token[]) => void;
  setStains: (stains: Cell[]) => void;
  setPresents: (presents: Cell[]) => void;
  setBeams: (beams: Beam[]) => void;
  setBumps: (bumps: Record<string, TokenBump>) => void;
  setFlashIds: (ids: string[]) => void;
  setShootingIds: (ids: string[]) => void;
  setStatus: (status: string) => void;
  carton: CartonSpec;
}): Promise<void> {
  let current = options.startTokens;
  let stains = options.startStains;
  let presents = options.startPresents;
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
          ? [{ shooterId: event.shooterId, cells: shotPlaybackCells(event, options.carton) }]
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
    } else if (first.type === 'pickup') {
      const pickups = frame.flatMap((event) => (event.type === 'pickup' ? [event] : []));
      const labels = pickups.map((event) => {
        const name = current.find((token) => token.id === event.playerId)?.name ?? 'Someone';
        return `${name} unwraps ${formatWeapon(event.weapon)}`;
      });
      options.setStatus(`Move ${actionIndex + 1} · ${labels.join(' · ')}`);
    }

    const blocked = frame.flatMap((event) => (event.type === 'blocked' ? [event] : []));
    const freshStains = frame.flatMap((event) => (event.type === 'eggStain' ? [event.cell] : []));
    const pickups = frame.flatMap((event) => (event.type === 'pickup' ? [event] : []));
    current = frame.reduce(applyEvent, current);
    options.setTokens(current);
    if (freshStains.length > 0) {
      stains = [...stains, ...freshStains];
      options.setStains(stains);
    }
    if (pickups.length > 0) {
      const taken = new Set(pickups.map((event) => `${event.cell.row},${event.cell.col}`));
      presents = presents.filter((cell) => !taken.has(`${cell.row},${cell.col}`));
      options.setPresents(presents);
    }

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

function PlanTimerFill({ deadlineAt }: { deadlineAt: number }) {
  const [anim] = useState(() => {
    const remaining = Math.max(0, deadlineAt - Date.now());
    return {
      remaining,
      startScale: Math.min(1, remaining / PLAN_TIME_MS),
    };
  });
  return (
    <div
      className="arena-timer-fill"
      style={
        {
          '--timer-start': `${anim.startScale * 100}%`,
          animationDuration: `${anim.remaining}ms`,
        } as React.CSSProperties
      }
    />
  );
}

function PlanTimerBar({ deadlineAt }: { deadlineAt: number | null }) {
  const remaining = deadlineAt ? Math.max(0, deadlineAt - Date.now()) : 0;
  return (
    <div
      className="arena-timer"
      role="progressbar"
      aria-label="Turn timer"
      aria-valuemin={0}
      aria-valuemax={PLAN_TIME_MS / 1000}
      aria-valuenow={Math.ceil(remaining / 1000)}
    >
      {deadlineAt ? <PlanTimerFill key={deadlineAt} deadlineAt={deadlineAt} /> : null}
    </div>
  );
}

export function Arena({ state, isHost, onSubmitPlan, onReturnToLobby }: ArenaProps) {
  const carton = cartonSpec(state.cartonType);
  const local = state.players.find((player) => player.id === state.localPlayerId);
  const localAlive = Boolean(local && isAlive(local));
  const planning = state.phase === 'playing' && state.turnPhase === 'planning';

  const [draft, setDraft] = useState<[ArenaAction | null, ArenaAction | null]>([null, null]);
  const [slotCards, setSlotCards] = useState<[string | null, string | null]>([null, null]);
  const [pendingSit, setPendingSit] = useState<[boolean, boolean]>([false, false]);
  const [slot, setSlot] = useState<0 | 1>(0);
  const [localLocked, setLocalLocked] = useState(false);
  const [tokens, setTokens] = useState<Token[]>(() => tokensFromState(state));
  const [stains, setStains] = useState<Cell[]>(() => state.eggStains ?? []);
  const [presents, setPresents] = useState<Cell[]>(() => state.presents ?? []);
  const [beams, setBeams] = useState<Beam[]>([]);
  const [bumps, setBumps] = useState<Record<string, TokenBump>>({});
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const [shootingIds, setShootingIds] = useState<string[]>([]);
  const [replayDone, setReplayDone] = useState(true);
  const [watchingLast, setWatchingLast] = useState(false);
  const [status, setStatus] = useState('');
  const watchGen = useRef(0);
  const submitDraftRef = useRef<() => void>(() => {});
  const canPlan = planning && localAlive && !local?.planSubmitted && !localLocked && !watchingLast;
  const showPlanOverlay = planning && !watchingLast;

  useEffect(() => {
    setDraft([null, null]);
    setSlotCards([null, null]);
    setPendingSit([false, false]);
    setSlot(0);
    setLocalLocked(false);
  }, [state.round, local?.id]);

  useEffect(() => {
    if (state.phase === 'playing' && state.turnPhase === 'planning') return;
    setDraft([null, null]);
    setSlotCards([null, null]);
    setPendingSit([false, false]);
  }, [state.phase, state.turnPhase]);

  useEffect(() => {
    if (state.turnPhase === 'resolving' && state.timeline.length > 0) return;
    if (watchingLast) return;
    setTokens(tokensFromState(state));
    setStains(state.eggStains ?? []);
    setPresents(state.presents ?? []);
    setBeams([]);
    setBumps({});
    setFlashIds([]);
    setShootingIds([]);
    setReplayDone(true);
    setStatus('');
  }, [state.players, state.turnPhase, state.timeline.length, state.eggStains, state.presents, watchingLast]);

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
    const startStains = state.lastReplay?.startEggStains ?? [];
    const startPresents = state.lastReplay?.startPresents ?? [];
    setStains(startStains);
    setPresents(startPresents);
    setBeams([]);
    setBumps({});
    setFlashIds([]);
    setShootingIds([]);

    const play = async () => {
      await runPlayback({
        timeline: state.timeline,
        startTokens: tokensFromSnapshot(state, state.roundStart),
        startStains,
        startPresents,
        cancelled: () => cancelled,
        setTokens,
        setStains,
        setPresents,
        setBeams,
        setBumps,
        setFlashIds,
        setShootingIds,
        setStatus,
        carton,
      });
      if (cancelled) return;
      setTokens(tokensFromState(state));
      setStains(state.eggStains ?? []);
      setPresents(state.presents ?? []);
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
    const action = draft[index];
    if ((action?.type === 'walk' && walkDelay(action)) || sittingSlot(index)) {
      return WALK_STEPS_AFTER_SIT;
    }
    return MAX_WALK_STEPS;
  };

  const walkPath = draft[slot]?.type === 'walk' ? draft[slot].path : [];
  const walkTip = walkPath[walkPath.length - 1] ?? origin;
  const validWalk =
    canPlan && editingMove && walkPath.length < maxWalkFor(slot)
      ? neighbors8(walkTip, carton).filter((cell) => !isObjectCell(cell, state.mapObjects))
      : [];
  const validShoot =
    canPlan && selectedCard && selectedCard.kind !== 'move'
      ? validShootCells(selectedCard.kind, origin, carton, state.mapObjects)
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
      if (action.type === 'stay' || (action.type === 'walk' && walkDelay(action))) {
        mark(from);
      }
      if (action.type !== 'walk') return;
      for (const cell of action.path) mark(cell);
    });
    return tones;
  }, [resolvedDraft, slot, editingMove, local]);

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
      const fan = weaponFanCells(action.weapon, from, action.dir, carton, state.mapObjects);
      if (fan) {
        for (const cell of fan) mark(cell);
        return;
      }
      if (action.weapon === 'bomb') {
        const steps = action.steps ?? WEAPON_STATS.bomb.range;
        const end = cellAlongRay(from, action.dir, steps, carton);
        if (!cellsEqual(end, from)) {
          mark(end);
          for (const cell of bombSplashCells(end, carton, state.mapObjects)) mark(cell);
        }
        return;
      }
      const ray = shotRayCells(
        from,
        action.dir,
        state.mapObjects,
        carton,
        WEAPON_STATS[action.weapon].range,
      );
      for (const cell of ray) mark(cell);
    });
    return tones;
  }, [draft, slot, local, editingShoot, state.mapObjects, carton]);

  const cardIds: [string, string] | null =
    slotCards[0] && slotCards[1] ? [slotCards[0], slotCards[1]] : null;
  const legalPlan =
    local && cardIds
      ? parseAndValidatePlan(local, resolvedDraft, cardIds, state.mapObjects, carton)
      : null;
  const beatNumbers = useMemo(() => {
    if (!local) return new Map<string, number>();
    return planBeatNumbers({ row: local.row, col: local.col }, resolvedDraft);
  }, [local, resolvedDraft]);
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
    if (!isReusableCard(card) && slotCards[other] === card.id) return;

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
      const currentDelay = draft[slot]?.type === 'walk' ? walkDelay(draft[slot]) : 0;
      if (cellsEqual(cell, origin)) {
        if (draft[slot]?.type === 'walk') {
          if (walkPath.length >= maxWalkFor(slot)) return;
          if (!isAdjacent8(walkTip, cell) || isObjectCell(cell, state.mapObjects)) return;
          setAction(slot, walkAction([...walkPath, cell], currentDelay));
          return;
        }
        setFlag(setPendingSit, slot, true);
        return;
      }
      if (sittingSlot(slot)) {
        if (!isAdjacent8(origin, cell) || !isOnBoard(cell, carton) || isObjectCell(cell, state.mapObjects)) {
          return;
        }
        setAction(slot, walkAction([cell], 1));
        return;
      }
      if (walkPath.length >= maxWalkFor(slot)) return;
      if (!isAdjacent8(walkTip, cell) || !isOnBoard(cell, carton) || isObjectCell(cell, state.mapObjects)) {
        return;
      }
      setAction(slot, walkAction([...walkPath, cell], currentDelay));
      return;
    }

    if (isCardinalWeapon(selectedCard.kind)) {
      const dir = directionFromRay(origin, cell);
      if (dir && isCardinalDir(dir)) {
        setAction(slot, { type: 'shoot', weapon: selectedCard.kind, dir });
      }
      return;
    }

    if (selectedCard.kind === 'bomb') {
      const dir = directionFromRay(origin, cell);
      if (!dir) return;
      const ray = bombThrowCells(origin, dir, carton);
      const index = ray.findIndex((step) => cellsEqual(step, cell));
      if (index < 0) return;
      setAction(slot, { type: 'shoot', weapon: 'bomb', dir, steps: index + 1 });
      return;
    }

    const dir = directionFromRay(origin, cell);
    if (!dir) return;
    const ray = shotRayCells(
      origin,
      dir,
      state.mapObjects,
      carton,
      WEAPON_STATS[selectedCard.kind].range,
    );
    if (!ray.some((step) => cellsEqual(step, cell))) return;
    setAction(slot, { type: 'shoot', weapon: selectedCard.kind, dir });
  };

  const resetAction = () => {
    if (!canPlan) return;
    setAction(slot, null);
    setFlag(setPendingSit, slot, false);
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

  const submitDraftOrSit = () => {
    if (!local || !localAlive || local.planSubmitted || localLocked) return;
    const completed = completePartialPlan(local, resolvedDraft, slotCards, state.mapObjects, carton);
    if (!completed) return;
    setLocalLocked(true);
    onSubmitPlan(completed);
  };
  submitDraftRef.current = submitDraftOrSit;

  useEffect(() => {
    if (!planning || !localAlive || local?.planSubmitted || localLocked) return;
    const deadline = state.planDeadlineAt;
    if (!deadline) return;
    const wait = Math.max(0, deadline - Date.now());
    const timer = window.setTimeout(() => {
      submitDraftRef.current();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [planning, localAlive, local?.planSubmitted, localLocked, state.planDeadlineAt, state.round]);

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
    const startStains = replay.startEggStains ?? [];
    const startPresents = replay.startPresents ?? [];
    setTokens(startTokens);
    setStains(startStains);
    setPresents(startPresents);
    void (async () => {
      await runPlayback({
        timeline: replay.timeline,
        startTokens,
        startStains,
        startPresents,
        cancelled: () => watchGen.current !== gen,
        setTokens,
        setStains,
        setPresents,
        setBeams,
        setBumps,
        setFlashIds,
        setShootingIds,
        setStatus,
        carton,
      });
      if (watchGen.current !== gen) return;
      setTokens(tokensFromState(state));
      setStains(state.eggStains ?? []);
      setPresents(state.presents ?? []);
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

  const walkHint = carton.maxPresents > 0 ? PLANNER_HINT_WALK : PLANNER_HINT_WALK_NO_PRESENT;
  const plannerHint = !localAlive
    ? 'You’re scrambled. Watch the rest of the carton.'
    : local?.planSubmitted || localLocked
      ? 'Egged. Waiting on the rest of the carton.'
      : watchingLast
        ? status || 'Watching the last scramble…'
        : !planning
          ? status || 'Watching the carton…'
          : selectedCard?.kind === 'move'
            ? walkHint
            : selectedCard?.kind === 'slap'
              ? 'Tap north, east, south, or west. The slap hits the three squares in that facing. An obstacle in front blocks the sides too. Two damage.'
              : selectedCard?.kind === 'flamethrower'
                ? 'Tap north, east, south, or west. The flame hits two squares ahead, and the sides of the second square. An obstacle in front stops the rest. Two damage.'
                : selectedCard?.kind === 'bomb'
                  ? 'Tap a cell on the line, up to 2 squares. Obstacles don’t stop the throw. The bomb hits that cell and open cardinal neighbors. Two damage.'
                  : selectedCard?.kind === 'shotgun'
                    ? 'Tap a cell on the line, up to 3 squares. Two damage.'
                    : selectedCard?.kind === 'rifle'
                      ? 'Tap a cell on the line you want. Unlimited range, two damage.'
                      : selectedCard?.kind === 'pistol'
                        ? 'Tap a cell on the line, up to 3 squares. One damage. Unlimited ammo.'
                        : carton.maxPresents > 0
                          ? 'Pick Walk, Action, or your spare. Walk onto a present to fill the spare slot.'
                          : 'Pick Walk, Action, or your spare.';

  const showPlanner = state.phase === 'playing';

  return (
    <div className="arena">
      <div className="arena-status-row">
        <p className="arena-kicker">
          {state.phase === 'finished' ? 'All scrambled' : `Round ${state.round} · ${carton.rows}×${carton.cols}`}
        </p>
        <p className="arena-meta-inline">
          {watchingLast
            ? status || `Watching round ${state.lastReplay?.round ?? ''}`
            : planning
              ? `${submittedCount}/${livingCount} scrambled`
              : status || (replayDone ? 'Moves played out' : 'Watching the carton…')}
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
                ? 'cracking'
                : !player.connected
                  ? 'rolled off'
                : player.hp <= 0
                  ? 'fried'
                  : planning && (player.planSubmitted || (player.isYou && localLocked))
                    ? 'scrambled'
                    : planning
                      ? 'thinking'
                      : player.isBot
                        ? 'bot'
                        : ''}
            </span>
          </li>
        ))}
      </ul>

      <div
        className="arena-stage"
        style={
          {
            '--board-rows': carton.rows,
            '--board-cols': carton.cols,
          } as React.CSSProperties
        }
      >
        <PlanTimerBar deadlineAt={planning ? state.planDeadlineAt : null} />
        <div className="arena-board-slot">
          <div className={`arena-board-wrap is-${carton.type}`}>
            <div
              className="arena-board"
              style={{
                gridTemplateColumns: `repeat(${carton.cols}, 1fr)`,
                gridTemplateRows: `repeat(${carton.rows}, 1fr)`,
              }}
            >
          {Array.from({ length: carton.rows * carton.cols }, (_, index) => {
            const row = Math.floor(index / carton.cols);
            const col = index % carton.cols;
            const cell = { row, col };
            const cellKey = `${row},${col}`;
            const walkTone = showPlanOverlay ? walkTones.get(cellKey) : undefined;
            const aimTone = showPlanOverlay ? aimTones.get(cellKey) : undefined;
            const pathIndex = showPlanOverlay ? (beatNumbers.get(cellKey) ?? 0) : 0;
            const isValid =
              validWalk.some((step) => cellsEqual(step, cell)) ||
              validShoot.some((step) => cellsEqual(step, cell));
            const isOrigin = canPlan && cellsEqual(origin, cell);
            const hasBlock = isObjectCell(cell, state.mapObjects);
            const hasPresent = presents.some((present) => cellsEqual(present, cell));
            const occupants = tokens
              .filter((token) => token.row === row && token.col === col)
              .sort((a, b) => a.hp - b.hp);
            const cellStains = stains.filter((stain) => stain.row === row && stain.col === col);
            const beam = beams.find((ray) => ray.cells.some((highlight) => cellsEqual(highlight, cell)));
            const beamShooter = beam
              ? tokens.find((token) => token.id === beam.shooterId)
              : undefined;

            return (
              <button
                key={`${row}-${col}`}
                type="button"
                className={`arena-cell${(row + col) % 2 === 0 ? ' shade' : ''}${
                  col === carton.cols - 1 ? ' is-last-col' : ''
                }${row === carton.rows - 1 ? ' is-last-row' : ''}${
                  walkTone === 'muted' ? ' on-path-muted' : ''
                }${aimTone === 'muted' ? ' on-aim-muted' : ''}${
                  walkTone === 'active' ? ' on-path' : ''
                }${aimTone === 'active' ? ' on-aim' : ''}${
                  isValid ? ' is-valid' : ''
                }${isOrigin ? ' is-origin' : ''}${beam ? ' on-beam' : ''}${
                  hasBlock ? ' has-block' : ''
                }${hasPresent ? ' has-present' : ''}`}
                style={
                  {
                    '--cell-row': row,
                    ...(beamShooter
                      ? { '--beam': playerColor(beamShooter.joinOrder) }
                      : {}),
                  } as React.CSSProperties
                }
                onClick={() => handleCellClick(cell)}
                disabled={!canPlan}
              >
                {pathIndex > 0 && <span className="path-index">{pathIndex}</span>}
                {hasBlock && <BlockMark />}
                {hasPresent && <PresentMark />}
                {cellStains.map((_, stainIndex) => (
                  <EggWhiteBlob key={`stain-${stainIndex}`} index={stainIndex} />
                ))}
                {occupants.map((token) => (
                  <PlayerToken
                    key={token.id}
                    joinOrder={token.joinOrder}
                    name={token.name}
                    isYou={token.isYou}
                    isDown={token.hp <= 0}
                    isHit={flashIds.includes(token.id)}
                    isShooting={shootingIds.includes(token.id)}
                    isHatched={showOutcome && token.id === winnerId}
                    bump={bumps[token.id]}
                    tiltSeed={`${token.id}:${token.row}:${token.col}`}
                    idle={token.hp > 0 && !showOutcome}
                  />
                ))}
              </button>
            );
          })}
            </div>
          </div>
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
                <FitText>{formatAction(resolvedDraft[index])}</FitText>
              </button>
            ))}
          </div>

          <div className="hand-row">
            {(['move', 'pistol', 'spare'] as const).map((slotKind) => {
              const card =
                slotKind === 'move'
                  ? local?.hand.find((entry) => entry.kind === 'move')
                  : slotKind === 'pistol'
                    ? local?.hand.find((entry) => entry.kind === 'pistol')
                    : local?.hand.find((entry) => entry.kind !== 'move' && entry.kind !== 'pistol');
              const label = slotKind === 'move' ? 'Move' : 'Action';
              if (!card) {
                return (
                  <button
                    key={slotKind}
                    type="button"
                    className="plan-card is-empty"
                    disabled
                  >
                    <span className="plan-card-label">{label}</span>
                    <FitText>Empty</FitText>
                  </button>
                );
              }
              const other = slot === 0 ? 1 : 0;
              const usedElsewhere = !isReusableCard(card) && slotCards[other] === card.id;
              const selected = slotCards[slot] === card.id;
              const title = card.kind === 'move' ? 'Walk' : formatWeapon(card.kind);
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
                  <FitText>{title}</FitText>
                </button>
              );
            })}
          </div>

          <div className="arena-hint-box">
            <p className="arena-hint is-sizer" aria-hidden="true">
              {PLANNER_HINT_SIZER}
            </p>
            <p className="arena-hint">{plannerHint}</p>
          </div>

          <div className="planner-actions">
            <div className="planner-tools">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canPlan}
                onClick={resetAction}
              >
                Re-lay
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canReplayLast}
                onClick={watchLastTurn}
              >
                Rewatch
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canPlan || !legalPlan}
              onClick={lockIn}
            >
              Scramble
            </button>
          </div>
        </div>
      )}

      {showOutcome && (
        <div className="arena-outcome">
          <p className="arena-kicker">
            {state.outcome.kind === 'winner'
              ? `${winner?.name ?? 'Someone'} Hatched`
              : 'Double yolk'}
          </p>
          <p className="arena-copy">
            {state.outcome.kind === 'winner'
              ? `${winner?.hp ?? 0} HP Left`
              : 'Last eggs cracked on the same beat.'}
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
            Rewatch
          </button>
          <button type="button" className="btn btn-primary" onClick={onReturnToLobby}>
            Back to the Nest
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
            Rewatch
          </button>
          <p className="arena-copy">The host is calling everyone back to the nest.</p>
        </div>
      )}
    </div>
  );
}

function PresentMark() {
  return (
    <span className="arena-present" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <rect
          x="6"
          y="13"
          width="20"
          height="14"
          rx="2"
          fill="#f6c7d4"
          stroke="#111"
          strokeWidth="2.2"
        />
        <rect x="14.4" y="13" width="3.2" height="14" fill="#c5e4ea" stroke="#111" strokeWidth="1.4" />
        <rect
          x="6"
          y="10"
          width="20"
          height="5"
          rx="1.5"
          fill="#d4ead0"
          stroke="#111"
          strokeWidth="2.2"
        />
        <path
          d="M16 10 C16 6.5 12.5 6.2 11.4 8.6 C10.6 10.2 13.4 11.2 16 10 C16 6.5 19.5 6.2 20.6 8.6 C21.4 10.2 18.6 11.2 16 10 Z"
          fill="#f6e7b4"
          stroke="#111"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function BlockMark() {
  return (
    <span className="arena-block" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path
          d="M8.2 18.6 C5.4 16.1 5.8 10.4 9.6 7.8 C12.2 6 15.1 5.4 18.4 6.2 C22.8 7.3 26.4 10.8 25.9 15.1 C25.6 18.4 23.8 21.2 20.6 23 C16.8 25.1 11.8 24.2 8.8 21.4 C7.8 20.5 8.2 19.4 8.2 18.6 Z"
          fill="#8b8174"
          stroke="#111"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path
          d="M10.4 11.2 C12.6 8.6 16.8 8.1 19.6 10.4 C20.4 11.1 19.2 12.2 18.1 11.6 C16 10.4 13.4 10.8 11.6 12.4 C10.8 13.1 9.8 12.1 10.4 11.2 Z"
          fill="#c4b9ab"
          opacity="0.55"
        />
        <path
          d="M12.2 16.8 C13.1 15.4 15.4 15.8 15.8 17.4 C16.1 18.4 14.8 19.1 14 18.4 C13.2 17.8 12.6 17.6 12.2 16.8 Z"
          fill="#6f675c"
          opacity="0.45"
        />
        <path
          d="M19.8 17.2 C21.4 16.4 22.8 17.8 21.6 19.2 C20.8 20.1 19.2 19.6 19.8 17.2 Z"
          fill="#6f675c"
          opacity="0.35"
        />
        <path
          d="M13.6 20.2 C14.8 19.8 16.4 20.6 16.1 21.8"
          fill="none"
          stroke="#111"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.35"
        />
      </svg>
    </span>
  );
}
