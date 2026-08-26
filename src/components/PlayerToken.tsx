import type { CSSProperties } from 'react';
import { PLAYER_HUES } from '../types/game';

interface PlayerTokenProps {
  joinOrder: number;
  name: string;
  isYou?: boolean;
  isDown?: boolean;
  isHit?: boolean;
  isShooting?: boolean;
  isHatched?: boolean;
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

function Chick({ hue }: { hue: string }) {
  return (
    <svg viewBox="0 0 120 150" aria-hidden="true">
      <ellipse className="chick-shadow" cx="60" cy="140" rx="28" ry="5" fill="#111" opacity="0.18" />
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
  isHatched,
  bump,
  tiltSeed,
}: PlayerTokenProps) {
  const hue = PLAYER_HUES[joinOrder % PLAYER_HUES.length];
  const tilt = tiltSeed ? eggTiltDeg(tiltSeed) : 0;

  return (
    <span
      className={`arena-token${isYou ? ' is-you' : ''}${isDown ? ' is-down' : ''}${
        isHit ? ' is-hit' : ''
      }${isShooting ? ' is-shooting' : ''}${isHatched ? ' is-hatched' : ''}${
        bump ? ' is-bump' : ''
      }`}
      style={
        {
          '--bump-dr': bump?.dr ?? 0,
          '--bump-dc': bump?.dc ?? 0,
          '--egg-tilt': `${tilt}deg`,
        } as CSSProperties
      }
      title={
        isHatched
          ? `${name} hatched`
          : isDown
            ? `${name} fried`
            : isShooting
              ? `${name} shooting`
              : name
      }
    >
      {isHatched ? (
        <Chick hue={hue} />
      ) : isDown ? (
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
