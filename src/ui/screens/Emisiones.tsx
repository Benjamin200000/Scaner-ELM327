import { useApp } from '@/state/store';
import { nombreMonitor, type TestResult } from '@/core/obd2/mode06';
import { describeEcu } from '@/core/elm327/frames';
import { Button, Notice, Panel } from '../parts/Panel';
import { ReadinessPanel } from '../parts/ReadinessPanel';

/**
 * Emisiones: monitores de preparación y resultados de sus pruebas.
 *
 * Las dos mitades se complementan. Los monitores dicen si cada
 * autodiagnóstico corrió; el modo 06 dice cuánto midió y contra qué límite.
 * Una prueba que aprueba pegada al límite todavía no genera código, pero es
 * el aviso más temprano que da el vehículo.
 */
export function Emisiones() {
  const { info, mode, mode06, ocupado, cargarModo06 } = useApp();
  if (!info) return null;
  const esCan = info.protocol?.family === 'can';

  const fallidas = mode06?.filter((t) => !t.passed) ?? [];
  const alLimite = mode06?.filter((t) => t.passed && t.position !== null
    && (t.position > 85 || t.position < 15)) ?? [];

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 980 }}>
      <ReadinessPanel readiness={info.readiness} mode={mode} />

      <Panel
        title="Resultados de autodiagnóstico (modo 06)"
        aside={
          <Button disabled={!esCan || ocupado !== null} onClick={() => void cargarModo06()}>
            {ocupado === 'modo06' ? 'Leyendo…' : mode06 ? 'Actualizar' : 'Leer'}
          </Button>
        }
      >
        {!esCan && (
          <div style={pad}>
            En este protocolo el modo 06 tiene un formato propio de cada
            fabricante y no se intenta. Está disponible en vehículos CAN.
          </div>
        )}
        {esCan && mode06 === null && (
          <div style={pad}>
            Cada monitor guarda el valor que midió y los límites contra los que
            lo comparó. Sirve para ver un componente que está por fallar antes
            de que aparezca un código.
          </div>
        )}
        {mode06 !== null && mode06.length === 0 && (
          <div style={pad}>Esta ECU no expone resultados por el modo 06.</div>
        )}

        {mode06 !== null && mode06.length > 0 && (
          <>
            <div style={{
              display: 'flex', gap: 18, flexWrap: 'wrap', padding: '10px 12px',
              borderBottom: '1px solid var(--color-line-soft)',
            }}>
              <Cuenta n={mode06.length - fallidas.length - alLimite.length} label="dentro de límites" tono="var(--color-ok)" />
              <Cuenta n={alLimite.length} label="aprobadas cerca del límite" tono="var(--color-warn)" />
              <Cuenta n={fallidas.length} label="fuera de límites" tono="var(--color-fail)" />
            </div>
            {[...mode06]
              .sort((a, b) => Number(a.passed) - Number(b.passed))
              .map((t) => <Prueba key={`${t.ecu}-${t.mid}-${t.tid}`} t={t} tecnico={mode === 'tecnico'} />)}
            <div style={{ padding: 10 }}>
              <Notice tone="info" title="Cómo leer esto">
                El aprobado o reprobado es exacto: compara el valor con los
                límites que la propia ECU informa. Los valores van en unidades
                internas, sin convertir. Los nombres marcados "sin contrastar"
                salen de la tabla de la norma, que no pude verificar contra una
                fuente primaria.
              </Notice>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function Cuenta({ n, label, tono }: { n: number; label: string; tono: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span className="num" style={{ fontSize: 18, color: n > 0 ? tono : 'var(--color-ink-faint)' }}>{n}</span>
      <span className="label">{label}</span>
    </span>
  );
}

function Prueba({ t, tecnico }: { t: TestResult; tecnico: boolean }) {
  const nombre = nombreMonitor(t.mid);
  const alLimite = t.passed && t.position !== null && (t.position > 85 || t.position < 15);
  const tono = !t.passed ? 'var(--color-fail)' : alLimite ? 'var(--color-warn)' : 'var(--color-ok)';
  const hex = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

  return (
    <div className="row" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5 }}>
          {nombre?.label ?? `Monitor ${hex(t.mid)}`}
        </span>
        <span className="label" style={{ color: tono }}>
          {!t.passed ? 'Fuera de límites' : alLimite ? 'Cerca del límite' : 'Dentro de límites'}
        </span>
        {nombre !== null && !nombre.verified && (
          <span className="label" style={{ color: 'var(--color-ink-faint)' }}>nombre sin contrastar</span>
        )}
        {tecnico && (
          <span className="num label">
            MID {hex(t.mid)} · TID {hex(t.tid)} · escala {hex(t.uas)} · {describeEcu(t.ecu)}
          </span>
        )}
      </div>

      {/* Barra: la ventana permitida, y dónde cayó el valor. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <span className="num" style={{ fontSize: 11, color: 'var(--color-ink-faint)' }}>{t.min}</span>
        <div style={{ position: 'relative', height: 8, background: 'var(--color-bg)', border: '1px solid var(--color-line)', borderRadius: 2 }}>
          <div style={{
            position: 'absolute', top: -3, bottom: -3, width: 3, borderRadius: 1,
            background: tono,
            left: `calc(${t.passed ? (t.position ?? 50) : t.value > t.max ? 100 : 0}% - 1.5px)`,
          }} />
        </div>
        <span className="num" style={{ fontSize: 11, color: 'var(--color-ink-faint)' }}>{t.max}</span>
      </div>
      <div className="num" style={{ fontSize: 12, marginTop: 3 }}>
        valor <span style={{ color: tono, fontSize: 14 }}>{t.value}</span>
        {!t.passed && (
          <span style={{ color: 'var(--color-ink-dim)', marginLeft: 8, fontFamily: 'var(--font-ui)', fontSize: 11.5 }}>
            {t.value > t.max ? 'por encima del máximo' : 'por debajo del mínimo'}
          </span>
        )}
      </div>
    </div>
  );
}

const pad: React.CSSProperties = {
  padding: 12, fontSize: 12, color: 'var(--color-ink-dim)', lineHeight: 1.6,
};
