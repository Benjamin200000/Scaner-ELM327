import { useEffect, useRef } from 'react';
import { useApp } from '@/state/store';
import { Button, Panel } from '../parts/Panel';

/**
 * Terminal de comunicación.
 *
 * Existe porque los problemas reales de un ELM327 son problemas de enlace, y
 * sin ver el tráfico crudo no se diagnostican: un clon que ignora ATH1, un
 * baud rate equivocado que devuelve basura, una ECU que tarda más que el
 * timeout. Muestra TX, RX, el tiempo de ida y vuelta y los errores.
 *
 * Está apagado por defecto: capturar todo el tráfico a varios hercios suma
 * trabajo que no hace falta mientras no se esté depurando.
 */
export function Terminal() {
  const { trace, debug, setDebug, session } = useApp();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [trace.length]);

  const slow = trace.filter((t) => (t.elapsedMs ?? 0) > 300).length;
  const errors = trace.filter((t) => t.direction === 'error').length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Panel
        title="Terminal"
        aside={
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="label" style={{ color: 'var(--color-ink-dim)' }}>
              {trace.length} eventos · {errors} errores · {slow} lentos
            </span>
            <Button
              variant={debug ? 'primary' : 'normal'}
              onClick={() => setDebug(!debug)}
            >
              {debug ? 'Debug activo' : 'Activar debug'}
            </Button>
          </span>
        }
      >
        {!debug && trace.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-dim)' }}>
            El modo debug está apagado. Al activarlo se registra cada comando
            enviado al adaptador, su respuesta, el tiempo de ida y vuelta y los
            errores de enlace.
          </div>
        )}

        <div
          style={{
            maxHeight: '58vh', overflowY: 'auto', padding: '4px 0',
            background: 'var(--color-bg)',
          }}
        >
          {trace.map((t, i) => (
            <div
              key={`${t.at}-${i}`}
              className="num"
              style={{
                display: 'grid',
                gridTemplateColumns: '62px 28px minmax(0,1fr) 54px',
                gap: 8,
                padding: '1px 10px',
                fontSize: 11.5,
                color: t.direction === 'error' ? 'var(--color-fail)'
                  : t.direction === 'tx' ? 'var(--color-ink-dim)'
                  : 'var(--color-ink)',
              }}
            >
              <span style={{ color: 'var(--color-ink-faint)' }}>
                {new Date(t.at).toLocaleTimeString('es', { hour12: false })}
              </span>
              <span style={{
                color: t.direction === 'tx' ? 'var(--color-info)'
                  : t.direction === 'error' ? 'var(--color-fail)'
                  : 'var(--color-ok)',
              }}>
                {t.direction === 'tx' ? 'TX' : t.direction === 'rx' ? 'RX' : '!!'}
              </span>
              <span style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {t.text}
              </span>
              <span style={{
                textAlign: 'right',
                color: (t.elapsedMs ?? 0) > 300 ? 'var(--color-warn)'
                  : 'var(--color-ink-faint)',
              }}>
                {t.elapsedMs !== undefined ? `${t.elapsedMs}ms` : ''}
              </span>
            </div>
          ))}
          <div ref={end} />
        </div>
      </Panel>

      {session !== null && (
        <Panel title="PID soportados sin decodificar">
          <div style={{ padding: 12 }}>
            {session.undecodedPids().length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--color-ink-dim)' }}>
                La app sabe decodificar todos los PID que esta ECU declara.
              </span>
            ) : (
              <>
                <div className="num" style={{ fontSize: 12, lineHeight: 1.8 }}>
                  {session.undecodedPids()
                    .map((p) => `01${p.toString(16).toUpperCase().padStart(2, '0')}`)
                    .join('  ')}
                </div>
                <p style={{
                  fontSize: 11, color: 'var(--color-ink-faint)', margin: '8px 0 0',
                  lineHeight: 1.5,
                }}>
                  Esta ECU los declara soportados, pero el catálogo todavía no
                  tiene su fórmula. Se listan en lugar de ignorarlos: son los
                  próximos candidatos a agregar, y saber que existen es mejor
                  que suponer que la cobertura está completa.
                </p>
              </>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
