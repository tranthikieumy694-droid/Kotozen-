import React from 'react';
import type { PitchAccent } from '../types';

interface PitchAccentSvgProps {
  pitchAccent: PitchAccent;
}

export const PitchAccentSvg: React.FC<PitchAccentSvgProps> = ({ pitchAccent }) => {
  const { morae, patternName, downstep } = pitchAccent;
  if (!morae || morae.length === 0) return null;

  const stepX = 34;
  const padX = 18;
  const highY = 14;
  const lowY = 34;
  const totalNodes = morae.length + 1; // +1 for following particle pitch preview
  const width = padX * 2 + (totalNodes - 1) * stepX;

  // Determine particle pitch after the word (drops to L if downstep > 0, stays H if Heiban [0])
  const lastMora = morae[morae.length - 1];
  const particlePitch: 'L' | 'H' =
    downstep === 0 ? 'H' : lastMora.drop || downstep === morae.length ? 'L' : lastMora.pitch;

  const points = [
    ...morae.map((m, idx) => ({
      x: padX + idx * stepX,
      y: m.pitch === 'H' ? highY : lowY,
      text: m.text,
      drop: Boolean(m.drop),
      isParticle: false,
    })),
    {
      x: padX + morae.length * stepX,
      y: particlePitch === 'H' ? highY : lowY,
      text: 'が',
      drop: false,
      isParticle: true,
    },
  ];

  const polylineStr = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-700 dark:text-slate-300">
          Pitch Accent Tokyo (NHK)
        </span>
        <span className="font-mono-tabular text-indigo-700 dark:text-indigo-300 font-medium">
          {patternName} · [{downstep}]
        </span>
      </div>

      <div className="overflow-x-auto pb-1">
        <svg
          width={width}
          height={64}
          viewBox={`0 0 ${width} 64`}
          className="block"
          role="img"
          aria-label={`Đường cao độ Pitch Accent ${patternName}`}
        >
          {/* Reference pitch rails */}
          <line
            x1={8}
            y1={highY}
            x2={width - 8}
            y2={highY}
            stroke="currentColor"
            strokeOpacity={0.1}
            strokeDasharray="2 3"
          />
          <line
            x1={8}
            y1={lowY}
            x2={width - 8}
            y2={lowY}
            stroke="currentColor"
            strokeOpacity={0.1}
            strokeDasharray="2 3"
          />

          {/* Pitch contour line */}
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-indigo-600 dark:text-indigo-400"
            points={polylineStr}
          />

          {/* Nodes & mora labels */}
          {points.map((pt, i) => (
            <g key={i}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={pt.isParticle ? 3.5 : 4.5}
                className={
                  pt.isParticle
                    ? 'fill-white dark:fill-slate-900 stroke-slate-400 dark:stroke-slate-500'
                    : pt.drop
                      ? 'fill-rose-500 stroke-white dark:stroke-slate-900'
                      : 'fill-indigo-600 dark:fill-indigo-400 stroke-white dark:stroke-slate-900'
                }
                strokeWidth={1.75}
              />
              {pt.drop && (
                <text
                  x={pt.x + 11}
                  y={pt.y - 3}
                  className="fill-rose-500 text-[10px] font-bold"
                >
                  ↘
                </text>
              )}
              <text
                x={pt.x}
                y={56}
                textAnchor="middle"
                className={`font-jp text-[12px] ${
                  pt.isParticle
                    ? 'fill-slate-400 dark:fill-slate-500'
                    : 'fill-slate-800 dark:fill-slate-200 font-medium'
                }`}
              >
                {pt.text}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
};
