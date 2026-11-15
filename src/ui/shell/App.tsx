import { type Screen, useApp } from '@/state/store';
import { Connect } from '../screens/Connect';
import { Dashboard } from '../screens/Dashboard';
import { Computadora } from '../screens/Computadora';
import { Dtcs } from '../screens/Dtcs';
import { LiveData } from '../screens/LiveData';
import { Emisiones } from '../screens/Emisiones';
import { Features } from '../screens/Features';
import { Memoria } from '../screens/Memoria';
import { Vag } from '../screens/Vag';
import { Mapas } from '../screens/Mapas';
import { Informe } from '../screens/Informe';
import { Historial } from '../screens/Historial';
import { Terminal } from '../screens/Terminal';
import { LinkDot } from '../parts/Status';

/**
 * Armazón de la aplicación.
 *
 * En pantalla ancha: barra lateral con las pantallas agrupadas por tarea
 * (diagnóstico, trabajo, herramientas) y una ficha del vehículo siempre a la
 * vista. En teléfono: barra inferior que se desliza, porque diez pantallas
 * no entran a lo ancho y achicarlas las vuelve imposibles de tocar con
 * guantes.
 *
 * El cambio de disposición es CSS puro, sin medir el viewport en JavaScript.
 */

interface NavItem {
  id: Screen;
  label: string;
  short: string;
  /** Requiere conexión activa. */
  live: boolean;
  grupo: 'Vehículo' | 'Diagnóstico' | 'Trabajo' | 'Herramientas';
}

const NAV: NavItem[] = [
  { id: 'conexion', label: 'Conexión', short: 'Conexión', live: false, grupo: 'Vehículo' },
  { id: 'resumen', label: 'Resumen', short: 'Resumen', live: true, grupo: 'Vehículo' },
  { id: 'computadora', label: 'Computadora', short: 'ECU', live: true, grupo: 'Vehículo' },
  { id: 'codigos', label: 'Códigos de falla', short: 'Códigos', live: true, grupo: 'Diagnóstico' },
  { id: 'datos', label: 'Datos en vivo', short: 'Datos', live: true, grupo: 'Diagnóstico' },
  { id: 'emisiones', label: 'Emisiones', short: 'Emisiones', live: true, grupo: 'Diagnóstico' },
  { id: 'funciones', label: 'Funciones', short: 'Funciones', live: true, grupo: 'Trabajo' },
  { id: 'memoria', label: 'Lectura de memoria', short: 'Memoria', live: true, grupo: 'Trabajo' },
  { id: 'vag', label: 'VAG (K-Line)', short: 'VAG', live: false, grupo: 'Trabajo' },
  { id: 'mapas', label: 'Mapas (remap)', short: 'Mapas', live: false, grupo: 'Trabajo' },
  { id: 'informe', label: 'Informe', short: 'Informe', live: false, grupo: 'Trabajo' },
  { id: 'historial', label: 'Historial', short: 'Historial', live: false, grupo: 'Trabajo' },
  { id: 'terminal', label: 'Terminal', short: 'Terminal', live: false, grupo: 'Herramientas' },
];

