import type { CSSProperties } from 'react';
import { PLAYER_HUES } from '../types/game';

interface PlayerTokenProps {
  joinOrder: number;
  name: string;
  isYou?: boolean;
  isDown?: boolean;
  isHit?: boolean;
  isShooting?: boolean;
  bump?: { dr: number; dc: number };
  tiltSeed?: string;
}

function eggTiltDeg(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 21) - 10;
}

function Face({ isHit }: { isHit?: boolean }) {
  if (isHit) {
    return (
      <>
        <circle cx="48" cy="74" r="4.5" fill="currentColor" />
        <circle cx="72" cy="74" r="4.5" fill="currentColor" />
        <path d="M50 100 Q60 90 70 100" />
      </>
    );
  }
  return (
    <>
      <circle cx="48" cy="74" r="4.5" fill="currentColor" />
      <circle cx="72" cy="74" r="4.5" fill="currentColor" />
      <path d="M50 96 Q60 108 70 96" />
    </>
  );
}

function FriedEgg({ hue }: { hue: string }) {
  const whitePath =
    'M28 70 C22 52 38 40 54 44 C62 28 90 32 98 52 C112 56 118 78 106 96 C110 118 84 128 64 122 C42 132 18 118 22 98 C12 88 18 76 28 70 Z';

  return (
    <svg viewBox="16 36 96 96" aria-hidden="true">
      <path
        d={whitePath}
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinejoin="round"
      />
      <path d={whitePath} fill="#fffdf6" />
      <circle cx="62" cy="82" r="26" fill={hue} opacity="0.45" />
      <circle cx="62" cy="82" r="22" fill="#f0b429" stroke="currentColor" strokeWidth="5" />
      <ellipse cx="54" cy="74" rx="7" ry="5" fill="#fff" opacity="0.45" />
    </svg>
  );
}

export function PlayerToken({
  joinOrder,
  name,
  isYou,
  isDown,
  isHit,
  isShooting,
  bump,
  tiltSeed,
}: PlayerTokenProps) {
  const hue = PLAYER_HUES[joinOrder % PLAYER_HUES.length];
  const tilt = tiltSeed ? eggTiltDeg(tiltSeed) : 0;

  return (
    <span
      className={`arena-token${isYou ? ' is-you' : ''}${isDown ? ' is-down' : ''}${
        isHit ? ' is-hit' : ''
      }${isShooting ? ' is-shooting' : ''}${bump ? ' is-bump' : ''}`}
      style={
        {
          '--bump-dr': bump?.dr ?? 0,
          '--bump-dc': bump?.dc ?? 0,
          '--egg-tilt': `${tilt}deg`,
        } as CSSProperties
      }
      title={isDown ? `${name} fried` : isShooting ? `${name} shooting` : name}
    >
      {isDown ? (
        <FriedEgg hue={hue} />
      ) : (
        <svg viewBox="0 0 120 150" aria-hidden="true">
          <ellipse cx="60" cy="140" rx="30" ry="6" fill="#111" opacity="0.18" />
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
          <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
            <Face isHit={isHit} />
          </g>
        </svg>
      )}
      {isShooting && !isDown && <span className="arena-token-callout">{name}</span>}
    </span>
  );
}
