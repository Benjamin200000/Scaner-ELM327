import { useState } from 'react';
import { useApp } from '@/state/store';
import { MODULOS, moduloPorId, type RegionMemoria } from '@/core/uds/modules';
import { ALGORITMOS } from '@/core/uds/security';
import { Button, Notice, Panel } from '../parts/Panel';

/**
 * Lectura de memoria de la ECU (UDS).
 *
 * Lo que un ELM327 no puede y un J2534 sí: abrir sesión extendida,
 * desbloquear la ECU y leer su memoria. Solo lectura — esta pantalla nunca
 * escribe, porque una escritura de flash fallida es lo único que deja una
 * ECU inservible.
 *
 * Como PCMFlash, funciona con módulos: cada uno describe cómo leer una
 * familia de ECU. La app trae el del simulador y un módulo manual; un módulo
 * para tu ECU real necesita su algoritmo de llave y su mapa, que se conectan
 * aparte.
 */
export function Memoria() {
  const {
    info, advanced, setAdvanced, ocupado, lectura, lecturaAvance,
    leerMemoria, cancelarLectura, descargarMemoria,
  } = useApp();
  const [moduloId, setModuloId] = useState(MODULOS[0]!.id);
  const [confirmar, setConfirmar] = useState<RegionMemoria | null>(null);
  const [manual, setManual] = useState({ dir: '80010000', tam: '512' });

  if (!info) return null;
  const modulo = moduloPorId(moduloId)!;
  const esCan = info.protocol?.family === 'can';
  const algoritmo = ALGORITMOS.find((a) => a.id === modulo.seguridad.algoritmo);

  const regiones: RegionMemoria[] = modulo.id === 'manual'
    ? [{
        id: 'manual', label: 'Región manual',
        direccion: parseInt(manual.dir, 16) || 0,
        tamano: parseInt(manual.tam, 10) || 0,
      }]
    : modulo.regiones;

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 980 }}>
      <Notice tone="info" title="Qué es esto y qué no">
        Lee la memoria de la computadora sin modificarla: identificación,
        calibración o el programa, según la ECU. Es solo lectura. No escribe ni
        reprograma nada: eso queda fuera a propósito, porque una escritura
        fallida inutiliza la ECU y no se puede deshacer.
      </Notice>

      {!esCan && (
        <Notice tone="warn" title="Hace falta un protocolo CAN">
          La lectura de memoria por UDS corre sobre CAN. Este vehículo está en
          otro protocolo.
        </Notice>
      )}

      <Notice tone="warn" title="Con ELM327 suele no alcanzar">
        El ELM327 limita el largo de los mensajes, así que muchas ECU cortan la
        lectura. El camino confiable es un adaptador J2534 (tu MaxiFlash), que
        no tiene ese límite. La app usa el que tengas conectado; con ELM327
        puede fallar a mitad.
      </Notice>

      <Panel
        title="Módulo de lectura"
        aside={
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={advanced}
              onChange={(e) => setAdvanced(e.target.checked)} />
            <span className="label" style={{ color: advanced ? 'var(--color-warn)' : 'var(--color-ink-faint)' }}>
              Modo avanzado
            </span>
          </label>
        }
      >
        <div style={{ padding: 12, display: 'grid', gap: 10 }}>
          <select value={moduloId} onChange={(e) => setModuloId(e.target.value)} style={input}>
            {MODULOS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: 'var(--color-ink-dim)', lineHeight: 1.6 }}>
            {modulo.aplica}.
            {modulo.soloSimulador && (
              <span style={{ color: 'var(--color-warn)' }}> Solo probado contra el simulador.</span>
            )}
          </div>
          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))',
          }}>
            <Dato label="Se le habla por" valor={modulo.reqAddr} />
            <Dato label="Contesta por" valor={modulo.resAddr} />
            <Dato label="Sesión" valor={`0x${modulo.sesion.toString(16)}`} />
            <Dato label="Método" valor={modulo.metodo === 'subida' ? 'Subida por bloques' : 'Lectura por dirección'} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-ink-dim)' }}>
            <span className="label">Acceso de seguridad: </span>
            {modulo.seguridad.nivel === 0
              ? 'No requerido'
              : algoritmo?.label ?? modulo.seguridad.algoritmo}
            {algoritmo && modulo.seguridad.nivel > 0 && (
              <div style={{ color: 'var(--color-ink-faint)', marginTop: 2 }}>{algoritmo.descripcion}</div>
            )}
          </div>
        </div>
      </Panel>

      {modulo.id === 'manual' && (
        <Panel title="Región a leer">
          <div style={{ padding: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px,100%),1fr))' }}>
            <label style={{ minWidth: 0 }}>
              <span className="label">Dirección (hex)</span>
              <input value={manual.dir} onChange={(e) => setManual({ ...manual, dir: e.target.value })}
                className="num" style={input} />
            </label>
            <label style={{ minWidth: 0 }}>
              <span className="label">Tamaño (bytes)</span>
              <input value={manual.tam} onChange={(e) => setManual({ ...manual, tam: e.target.value })}
                className="num" style={input} />
            </label>
          </div>
        </Panel>
      )}

      <Panel title="Regiones">
        {regiones.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
            Este módulo no define regiones.
          </div>
        )}
        {regiones.map((r) => (
          <div key={r.id} className="row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5 }}>{r.label}</div>
              <div className="num" style={{ fontSize: 11, color: 'var(--color-ink-faint)', marginTop: 2 }}>
                0x{r.direccion.toString(16).toUpperCase().padStart(8, '0')} · {r.tamano} bytes
                {r.nota && <span style={{ fontFamily: 'var(--font-ui)' }}> · {r.nota}</span>}
              </div>
            </div>
            <Button
              variant="primary"
              disabled={!esCan || !advanced || ocupado !== null || r.tamano === 0}
              onClick={() => setConfirmar(r)}
            >
              {ocupado === 'memoria' ? 'Leyendo…' : 'Leer'}
            </Button>
          </div>
        ))}
        {!advanced && (
          <div style={{ padding: '0 12px 12px' }}>
            <span style={{ fontSize: 11.5, color: 'var(--color-ink-faint)' }}>
              Activá el modo avanzado para habilitar la lectura.
            </span>
          </div>
        )}
      </Panel>

      {lecturaAvance !== null && (
        <Panel title="Leyendo">
          <div style={{ padding: 12 }}>
            <div style={{ height: 10, background: 'var(--color-bg)', border: '1px solid var(--color-line)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'var(--color-info)',
                width: `${lecturaAvance.total > 0 ? (lecturaAvance.leido / lecturaAvance.total) * 100 : 0}%`,
                transition: 'width .15s',
              }} />
            </div>
            <div className="num" style={{ fontSize: 12, marginTop: 6, color: 'var(--color-ink-dim)' }}>
              {lecturaAvance.leido} / {lecturaAvance.total} bytes
            </div>
            <div style={{ marginTop: 10 }}>
              <Button variant="ghost" onClick={cancelarLectura}>Cancelar</Button>
            </div>
          </div>
        </Panel>
      )}

      {lectura !== null && (
        <Panel
          title={`Memoria leída · ${lectura.resultado.region.label}`}
          aside={
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="label" style={{
                color: lectura.resultado.completa ? 'var(--color-ok)' : 'var(--color-warn)',
              }}>
                {lectura.resultado.completa
                  ? `${lectura.resultado.datos.length} bytes`
                  : 'Incompleta'}
              </span>
              <Button onClick={descargarMemoria}>Descargar .bin</Button>
            </span>
          }
        >
          {!lectura.resultado.completa && (
            <div style={{ padding: 12 }}>
              <Notice tone="warn" title="No se leyó todo">{lectura.resultado.motivo}</Notice>
            </div>
          )}
          <div style={{
            maxHeight: '46vh', overflow: 'auto', background: 'var(--color-bg)',
            padding: '6px 0',
          }}>
            <pre className="num" style={{ margin: 0, padding: '0 12px', fontSize: 11, lineHeight: 1.5 }}>
              {lectura.volcado.slice(0, 2048).join('\n')}
            </pre>
          </div>
          <div style={{ padding: 10 }}>
            <p style={{ fontSize: 11, color: 'var(--color-ink-faint)', margin: 0, lineHeight: 1.5 }}>
              Se muestran las primeras líneas. El archivo .bin trae todo. Con el
              número de repuesto y la versión (pantalla Computadora) se
              identifica contra qué comparar este volcado.
            </p>
          </div>
        </Panel>
      )}

      {confirmar !== null && (
        <Confirmar
          region={confirmar}
          modulo={modulo.label}
          onCancelar={() => setConfirmar(null)}
          onLeer={() => { const r = confirmar; setConfirmar(null); void leerMemoria(moduloId, r); }}
        />
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="label">{label}</div>
      <div className="num" style={{ fontSize: 13 }}>{valor}</div>
    </div>
  );
}

