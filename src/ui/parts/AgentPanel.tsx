import { useApp } from '@/state/store';
import { Button, Notice, Panel } from './Panel';

/**
 * Configuración del agente local.
 *
 * El flujo es en dos pasos a propósito: primero "Buscar interfaces", después
 * elegir y conectar. El usuario no sabe de antemano en qué COM quedó su
 * adaptador Bluetooth, así que primero tiene que poder mirar.
 */
export function AgentPanel() {
  const {
    agentUrl, agentToken, agentInterfaces, agentInterfaceId, agentBusy, agentVersion,
    setAgentUrl, setAgentToken, setAgentInterfaceId, probeAgent, connect,
  } = useApp();

  const elegida = agentInterfaces.find((i) => i.id === agentInterfaceId) ?? null;
  const utiles = agentInterfaces.filter((i) => i.kind !== 'error');
  const problemas = agentInterfaces.filter((i) => i.kind === 'error');

  return (
    <Panel
      title="Agente local"
      aside={
        agentVersion !== null && (
          <span className="label" style={{ color: 'var(--color-ok)' }}>{agentVersion}</span>
        )
      }
    >
      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        <p style={{
          fontSize: 11.5, color: 'var(--color-ink-dim)', margin: 0, lineHeight: 1.55,
        }}>
          Alcanza lo que el navegador no puede tocar: ELM327 Bluetooth Classic,
          cable K-Line y, más adelante, J2534. Si el agente corre en la
          notebook con <span className="num">--lan</span>, esta app puede usarse
          desde una tablet contra el adaptador enchufado allá.
        </p>

        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
        }}>
          <label style={{ display: 'block', minWidth: 0 }}>
            <span className="label">Dirección</span>
            <input
              value={agentUrl}
              onChange={(e) => setAgentUrl(e.target.value)}
              placeholder="ws://127.0.0.1:8777"
              className="num"
              style={input}
            />
          </label>
          <label style={{ display: 'block', minWidth: 0 }}>
            <span className="label">Token</span>
            <input
              value={agentToken}
              onChange={(e) => setAgentToken(e.target.value)}
              placeholder="lo imprime el agente al arrancar"
              type="password"
              className="num"
              style={input}
            />
          </label>
        </div>

        <div>
          <Button
            disabled={agentBusy || agentToken === ''}
            onClick={() => void probeAgent()}
          >
            {agentBusy ? 'Buscando…' : 'Buscar interfaces'}
          </Button>
        </div>

        {problemas.map((p) => (
          <Notice key={p.id} tone="warn" title={p.label}>{p.detail}</Notice>
        ))}

        {utiles.length > 0 && (
          <>
            <label style={{ display: 'block' }}>
              <span className="label">Interfaz</span>
              <select
                value={agentInterfaceId}
                onChange={(e) => setAgentInterfaceId(e.target.value)}
                style={input}
              >
                {utiles.map((i) => (
                  <option key={i.id} value={i.id}>{i.label}</option>
                ))}
              </select>
            </label>
            {elegida !== null && (
              <div style={{
                fontSize: 11, color: 'var(--color-ink-faint)', lineHeight: 1.5,
              }}>
                {elegida.detail}
                {elegida.kind === 'bluetooth-spp' && (
                  <div style={{ color: 'var(--color-ok)', marginTop: 3 }}>
                    Este es el caso que el navegador no puede alcanzar por sí solo.
                  </div>
                )}
              </div>
            )}
            <div>
              <Button
                variant="primary"
                disabled={agentBusy || agentInterfaceId === ''}
                onClick={() => void connect('websocket')}
              >
                Conectar por el agente
              </Button>
            </div>
          </>
        )}

        {agentInterfaces.length === 0 && agentVersion === null && (
          <div style={{
            fontSize: 11, color: 'var(--color-ink-faint)', lineHeight: 1.6,
          }}>
            Para levantarlo, en la notebook:{' '}
            <span className="num">node agent/scaner-agent.mjs</span>.
            Imprime la dirección y el token al arrancar. Agregá{' '}
            <span className="num">--simular</span> para verificar el enlace sin
            adaptador, y <span className="num">--lan</span> para alcanzarlo desde
            otro equipo.
          </div>
        )}
      </div>
    </Panel>
  );
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  marginTop: 2,
  background: 'var(--color-bg)',
  color: 'var(--color-ink)',
  border: '1px solid var(--color-line)',
  borderRadius: 3,
  fontSize: 12.5,
  fontFamily: 'inherit',
};
