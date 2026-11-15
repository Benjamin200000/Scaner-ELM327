import type { EvaluatedParam } from '@/core/engine/evaluate';
import { formatValue } from '@/core/engine/evaluate';
import type { Series } from '@/state/store';
import { StatusChip } from './Status';

/**
 * Indicadores grandes con su tendencia.
 *
 * Son los valores que se miran con el capó abierto y a un metro de la
 * pantalla, así que el número manda. La línea de abajo muestra el último
 * minuto: un valor estable y uno que viene cayendo dicen cosas distintas
 * aunque el número de ahora sea el mismo.
 */

/** Orden de preferencia: se muestran los primeros que la ECU soporte. */
const PREFERIDOS = [
  'rpm', 'coolant', 'module_voltage', 'load', 'boost_actual', 'rail_pressure',
  'maf', 'map', 'ltft1', 'stft1', 'dpf_delta', 'speed', 'iat', 'throttle',
];

export function LiveTiles({ evaluated, series, max = 6 }: {
  evaluated: EvaluatedParam[];
  series: Map<string, Series>;
  max?: number;
}) {
  const porId = new Map(evaluated.map((e) => [e.id, e]));
  const visibles = PREFERIDOS
    .map((id) => porId.get(id))
    .filter((e): e is EvaluatedParam => e !== undefined && e.value !== null)
    .slice(0, max);

  if (visibles.length === 0) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
        Esperando las primeras lecturas…
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 50%), 1fr))',
    }}>
      {visibles.map((e) => (
        <div key={e.id} className="tile">
          <div className="label" style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {e.def.label}
          </div>
          <div className="num tile-valor">
            {formatValue(e)}
            <span className="tile-unidad">{e.def.unit}</span>
          </div>
          <Spark serie={series.get(e.id)} />
          <StatusChip status={e.status} />
        </div>
      ))}
    </div>
  );
}

function Spark({ serie }: { serie: Series | undefined }) {
  const valores = (serie?.v ?? []).filter((v): v is number => v !== null).slice(-60);
  if (valores.length < 2) return <svg className="spark" aria-hidden />;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;
  const puntos = valores
    .map((v, i) => `${(i / (valores.length - 1)) * 100},${20 - ((v - min) / rango) * 18}`)
    .join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden>
      <polyline points={puntos} fill="none" stroke="var(--color-info)"
        strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
