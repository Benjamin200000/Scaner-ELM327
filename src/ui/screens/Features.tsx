import { useState } from 'react';
import { useApp } from '@/state/store';
import type { CapabilityVerdict } from '@/core/capabilities';
import { ROUTINES } from '@/core/service/routines';
import { RISK_LABEL, type RunMode, type ServiceRoutine, type StepOutcome } from '@/core/service/types';
import { Button, Notice, Panel } from '../parts/Panel';
import { SupportChip } from '../parts/Status';

/**
 * Funciones de servicio.
 *
 * La pantalla está construida alrededor del modo simulación, no del modo
 * real. Con un vehículo delante, lo que hace falta primero es ver qué bytes
 * se van a enviar y contrastarlos con la documentación; recién después se
 * arma la ejecución. Por eso "Simular" es el botón principal y "Ejecutar"
 * está deshabilitado hasta que la secuencia esté verificada.
 */
export function Features() {
  const { info, advanced, setAdvanced } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  if (!info) return null;

  const routine = ROUTINES.find((r) => r.id === selected) ?? null;

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 900 }}>
      <Panel
        title="Funciones de servicio"
        aside={
          <label style={{
            display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => setAdvanced(e.target.checked)}
            />
            <span className="label" style={{
              color: advanced ? 'var(--color-warn)' : 'var(--color-ink-faint)',
            }}>
              Modo avanzado
            </span>
          </label>
        }
      >
        {!advanced && (
          <div style={{ padding: 12 }}>
            <Notice tone="info" title="Las funciones de escritura están bloqueadas">
              El modo avanzado está apagado. Podés ver cada rutina y simularla
              — que es lo que conviene hacer primero — pero ninguna escritura
              se puede ejecutar hasta habilitarlo a propósito.
            </Notice>
          </div>
        )}
        {ROUTINES.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id === selected ? null : r.id)}
            className="row"
            style={{
              gridTemplateColumns: 'minmax(0,1fr) auto',
              width: '100%',
              textAlign: 'left',
              background: r.id === selected ? 'var(--color-panel-alt)' : 'transparent',
              border: 0,
              borderLeft: `2px solid ${r.id === selected ? 'var(--color-info)' : 'transparent'}`,
              borderBottom: '1px solid var(--color-line-soft)',
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{
                fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'baseline',
                flexWrap: 'wrap',
              }}>
                {r.label}
                <RiskChip routine={r} />
                {!r.verified && (
                  <span className="label" style={{ color: 'var(--color-warn)' }}>
                    secuencia sin verificar
                  </span>
                )}
                {r.steps.length === 0 && (
                  <span className="label" style={{ color: 'var(--color-ink-faint)' }}>
                    sin implementar
                  </span>
                )}
              </span>
              <span style={{
                display: 'block', fontSize: 11, color: 'var(--color-ink-faint)',
                marginTop: 2, lineHeight: 1.5, whiteSpace: 'normal',
              }}>
                {r.description}
              </span>
            </span>
            <span className="label" style={{ whiteSpace: 'nowrap' }}>
              {r.scope === 'obd2' ? 'OBD-II' : 'Fabricante'}
            </span>
          </button>
        ))}
      </Panel>

      {routine !== null && <RoutineDetail routine={routine} />}

      <CapabilityMatrix capabilities={info.capabilities} />
    </div>
  );
}

function RiskChip({ routine }: { routine: ServiceRoutine }) {
  const color = routine.risk === 'fisico' ? 'var(--color-fail)'
    : routine.risk === 'escritura' ? 'var(--color-warn)'
    : 'var(--color-ok)';
  return (
    <span className="label" style={{ color }}>{RISK_LABEL[routine.risk]}</span>
  );
}

