import { useState } from 'react';
import { useApp } from '@/state/store';
import { DIRECCION } from '@/core/kline/engine';
import { Button, Field, Notice, Panel } from '../parts/Panel';
import { buscarGrupoVag, nombreCampo } from '@/knowledge/vag/groups';

/**
 * Diagnóstico VAG por K-Line (KW1281).
 *
 * El protocolo que un ELM327 no puede hablar y un cable KKL sí: grupos de
 * medición, identificación profunda y fallas con el código VAG de 5 dígitos,
 * en las ECU del grupo VAG anteriores a ~2005.
 *
 * Para probar sin cable, la fuente "Simulador" usa un ECU Golf ME7.5 en
 * memoria. Con el cable, el agente hace el init de 5 baudios y el handshake.
 */
export function Vag() {
  const { kline, agentInterfaceId, klineConectar, klineVerGrupo, klineLeerFallas, klineDesconectar } = useApp();
  const [fuente, setFuente] = useState<'simulador' | 'agente'>('simulador');
  const [direccion, setDireccion] = useState<number>(DIRECCION.motor);
  const [grupoTexto, setGrupoTexto] = useState('1');

  const conectado = kline.estado === 'conectado';
  const unidades: [string, number][] = [
    ['Motor', DIRECCION.motor], ['Cambio automático', DIRECCION.cambio],
    ['ABS', DIRECCION.abs], ['Tablero', DIRECCION.tablero],
    ['Airbag', DIRECCION.airbag], ['Climatizador', DIRECCION.climatizador],
    ['Central de confort', DIRECCION.centralConfort],
  ];
  const gruposComunes = [1, 2, 3, 4, 20, 31, 115];

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 980 }}>
      <Notice tone="info" title="K-Line, para VAG anteriores a ~2005">
        Volkswagen, Audi, SEAT y Škoda viejos hablan KW1281, que necesita un
        cable KKL: el ELM327 no puede. Trae grupos de medición, identificación
        y fallas con el código VAG de 5 dígitos. Lo nuevo (CAN) va por las otras
        pantallas.
      </Notice>

      {!conectado && (
        <Panel title="Conexión">
          <div style={{ padding: 12, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['simulador', 'agente'] as const).map((f) => (
                <button key={f} onClick={() => setFuente(f)}
                  className={fuente === f ? 'modo-btn on' : 'modo-btn'}
                  style={{ padding: '6px 12px' }}>
                  {f === 'simulador' ? 'Simulador (Golf ME7.5)' : 'Cable KKL (agente)'}
                </button>
              ))}
            </div>
            {fuente === 'agente' && agentInterfaceId === '' && (
              <Notice tone="warn" title="Falta elegir el cable">
                Configurá el agente y elegí el puerto del cable KKL en la
                pantalla Conexión.
              </Notice>
            )}
            <label style={{ display: 'block', maxWidth: 280 }}>
              <span className="label">Unidad</span>
              <select value={direccion} onChange={(e) => setDireccion(Number(e.target.value))} style={input}>
                {unidades.map(([n, d]) => (
                  <option key={d} value={d}>{n} (0x{d.toString(16).padStart(2, '0').toUpperCase()})</option>
                ))}
              </select>
            </label>
            <div>
              <Button
                variant="primary"
                disabled={kline.estado === 'conectando' || (fuente === 'agente' && agentInterfaceId === '')}
                onClick={() => void klineConectar(fuente, direccion)}
              >
                {kline.estado === 'conectando' ? 'Conectando…' : 'Conectar'}
              </Button>
            </div>
            {kline.estado === 'error' && kline.error !== null && (
              <Notice tone="fail" title="No se pudo conectar">{kline.error}</Notice>
            )}
            {fuente === 'agente' && (
              <p style={{ fontSize: 11, color: 'var(--color-ink-faint)', margin: 0, lineHeight: 1.5 }}>
                El init de 5 baudios y el handshake byte a byte están portados de
                la implementación de referencia pero no verificados contra un
                cable real. Si falla el primer intento, suele ser el baud rate o
                la latencia del cable.
              </p>
            )}
          </div>
        </Panel>
      )}

      {conectado && kline.ident !== null && (
        <>
          <Panel title="Identificación" aside={
            <Button variant="danger" onClick={() => void klineDesconectar()}>Desconectar</Button>
          }>
            <div style={{ display: 'grid', gap: 14, padding: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px,100%),1fr))' }}>
              <Field label="Número de repuesto" value={kline.ident.numeroRepuesto} />
              <Field label="Componente" value={kline.ident.componente} />
              <Field label="Protocolo" value={`KW ${kline.ident.version}`} />
            </div>
          </Panel>

          <Panel title={buscarGrupoVag(kline.grupoNum)
            ? `Grupo ${kline.grupoNum} · ${buscarGrupoVag(kline.grupoNum)!.titulo}`
            : `Grupo de medición ${kline.grupoNum}`} aside={
            <span className="label" style={{ color: 'var(--color-ink-dim)' }}>en vivo</span>
          }>
            <div style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--color-line-soft)' }}>
              <span className="label">Grupo</span>
              {gruposComunes.map((g) => (
                <button key={g} onClick={() => { klineVerGrupo(g); setGrupoTexto(String(g)); }}
                  className={kline.grupoNum === g ? 'modo-btn on' : 'modo-btn'}
                  style={{ padding: '4px 10px' }}>{g}</button>
              ))}
              <input value={grupoTexto} onChange={(e) => setGrupoTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') klineVerGrupo(Number(grupoTexto) || 1); }}
                className="num" style={{ ...input, width: 64 }} />
              <Button onClick={() => klineVerGrupo(Number(grupoTexto) || 1)}>Ver</Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px,50%),1fr))' }}>
              {(kline.grupo?.mediciones ?? []).map((m, i) => (
                <div key={i} className="tile">
                  <div className="label">{nombreCampo(kline.grupoNum, i)}</div>
                  <div className="num tile-valor" style={{ fontSize: 24 }}>
                    {m.value !== null ? m.value.toFixed(1) : m.text}
                    {m.value !== null && <span className="tile-unidad">{m.unit}</span>}
                  </div>
                </div>
              ))}
              {(kline.grupo?.mediciones.length ?? 0) === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
                  El grupo {kline.grupoNum} no tiene datos en esta unidad.
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Fallas" aside={
            <Button onClick={() => void klineLeerFallas()}>Leer fallas</Button>
          }>
            {kline.fallas === null ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
                Tocá "Leer fallas" para consultar la memoria de averías de esta unidad.
              </div>
            ) : kline.fallas.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ok)' }}>Sin fallas almacenadas.</div>
            ) : (
              kline.fallas.map((f) => (
                <div key={f.codigo} className="row" style={{ display: 'block' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span className="num" style={{ fontSize: 15 }}>{f.codigo}</span>
                    {f.sistema !== null && <span className="label">{f.sistema}</span>}
                    <span className="label" style={{ marginLeft: 'auto', color: f.presente ? 'var(--color-fail)' : 'var(--color-warn)' }}>
                      {f.presente ? 'Presente' : 'Esporádica'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 2, color: f.descripcion ? 'var(--color-ink)' : 'var(--color-ink-faint)' }}>
                    {f.descripcion ?? 'Sin descripción en la tabla · estado 0x' + f.estado.toString(16).toUpperCase().padStart(2, '0')}
                  </div>
                </div>
              ))
            )}
            <div style={{ padding: 10, borderTop: '1px solid var(--color-line-soft)' }}>
              <p style={{ fontSize: 11, color: 'var(--color-ink-faint)', margin: 0, lineHeight: 1.5 }}>
                Los códigos VAG de 5 dígitos son propios del fabricante. La tabla
                cubre los más comunes de ME7.5; uno que no esté se muestra por
                su número. El bit 0x80 del estado marca las esporádicas.
              </p>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', padding: '7px 9px', marginTop: 2, background: 'var(--color-bg)',
  color: 'var(--color-ink)', border: '1px solid var(--color-line)', borderRadius: 3,
  fontSize: 12.5, fontFamily: 'inherit',
};