export function App() {
  const {
    screen, setScreen, info, mode, setMode, progress, polling, paused, dtcs, manual, ocupado,
  } = useApp();
  const connected = info !== null;

  const libres: Screen[] = ['conexion', 'terminal', 'informe', 'historial', 'vag', 'mapas'];
  const effective: Screen = !connected && !libres.includes(screen) ? 'conexion' : screen;

  const confirmados = dtcs.filter((d) => d.kind === 'stored').length;
  const vehiculo = [
    manual.make ?? info?.vinInfo?.manufacturer,
    manual.model,
    manual.year ?? info?.vinInfo?.modelYear,
  ].filter(Boolean).join(' ');

  return (
    <div className="shell">
      <style>{LAYOUT}</style>

      <header className="shell-head">
        <span className="marca">Escáner OBD</span>

        <span className="estado">
          <LinkDot state={
            connected ? (ocupado !== null ? 'trabajando' : polling && !paused ? 'activa' : 'trabajando')
            : progress.phase === 'error' ? 'error'
            : progress.phase === 'desconectado' ? 'inactiva' : 'trabajando'
          } />
          <span className="num estado-texto">
            {connected
              ? `${info.protocol?.name ?? 'protocolo desconocido'}${
                  info.voltage !== null ? ` · ${info.voltage.toFixed(1)} V` : ''}${
                  ocupado !== null ? ' · OCUPADO' : paused ? ' · PAUSADO' : ''}`
              : progress.detail}
          </span>
        </span>

        <div className="modo">
          {(['simple', 'tecnico'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={mode === m ? 'modo-btn on' : 'modo-btn'}
            >
              {m === 'simple' ? 'Simple' : 'Técnico'}
            </button>
          ))}
        </div>
      </header>

      <nav id="nav" className="shell-nav">
        {connected && (
          <div className="ficha">
            <div className="ficha-nombre">{vehiculo || 'Vehículo conectado'}</div>
            {info.identity.vin !== null && (
              <div className="num ficha-dato">{info.identity.vin}</div>
            )}
            {info.identity.ecuName !== null && (
              <div className="num ficha-dato">{info.identity.ecuName}</div>
            )}
          </div>
        )}
        {NAV.map((item, i) => {
          const disabled = item.live && !connected;
          const on = effective === item.id;
          const primeroDelGrupo = NAV[i - 1]?.grupo !== item.grupo;
          return (
            <div key={item.id} className="nav-celda">
              {primeroDelGrupo && <div className="nav-grupo label">{item.grupo}</div>}
              <button
                onClick={() => !disabled && setScreen(item.id)}
                disabled={disabled}
                className={on ? 'nav-btn on' : 'nav-btn'}
                aria-current={on ? 'page' : undefined}
              >
                <span className="nav-short">{item.short}</span>
                <span className="nav-long">{item.label}</span>
                {item.id === 'codigos' && connected && confirmados > 0 && (
                  <span className="num nav-badge">{confirmados}</span>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      <main className="shell-main">
        {effective === 'conexion' && <Connect />}
        {effective === 'resumen' && <Dashboard />}
        {effective === 'computadora' && <Computadora />}
        {effective === 'codigos' && <Dtcs />}
        {effective === 'datos' && <LiveData />}
        {effective === 'emisiones' && <Emisiones />}
        {effective === 'funciones' && <Features />}
        {effective === 'memoria' && <Memoria />}
        {effective === 'vag' && <Vag />}
        {effective === 'mapas' && <Mapas />}
        {effective === 'informe' && <Informe />}
        {effective === 'historial' && <Historial />}
        {effective === 'terminal' && <Terminal />}
      </main>
    </div>
  );
}

const LAYOUT = `
.shell {
  display: grid;
  height: 100%;
  grid-template-areas: "head" "main" "nav";
  grid-template-rows: auto minmax(0,1fr) auto;
  /* minmax(0,1fr): con 1fr a secas, una línea larga ensancha toda la grilla. */
  grid-template-columns: minmax(0,1fr);
}
.shell-head {
  grid-area: head; display: flex; align-items: center; gap: 12px;
  padding: 8px 12px; min-height: 44px; overflow: hidden;
  border-bottom: 1px solid var(--color-line); background: var(--color-panel);
}
.marca { font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.estado { display: flex; align-items: center; gap: 7px; flex: 1 1 auto; min-width: 0; overflow: hidden; }
.estado-texto { font-size: 11px; color: var(--color-ink-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modo { display: flex; gap: 2px; flex: 0 0 auto; }
.modo-btn {
  padding: 4px 10px; font-size: 10px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase;
  border: 1px solid var(--color-line); background: transparent; color: var(--color-ink-faint); border-radius: 3px;
}
.modo-btn.on { border-color: var(--color-accent-line); background: var(--color-accent-bg); color: var(--color-accent-ink); }

.shell-main { grid-area: main; overflow-y: auto; overflow-x: hidden; min-width: 0; padding: 12px; -webkit-overflow-scrolling: touch; }

/* Teléfono: barra inferior deslizable. */
.shell-nav {
  grid-area: nav; display: flex; overflow-x: auto; scrollbar-width: none;
  border-top: 1px solid var(--color-line); background: var(--color-panel);
  padding-bottom: env(safe-area-inset-bottom);
}
.shell-nav::-webkit-scrollbar { display: none; }
.ficha, .nav-grupo { display: none; }
.nav-celda { flex: 0 0 auto; display: flex; }
.nav-btn {
  position: relative; min-width: 76px; padding: 11px 12px 10px; background: transparent; border: 0;
  border-top: 2px solid transparent; color: var(--color-ink-dim);
  font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap;
}
.nav-btn.on { background: var(--color-panel-alt); border-top-color: var(--color-info); color: var(--color-ink); }
.nav-btn:disabled { opacity: .35; }
.nav-long { display: none; }
.nav-badge {
  margin-left: 6px; padding: 0 5px; border-radius: 8px; font-size: 10px;
  background: var(--color-fail); color: #fff;
}

/* Pantalla ancha: barra lateral agrupada, con la ficha del vehículo. */
@media (min-width: 860px) {
  .shell {
    grid-template-areas: "head head" "nav main";
    grid-template-columns: 208px minmax(0,1fr);
    grid-template-rows: auto minmax(0,1fr);
  }
  .shell-nav {
    flex-direction: column; overflow-x: hidden; overflow-y: auto;
    border-top: 0; border-right: 1px solid var(--color-line); padding-bottom: 12px;
  }
  .ficha {
    display: block; padding: 12px 14px; border-bottom: 1px solid var(--color-line);
    background: var(--color-panel-alt);
  }
  .ficha-nombre { font-size: 13px; font-weight: 600; }
  .ficha-dato { font-size: 10.5px; color: var(--color-ink-dim); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-celda { display: block; }
  .nav-grupo { display: block; padding: 14px 14px 4px; }
  .nav-btn {
    display: flex; align-items: center; width: 100%; min-width: 0; text-align: left;
    padding: 8px 14px; border-top: 0; border-left: 2px solid transparent;
    font-size: 11.5px;
  }
  .nav-btn.on { border-left-color: var(--color-info); }
  .nav-btn:hover:not(:disabled):not(.on) { background: var(--color-panel-alt); color: var(--color-ink); }
  .nav-short { display: none; }
  .nav-long { display: inline; flex: 1; }
  .shell-main { padding: 16px 18px; }
}
`;
