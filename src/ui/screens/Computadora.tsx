import { useApp } from '@/state/store';
import { describeEcu, direccionSolicitud } from '@/core/elm327/frames';
import { Button, Field, Notice, Panel } from '../parts/Panel';

/**
 * Qué computadora tiene el vehículo.
 *
 * Junta todo lo que se puede saber de las unidades de control sin abrir
 * nada: quién fabricó el vehículo (VIN), qué unidades contestan en el bus,
 * y de cada una su nombre, calibración, número de verificación y, por UDS,
 * número de repuesto, versiones de software y hardware y número de serie.
 *
 * Con el número de repuesto y la versión de software se busca el mapa o la
 * actualización correcta. Con el CVN se detecta si la calibración fue
 * modificada: lo calcula la propia ECU sobre su memoria.
 */
export function Computadora() {
  const { info, uds, ocupado, cargarUds, adaptador, ejecutarPruebaAdaptador, mode } = useApp();
  if (!info) return null;
  const v = info.vinInfo;

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 980 }}>
      <Panel title="Vehículo según el VIN">
        {v === null ? (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
            La ECU no entregó el VIN. Es habitual en vehículos anteriores a 2005.
          </div>
        ) : (
          <>
            <div style={{ padding: '10px 12px 0' }}>
              <div className="num" style={{ fontSize: 19, letterSpacing: '0.06em' }}>
                <span style={{ color: 'var(--color-info)' }}>{v.vin.slice(0, 3)}</span>
                <span style={{ color: 'var(--color-ink-dim)' }}>{v.vin.slice(3, 9)}</span>
                <span style={{ color: 'var(--color-warn)' }}>{v.vin.slice(9, 10)}</span>
                <span style={{ color: 'var(--color-ink-dim)' }}>{v.vin.slice(10, 11)}</span>
                <span>{v.vin.slice(11)}</span>
              </div>
            </div>
            <div style={grid}>
              <Field label="Fabricante" mono={false}
                value={v.manufacturer ?? `No identificado (${v.wmi})`} />
              <Field label="Fabricado en" mono={false} value={v.country} />
              <Field label="Año modelo (posición 10)" value={v.modelYear?.toString() ?? null} />
              <Field label="Número de serie" value={v.serial} />
            </div>
            {!v.valid && (
              <div style={{ padding: '0 12px 12px' }}>
                <Notice tone="warn" title="El VIN no tiene forma válida">{v.problem}</Notice>
              </div>
            )}
          </>
        )}
      </Panel>

      {info.ecus.length === 0 && (
        <Notice tone="info" title="Ninguna unidad entregó identificación">
          La ECU contesta datos pero no expone nombre ni calibración por el modo 09.
        </Notice>
      )}

      {info.ecus.map((e, i) => {
        const valores = uds[e.ecu];
        const puedeUds = direccionSolicitud(e.ecu) !== null;
        return (
          <Panel
            key={e.ecu}
            title={describeEcu(e.ecu)}
            aside={
              <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
                {i === 0 ? 'Unidad principal' : 'Unidad adicional'}
              </span>
            }
          >
            <div style={grid}>
              <Field label="Nombre" value={e.name} />
              <Field label="Calibración" value={e.calIds.join(' · ') || null} />
              <Field label="Verificación (CVN)" value={e.cvns.join(' · ') || null} />
              <Field label="Dirección" value={
                puedeUds ? `${e.ecu} ← ${direccionSolicitud(e.ecu)}` : e.ecu
              } />
            </div>

            {valores !== undefined && valores.length > 0 && (
              <div style={{ borderTop: '1px solid var(--color-line-soft)' }}>
                {valores.map((d) => (
                  <div key={d.did} className="row"
                    style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)' }}>
                    <span style={{ fontSize: 12, color: 'var(--color-ink-dim)' }}>
                      {d.label}
                      {mode === 'tecnico' && (
                        <span className="num label" style={{ marginLeft: 7 }}>
                          {d.did.toString(16).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="num" style={{
                      fontSize: 13, textAlign: 'right', overflowWrap: 'anywhere',
                    }}>
                      {d.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {valores !== undefined && valores.length === 0 && (
              <div style={{ padding: '0 12px 12px', fontSize: 11.5, color: 'var(--color-ink-faint)' }}>
                Esta unidad no contestó ningún identificador UDS. Puede no
                hablar UDS, o exigir una sesión que esta app no abre.
              </div>
            )}

            <div style={{ padding: '0 12px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                disabled={!puedeUds || ocupado !== null}
                onClick={() => void cargarUds(e.ecu)}
              >
                {ocupado === `uds:${e.ecu}` ? 'Leyendo…' : 'Identificación profunda (UDS)'}
              </Button>
              <span style={{ fontSize: 11, color: 'var(--color-ink-faint)', flex: '1 1 220px' }}>
                {puedeUds
                  ? 'Lee número de repuesto, versiones y serie. Solo lectura: no modifica nada.'
                  : 'UDS requiere CAN de 11 bits. En este protocolo solo está el modo 09.'}
              </span>
            </div>
          </Panel>
        );
      })}

      <Panel title="Comunicación">
        <div style={grid}>
          <Field label="Protocolo" mono={false} value={info.protocol?.name ?? null} />
          <Field label="Adaptador" value={info.adapter?.version ?? null} />
          <Field label="Lecturas agrupadas" mono={false}
            value={info.agrupacion ? 'Sí, hasta 6 por solicitud' : 'No: de a un parámetro'} />
          <Field label="Parámetros soportados" value={String(info.supportedPids.size)} />
        </div>
      </Panel>

      <Panel
        title="Prueba del adaptador"
        aside={
          <Button disabled={ocupado !== null} onClick={() => void ejecutarPruebaAdaptador()}>
            {ocupado === 'adaptador' ? 'Probando…' : adaptador ? 'Repetir' : 'Probar'}
          </Button>
        }
      >
        {adaptador === null ? (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)', lineHeight: 1.6 }}>
            Casi todo lo que se vende como ELM327 son clones que implementan
            una parte de los comandos. Esta prueba manda cada comando de
            configuración y anota si el adaptador lo acepta. No transmite nada
            al vehículo.
          </div>
        ) : (
          <>
            <div style={{ padding: 12 }}>
              <Notice
                tone={adaptador.avanzadoCompleto ? 'info' : 'warn'}
                title={adaptador.descripcion ?? 'Adaptador sin descripción'}
              >
                {adaptador.veredicto}
              </Notice>
            </div>
            {adaptador.resultados.map((r) => (
              <div key={r.comando} className="row"
                style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}>
                <span aria-hidden className="num" style={{
                  color: r.soportado ? 'var(--color-ok)' : 'var(--color-fail)', fontSize: 12,
                }}>
                  {r.soportado ? '✓' : '✕'}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 12.5 }}>{r.proposito}</span>
                  {!r.soportado && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-warn)' }}>
                      {r.sinEsto}
                    </span>
                  )}
                </span>
                <span className="num label">{r.comando}</span>
              </div>
            ))}
          </>
        )}
      </Panel>
    </div>
  );
}

const grid: React.CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))',
};
