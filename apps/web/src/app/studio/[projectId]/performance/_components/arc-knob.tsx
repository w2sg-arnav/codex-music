"use client";

type ArcKnobProps = {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
  valueFormatter?: (value: number) => string;
};

export function ArcKnob({
  label,
  max,
  min,
  onChange,
  value,
  valueFormatter,
}: ArcKnobProps) {
  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const startAngle = 135;
  const endAngle = 405;
  const angle = startAngle + normalized * (endAngle - startAngle);
  const radius = 40;
  const center = 56;

  function polarToCartesian(degrees: number) {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(radians),
      y: center + radius * Math.sin(radians),
    };
  }

  const start = polarToCartesian(startAngle);
  const finish = polarToCartesian(endAngle);
  const indicator = polarToCartesian(angle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  const arcPath = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${finish.x} ${finish.y}`;

  return (
    <label className="group relative flex flex-col items-center rounded-[1.5rem] border border-stone-200 bg-stone-50 px-4 py-5 text-center text-stone-900 transition hover:border-stone-300">
      <span className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{label}</span>
      <div className="relative mt-3 h-28 w-28">
        <svg viewBox="0 0 112 112" className="h-full w-full">
          <path d={arcPath} fill="none" stroke="rgb(214 211 209)" strokeWidth="10" strokeLinecap="round" />
          <line
            x1={center}
            y1={center}
            x2={indicator.x}
            y2={indicator.y}
            stroke="rgb(24 24 27)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx={center} cy={center} r="9" fill="rgb(24 24 27)" />
        </svg>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <span className="mt-2 text-lg font-semibold tracking-[-0.04em] text-stone-950">
        {valueFormatter ? valueFormatter(value) : value}
      </span>
    </label>
  );
}
