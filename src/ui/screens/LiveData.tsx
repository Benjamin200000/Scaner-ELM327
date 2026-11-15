import { useMemo, useState } from 'react';
import { useApp } from '@/state/store';
import { PARAM_INDEX } from '@/core/obd2/pids';
import { paramsOfSystem } from '@/core/engine/systems';
import { Button, Panel } from '../parts/Panel';
import { ParamRow } from '../parts/ParamRow';
import { Graph } from '../parts/Graph';

/**
 * Datos en vivo, agrupados por sistema.
 *
 * Solo se muestran los sistemas que esta ECU soporta, y dentro de cada uno
 * solo sus parámetros. Un gasolina no ve una pestaña de DPF vacía.
 *
 * El gráfico permite superponer parámetros, que es lo que hace útil la
 * comparación solicitado contra real: con boost, presión de riel o EGR, la
 * desviación entre los dos se ve de inmediato y en un número suelto no.
 */
export function LiveData() {
  const { info, evaluated, systems, series, paused, setPaused, mode } = useApp();
  const [active, setActive] = useState<string | null>(null);
  const [plotted, setPlotted] = useState<string[]>([]);

  const sys = systems();
  const current = active ?? sys[0]?.id ?? null;
  const evs = evaluated();

  const rows = useMemo(() => {
    if (current === null || !info) return [];
    const ids = paramsOfSystem(current as never);
    return evs
      .filter((e) => ids.includes(e.id))
      .sort((a, b) => a.def.label.localeCompare(b.def.label, 'es'));
  }, [current, evs, info]);

  const toggle = (id: string): void => {
    setPlotted((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id)
        : prev.length >= 4 ? [...prev.slice(1), id]
        : [...prev, id],
    );
  };

  if (!info) return null;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {sys.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            style={{
              padding: '5px 11px',
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              borderRadius: 3,
              border: '1px solid',
              borderColor: current === s.id ? '#2d5a76' : 'var(--color-line)',
              background: current === s.id ? '#1d3a4d' : 'var(--color-panel)',
              color: current === s.id ? '#cfe6f5' : 'var(--color-ink-dim)',
            }}
          >
            {s.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          <Button variant={paused ? 'primary' : 'normal'} onClick={() => setPaused(!paused)}>
            {paused ? 'Continuar' : 'Pausar'}
          </Button>
        </span>
      </div>

      {plotted.length > 0 && (
        <Panel
          title={plotted.length > 1 ? 'Comparación' : 'Gráfico'}
          aside={
            <button
              className="label"
              onClick={() => setPlotted([])}
              style={{ background: 'none', border: 0, color: 'var(--color-info)' }}
            >
              Limpiar
            </button>
          }
        >
          <Graph paramIds={plotted} series={series} height={190} />
        </Panel>
      )}

      <Panel
        title={sys.find((s) => s.id === current)?.label ?? 'Parámetros'}
        aside={
          <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
            {rows.length} parámetros · toque para graficar
          </span>
        }
      >
        {rows.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
            Este sistema no tiene parámetros legibles en esta ECU.
          </div>
        )}
        {rows.map((p) => (
          <div
            key={p.id}
            onClick={() => toggle(p.id)}
            style={{
              cursor: 'pointer',
              background: plotted.includes(p.id) ? 'var(--color-panel-alt)' : undefined,
              borderLeft: plotted.includes(p.id)
                ? '2px solid var(--color-info)' : '2px solid transparent',
            }}
          >
            <ParamRow
              param={p}
              mode={mode}
              {...(PARAM_INDEX.get(p.id)?.pid.pid !== undefined
                ? { pid: PARAM_INDEX.get(p.id)!.pid.pid }
                : {})}
            />
          </div>
        ))}
      </Panel>
    </div>
  );
}
