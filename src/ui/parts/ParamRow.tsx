import type { EvaluatedParam } from '@/core/engine/evaluate';
import { formatRange, formatValue } from '@/core/engine/evaluate';
import { StatusChip } from './Status';

/**
 * Una fila de parámetro.
 *
 * El valor es lo más grande de la fila: tiene que leerse desde un metro de
 * distancia, con el capó abierto. La etiqueta, el rango y la procedencia
 * quedan en segundo plano, y el detalle técnico (PID, bytes crudos) solo
 * aparece en modo técnico.
 */
export function ParamRow({ param, mode, pid }: {
  param: EvaluatedParam;
  mode: 'simple' | 'tecnico';
  pid?: number;
}) {
  const range = formatRange(param.range);
  const dim = param.status === 'no-compatible' || param.status === 'no-disponible';

  return (
    <div
      className="row"
      style={{ gridTemplateColumns: 'minmax(0,1fr) auto', opacity: dim ? 0.55 : 1 }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--color-ink)' }}>
          {param.def.label}
          {!param.def.verified && mode === 'tecnico' && (
            <span
              className="label"
              style={{ marginLeft: 6, color: 'var(--color-warn)' }}
              title="La escala de este parámetro no está verificada contra norma ni contra un vehículo real"
            >
              sin verificar
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-ink-faint)', marginTop: 1 }}>
          {param.note ?? (range !== null ? `Referencia ${range}` : 'Sin rango de referencia')}
          {mode === 'tecnico' && pid !== undefined && (
            <span className="num" style={{ marginLeft: 8 }}>
              PID 01{pid.toString(16).toUpperCase().padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div className="num" style={{ fontSize: 19, lineHeight: 1.15 }}>
          {param.status === 'no-compatible'
            ? <span style={{ fontSize: 11, color: 'var(--color-ink-faint)' }}>NO COMPATIBLE</span>
            : param.status === 'no-disponible'
            ? <span style={{ fontSize: 11, color: 'var(--color-ink-faint)' }}>NO DISPONIBLE</span>
            : <>{formatValue(param)}<span style={{
                fontSize: 11, color: 'var(--color-ink-faint)', marginLeft: 3,
              }}>{param.def.unit}</span></>}
        </div>
        <div style={{ marginTop: 1 }}>
          <StatusChip status={param.status} compact={mode === 'simple'} />
        </div>
      </div>
    </div>
  );
}
