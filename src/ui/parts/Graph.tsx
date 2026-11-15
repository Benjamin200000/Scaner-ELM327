import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Series } from '@/state/store';
import { paramById } from '@/core/obd2/pids';

/**
 * Gráfico en vivo.
 *
 * uPlot y no una librería de componentes: dibuja sobre canvas y sostiene
 * actualizaciones a varios hercios sin que el hilo principal se note. Con
 * SVG y re-render de React por punto, la interfaz se arrastra justo cuando
 * más importa, que es mirando una aceleración.
 *
 * Soporta comparar varios parámetros en el mismo eje, que es el caso que
 * pidió la especificación: boost solicitado contra boost real.
 */

const PALETTE = ['#5aa9d6', '#d6a35a', '#7fc08a', '#c87f7f', '#a68fc0'];

export function Graph({ paramIds, series, height = 180 }: {
  paramIds: string[];
  series: Map<string, Series>;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const width = useRef(0);

  // Reconstruir solo cuando cambia el conjunto de parámetros.
  const key = paramIds.join(',');

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    width.current = el.clientWidth || 600;
    const opts: uPlot.Options = {
      width: width.current,
      height,
      padding: [8, 8, 0, 0],
      cursor: { drag: { x: true, y: false }, points: { size: 5 } },
      legend: { show: false },
      axes: [
        {
          stroke: '#6b747d',
          grid: { stroke: '#1f2429', width: 1 },
          ticks: { stroke: '#262b32' },
          font: '10px ui-monospace, monospace',
          values: (_u, vals) => vals.map((v) => `${Math.round(v)}s`),
        },
        {
          stroke: '#6b747d',
          grid: { stroke: '#1f2429', width: 1 },
          ticks: { stroke: '#262b32' },
          font: '10px ui-monospace, monospace',
          size: 46,
        },
      ],
      scales: { x: { time: false } },
      series: [
        {},
        ...paramIds.map((id, i) => ({
          label: paramById(id)?.label ?? id,
          stroke: PALETTE[i % PALETTE.length] ?? '#8a939c',
          width: 1.5,
          spanGaps: false,
        })),
      ],
    };

    plot.current = new uPlot(opts, [[0], ...paramIds.map(() => [null as number | null])], el);

    const onResize = (): void => {
      const w = el.clientWidth;
      if (w > 0 && Math.abs(w - width.current) > 4) {
        width.current = w;
        plot.current?.setSize({ width: w, height });
      }
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);

    return () => {
      observer.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [key, height, paramIds]);

  // Alimentar datos sin recrear el gráfico.
  useEffect(() => {
    const p = plot.current;
    if (!p) return;

    // Eje de tiempo común: el del parámetro con más muestras.
    const base = paramIds
      .map((id) => series.get(id))
      .filter((s): s is Series => s !== undefined)
      .reduce<Series | null>((a, b) => (a === null || b.t.length > a.t.length ? b : a), null);

    if (!base || base.t.length === 0) return;
    const t0 = base.t[0] ?? 0;
    const x = base.t.map((t) => t - t0);

    const columns = paramIds.map((id) => {
      const s = series.get(id);
      if (!s) return x.map(() => null);
      // Alinear por índice desde el final: todas las series crecen juntas.
      const offset = x.length - s.v.length;
      return x.map((_, i) => (i - offset >= 0 ? s.v[i - offset] ?? null : null));
    });

    p.setData([x, ...columns] as uPlot.AlignedData);
  }, [series, paramIds]);

  return (
    <div>
      <div ref={host} style={{ width: '100%' }} />
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 12,
          padding: '6px 10px 8px', borderTop: '1px solid var(--color-line-soft)',
        }}
      >
        {paramIds.map((id, i) => {
          const def = paramById(id);
          const last = series.get(id)?.v.at(-1);
          return (
            <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden
                style={{
                  width: 10, height: 2,
                  background: PALETTE[i % PALETTE.length] ?? '#8a939c',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--color-ink-dim)' }}>
                {def?.label ?? id}
              </span>
              <span className="num" style={{ fontSize: 11.5 }}>
                {last === null || last === undefined
                  ? '—'
                  : `${last.toFixed(def?.decimals ?? 1)} ${def?.unit ?? ''}`}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
