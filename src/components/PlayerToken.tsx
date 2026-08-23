import { PLAYER_HUES } from '../types/game';

interface PlayerTokenProps {
  joinOrder: number;
  name: string;
  isYou?: boolean;
  isDown?: boolean;
  isHit?: boolean;
  isShooting?: boolean;
}

function Face({ isDown, isHit }: { isDown?: boolean; isHit?: boolean }) {
  if (isDown) {
    return (
      <>
        <path d="M14 16 L18 20 M18 16 L14 20" />
        <path d="M22 16 L26 20 M26 16 L22 20" />
        <path d="M16 26 Q20 23 24 26" />
      </>
    );
  }
  if (isHit) {
    return (
      <>
        <circle cx="16" cy="18" r="1.6" fill="currentColor" />
        <circle cx="24" cy="18" r="1.6" fill="currentColor" />
        <path d="M16 26 Q20 22 24 26" />
      </>
    );
  }
  return (
    <>
      <circle cx="16" cy="18" r="1.6" fill="currentColor" />
      <circle cx="24" cy="18" r="1.6" fill="currentColor" />
      <path d="M16 25 Q20 28 24 25" />
    </>
  );
}

function Body() {
  return <circle cx="20" cy="20" r="13" />;
}

export function PlayerToken({
  joinOrder,
  name,
  isYou,
  isDown,
  isHit,
  isShooting,
}: PlayerTokenProps) {
  return (
    <span
      className={`arena-token${isYou ? ' is-you' : ''}${isDown ? ' is-down' : ''}${
        isHit ? ' is-hit' : ''
      }${isShooting ? ' is-shooting' : ''}`}
      title={isShooting ? `${name} shooting` : name}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <g
          fill={PLAYER_HUES[joinOrder % PLAYER_HUES.length]}
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinejoin="round"
        >
          <Body />
        </g>
        <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <Face isDown={isDown} isHit={isHit} />
        </g>
      </svg>
      {isShooting && <span className="arena-token-callout">{name}</span>}
    </span>
  );
}