function RoutineDetail({ routine }: { routine: ServiceRoutine }) {
  const {
    advanced, routineBusy, routineRun, routineOutcomes,
    runRoutine, cancelRoutine, clearRoutineRun, gateRoutine,
  } = useApp();
  const [confirming, setConfirming] = useState(false);

  const sim = gateRoutine(routine.id, 'simulacion');
  const real = gateRoutine(routine.id, 'real');
  const canRun = real?.allowed === true && advanced;

  const start = (mode: RunMode): void => {
    clearRoutineRun();
    void runRoutine(routine.id, mode);
  };

  return (
    <>
      <Panel
        title={routine.label}
        aside={<RiskChip routine={routine} />}
      >
        <div style={{ padding: 12, display: 'grid', gap: 12 }}>
          <div>
            <div className="label">Origen de la secuencia</div>
            <p style={{
              fontSize: 11.5, color: 'var(--color-ink-dim)', margin: '3px 0 0',
              lineHeight: 1.55,
            }}>
              {routine.sourceNote}
            </p>
          </div>

          <div>
            <div className="label" style={{ marginBottom: 4 }}>Precondiciones</div>
            {routine.preconditions.length === 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--color-ink-faint)' }}>
                Esta rutina no define precondiciones.
              </span>
            )}
            {(sim?.preconditions ?? []).map(({ precondition, result }) => (
              <div
                key={precondition.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0,1fr) auto',
                  gap: 8,
                  alignItems: 'baseline',
                  padding: '4px 0',
                  borderBottom: '1px solid var(--color-line-soft)',
                }}
              >
                <span
                  aria-hidden
                  className="num"
                  style={{
                    fontSize: 12,
                    color: result.state === 'cumplida' ? 'var(--color-ok)'
                      : result.state === 'no-cumplida' ? 'var(--color-fail)'
                      : 'var(--color-warn)',
                  }}
                >
                  {result.state === 'cumplida' ? '✓'
                    : result.state === 'no-cumplida' ? '✕' : '?'}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 12 }}>{precondition.label}</span>
                  <span style={{
                    display: 'block', fontSize: 10.5, color: 'var(--color-ink-faint)',
                    lineHeight: 1.5, whiteSpace: 'normal',
                  }}>
                    {precondition.rationale}
                  </span>
                </span>
                <span className="num" style={{
                  fontSize: 11.5, textAlign: 'right',
                  color: result.state === 'cumplida' ? 'var(--color-ink-dim)'
                    : 'var(--color-ink)',
                }}>
                  {result.observed}
                </span>
              </div>
            ))}
          </div>

          {real !== null && !real.allowed && (
            <Notice
              tone={routine.steps.length === 0 ? 'info' : 'warn'}
              title="Esta rutina no se puede ejecutar ahora"
            >
              <ul style={{ margin: '4px 0 0 15px', padding: 0, lineHeight: 1.6 }}>
                {real.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </Notice>
          )}

          {routine.afterNote !== undefined && (
            <div>
              <div className="label">Qué esperar después</div>
              <p style={{
                fontSize: 11.5, color: 'var(--color-ink-dim)', margin: '3px 0 0',
                lineHeight: 1.55,
              }}>
                {routine.afterNote}
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              disabled={routineBusy || sim?.allowed !== true}
              onClick={() => start('simulacion')}
            >
              Simular secuencia
            </Button>
            <Button
              variant="danger"
              disabled={routineBusy || !canRun}
              onClick={() => setConfirming(true)}
            >
              Ejecutar en el vehículo
            </Button>
            {routineBusy && (
              <Button variant="ghost" onClick={cancelRoutine}>Cancelar</Button>
            )}
          </div>
        </div>
      </Panel>

      {routineOutcomes.length > 0 && (
        <RunReport
          outcomes={routineOutcomes}
          mode={routineRun?.mode ?? 'simulacion'}
          aborted={routineRun?.abortedBecause}
          completed={routineRun?.completed ?? false}
          busy={routineBusy}
        />
      )}

      {confirming && (
        <ConfirmRun
          routine={routine}
          onCancel={() => setConfirming(false)}
          onConfirm={() => { setConfirming(false); start('real'); }}
        />
      )}
    </>
  );
}

function RunReport({ outcomes, mode, aborted, completed, busy }: {
  outcomes: StepOutcome[];
  mode: RunMode;
  aborted?: string | undefined;
  completed: boolean;
  busy: boolean;
}) {
  const tone: Record<StepOutcome['status'], string> = {
    ok: 'var(--color-ok)',
    rechazado: 'var(--color-fail)',
    error: 'var(--color-fail)',
    enviando: 'var(--color-warn)',
    pendiente: 'var(--color-idle)',
    omitido: 'var(--color-idle)',
  };

  return (
    <Panel
      title={mode === 'simulacion' ? 'Simulación de la secuencia' : 'Ejecución'}
      aside={
        <span className="label" style={{
          color: busy ? 'var(--color-warn)'
            : completed ? 'var(--color-ok)' : 'var(--color-fail)',
        }}>
          {busy ? 'En curso' : completed ? 'Completada' : 'Interrumpida'}
        </span>
      }
    >
      {mode === 'simulacion' && (
        <div style={{ padding: 12, paddingBottom: 0 }}>
          <Notice tone="info" title="No se envió nada al vehículo">
            Esto es exactamente lo que se enviaría. Contrastalo con la
            documentación del vehículo antes de ejecutarlo de verdad.
          </Notice>
        </div>
      )}

      {outcomes.map((o) => (
        <div key={o.index} className="row" style={{ display: 'block' }}>
          <div style={{
            display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap',
          }}>
            <span className="num" style={{ color: 'var(--color-ink-faint)', fontSize: 11 }}>
              {o.index + 1}
            </span>
            <span style={{ fontSize: 12.5 }}>{o.step.label}</span>
            <span className="label" style={{ color: tone[o.status] }}>{o.status}</span>
            {o.step.writes && (
              <span className="label" style={{ color: 'var(--color-warn)' }}>escribe</span>
            )}
            {o.elapsedMs !== undefined && (
              <span className="num" style={{ fontSize: 10.5, color: 'var(--color-ink-faint)' }}>
                {o.elapsedMs} ms
              </span>
            )}
          </div>
          <div className="num" style={{ fontSize: 11.5, marginTop: 3 }}>
            <span style={{ color: 'var(--color-info)' }}>TX</span>{' '}
            <span>{o.request}</span>
            {o.response !== undefined && (
              <>
                {'   '}
                <span style={{ color: 'var(--color-ok)' }}>RX</span>{' '}
                <span>{o.response}</span>
              </>
            )}
          </div>
          {o.detail !== undefined && (
            <div style={{
              fontSize: 11, color: 'var(--color-ink-dim)', marginTop: 3, lineHeight: 1.5,
            }}>
              {o.detail}
            </div>
          )}
        </div>
      ))}

      {aborted !== undefined && (
        <div style={{ padding: 12 }}>
          <Notice tone="fail" title="La secuencia se cortó">{aborted}</Notice>
        </div>
      )}
    </Panel>
  );
}

/**
 * Confirmación doble para ejecutar en el vehículo.
 *
 * Enumera los pasos que escriben, con sus bytes. La confirmación genérica
 * "¿estás seguro?" no informa nada; esta dice exactamente qué se modifica.
 */
function ConfirmRun({ routine, onCancel, onConfirm }: {
  routine: ServiceRoutine;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const writes = routine.steps.filter((s) => s.writes);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(5,7,9,0.80)',
        display: 'grid', placeItems: 'center', padding: 16, zIndex: 50,
      }}
    >
      <div className="panel" style={{ maxWidth: 520, width: '100%' }}>
        <div className="panel-head">
          <h2 className="label" style={{ margin: 0, color: 'var(--color-fail)' }}>
            Ejecutar en el vehículo
          </h2>
        </div>
        <div style={{ padding: 14, fontSize: 12.5, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 10px' }}>
            <strong>{routine.label}</strong> — {routine.description}
          </p>

          <div className="label">Pasos que modifican la ECU</div>
          {writes.length === 0 ? (
            <p style={{ margin: '3px 0 10px', color: 'var(--color-ink-dim)' }}>
              Ninguno: esta rutina solo lee.
            </p>
          ) : (
            <ul style={{ margin: '4px 0 10px 15px', padding: 0 }}>
              {writes.map((s) => (
                <li key={s.label} style={{ marginBottom: 4 }}>
                  {s.label}{' '}
                  <span className="num" style={{ color: 'var(--color-warn)' }}>
                    {[s.sid, ...s.payload]
                      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
                      .join(' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {routine.risk === 'fisico' && (
            <Notice tone="fail" title="Esta rutina acciona componentes físicos">
              Verificá que nadie esté cerca de partes móviles ni de la salida
              de escape antes de continuar.
            </Notice>
          )}

          <label style={{
            display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 12,
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span style={{ color: 'var(--color-ink-dim)' }}>
              Entiendo que esto modifica el vehículo y que la operación no se
              puede deshacer desde la aplicación.
            </span>
          </label>
        </div>
        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 12,
          borderTop: '1px solid var(--color-line)',
        }}>
          <Button onClick={onCancel}>Cancelar</Button>
          <Button variant="danger" disabled={!acknowledged} onClick={onConfirm}>
            Ejecutar
          </Button>
        </div>
      </div>
    </div>
  );
}

function CapabilityMatrix({ capabilities }: { capabilities: CapabilityVerdict[] }) {
  const obd2 = capabilities.filter((c) => c.feature.scope === 'obd2');
  const mfr = capabilities.filter((c) => c.feature.scope === 'fabricante');
  return (
    <>
      <Panel title="Compatibilidad: OBD-II genérico">
        {obd2.map((c) => <CapRow key={c.feature.id} verdict={c} />)}
      </Panel>
      <Panel title="Compatibilidad: diagnóstico de fabricante">
        {mfr.map((c) => <CapRow key={c.feature.id} verdict={c} />)}
        <div style={{
          padding: 12, fontSize: 11.5, color: 'var(--color-ink-dim)',
          lineHeight: 1.6, borderTop: '1px solid var(--color-line-soft)',
        }}>
          Un ELM327 es un conversor de protocolo: puede transportar
          solicitudes KWP2000 o UDS arbitrarias, así que estas funciones son
          alcanzables en principio. Lo que no se puede afirmar sin probarlo en
          el vehículo es que la secuencia concreta funcione en esa ECU. Por eso
          nada acá dice "compatible". Los VAG anteriores a ~2001 suelen usar{' '}
          <span className="num">KW1281</span>, que el ELM327 no puede hablar ni
          siquiera sobre K-Line.
        </div>
      </Panel>
    </>
  );
}

function CapRow({ verdict }: { verdict: CapabilityVerdict }) {
  const { feature, support, reason, notImplemented } = verdict;
  return (
    <div className="row" style={{ display: 'block' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12.5 }}>{feature.label}</span>
        <SupportChip support={support} />
        {feature.writes && (
          <span className="label" style={{ color: 'var(--color-warn)' }}>
            escribe en la ecu
          </span>
        )}
        {notImplemented === true && (
          <span className="label" style={{ color: 'var(--color-ink-faint)' }}>
            no implementada
          </span>
        )}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--color-ink-faint)', marginTop: 3, lineHeight: 1.5,
      }}>
        {reason}
      </div>
    </div>
  );
}
