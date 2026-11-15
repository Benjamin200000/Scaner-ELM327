import { useState } from 'react';
import { useApp } from '@/state/store';
import { dtcArea, dtcKindLabel } from '@/core/obd2/dtc';
import { findDtcFor } from '@/knowledge';
import { PID_DEFS } from '@/core/obd2/pids';
import { describeEcu } from '@/core/elm327/frames';
import { SOURCE_LABEL } from '@/knowledge/types';
import { Button, Notice, Panel } from '../parts/Panel';

/**
 * Códigos de falla e interpretación.
 *
 * El punto delicado acá es el código desconocido. La tentación es armar un
 * texto a partir del rango del código ("falla en el sistema de combustible")
 * y presentarlo como descripción. Esta pantalla no lo hace: si la base no
 * tiene el código, lo dice, muestra solo el área orientativa derivada del
 * rango numérico y aclara que es una pista, no una descripción.
 */
/** Primer parámetro de cada PID, que es el que representa la foto. */
const PARAM_INDEX_POR_PID = new Map(
  PID_DEFS.map((d) => [d.pid, d.params[0]!] as const),
);

export function Dtcs() {
  const {
    dtcs, refreshDtcs, clearDtcs, vehicleContext, info,
    freeze, freezeCargando, cargarFreezeFrame, mode,
  } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const ctx = vehicleContext();

  const byKind = (['stored', 'pending', 'permanent'] as const).map((kind) => ({
    kind,
    items: dtcs.filter((d) => d.kind === kind),
  }));

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 900 }}>
      <Panel
        title="Códigos de falla"
        aside={
          <span style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" disabled={busy}
              onClick={() => void run(refreshDtcs)}>
              Actualizar
            </Button>
            <Button variant="ghost" disabled={busy || freezeCargando || dtcs.length === 0}
              onClick={() => void cargarFreezeFrame()}>
              {freezeCargando ? 'Leyendo…' : 'Datos congelados'}
            </Button>
            <Button variant="danger" disabled={busy || dtcs.length === 0}
              onClick={() => setConfirming(true)}>
              Borrar
            </Button>
          </span>
        }
      >
        {dtcs.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
            Sin códigos en la ECU del motor.
            {info?.protocol !== null && (
              <> Solo se consultó OBD-II genérico: otras unidades del vehículo
              (ABS, airbag, confort) requieren diagnóstico específico de
              fabricante y no están cubiertas.</>
            )}
          </div>
        )}

        {byKind.map(({ kind, items }) =>
          items.length === 0 ? null : (
            <div key={kind}>
              <div style={{
                padding: '6px 10px', background: 'var(--color-panel-alt)',
                borderBottom: '1px solid var(--color-line)',
              }}>
                <span className="label">{dtcKindLabel[kind]} · {items.length}</span>
              </div>
              {items.map((d) => {
                const k = findDtcFor(d.code, ctx);
                return (
                  <div key={`${d.code}-${kind}-${d.ecu ?? ''}`} style={{
                    borderBottom: '1px solid var(--color-line-soft)', padding: '10px 12px',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
                    }}>
                      <span className="num" style={{ fontSize: 20 }}>{d.code}</span>
                      {d.ecu !== undefined && (
                        <span className="label" style={{ color: 'var(--color-info)' }}>
                          {describeEcu(d.ecu)}
                        </span>
                      )}
                      {k !== null ? (
                        <>
                          <span className="label" style={{
                            color: k.priority === 'alta' ? 'var(--color-fail)'
                              : k.priority === 'media' ? 'var(--color-warn)'
                              : 'var(--color-ink-dim)',
                          }}>
                            prioridad {k.priority}
                          </span>
                          <span className="label">{k.system}</span>
                        </>
                      ) : (
                        <span className="label" style={{ color: 'var(--color-warn)' }}>
                          sin interpretación en la base
                        </span>
                      )}
                    </div>

                    {k !== null ? (
                      <>
                        <div style={{
                          fontSize: 13, marginTop: 4, textTransform: 'uppercase',
                          letterSpacing: '0.02em',
                        }}>
                          {k.description}
                        </div>
                        <p style={{
                          fontSize: 12, color: 'var(--color-ink-dim)',
                          margin: '7px 0 0', lineHeight: 1.55,
                        }}>
                          {k.meaning}
                        </p>

                        <Section title="Posibles causas" items={k.causes} />
                        <Section title="Pruebas a realizar" items={k.tests} />
                        {k.confirmsIf !== undefined && (
                          <Section title="Apoyaría la hipótesis" items={k.confirmsIf} />
                        )}
                        {k.rulesOutIf !== undefined && (
                          <Section title="La descartaría" items={k.rulesOutIf} />
                        )}
                        {k.checkParams.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div className="label">Parámetros a observar</div>
                            <div className="num" style={{
                              fontSize: 11.5, color: 'var(--color-ink-dim)', marginTop: 2,
                            }}>
                              {k.checkParams.join(' · ')}
                            </div>
                          </div>
                        )}
                        <div className="label" style={{ marginTop: 8 }}>
                          Origen: {SOURCE_LABEL[k.provenance.source]}
                          {k.provenance.reference !== undefined && ` · ${k.provenance.reference}`}
                        </div>
                      </>
                    ) : (
                      <div style={{ marginTop: 6 }}>
                        <Notice tone="warn" title="Descripción no disponible">
                          Este código no está en la base de conocimiento, así que
                          la app no tiene una descripción verificada para él. Por
                          el rango numérico correspondería al área
                          <strong> {dtcArea(d.code)}</strong>, pero eso es una
                          pista derivada del número, no la descripción del código.
                          En muchos vehículos el significado exacto es específico
                          del fabricante.
                        </Notice>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ),
        )}
      </Panel>

      {freeze !== null && <FreezeFrame freeze={freeze} mode={mode} />}

      {confirming && (
        <ConfirmClear
          count={dtcs.length}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run(clearDtcs);
          }}
        />
      )}
    </div>
  );
}

/**
 * Datos congelados.
 *
 * La ECU guarda una foto de los sensores en el momento exacto en que
 * registró el código. Para una falla intermitente vale más que cualquier
 * lectura en vivo: dice a qué régimen, con qué carga y a qué temperatura
 * ocurrió, que es lo que no se puede reproducir en el box.
 */
function FreezeFrame({ freeze, mode }: {
  freeze: { dtc: string | null; values: Map<number, number | null> };
  mode: 'simple' | 'tecnico';
}) {
  const filas = [...freeze.values.entries()]
    .map(([pid, v]) => ({ pid, v, def: PARAM_INDEX_POR_PID.get(pid) }))
    .filter((f) => f.def !== undefined && f.v !== null);

  return (
    <Panel
      title="Datos congelados"
      aside={
        freeze.dtc !== null && (
          <span className="num" style={{ fontSize: 12 }}>
            disparado por {freeze.dtc}
          </span>
        )
      }
    >
      {filas.length === 0 ? (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
          Esta ECU no guardó datos congelados, o no soporta el modo 02.
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))',
          }}>
            {filas.map(({ pid, v, def }) => (
              <div key={pid} style={{
                padding: '8px 12px',
                borderRight: '1px solid var(--color-line-soft)',
                borderBottom: '1px solid var(--color-line-soft)',
              }}>
                <div className="label">{def!.label}</div>
                <div className="num" style={{ fontSize: 17, marginTop: 1 }}>
                  {v!.toFixed(def!.decimals)}
                  <span style={{ fontSize: 10.5, color: 'var(--color-ink-faint)', marginLeft: 3 }}>
                    {def!.unit}
                  </span>
                </div>
                {mode === 'tecnico' && (
                  <div className="num label" style={{ marginTop: 1 }}>
                    PID 02{pid.toString(16).toUpperCase().padStart(2, '0')}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ padding: 10 }}>
            <p style={{
              fontSize: 11, color: 'var(--color-ink-faint)', margin: 0, lineHeight: 1.55,
            }}>
              Estos son los valores del momento en que la ECU guardó el código,
              no los actuales. Comparar ambos muestra en qué condiciones
              apareció la falla, que es lo que no se puede reproducir con el
              auto detenido en el box.
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="label">{title}</div>
      <ul style={{
        margin: '3px 0 0 15px', padding: 0, fontSize: 11.5,
        color: 'var(--color-ink-dim)', lineHeight: 1.55,
      }}>
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}

/**
 * Confirmación de borrado.
 *
 * El borrado es una ESCRITURA en la ECU y no es reversible: se van los
 * códigos, los datos congelados y el estado de los monitores de a bordo. El
 * diálogo dice exactamente eso en lugar de un "¿estás seguro?".
 */
function ConfirmClear({ count, busy, onCancel, onConfirm }: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(5,7,9,0.78)',
        display: 'grid', placeItems: 'center', padding: 16, zIndex: 50,
      }}
    >
      <div className="panel" style={{ maxWidth: 460, width: '100%' }}>
        <div className="panel-head">
          <h2 className="label" style={{ margin: 0, color: 'var(--color-fail)' }}>
            Borrar códigos de falla
          </h2>
        </div>
        <div style={{ padding: 14, fontSize: 12.5, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 10px' }}>
            Se van a borrar <span className="num">{count}</span> códigos de la ECU
            del motor. Esta operación escribe en la ECU y no se puede deshacer.
          </p>
          <p style={{ margin: '0 0 10px', color: 'var(--color-ink-dim)' }}>
            Además de los códigos, se eliminan:
          </p>
          <ul style={{
            margin: '0 0 10px 15px', padding: 0, color: 'var(--color-ink-dim)',
          }}>
            <li>Los datos congelados del momento de la falla</li>
            <li>El estado de los monitores de a bordo</li>
            <li>La distancia y el tiempo con el testigo encendido</li>
          </ul>
          <p style={{ margin: 0, color: 'var(--color-warn)' }}>
            Borrar no repara nada. Si la condición persiste, el código vuelve.
          </p>
        </div>
        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 12,
          borderTop: '1px solid var(--color-line)',
        }}>
          <Button onClick={onCancel}>Cancelar</Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            Borrar códigos
          </Button>
        </div>
      </div>
    </div>
  );
}
