import { useApp } from '@/state/store';
import { summarizeSystem } from '@/core/engine/systems';
import { type EvaluatedParam, STATUS_LABEL, STATUS_SEVERITY } from '@/core/engine/evaluate';
import { LEVEL_LABEL } from '@/core/engine/rules';
import { Notice, Panel } from '../parts/Panel';
import { StatusChip } from '../parts/Status';
import { LiveTiles } from '../parts/LiveTiles';
import { evaluarRevision } from '@/core/obd2/readiness';

/**
 * Resumen del vehículo.
 *
 * Pocos indicadores y entrada a cada sistema, en lugar de una pantalla con
 * cuarenta parámetros. Un sistema cuyos parámetros no se pudieron comparar
 * contra una referencia NO aparece como normal: aparece como sin referencia,
 * porque decir "normal" sin haber comparado nada es afirmar algo que no se
 * verificó.
 */
export function Dashboard() {
  const { info, systems, evaluated, diagnosis, dtcs, setScreen, series } = useApp();
  if (!info) return null;

  const evs = evaluated();
  const summaries = systems()
    .map((s) => summarizeSystem(s, evs))
    .sort((a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status]);

  const { findings, skipped } = diagnosis();
  const stored = dtcs.filter((d) => d.kind === 'stored');

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Panel title="En vivo" aside={
        <button className="label" onClick={() => setScreen('datos')}
          style={{ background: 'none', border: 0, color: 'var(--color-info)' }}>
          Todos los parámetros
        </button>
      }>
        <LiveTiles evaluated={evs} series={series} />
      </Panel>

      <Revision onAbrir={() => setScreen('emisiones')} />

      <Panel
        title="Estado del vehículo"
        aside={
          <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
            {summaries.length} sistemas
          </span>
        }
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(168px, 100%), 1fr))',
        }}>
          {summaries.map((s) => (
            <button
              key={s.system.id}
              onClick={() => setScreen('datos')}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                background: 'transparent',
                border: 0,
                borderRight: '1px solid var(--color-line-soft)',
                borderBottom: '1px solid var(--color-line-soft)',
              }}
            >
              <div style={{ fontSize: 13, marginBottom: 3 }}>{s.system.label}</div>
              <StatusChip status={s.status} />
              <div style={{
                fontSize: 10.5, color: 'var(--color-ink-faint)', marginTop: 4,
                minHeight: 13,
              }}>
                {s.drivers.length > 0
                  ? s.drivers.map((d) => d.def.label).join(', ')
                  : s.status === 'sin-referencia'
                  ? `${countRead(s.system.id, evs)} leídos, sin rango de referencia`
                  : s.status === 'no-compatible'
                  ? 'Sin parámetros legibles'
                  : `${s.evaluated} ${s.evaluated === 1 ? 'parámetro' : 'parámetros'} en rango`}
              </div>
            </button>
          ))}
        </div>
      </Panel>

      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
      }}>
        <Panel
          title="Diagnóstico"
          aside={
            <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
              {findings.length} hallazgos
            </span>
          }
        >
          {findings.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
              Ninguna regla encontró un patrón anómalo con los datos actuales.
              No equivale a que el vehículo esté sano: solo significa que estas
              reglas, con estos parámetros, no detectaron nada.
            </div>
          )}
          {findings.map((f) => (
            <div key={f.ruleId} className="row" style={{ display: 'block' }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
              }}>
                <span className="label" style={{
                  color: f.level === 'patron-compatible' ? 'var(--color-fail)'
                    : f.level === 'indicio' ? 'var(--color-warn)'
                    : 'var(--color-info)',
                }}>
                  {LEVEL_LABEL[f.level]}
                </span>
                <span style={{ fontSize: 12.5 }}>{f.title}</span>
              </div>
              <p style={{
                fontSize: 11.5, color: 'var(--color-ink-dim)', margin: '4px 0 0',
                lineHeight: 1.5,
              }}>
                {f.observed}
              </p>
              <details style={{ marginTop: 6 }}>
                <summary className="label" style={{ cursor: 'pointer' }}>
                  Posibles causas y qué revisar
                </summary>
                <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-ink-dim)' }}>
                  <div className="label" style={{ marginBottom: 2 }}>Posibles causas</div>
                  <ul style={listStyle}>
                    {f.causes.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                  <div className="label" style={{ margin: '8px 0 2px' }}>Revisar</div>
                  <ul style={listStyle}>
                    {f.check.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </div>
              </details>
            </div>
          ))}
        </Panel>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <Panel
            title="Códigos de falla"
            aside={
              <button
                className="label"
                onClick={() => setScreen('codigos')}
                style={{ background: 'none', border: 0, color: 'var(--color-info)' }}
              >
                Ver todos
              </button>
            }
          >
            {dtcs.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
                Sin códigos almacenados en la ECU del motor.
              </div>
            ) : (
              dtcs.slice(0, 5).map((d) => (
                <div key={`${d.code}-${d.kind}-${d.ecu ?? ''}`} className="row"
                  style={{ gridTemplateColumns: 'auto minmax(0,1fr)' }}>
                  <span className="num" style={{ fontSize: 14 }}>{d.code}</span>
                  <span className="label" style={{ textAlign: 'right' }}>
                    {d.kind === 'stored' ? 'Confirmado'
                      : d.kind === 'pending' ? 'Pendiente' : 'Permanente'}
                  </span>
                </div>
              ))
            )}
            {stored.length > 0 && (
              <div style={{ padding: 10, borderTop: '1px solid var(--color-line-soft)' }}>
                <Notice tone="warn" title="Hay códigos confirmados">
                  Conviene leer su interpretación antes de borrarlos: el borrado
                  también elimina los datos congelados que ayudan a diagnosticar.
                </Notice>
              </div>
            )}
          </Panel>

          {skipped.length > 0 && (
            <Panel title="Reglas no evaluadas">
              {skipped.map((s) => (
                <div key={s.ruleId} className="row" style={{ display: 'block' }}>
                  <div style={{ fontSize: 12.5 }}>{s.title}</div>
                  <div style={{
                    fontSize: 11, color: 'var(--color-ink-faint)', marginTop: 2,
                    lineHeight: 1.5,
                  }}>
                    {s.reason}. Falta: <span className="num">{s.missing.join(', ')}</span>
                  </div>
                </div>
              ))}
              <div style={{ padding: 10, borderTop: '1px solid var(--color-line-soft)' }}>
                <p style={{
                  fontSize: 11, color: 'var(--color-ink-faint)', margin: 0, lineHeight: 1.5,
                }}>
                  Estas reglas no corrieron. Se listan porque su ausencia es
                  información: que la regla de DPF no se haya evaluado no
                  significa que el DPF esté bien.
                </p>
              </div>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Resumen de estados">
        <div style={{ padding: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {(['falla', 'atencion', 'normal', 'sin-referencia', 'fuera-de-condicion',
             'no-disponible'] as const).map((st) => {
            const n = evs.filter((e) => e.status === st).length;
            return (
              <span key={st} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <StatusChip status={st} compact />
                <span className="num" style={{ fontSize: 13 }}>{n}</span>
                <span className="label">{STATUS_LABEL[st]}</span>
              </span>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/** Veredicto de revisión técnica en una línea; el detalle vive en Emisiones. */
function Revision({ onAbrir }: { onAbrir: () => void }) {
  const readiness = useApp((s) => s.info?.readiness ?? null);
  const v = evaluarRevision(readiness);
  const tono = v.aprobaria === true ? 'var(--color-ok)'
    : v.aprobaria === false ? 'var(--color-fail)' : 'var(--color-idle)';
  return (
    <button onClick={onAbrir} className="panel" style={{
      display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap',
      padding: '10px 12px', textAlign: 'left', width: '100%',
      borderLeft: `3px solid ${tono}`,
    }}>
      <span className="label">Revisión técnica</span>
      <span style={{
        fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase', color: tono,
      }}>
        {v.aprobaria === true ? 'Pasaría' : v.aprobaria === false ? 'No pasaría' : 'Sin datos'}
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--color-ink-dim)', flex: '1 1 220px' }}>
        {v.motivo}
      </span>
      {readiness !== null && (
        <span className="num label">{v.completos}/{v.soportados} monitores</span>
      )}
    </button>
  );
}

/**
 * Cuántos parámetros del sistema están llegando con dato.
 *
 * "Sin rango para comparar" a secas sugería que la app no está leyendo nada,
 * cuando en realidad lee los valores y lo único que falta es la referencia
 * contra la cual juzgarlos. Son dos cosas distintas y conviene distinguirlas.
 */
function countRead(systemId: string, evs: EvaluatedParam[]): number {
  return evs.filter((e) => e.def.system === systemId && e.value !== null).length;
}

const listStyle: React.CSSProperties = {
  margin: '0 0 0 14px',
  padding: 0,
  lineHeight: 1.55,
};
