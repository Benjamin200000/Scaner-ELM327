import { useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/store';
import { type Definicion } from '@/core/tune/def';
import { importarXdf } from '@/core/tune/xdf';
import { leerDefinicion, type TablaLeida, compararTabla } from '@/core/tune/apply';
import { compilarTabla } from '@/core/tune/def';
import { defSimulador } from '@/core/tune/nativas';
import { Button, Notice, Panel } from '../parts/Panel';

/**
 * Visor de mapas de ECU (remap).
 *
 * Toma un volcado de memoria (de la lectura por UDS, o un .bin cargado) y una
 * definición (nativa o un XDF de la comunidad), y muestra las tablas —
 * inyección, turbo, encendido— como grillas con mapa de calor. Comparando dos
 * volcados, resalta qué celdas cambió un remap.
 *
 * Es solo lectura, a propósito: deja ENTENDER un remap sin tocar la ECU. No
 * edita ni escribe flash; una escritura fallida la inutiliza y no se deshace.
 */
export function Mapas() {
  const lectura = useApp((s) => s.lectura);
  const [dump, setDump] = useState<Uint8Array | null>(null);
  const [dumpNombre, setDumpNombre] = useState('');
  const [modificado, setModificado] = useState<Uint8Array | null>(null);
  const [def, setDef] = useState<Definicion>(defSimulador);
  const [sel, setSel] = useState(0);
  const inpBin = useRef<HTMLInputElement>(null);
  const inpMod = useRef<HTMLInputElement>(null);
  const inpXdf = useRef<HTMLInputElement>(null);

  // El volcado activo: el cargado, o el de la última lectura de memoria.
  const activo = dump ?? (lectura ? lectura.resultado.datos : null);
  const activoNombre = dump ? dumpNombre : lectura ? `Lectura · ${lectura.resultado.region.label}` : '';

  const tablas = useMemo<TablaLeida[]>(
    () => (activo ? leerDefinicion(activo, def) : []),
    [activo, def],
  );
  const tabla = tablas[sel] ?? null;

  const diff = useMemo(() => {
    if (!activo || !modificado || !tabla) return null;
    return compararTabla(activo, modificado, compilarTabla(tabla.def));
  }, [activo, modificado, tabla]);
  const celdasCambiadas = new Set((diff?.cambios ?? []).map((c) => `${c.fila}:${c.columna}`));

  const cargar = (ref: React.RefObject<HTMLInputElement | null>, set: (b: Uint8Array, n: string) => void) => {
    const f = ref.current?.files?.[0];
    if (!f) return;
    f.arrayBuffer().then((buf) => set(new Uint8Array(buf), f.name));
  };

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 1040 }}>
      <Notice tone="info" title="Visor de mapas · solo lectura">
        Muestra las tablas de la ECU para entender un remap: inyección, turbo,
        encendido. No edita ni escribe nada en la computadora — ver y comparar,
        nada más. La escritura de flash queda fuera a propósito.
      </Notice>

      <Panel title="Volcado y definición">
        <div style={{ padding: 12, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="label">Volcado</span>
            <span className="num" style={{ fontSize: 12 }}>
              {activo ? `${activoNombre} · ${activo.length} bytes` : 'ninguno'}
            </span>
            <input ref={inpBin} type="file" accept=".bin" hidden
              onChange={() => cargar(inpBin, (b, n) => { setDump(b); setDumpNombre(n); })} />
            <Button onClick={() => inpBin.current?.click()}>Cargar .bin</Button>
            {lectura && dump && (
              <Button variant="ghost" onClick={() => setDump(null)}>Usar la última lectura</Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="label">Definición</span>
            <span style={{ fontSize: 12 }}>{def.nombre} · {def.tablas.length} tablas</span>
            <input ref={inpXdf} type="file" accept=".xdf" hidden
              onChange={() => cargar(inpXdf, (b, n) => {
                setDef(importarXdf(new TextDecoder().decode(b), n)); setSel(0);
              })} />
            <Button onClick={() => inpXdf.current?.click()}>Importar XDF</Button>
            {def.nombre !== defSimulador.nombre && (
              <Button variant="ghost" onClick={() => { setDef(defSimulador); setSel(0); }}>Volver a la de demo</Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="label">Comparar con</span>
            <input ref={inpMod} type="file" accept=".bin" hidden
              onChange={() => cargar(inpMod, (b) => setModificado(b))} />
            <Button onClick={() => inpMod.current?.click()}>Cargar remap (.bin)</Button>
            {modificado && <Button variant="ghost" onClick={() => setModificado(null)}>Quitar</Button>}
            {diff && (
              <span className="num" style={{ fontSize: 12, color: diff.cambios.length > 0 ? 'var(--color-warn)' : 'var(--color-ok)' }}>
                {diff.cambios.length} de {diff.celdas} celdas cambiadas en esta tabla
              </span>
            )}
          </div>
        </div>
      </Panel>

      {!activo && (
        <Notice tone="warn" title="No hay volcado">
          Cargá un .bin, o leé la memoria de la ECU en la pantalla Lectura de
          memoria. En el demo, leé la región de calibración del simulador.
        </Notice>
      )}

      {activo && tablas.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tablas.map((t, i) => (
              <button key={t.def.id} onClick={() => setSel(i)}
                className={i === sel ? 'modo-btn on' : 'modo-btn'} style={{ padding: '6px 11px' }}>
                {t.def.titulo}
              </button>
            ))}
          </div>

          {tabla && (
            <Panel
              title={tabla.def.titulo}
              aside={
                <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
                  {tabla.def.filas}×{tabla.def.columnas} · {tabla.def.unidad} · {tabla.def.bits} bits
                </span>
              }
            >
              {tabla.def.descripcion && (
                <div style={{ padding: '8px 12px 0', fontSize: 11.5, color: 'var(--color-ink-dim)' }}>
                  {tabla.def.descripcion}
                </div>
              )}
              {tabla.problema && (
                <div style={{ padding: 12 }}><Notice tone="fail" title="Problema">{tabla.problema}</Notice></div>
              )}
              <div style={{ overflowX: 'auto', padding: 12 }}>
                <GrillaMapa tabla={tabla} cambiadas={celdasCambiadas} />
              </div>
              <div style={{ padding: '0 12px 12px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <Dato label="Mínimo" v={`${tabla.min.toFixed(tabla.def.decimales)} ${tabla.def.unidad}`} />
                <Dato label="Máximo" v={`${tabla.max.toFixed(tabla.def.decimales)} ${tabla.def.unidad}`} />
                <Dato label="Dirección" v={`0x${tabla.def.direccion.toString(16).toUpperCase()}`} />
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function GrillaMapa({ tabla, cambiadas }: { tabla: TablaLeida; cambiadas: Set<string> }) {
  const rango = tabla.max - tabla.min || 1;
  const color = (v: number): string => {
    // Rampa azul → amarillo → rojo según el valor en el rango.
    const t = Math.max(0, Math.min(1, (v - tabla.min) / rango));
    const h = 220 - t * 220; // 220 (azul) a 0 (rojo)
    return `hsl(${h} 55% 22%)`;
  };
  const dec = tabla.def.decimales;
  return (
    <table className="num" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr>
          <th style={{ ...th, color: 'var(--color-ink-faint)' }} />
          {tabla.x.map((xv, c) => (
            <th key={c} style={{ ...th, color: 'var(--color-ink-dim)' }}>{formatEje(xv)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tabla.valores.map((fila, f) => (
          <tr key={f}>
            <th style={{ ...th, color: 'var(--color-ink-dim)', textAlign: 'right', paddingRight: 6 }}>
              {formatEje(tabla.y[f] ?? f)}
            </th>
            {fila.map((v, c) => {
              const cambiada = cambiadas.has(`${f}:${c}`);
              return (
                <td key={c} style={{
                  padding: '3px 7px', textAlign: 'right', background: color(v),
                  color: '#e8ebee', whiteSpace: 'nowrap',
                  outline: cambiada ? '2px solid var(--color-warn)' : 'none',
                  outlineOffset: '-2px',
                }}>
                  {v.toFixed(dec)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '3px 7px', fontWeight: 600, fontSize: 10.5 };
const formatEje = (v: number): string => Number.isInteger(v) ? String(v) : v.toFixed(1);

function Dato({ label, v }: { label: string; v: string }) {
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span className="label">{label}</span>
      <span className="num" style={{ fontSize: 12.5 }}>{v}</span>
    </span>
  );
}