function Confirmar({ region, modulo, onCancelar, onLeer }: {
  region: RegionMemoria; modulo: string; onCancelar: () => void; onLeer: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'rgba(5,7,9,0.80)',
      display: 'grid', placeItems: 'center', padding: 16, zIndex: 50,
    }}>
      <div className="panel" style={{ maxWidth: 480, width: '100%' }}>
        <div className="panel-head">
          <h2 className="label" style={{ margin: 0 }}>Leer memoria</h2>
        </div>
        <div style={{ padding: 14, fontSize: 12.5, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 10px' }}>
            Se va a leer <strong>{region.label}</strong> ({region.tamano} bytes
            desde 0x{region.direccion.toString(16).toUpperCase()}) con el módulo{' '}
            <strong>{modulo}</strong>.
          </p>
          <p style={{ margin: 0, color: 'var(--color-ink-dim)' }}>
            Es una operación de solo lectura: abre una sesión de diagnóstico y
            copia la memoria. No modifica nada en la ECU. Mantené el motor en
            contacto y el adaptador firme; si se corta, se reintenta.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 12, borderTop: '1px solid var(--color-line)' }}>
          <Button onClick={onCancelar}>Cancelar</Button>
          <Button variant="primary" onClick={onLeer}>Leer</Button>
        </div>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', padding: '7px 9px', marginTop: 2, background: 'var(--color-bg)',
  color: 'var(--color-ink)', border: '1px solid var(--color-line)', borderRadius: 3,
  fontSize: 12.5, fontFamily: 'inherit',
};
