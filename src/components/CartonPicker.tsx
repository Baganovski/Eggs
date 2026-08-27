import { CARTON_SPECS, cartonFitsPlayerCount, cartonNeedsLabel, cartonSpec, type CartonType } from '../types/game';

interface CartonPickerProps {
  value: CartonType;
  playerCount: number;
  isHost: boolean;
  onChange: (cartonType: CartonType) => void;
}

const CARTON_COPY: Record<CartonType, { title: string; size: string }> = {
  halfDozen: {
    title: 'Half dozen',
    size: '2×3',
  },
  full: {
    title: 'Full carton',
    size: '7×7',
  },
};

function MiniCarton({ type }: { type: CartonType }) {
  const spec = CARTON_SPECS[type];
  const cell = 8;
  const gap = 1.6;
  const pad = 3.5;
  const width = pad * 2 + spec.cols * cell + (spec.cols - 1) * gap;
  const height = pad * 2 + spec.rows * cell + (spec.rows - 1) * gap;

  return (
    <svg className="carton-mini" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <rect
        x="1.2"
        y="1.2"
        width={width - 2.4}
        height={height - 2.4}
        rx="4"
        fill="#fffdf8"
        stroke="#111"
        strokeWidth="2.4"
      />
      {Array.from({ length: spec.rows * spec.cols }, (_, index) => {
        const row = Math.floor(index / spec.cols);
        const col = index % spec.cols;
        const x = pad + col * (cell + gap);
        const y = pad + row * (cell + gap);
        return (
          <rect
            key={`${row}-${col}`}
            x={x}
            y={y}
            width={cell}
            height={cell}
            rx="1.6"
            fill={(row + col) % 2 === 0 ? '#e8d7c0' : '#f6f0e4'}
            stroke="#111"
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

export function CartonPicker({ value, playerCount, isHost, onChange }: CartonPickerProps) {
  const selected = cartonSpec(value);

  return (
    <fieldset className="carton-picker">
      <legend className="carton-picker-label">Carton type</legend>
      <div className="carton-options">
        {(Object.keys(CARTON_SPECS) as CartonType[]).map((type) => {
          const copy = CARTON_COPY[type];
          const fitsCount = cartonFitsPlayerCount(type, playerCount);
          const selectedHere = selected.type === type;
          const disabled = !isHost || !fitsCount;
          return (
            <button
              key={type}
              type="button"
              className={`carton-option${selectedHere ? ' is-selected' : ''}`}
              aria-pressed={selectedHere}
              disabled={disabled}
              onClick={() => {
                if (!isHost || !fitsCount || selectedHere) return;
                onChange(type);
              }}
            >
              <span className="carton-mini-wrap">
                <MiniCarton type={type} />
              </span>
              <span className="carton-option-size">{copy.size}</span>
              <span className="carton-option-title">{copy.title}</span>
              <span className="carton-option-meta">{cartonNeedsLabel(type)}</span>
            </button>
          );
        })}
      </div>
      {!isHost && <p className="carton-picker-note">The host picks the carton.</p>}
    </fieldset>
  );
}
