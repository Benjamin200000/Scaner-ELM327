import { type Screen, useApp } from '@/state/store';
import { Connect } from '../screens/Connect';
import { Dashboard } from '../screens/Dashboard';
import { Dtcs } from '../screens/Dtcs';
import { LiveData } from '../screens/LiveData';
import { Features } from '../screens/Features';
import { Informe } from '../screens/Informe';
import { Historial } from '../screens/Historial';
import { Terminal } from '../screens/Terminal';
import { LinkDot } from '../parts/Status';

/**
 * Armazón de la aplicación.
 *
 * En pantalla ancha: barra lateral fija más área de diagnóstico, que es la
 * ergonomía de un equipo de taller. En teléfono: barra inferior, porque es
 * donde llega el pulgar con el celular en una mano y la otra en el motor.
 *
 * El cambio es por CSS puro, sin JavaScript midiendo el viewport: así no hay
 * salto al cargar ni relayout al rotar la tablet.
 */

interface NavItem {
  id: Screen;
  label: string;
  short: string;
  /** Requiere conexión activa. */
  live: boolean;
}

const NAV: NavItem[] = [
  { id: 'conexion', label: 'Conexión', short: 'Conex.', live: false },
  { id: 'resumen', label: 'Resumen', short: 'Resumen', live: true },
  { id: 'codigos', label: 'Códigos de falla', short: 'Códigos', live: true },
  { id: 'datos', label: 'Datos en vivo', short: 'Datos', live: true },
  { id: 'funciones', label: 'Funciones', short: 'Func.', live: true },
  { id: 'informe', label: 'Informe', short: 'Informe', live: false },
  { id: 'historial', label: 'Historial', short: 'Hist.', live: false },
  { id: 'terminal', label: 'Terminal', short: 'Term.', live: false },
];

export function App() {
  const { screen, setScreen, info, mode, setMode, progress, polling, paused } = useApp();
  const connected = info !== null;

  const effective: Screen = !connected && screen !== 'conexion' && screen !== 'terminal'
    ? 'conexion'
    : screen;

  return (
    <div
      style={{
        display: 'grid',
        height: '100%',
        gridTemplateAreas: '"head" "main" "nav"',
        gridTemplateRows: 'auto minmax(0,1fr) auto',
        // minmax(0,1fr) y no 1fr: el mínimo implícito 'auto' es el ancho de
        // max-content, así que una línea larga en el encabezado ensancharía
        // toda la grilla y provocaría scroll horizontal en el teléfono.
        gridTemplateColumns: 'minmax(0,1fr)',
      }}
      data-wide="false"
    >
      <style>{WIDE_LAYOUT}</style>

      <header
        style={{
          gridArea: 'head',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-line)',
          background: 'var(--color-panel)',
          minHeight: 44,
          overflow: 'hidden',
        }}
      >
        <span style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>
          Escáner OBD
        </span>

        <span style={{
          display: 'flex', alignItems: 'center', gap: 7,
          flex: '1 1 auto', minWidth: 0, overflow: 'hidden',
        }}>
          <LinkDot state={
            connected ? (polling && !paused ? 'activa' : 'trabajando')
            : progress.phase === 'error' ? 'error' : 'inactiva'
          } />
          <span className="num" style={{
            fontSize: 11, color: 'var(--color-ink-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {connected
              ? `${info.protocol?.name ?? 'protocolo desconocido'}${
                  info.voltage !== null ? ` · ${info.voltage.toFixed(1)} V` : ''}${
                  paused ? ' · PAUSADO' : ''}`
              : progress.detail}
          </span>
        </span>

        <div style={{ display: 'flex', gap: 2, flex: '0 0 auto' }}>
          {(['simple', 'tecnico'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                border: '1px solid',
                borderColor: mode === m ? '#2d5a76' : 'var(--color-line)',
                background: mode === m ? '#1d3a4d' : 'transparent',
                color: mode === m ? '#cfe6f5' : 'var(--color-ink-faint)',
                borderRadius: 3,
              }}
            >
              {m === 'simple' ? 'Simple' : 'Técnico'}
            </button>
          ))}
        </div>
      </header>

      <nav
        id="nav"
        style={{
          gridArea: 'nav',
          display: 'flex',
          borderTop: '1px solid var(--color-line)',
          background: 'var(--color-panel)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {NAV.map((item) => {
          const disabled = item.live && !connected;
          const on = effective === item.id;
          return (
            <button
              key={item.id}
              onClick={() => !disabled && setScreen(item.id)}
              disabled={disabled}
              data-nav
              style={{
                flex: 1,
                padding: '8px 4px',
                background: on ? 'var(--color-panel-alt)' : 'transparent',
                border: 0,
                borderTop: `2px solid ${on ? 'var(--color-info)' : 'transparent'}`,
                color: disabled ? 'var(--color-ink-faint)'
                  : on ? 'var(--color-ink)' : 'var(--color-ink-dim)',
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                opacity: disabled ? 0.4 : 1,
              }}
            >
              <span data-short>{item.short}</span>
              <span data-long style={{ display: 'none' }}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <main
        style={{
          gridArea: 'main',
          overflowY: 'auto',
          overflowX: 'hidden',
          minWidth: 0,
          padding: 12,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {effective === 'conexion' && <Connect />}
        {effective === 'resumen' && <Dashboard />}
        {effective === 'codigos' && <Dtcs />}
        {effective === 'datos' && <LiveData />}
        {effective === 'funciones' && <Features />}
        {effective === 'informe' && <Informe />}
        {effective === 'historial' && <Historial />}
        {effective === 'terminal' && <Terminal />}
      </main>
    </div>
  );
}

/**
 * En pantalla ancha la navegación pasa a ser una columna a la izquierda.
 * Se hace con una media query sobre grid-template-areas: una sola regla
 * reubica la barra sin que ningún componente sepa en qué tamaño está.
 */
const WIDE_LAYOUT = `
@media (min-width: 860px) {
  [data-wide] {
    grid-template-areas: "head head" "nav main" !important;
    grid-template-columns: 196px minmax(0,1fr) !important;
    grid-template-rows: auto minmax(0,1fr) !important;
  }
  #nav {
    flex-direction: column;
    border-top: 0 !important;
    border-right: 1px solid var(--color-line);
    align-items: stretch;
    padding-bottom: 0 !important;
  }
  #nav button[data-nav] {
    /* El estilo inline flex:1, que la barra inferior necesita, le gana a
       esta regla sin !important y deja botones de 143 px de alto. */
    flex: 0 0 auto !important;
    text-align: left;
    padding: 9px 14px !important;
    border-top: 0 !important;
    border-left: 2px solid transparent;
  }
  #nav [data-short] { display: none !important; }
  #nav [data-long] { display: inline !important; }
  main { padding: 14px !important; }
}
`;
