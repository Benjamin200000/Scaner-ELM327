import { useMemo, useState } from 'react';
import { useApp } from '@/state/store';
import { detectTransports } from '@/core/transport';
import type { TransportKind } from '@/core/transport/types';
import { PROTOCOLS } from '@/core/elm327/protocols';
import { PROFILES } from '@/sim/profiles';
import { Button, Field, Notice, Panel } from '../parts/Panel';
import { AdapterVerdict } from '../parts/AdapterVerdict';
import { AgentPanel } from '../parts/AgentPanel';
import { LinkDot } from '../parts/Status';

/**
 * Pantalla de conexión.
 *
 * Decisión de diseño: los transportes que este dispositivo NO puede usar se
 * muestran igual, deshabilitados y con el motivo. Esconderlos haría que el
 * usuario crea que la app no soporta Bluetooth, cuando el límite lo pone el
 * navegador. Esa confusión cuesta mucho más que una línea de texto.
 */
export function Connect() {
  const {
    progress, info, fault, manual, simProfileId, forcedProtocol, bitacora,
    connect, disconnect, setManual, setSimProfile, setForcedProtocol, clearFault,
  } = useApp();
  const session = useApp((s) => s.session);
  // En la app de escritorio todo el hardware pasa por el agente integrado:
  // los selectores de puerto del navegador no existen ahí.
  const transports = useMemo(() => {
    const todos = detectTransports();
    const escritorio = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
    return escritorio ? todos.filter((t) => t.kind === 'mock') : todos;
  }, []);

  const tInfo = session?.transport.info ?? null;
  const link = tInfo !== null
    ? `${tInfo.name ?? tInfo.kind}${tInfo.link !== undefined ? ` · ${tInfo.link}` : ''}`
    : null;
  const [busy, setBusy] = useState<TransportKind | null>(null);

  const connected = info !== null;
  const working = progress.phase !== 'desconectado' && progress.phase !== 'listo'
    && progress.phase !== 'error';

  const handle = async (kind: TransportKind): Promise<void> => {
    setBusy(kind);
    try {
      await connect(kind);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 880 }}>
      <Panel
        title="Estado de comunicación"
        aside={
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <LinkDot state={
              connected ? 'activa'
              : working ? 'trabajando'
              : progress.phase === 'error' ? 'error'
              : 'inactiva'
            } />
            <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
              {connected ? 'ACTIVA' : progress.detail}
            </span>
          </span>
        }
      >
        <div style={{
          display: 'grid', gap: 14, padding: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(135px, 100%), 1fr))',
        }}>
          <Field label="Interfaz" value={link} />
          <Field label="Protocolo" value={info?.protocol?.name ?? null} />
          <Field
            label="Batería"
            value={info?.voltage !== null && info?.voltage !== undefined
              ? `${info.voltage.toFixed(1)} V` : null}
          />
          <Field label="VIN" value={info?.identity.vin ?? null} />
          <Field label="ECU" value={info?.identity.ecuName ?? null} />
          <Field label="Calibración" value={info?.identity.calibrationId ?? null} />
          <Field
            label="Combustible"
            value={info?.fuel === 'diesel' ? 'Diésel'
              : info?.fuel === 'gasolina' ? 'Gasolina' : null}
          />
          <Field
            label="Parámetros"
            value={info ? `${info.availableParams.size} disponibles` : null}
          />
        </div>

        {info?.adapter?.likelyClone === true && (
          <div style={{ padding: '0 12px 12px' }}>
            <Notice tone="warn" title={`Adaptador reportado como ${info.adapter.version}`}>
              Esa versión nunca existió en el chip original de ELM Electronics, así
              que es un clon. Funciona para OBD-II genérico, pero puede no soportar
              los comandos de header y temporización que necesitan las funciones
              específicas de fabricante.
            </Notice>
          </div>
        )}

        {connected && (
          <div style={{ padding: '0 12px 12px' }}>
            <Button variant="danger" onClick={() => void disconnect()}>Desconectar</Button>
          </div>
        )}
      </Panel>

      {bitacora.length > 0 && (
        <Panel title="Qué hizo la conexión" aside={
          <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
            {bitacora.length} pasos · {((bitacora.at(-1)!.at - bitacora[0]!.at) / 1000).toFixed(1)} s
          </span>
        }>
          <ol style={{ listStyle: 'none', margin: 0, padding: '6px 0' }}>
            {bitacora.map((p, i) => {
              const ultimo = i === bitacora.length - 1;
              const enCurso = ultimo && working;
              return (
                <li key={`${p.at}-${i}`} style={{
                  display: 'grid', gridTemplateColumns: '18px 52px minmax(0,1fr)',
                  gap: 6, padding: '2px 12px', fontSize: 12, alignItems: 'baseline',
                }}>
                  <span aria-hidden className="num" style={{
                    color: p.fase === 'error' ? 'var(--color-fail)'
                      : enCurso ? 'var(--color-warn)' : 'var(--color-ok)',
                  }}>
                    {p.fase === 'error' ? '✕' : enCurso ? '›' : '✓'}
                  </span>
                  <span className="num" style={{ color: 'var(--color-ink-faint)', fontSize: 10.5 }}>
                    +{((p.at - bitacora[0]!.at) / 1000).toFixed(1)}s
                  </span>
                  <span style={{ color: enCurso ? 'var(--color-ink)' : 'var(--color-ink-dim)' }}>
                    {p.texto}
                  </span>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

      {connected && <AdapterVerdict info={info} transport={tInfo} />}

      {fault !== null && (
        <Notice tone="fail" title={fault.title}>
          {fault.advice !== undefined && <div>{fault.advice}</div>}
          {fault.detail !== undefined && (
            <div className="num" style={{ fontSize: 11, marginTop: 4, opacity: 0.75 }}>
              {fault.detail}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={clearFault}>Descartar</Button>
          </div>
        </Notice>
      )}

      {!connected && (
        <Panel title="Interfaz de diagnóstico">
          {transports.map((t) => (
            <div
              key={t.kind}
              className="row"
              style={{ gridTemplateColumns: 'minmax(0,1fr) auto', gap: 14 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{t.label}</div>
                <div style={{
                  fontSize: 11, color: 'var(--color-ink-faint)', marginTop: 2,
                  whiteSpace: 'normal',
                }}>
                  {t.detail}
                </div>
              </div>
              <Button
                variant={t.kind === 'mock' ? 'normal' : 'primary'}
                disabled={!t.available || busy !== null || working}
                onClick={() => void handle(t.kind)}
              >
                {busy === t.kind ? 'Conectando…' : 'Conectar'}
              </Button>
            </div>
          ))}
        </Panel>
      )}

      {!connected && <AgentPanel />}

      {!connected && (
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
        }}>
          <Panel title="Protocolo">
            <div style={{ padding: 12 }}>
              <select
                value={forcedProtocol}
                onChange={(e) => setForcedProtocol(e.target.value)}
                style={selectStyle}
              >
                {PROTOCOLS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p style={hintStyle}>
                La detección automática resuelve bien en la mayoría de los casos.
                Forzar el protocolo ayuda cuando el adaptador queda en SEARCHING
                sin resolver, típico en K-Line.
              </p>
            </div>
          </Panel>

          <Panel title="Vehículo simulado">
            <div style={{ padding: 12 }}>
              <select
                value={simProfileId}
                onChange={(e) => setSimProfile(e.target.value)}
                style={selectStyle}
              >
                {PROFILES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <p style={hintStyle}>
                Escenarios para trabajar sin vehículo. No son datos de un auto
                real: sirven para ejercitar la interfaz y las reglas.
              </p>
            </div>
          </Panel>
        </div>
      )}

      <Panel title="Datos del vehículo (carga manual)">
        <div style={{
          display: 'grid', gap: 10, padding: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))',
        }}>
          <Input label="Marca" value={manual.make ?? ''}
            onChange={(v) => setManual({ make: v || undefined })} />
          <Input label="Modelo" value={manual.model ?? ''}
            onChange={(v) => setManual({ model: v || undefined })} />
          <Input label="Motor" value={manual.engine ?? ''}
            onChange={(v) => setManual({ engine: v || undefined })} />
          <Input label="Año" value={manual.year?.toString() ?? ''}
            onChange={(v) => setManual({ year: v ? Number(v) : undefined })} />
          <Input label="Cilindrada (L)" value={manual.displacementL?.toString() ?? ''}
            onChange={(v) => setManual({ displacementL: v ? Number(v) : undefined })} />
          <Input label="Kilometraje" value={manual.odometerKm?.toString() ?? ''}
            onChange={(v) => setManual({ odometerKm: v ? Number(v) : undefined })} />
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <p style={{ ...hintStyle, marginTop: 0 }}>
            Lo que la ECU no informa se puede cargar acá. La cilindrada no es
            decorativa: sin ella la app no estima el caudal de aire teórico y
            la regla correspondiente queda sin evaluar en lugar de comparar
            contra un número inventado.
          </p>
        </div>
      </Panel>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  background: 'var(--color-bg)',
  color: 'var(--color-ink)',
  border: '1px solid var(--color-line)',
  borderRadius: 3,
  fontSize: 12.5,
  fontFamily: 'inherit',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-ink-faint)',
  marginTop: 8,
  marginBottom: 0,
  lineHeight: 1.5,
};

function Input({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span className="label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...selectStyle, marginTop: 2 }}
        className="num"
      />
    </label>
  );
}
