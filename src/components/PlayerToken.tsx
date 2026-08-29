import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PLAYER_HUES } from '../types/game';

interface PlayerTokenProps {
  joinOrder: number;
  name: string;
  isYou?: boolean;
  isDown?: boolean;
  isSteppedOn?: boolean;
  isHit?: boolean;
  isShooting?: boolean;
  isHatched?: boolean;
  bump?: { dr: number; dc: number };
  tiltSeed?: string;
  idle?: boolean;
}

const IDLE_MIN_MS = 5000;
const IDLE_SPAN_MS = 5000;

function idlePeriodMs(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return IDLE_MIN_MS + (Math.abs(hash) % (IDLE_SPAN_MS + 1));
}

function eggTiltDeg(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 21) - 10;
}

function Chick({ hue }: { hue: string }) {
  return (
    <svg viewBox="0 0 120 150" aria-hidden="true">
      <g className="chick-body">
        <ellipse
          cx="60"
          cy="98"
          rx="36"
          ry="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="22"
          strokeLinejoin="round"
        />
        <ellipse cx="60" cy="98" rx="36" ry="40" fill="#ffe066" />
        <ellipse cx="60" cy="98" rx="36" ry="40" fill={hue} opacity="0.35" />
        <circle
          cx="60"
          cy="50"
          r="26"
          fill="none"
          stroke="currentColor"
          strokeWidth="22"
          strokeLinejoin="round"
        />
        <circle cx="60" cy="50" r="26" fill="#ffe066" />
        <circle cx="60" cy="50" r="26" fill={hue} opacity="0.28" />
        <path
          d="M60 58 L50 70 L70 70 Z"
          fill="#f0b429"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
          <circle cx="50" cy="46" r="4.5" fill="currentColor" />
          <circle cx="70" cy="46" r="4.5" fill="currentColor" />
          <path d="M46 132 L40 144 M46 132 L52 144" />
          <path d="M74 132 L68 144 M74 132 L80 144" />
        </g>
        <g className="chick-wing chick-wing-l">
          <ellipse
            cx="38"
            cy="92"
            rx="12"
            ry="18"
            fill="#ffe066"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinejoin="round"
          />
        </g>
        <g className="chick-wing chick-wing-r">
          <ellipse
            cx="82"
            cy="92"
            rx="12"
            ry="18"
            fill="#ffe066"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}

function FriedEgg({ hue, stepped }: { hue: string; stepped?: boolean }) {
  const whitePath = stepped
    ? 'M18 86 C10 72 32 60 54 66 C68 52 102 54 116 70 C130 74 132 94 118 104 C122 118 92 126 66 118 C42 128 12 118 16 102 C8 94 12 86 18 86 Z'
    : 'M28 70 C22 52 38 40 54 44 C62 28 90 32 98 52 C112 56 118 78 106 96 C110 118 84 128 64 122 C42 132 18 118 22 98 C12 88 18 76 28 70 Z';
  const yolkPath =
    'M46 92 C44 78 60 70 74 78 C90 72 108 84 100 96 C110 108 92 118 74 112 C56 120 38 108 46 92 Z';
  const splatPath = 'M104 108 C102 98 116 96 122 104 C128 114 112 120 104 108 Z';

  return (
    <svg viewBox={stepped ? '4 48 128 86' : '16 36 96 96'} aria-hidden="true">
      {stepped && (
        <>
          <path
            d={splatPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="14"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path d={splatPath} fill="#fffdf6" />
        </>
      )}
      <path
        d={whitePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={stepped ? 18 : 16}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d={whitePath} fill="#fffdf6" />
      {stepped ? (
        <>
          <g transform="translate(72 94) scale(1.14) translate(-72 -94)">
            <path d={yolkPath} fill={hue} opacity="0.38" />
          </g>
          <path
            d={yolkPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="11"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path d={yolkPath} fill="#f0b429" />
          <ellipse cx="58" cy="88" rx="9" ry="6" fill="#fff" opacity="0.4" />
        </>
      ) : (
        <>
          <circle cx="62" cy="82" r="26" fill={hue} opacity="0.45" />
          <circle cx="62" cy="82" r="22" fill="#f0b429" stroke="currentColor" strokeWidth="5" />
          <ellipse cx="54" cy="74" rx="7" ry="5" fill="#fff" opacity="0.45" />
        </>
      )}
    </svg>
  );
}

export function PlayerToken({
  joinOrder,
  name,
  isYou,
  isDown,
  isSteppedOn,
  isHit,
  isShooting,
  isHatched,
  bump,
  tiltSeed,
  idle,
}: PlayerTokenProps) {
  const hue = PLAYER_HUES[joinOrder % PLAYER_HUES.length];
  const [idlePose, setIdlePose] = useState(0);
  const [idleSnap, setIdleSnap] = useState(false);
  const firstWait = useRef(true);
  const [poseSeed, setPoseSeed] = useState(tiltSeed);
  if (tiltSeed !== poseSeed) {
    setPoseSeed(tiltSeed);
    setIdlePose(0);
    setIdleSnap(false);
    firstWait.current = true;
  }

  const baseSeed = tiltSeed ?? `${joinOrder}:${name}`;
  const rawTilt = eggTiltDeg(idlePose > 0 ? `${baseSeed}:idle:${idlePose}` : baseSeed);
  const tilt = isDown && isSteppedOn ? Math.round(rawTilt * 0.35) : rawTilt;

  useEffect(() => {
    if (!idleSnap) return;
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setIdleSnap(false));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [idleSnap]);

  useEffect(() => {
    const canIdle = idle && !isDown && !isHatched && !isHit && !isShooting;
    if (!canIdle) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const wait = firstWait.current
      ? idlePeriodMs(`${baseSeed}:start`)
      : idlePeriodMs(`${baseSeed}:${idlePose}`);
    firstWait.current = false;
    const timeout = window.setTimeout(() => {
      setIdleSnap(true);
      setIdlePose((pose) => pose + 1);
    }, wait);
    return () => window.clearTimeout(timeout);
  }, [idle, isDown, isHatched, isHit, isShooting, baseSeed, idlePose]);

  return (
    <span
      className={`arena-token${isYou ? ' is-you' : ''}${isDown ? ' is-down' : ''}${
        isDown && isSteppedOn ? ' is-stepped' : ''
      }${isHit ? ' is-hit' : ''}${isShooting ? ' is-shooting' : ''}${
        isHatched ? ' is-hatched' : ''
      }${bump ? ' is-bump' : ''}${idleSnap ? ' is-idle-snap' : ''}`}
      style={
        {
          '--bump-dr': bump?.dr ?? 0,
          '--bump-dc': bump?.dc ?? 0,
          '--egg-tilt': `${tilt}deg`,
          '--egg-plane': joinOrder + 1,
        } as CSSProperties
      }
      title={
        isHatched
          ? `${name} hatched`
          : isDown
            ? `${name} fried${isSteppedOn ? ' and stepped on' : ''}`
          : isShooting
              ? `${name} shooting`
              : name
      }
    >
      {isHatched ? (
        <Chick hue={hue} />
      ) : isDown ? (
        <FriedEgg hue={hue} stepped={isSteppedOn} />
      ) : (
        <svg viewBox="0 0 120 150" aria-hidden="true">
          <path
            d="M60 8 C86 8 108 52 108 92 C108 124 86 142 60 142 C34 142 12 124 12 92 C12 52 34 8 60 8 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="24"
            strokeLinejoin="round"
          />
          <path
            d="M60 8 C86 8 108 52 108 92 C108 124 86 142 60 142 C34 142 12 124 12 92 C12 52 34 8 60 8 Z"
            fill={hue}
          />
          <ellipse cx="46" cy="52" rx="16" ry="22" fill="#fff" opacity="0.38" />
        </svg>
      )}
      {isShooting && !isDown && <span className="arena-token-callout">{name}</span>}
    </span>
  );
}
