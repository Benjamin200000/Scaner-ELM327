import { ESTADO_LABEL, evaluarRevision, type Readiness } from '@/core/obd2/readiness';
import { Notice, Panel } from './Panel';

/**
 * Estado de los monitores de emisiones.
 *
 * Es la pantalla que contesta "¿pasa la revisión técnica?". Un vehículo sin
 * fallas pero con monitores pendientes se rechaza igual, y eso agarra
 * desprevenida a mucha gente: borrar los códigos justo antes de ir es la
 * forma más rápida de que lo rechacen.
 *
 * Muestra los cuatro bytes crudos a propósito. La decodificación sigue el
 * esquema documentado de SAE J1979 pero no pude verificarla contra la norma
 * ni contra un vehículo real, y un error de polaridad diría lo contrario de
 * la verdad. Con los bytes a la vista se verifica en dos minutos comparando
 * un auto recién borrado contra uno con días de uso.
 */
export function ReadinessPanel({ readiness, mode }: {
  readiness: Readiness | null;
  mode: 'simple' | 'tecnico';
}) {
  const v = evaluarRevision(readiness);

  if (readiness === null) {
    return (
      <Panel title="Monitores de emisiones">
        <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
          Esta ECU no entregó el estado de los monitores.
        </div>
      </Panel>
    );
  }

  const tono = v.aprobaria === true ? 'var(--color-ok)'
    : v.aprobaria === false ? 'var(--color-fail)'
    : 'var(--color-warn)';

  const soportados = readiness.monitores.filter((m) => m.estado !== 'no-soportado');
  const noSoportados = readiness.monitores.filter((m) => m.estado === 'no-soportado');

  return (
    <Panel
      title="Monitores de emisiones"
      aside={
        <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
          {readiness.tipoEncendido === 'compresion' ? 'Encendido por compresión' : 'Encendido por chispa'}
          {' · '}{v.completos}/{v.soportados} completos
        </span>
      }
    >
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--color-line-soft)',
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
          textTransform: 'uppercase', color: tono,
        }}>
          {v.aprobaria === true ? 'Pasaría la revisión'
            : v.aprobaria === false ? 'No pasaría la revisión'
            : 'Indeterminado'}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--color-ink-dim)', flex: '1 1 240px' }}>
          {v.motivo}
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))',
      }}>
        {soportados.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 7,
              padding: '6px 12px',
              borderRight: '1px solid var(--color-line-soft)',
              borderBottom: '1px solid var(--color-line-soft)',
            }}
          >
            <span
              aria-hidden
              className="num"
              style={{
                fontSize: 11,
                color: m.estado === 'completo' ? 'var(--color-ok)' : 'var(--color-warn)',
              }}
            >
              {m.estado === 'completo' ? '✓' : '◐'}
            </span>
            <span style={{ fontSize: 12, minWidth: 0, flex: 1 }}>{m.label}</span>
            <span className="label" style={{
              color: m.estado === 'completo' ? 'var(--color-ink-faint)' : 'var(--color-warn)',
            }}>
              {ESTADO_LABEL[m.estado]}
            </span>
          </div>
        ))}
      </div>

      {mode === 'tecnico' && (
        <div style={{ padding: '10px 12px' }}>
          <div className="label">Bytes del PID 01</div>
          <div className="num" style={{ fontSize: 13, marginTop: 3 }}>
            {readiness.raw.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}
          </div>
          {noSoportados.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--color-ink-faint)', marginTop: 6, lineHeight: 1.5 }}>
              No soportados por esta ECU: {noSoportados.map((m) => m.label).join(', ')}.
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Notice tone="warn" title="Decodificación sin verificar">
              Sigue el esquema documentado de SAE J1979, pero no está
              contrastada contra la norma ni contra un vehículo real. Para
              verificarla: en un auto recién borrado casi todo debería figurar
              PENDIENTE, y en uno con varios días de uso casi todo COMPLETO.
              Si sale al revés, la polaridad está invertida.
            </Notice>
          </div>
        </div>
      )}
    </Panel>
  );
}
