import { useMemo } from 'react';
import { useApp } from '@/state/store';
import { findDtcFor } from '@/knowledge';
import { dtcKindLabel } from '@/core/obd2/dtc';
import { formatRange, formatValue, STATUS_LABEL } from '@/core/engine/evaluate';
import { LEVEL_LABEL } from '@/core/engine/rules';
import { Button, Notice, Panel } from '../parts/Panel';

/**
 * Informe de diagnóstico.
 *
 * Se imprime con el navegador en lugar de generarse con una librería de PDF:
 * la fidelidad es mucho mayor, no agrega dependencias y "Guardar como PDF"
 * está en el mismo diálogo de impresión en escritorio y en tablet.
 *
 * Dos decisiones que lo diferencian de un volcado de datos:
 *
 * 1. Lleva una sección de ALCANCE que dice qué NO se revisó. Un informe que
 *    solo enumera lo que encontró sugiere que lo demás está bien, y acá solo
 *    se consultó la ECU de motor por OBD-II genérico.
 *
 * 2. Los hallazgos se presentan con su nivel de certeza. Ninguna línea
 *    afirma que una pieza esté defectuosa.
 */
export function Informe() {
  const {
    info, evaluated, diagnosis, dtcs, manual, vehicleContext,
    taller, setTaller, guardarSesionActual, historialAbierto,
  } = useApp();

  const evs = evaluated();
  const { findings, skipped } = diagnosis();
  const ctx = vehicleContext();

  // El testigo de avería y la cuenta de códigos son estados, no mediciones,
  // y la sección de códigos ya los cubre. Listarlos como "parámetro fuera de
  // rango" llena el informe de ruido y repite información.
  const medibles = useMemo(
    () => evs.filter((e) => e.id !== 'mil' && e.id !== 'dtc_count'),
    [evs],
  );
  const anormales = useMemo(
    () => medibles.filter((e) => e.status === 'falla' || e.status === 'atencion')
      .sort((a) => (a.status === 'falla' ? -1 : 1)),
    [medibles],
  );
  const normales = useMemo(() => medibles.filter((e) => e.status === 'normal'), [medibles]);
  const sinJuicio = useMemo(
    () => medibles.filter((e) => e.status === 'sin-referencia' || e.status === 'fuera-de-condicion'),
    [medibles],
  );

  if (!info && historialAbierto === null) {
    return (
      <Notice tone="info" title="No hay una sesión para informar">
        Conectá un vehículo, o abrí una sesión guardada desde Historial.
      </Notice>
    );
  }

  const fecha = new Date();

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="no-imprimir" style={{ display: 'grid', gap: 12, maxWidth: 940 }}>
        <Panel title="Datos del taller">
          <div style={{
            display: 'grid', gap: 10, padding: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))',
          }}>
            <Campo label="Taller" value={taller.nombre}
              onChange={(v) => setTaller({ nombre: v })} />
            <Campo label="Técnico" value={taller.tecnico}
              onChange={(v) => setTaller({ tecnico: v })} />
            <Campo label="N° de orden" value={taller.orden}
              onChange={(v) => setTaller({ orden: v })} />
            <Campo label="Contacto" value={taller.contacto}
              onChange={(v) => setTaller({ contacto: v })} />
          </div>
          <div style={{ padding: '0 12px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => window.print()}>
              Imprimir o guardar PDF
            </Button>
            <Button onClick={() => void guardarSesionActual()}>
              Guardar en historial
            </Button>
          </div>
          <div style={{ padding: '0 12px 12px' }}>
            <p style={{ fontSize: 11, color: 'var(--color-ink-faint)', margin: 0, lineHeight: 1.5 }}>
              En el diálogo de impresión, elegí "Guardar como PDF" como destino.
              El informe se imprime en blanco, sin la interfaz.
            </p>
          </div>
        </Panel>
      </div>

      {/* ── El informe propiamente dicho ────────────────────────────── */}
      <article className="informe">
        <header className="informe-cabecera">
          <div>
            <h1>Informe de diagnóstico electrónico</h1>
            <p className="informe-sub">
              {taller.nombre || 'Taller'}
              {taller.contacto && ` · ${taller.contacto}`}
            </p>
          </div>
          <dl className="informe-meta">
            <dt>Fecha</dt>
            <dd className="num">{fecha.toLocaleDateString('es-CL')} {fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</dd>
            {taller.orden && (<><dt>Orden</dt><dd className="num">{taller.orden}</dd></>)}
            {taller.tecnico && (<><dt>Técnico</dt><dd>{taller.tecnico}</dd></>)}
          </dl>
        </header>

        <Seccion titulo="Vehículo">
          <Tabla filas={[
            ['Marca y modelo', [manual.make, manual.model, manual.year].filter(Boolean).join(' ') || null],
            ['Motor', manual.engine ?? null],
            ['Cilindrada', manual.displacementL !== undefined ? `${manual.displacementL} L` : null],
            ['Kilometraje', manual.odometerKm !== undefined ? `${manual.odometerKm.toLocaleString('es')} km` : null],
            ['VIN', info?.identity.vin ?? null],
            ['Combustible', info?.fuel === 'diesel' ? 'Diésel' : info?.fuel === 'gasolina' ? 'Gasolina' : null],
          ]} />
        </Seccion>

        <Seccion titulo="Unidad de control">
          <Tabla filas={[
            ['ECU', info?.identity.ecuName ?? null],
            ['Calibración', info?.identity.calibrationId ?? null],
            ['Protocolo', info?.protocol?.name ?? null],
            ['Adaptador', info?.adapter?.version ?? null],
            ['Tensión de batería', info?.voltage != null ? `${info.voltage.toFixed(1)} V` : null],
            ['Parámetros legibles', info ? String(info.availableParams.size) : null],
          ]} />
        </Seccion>

        <Seccion titulo={`Códigos de falla (${dtcs.length})`}>
          {dtcs.length === 0 ? (
            <p className="informe-p">
              No se encontraron códigos almacenados en la unidad de control del motor.
            </p>
          ) : (
            dtcs.map((d) => {
              const k = findDtcFor(d.code, ctx);
              return (
                <div key={`${d.code}-${d.kind}`} className="informe-dtc">
                  <div className="informe-dtc-cab">
                    <span className="num informe-codigo">{d.code}</span>
                    <span className="informe-etq">{dtcKindLabel[d.kind]}</span>
                    {k !== null && <span className="informe-etq">Prioridad {k.priority}</span>}
                  </div>
                  {k !== null ? (
                    <>
                      <p className="informe-p"><strong>{k.description}</strong></p>
                      <p className="informe-p">{k.meaning}</p>
                      <p className="informe-p informe-lista">
                        <strong>Posibles causas a verificar:</strong>{' '}
                        {k.causes.join('; ')}.
                      </p>
                    </>
                  ) : (
                    <p className="informe-p">
                      Este código no cuenta con una descripción verificada en la base
                      de datos del equipo. Su significado exacto puede ser específico
                      del fabricante.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </Seccion>

        {findings.length > 0 && (
          <Seccion titulo="Análisis de parámetros">
            {findings.map((f) => (
              <div key={f.ruleId} className="informe-dtc">
                <div className="informe-dtc-cab">
                  <span className="informe-etq">{LEVEL_LABEL[f.level]}</span>
                  <strong>{f.title}</strong>
                </div>
                <p className="informe-p">{f.observed}</p>
                <p className="informe-p informe-lista">
                  <strong>A verificar:</strong> {f.check.join('; ')}.
                </p>
              </div>
            ))}
          </Seccion>
        )}

        {anormales.length > 0 && (
          <Seccion titulo={`Parámetros fuera de rango (${anormales.length})`}>
            <TablaParams items={anormales} conEstado />
          </Seccion>
        )}

        {normales.length > 0 && (
          <Seccion titulo={`Parámetros dentro de rango (${normales.length})`}>
            <TablaParams items={normales} conEstado={false} />
          </Seccion>
        )}

        <Seccion titulo="Alcance de esta revisión">
          <p className="informe-p">
            Se consultó únicamente la unidad de control del motor mediante
            diagnóstico OBD-II genérico
            {info?.protocol ? ` sobre ${info.protocol.name}` : ''}. Otras unidades
            del vehículo (frenos ABS, airbag, confort, transmisión) requieren
            diagnóstico específico del fabricante y <strong>no fueron
            revisadas</strong>.
          </p>
          {sinJuicio.length > 0 && (
            <p className="informe-p">
              {sinJuicio.length} parámetros se leyeron correctamente pero no se
              compararon contra un rango de referencia, por no existir uno
              verificado para este motor o por no cumplirse las condiciones de
              medición. Se informan sin valoración.
            </p>
          )}
          {skipped.length > 0 && (
            <p className="informe-p">
              {skipped.length} análisis no pudieron ejecutarse por falta de
              parámetros o de datos del vehículo:{' '}
              {skipped.map((s) => s.title).join('; ')}. Su ausencia no implica
              que esos sistemas estén en buen estado.
            </p>
          )}
          <p className="informe-p informe-nota">
            Las causas indicadas son hipótesis a verificar, no diagnósticos
            confirmados. Un parámetro fuera de rango señala dónde buscar; la
            confirmación requiere las comprobaciones mecánicas y eléctricas
            correspondientes.
          </p>
        </Seccion>

        <footer className="informe-pie">
          <div className="informe-firma">
            <span>Firma del técnico</span>
          </div>
          <p className="informe-nota">
            Informe generado con lectura directa de la unidad de control.
            Los valores corresponden al momento de la medición.
          </p>
        </footer>
      </article>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="informe-seccion">
      <h2>{titulo}</h2>
      {children}
    </section>
  );
}

function Tabla({ filas }: { filas: [string, string | null][] }) {
  return (
    <table className="informe-tabla">
      <tbody>
        {filas.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td className={v === null ? 'informe-vacio' : 'num'}>
              {v ?? 'No disponible'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablaParams({ items, conEstado }: {
  items: ReturnType<ReturnType<typeof useApp.getState>['evaluated']>;
  conEstado: boolean;
}) {
  return (
    <table className="informe-tabla informe-tabla-params">
      <thead>
        <tr>
          <th>Parámetro</th>
          <th>Valor</th>
          <th>Referencia</th>
          {conEstado && <th>Estado</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((e) => (
          <tr key={e.id}>
            <td>{e.def.label}</td>
            <td className="num">{formatValue(e)} {e.def.unit}</td>
            <td className="num">{formatRange(e.range) ?? '—'}</td>
            {conEstado && <td>{STATUS_LABEL[e.status]}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Campo({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span className="label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '7px 9px', marginTop: 2,
          background: 'var(--color-bg)', color: 'var(--color-ink)',
          border: '1px solid var(--color-line)', borderRadius: 3,
          fontSize: 12.5, fontFamily: 'inherit',
        }}
      />
    </label>
  );
}
