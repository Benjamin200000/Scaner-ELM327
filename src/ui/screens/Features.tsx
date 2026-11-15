import { useApp } from '@/state/store';
import type { CapabilityVerdict } from '@/core/capabilities';
import { Notice, Panel } from '../parts/Panel';
import { SupportChip } from '../parts/Status';

/**
 * Funciones de servicio y su compatibilidad real.
 *
 * Esta pantalla es, sobre todo, una declaración honesta de alcance. Las
 * funciones de fabricante (adaptaciones, pruebas de actuadores, regeneración
 * de DPF, ajustes básicos) están modeladas en la arquitectura y evaluadas
 * contra el protocolo activo, pero NO están implementadas: ejecutarlas
 * requiere verificar cada secuencia contra una ECU real, y una secuencia
 * equivocada en una adaptación o una regeneración puede dañar algo.
 *
 * Mostrar botones que no andan sería peor que no mostrarlos. Mostrar la
 * matriz de compatibilidad con el motivo sirve, porque le dice al mecánico
 * exactamente qué puede esperar de este adaptador en este vehículo.
 */
export function Features() {
  const { info } = useApp();
  if (!info) return null;

  const obd2 = info.capabilities.filter((c) => c.feature.scope === 'obd2');
  const mfr = info.capabilities.filter((c) => c.feature.scope === 'fabricante');

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 820 }}>
      <Notice tone="info" title="Alcance de esta versión">
        Lo que está implementado y probado es el bloque OBD-II genérico: lectura
        y borrado de códigos, datos en vivo, identificación y descubrimiento de
        parámetros. Las funciones de fabricante aparecen con su compatibilidad
        evaluada, pero todavía no se pueden ejecutar: cada secuencia tiene que
        verificarse contra una ECU real antes de ofrecerla, y una adaptación o
        una regeneración mal enviada puede dejar el vehículo peor que antes.
      </Notice>

      <Panel title="OBD-II genérico">
        {obd2.map((c) => (
          <Row key={c.feature.id} verdict={c} />
        ))}
      </Panel>

      <Panel title="Diagnóstico específico de fabricante">
        {mfr.map((c) => (
          <Row key={c.feature.id} verdict={c} />
        ))}
      </Panel>

      <Panel title="Por qué la separación importa">
        <div style={{
          padding: 12, fontSize: 12, color: 'var(--color-ink-dim)', lineHeight: 1.6,
        }}>
          <p style={{ margin: '0 0 8px' }}>
            Un ELM327 es un conversor de protocolo, no un equipo de diagnóstico
            de fabricante. Puede transportar solicitudes KWP2000 o UDS
            arbitrarias, así que las funciones de VAG son alcanzables en
            principio, pero dependen de la ECU concreta y de su nivel de acceso.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            Hay un límite que no es de software: los VAG anteriores a ~2001
            suelen usar <span className="num">KW1281</span>, un protocolo por
            bloques con handshake byte a byte que el ELM327 no puede hablar, por
            mucho que la ECU esté sobre K-Line. Para esos vehículos hace falta
            una interfaz KKL o un equipo dedicado.
          </p>
          <p style={{ margin: 0 }}>
            Por eso la app no promete "compatible" en el bloque de fabricante:
            lo máximo que puede afirmar sin haberlo probado en ese vehículo es
            que es alcanzable.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Row({ verdict }: { verdict: CapabilityVerdict }) {
  const { feature, support, reason, notImplemented } = verdict;
  return (
    <div className="row" style={{ display: 'block' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12.5 }}>{feature.label}</span>
        <SupportChip support={support} />
        {feature.writes && (
          <span className="label" style={{ color: 'var(--color-warn)' }}>
            escribe en la ecu
          </span>
        )}
        {feature.risk === 'fisico' && (
          <span className="label" style={{ color: 'var(--color-fail)' }}>
            mueve componentes
          </span>
        )}
        {notImplemented === true && (
          <span className="label" style={{ color: 'var(--color-ink-faint)' }}>
            no implementada
          </span>
        )}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--color-ink-faint)', marginTop: 3, lineHeight: 1.5,
      }}>
        {reason}
      </div>
    </div>
  );
}
