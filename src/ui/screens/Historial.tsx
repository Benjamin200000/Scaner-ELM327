import { useEffect } from 'react';
import { useApp } from '@/state/store';
import type { HistoryEntry } from '@/state/history';
import { paramById } from '@/core/obd2/pids';
import { Button, Field, Notice, Panel } from '../parts/Panel';

/**
 * Historial de diagnóstico.
 *
 * Guardado en IndexedDB, local al equipo. Sin servidor, sin cuentas: en un
 * taller con mala señal eso es una ventaja, no una limitación.
 *
 * La comparación entre visitas es lo que le da valor: ver que un código
 * volvió, o que la corrección larga subió desde la última vez, dice más que
 * cualquier lectura aislada.
 */
export function Historial() {
  const {
    historial, historialCargando, historialAbierto,
    cargarHistorial, abrirDelHistorial, borrarDelHistorial, setScreen,
  } = useApp();

  useEffect(() => {
    void cargarHistorial();
  }, [cargarHistorial]);

  const porVin = new Map<string, HistoryEntry[]>();
  for (const e of historial) {
    const descripcion = `${e.vehicle.make ?? ''} ${e.vehicle.model ?? ''}`.trim();
    const clave = e.vehicle.vin ?? (descripcion !== '' ? descripcion : 'sin identificar');
    porVin.set(clave, [...(porVin.get(clave) ?? []), e]);
  }

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 940 }}>
      <Panel
        title="Historial de diagnóstico"
        aside={
          <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
            {historial.length} sesiones · {porVin.size} vehículos
          </span>
        }
      >
        {historialCargando && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
            Cargando…
          </div>
        )}
        {!historialCargando && historial.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)', lineHeight: 1.6 }}>
            Todavía no hay sesiones guardadas. Se guarda una al desconectar, y
            también cada vez que generás un informe.
          </div>
        )}
        {historial.map((e) => {
          const abierto = historialAbierto?.id === e.id;
          const confirmados = e.dtcs.filter((d) => d.kind === 'stored');
          return (
            <div
              key={e.id}
              style={{
                borderBottom: '1px solid var(--color-line-soft)',
                background: abierto ? 'var(--color-panel-alt)' : undefined,
                borderLeft: `2px solid ${abierto ? 'var(--color-info)' : 'transparent'}`,
              }}
            >
              <button
                onClick={() => abrirDelHistorial(abierto ? null : e)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) auto',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 12px',
                  background: 'transparent',
                  border: 0,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="num" style={{ fontSize: 12.5 }}>
                    {new Date(e.at).toLocaleString('es-CL', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  <span style={{ marginLeft: 10, fontSize: 12.5 }}>
                    {[e.vehicle.make, e.vehicle.model, e.vehicle.year]
                      .filter(Boolean).join(' ') || 'Vehículo sin identificar'}
                  </span>
                  <span style={{
                    display: 'block', fontSize: 11, color: 'var(--color-ink-faint)',
                    marginTop: 2,
                  }}>
                    {e.vehicle.vin !== null && (
                      <span className="num">{e.vehicle.vin} · </span>
                    )}
                    {e.vehicle.odometerKm !== null && (
                      <span className="num">{e.vehicle.odometerKm.toLocaleString('es')} km · </span>
                    )}
                    {e.ecu.name ?? 'ECU no identificada'}
                  </span>
                </span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="num" style={{
                    fontSize: 15,
                    color: confirmados.length > 0 ? 'var(--color-fail)' : 'var(--color-ok)',
                  }}>
                    {confirmados.length}
                  </span>
                  <span className="label" style={{ marginLeft: 5 }}>códigos</span>
                </span>
              </button>

              {abierto && <Detalle entry={e} onBorrar={() => void borrarDelHistorial(e.id!)} onInforme={() => setScreen('informe')} />}
            </div>
          );
        })}
      </Panel>

      {porVin.size > 0 && (
        <Panel title="Por vehículo">
          {[...porVin.entries()].map(([clave, entradas]) => {
            const codigos = new Map<string, number>();
            for (const e of entradas) {
              for (const d of e.dtcs) {
                codigos.set(d.code, (codigos.get(d.code) ?? 0) + 1);
              }
            }
            const repetidos = [...codigos.entries()].filter(([, n]) => n > 1);
            return (
              <div key={clave} className="row" style={{ display: 'block' }}>
                <div className="num" style={{ fontSize: 12.5 }}>{clave}</div>
                <div style={{ fontSize: 11, color: 'var(--color-ink-faint)', marginTop: 2 }}>
                  {entradas.length} {entradas.length === 1 ? 'visita' : 'visitas'}
                  {' · '}
                  última el {new Date(entradas[0]!.at).toLocaleDateString('es-CL')}
                </div>
                {repetidos.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Notice tone="warn" title="Códigos que volvieron a aparecer">
                      {repetidos.map(([c, n]) => `${c} en ${n} visitas`).join(' · ')}.
                      Un código que reaparece después de borrarlo apunta a que la
                      causa sigue presente.
                    </Notice>
                  </div>
                )}
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}

function Detalle({ entry, onBorrar, onInforme }: {
  entry: HistoryEntry;
  onBorrar: () => void;
  onInforme: () => void;
}) {
  const valores = Object.entries(entry.values)
    .filter(([, v]) => v !== null)
    .map(([id, v]) => ({ id, v: v as number, def: paramById(id) }))
    .filter((x) => x.def !== null);

  return (
    <div style={{ padding: '0 12px 12px' }}>
      <div style={{
        display: 'grid', gap: 12, marginBottom: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))',
      }}>
        <Field label="Protocolo" value={entry.ecu.protocol} />
        <Field label="Calibración" value={entry.ecu.calibrationId} />
        <Field label="Parámetros guardados" value={String(valores.length)} />
      </div>

      {entry.dtcs.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="label">Códigos</div>
          <div className="num" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.7 }}>
            {entry.dtcs.map((d) => (
              <span key={`${d.code}-${d.kind}`} style={{ marginRight: 12 }}>
                {d.code}
                <span className="label" style={{ marginLeft: 4 }}>{d.kind}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {valores.length > 0 && (
        <details>
          <summary className="label" style={{ cursor: 'pointer' }}>
            Parámetros al cierre de la sesión
          </summary>
          <div style={{
            display: 'grid', gap: 6, marginTop: 8,
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
          }}>
            {valores.map(({ id, v, def }) => (
              <div key={id} style={{ fontSize: 11.5 }}>
                <span style={{ color: 'var(--color-ink-faint)' }}>{def!.label}</span>
                <span className="num" style={{ marginLeft: 6 }}>
                  {v.toFixed(def!.decimals)} {def!.unit}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button onClick={onInforme}>Ver informe</Button>
        <Button variant="danger" onClick={onBorrar}>Borrar sesión</Button>
      </div>
    </div>
  );
}
