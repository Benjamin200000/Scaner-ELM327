import type { SessionInfo } from '@/core/session';
import type { TransportInfo } from '@/core/transport/types';
import { Notice, Panel } from './Panel';

/**
 * Veredicto sobre el adaptador conectado.
 *
 * Responde una pregunta concreta y práctica: con ESTE adaptador y ESTE
 * protocolo, ¿hasta dónde se puede llegar desde el navegador, y hace falta
 * un agente local en la notebook?
 *
 * Existe porque esa decisión es difícil de tomar leyendo documentación y
 * fácil de tomar mirando lo que el adaptador acaba de contestar.
 */
export function AdapterVerdict({ info, transport }: {
  info: SessionInfo;
  transport: TransportInfo | null;
}) {
  const kind = transport?.kind;
  const clone = info.adapter?.likelyClone === true;
  const family = info.protocol?.family;

  const lines: { label: string; value: string; tone?: 'ok' | 'warn' | 'fail' }[] = [
    {
      label: 'Adaptador',
      value: info.adapter?.version ?? 'sin identificar',
      tone: clone ? 'warn' : 'ok',
    },
    {
      label: 'Enlace',
      value: kind === 'webserial' ? 'USB por Web Serial'
        : kind === 'webbluetooth' ? `Bluetooth LE · ${transport?.link ?? ''}`
        : kind === 'mock' ? 'Simulador, sin hardware'
        : 'desconocido',
    },
    {
      label: 'Protocolo',
      value: info.protocol?.name ?? 'sin resolver',
      tone: family === 'iso9141' || family === 'pwm' || family === 'vpw' ? 'warn' : 'ok',
    },
  ];

  const needsAgent: string[] = [];
  if (family === 'iso9141' || family === 'pwm' || family === 'vpw') {
    needsAgent.push(
      'El protocolo activo no transporta diagnóstico extendido. Con este ' +
      'vehículo solo hay OBD-II genérico, con o sin agente local.',
    );
  }
  if (clone) {
    needsAgent.push(
      'El adaptador se identifica como clon. Suele ignorar comandos de ' +
      'header y temporización, que es justo lo que necesitan las funciones ' +
      'de fabricante. Un agente local no lo arregla: el límite está en el ' +
      'firmware del adaptador.',
    );
  }
  if (kind === 'webbluetooth') {
    needsAgent.push(
      'Estás sobre BLE, que es el único Bluetooth que el navegador alcanza. ' +
      'Funciona, pero tiene más latencia que USB: para secuencias de ' +
      'escritura largas conviene cable.',
    );
  }

  return (
    <Panel title="Veredicto del adaptador">
      <div style={{
        display: 'grid', gap: 12, padding: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
      }}>
        {lines.map((l) => (
          <div key={l.label} style={{ minWidth: 0 }}>
            <div className="label">{l.label}</div>
            <div
              className="num"
              style={{
                fontSize: 12.5,
                color: l.tone === 'warn' ? 'var(--color-warn)'
                  : l.tone === 'fail' ? 'var(--color-fail)'
                  : 'var(--color-ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              title={l.value}
            >
              {l.value}
            </div>
          </div>
        ))}
      </div>

      {needsAgent.length > 0 && (
        <div style={{ padding: '0 12px 12px', display: 'grid', gap: 8 }}>
          {needsAgent.map((n) => (
            <Notice key={n.slice(0, 24)} tone="warn" title="A tener en cuenta">{n}</Notice>
          ))}
        </div>
      )}

      {kind === 'mock' && (
        <div style={{ padding: '0 12px 12px' }}>
          <Notice tone="info" title="Esto es el simulador">
            Para que este veredicto signifique algo, conectá el adaptador
            real. Con un vehículo delante, lo primero que conviene hacer es
            activar el modo debug en Terminal y exportar la sesión: ese
            archivo es lo que permite verificar las escalas que hoy están
            marcadas como no verificadas.
          </Notice>
        </div>
      )}
    </Panel>
  );
}
