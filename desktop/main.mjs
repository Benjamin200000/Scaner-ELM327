/**
 * Aplicación de escritorio: una ventana propia, sin navegador.
 *
 * Electron hace dos cosas acá y nada más:
 *   - corre el agente (puerto serie, K-Line, J2534) dentro de este proceso
 *   - muestra la app en una ventana, ya enlazada con ese agente
 * La app y el agente son los mismos que en la versión web; no hay lógica de
 * diagnóstico en este archivo.
 */
import { app, BrowserWindow, Menu, dialog, session, shell } from 'electron';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const AGENTE = join(AQUI, 'agent');
const importar = (...partes) => import(pathToFileURL(join(...partes)).href);

const propios = process.argv.slice(app.isPackaged ? 1 : 2);
const opcion = (n) => {
  const i = propios.indexOf(n);
  return i !== -1 ? propios[i + 1] : undefined;
};

/** 8777 si está libre (así una tablet lo encuentra donde siempre); si no, cualquiera. */
function puertoLibre(preferido) {
  const probar = (p) => new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(null));
    s.listen(p, '127.0.0.1', () => { const n = s.address().port; s.close(() => ok(n)); });
  });
  return probar(preferido).then((p) => p ?? probar(0));
}

let ventana = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!ventana) return;
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  });
  app.whenReady().then(iniciar).catch((err) => {
    dialog.showErrorBox('Scaner ELM327', `No se pudo iniciar:\n\n${err?.stack ?? err}`);
    app.exit(1);
  });
}

async function iniciar() {
  // Solo para pruebas automáticas: comprueba los módulos nativos y sale.
  if (process.env.SCANER_DIAGNOSTICO) {
    const { diagnostico } = await importar(AGENTE, 'lib', 'diagnostico.mjs');
    const r = await diagnostico({ version: app.getVersion(), web: true });
    writeFileSync(process.env.SCANER_DIAGNOSTICO, r.lineas.join('\n') + '\n');
    return app.exit(r.fallas === 0 ? 0 : 1);
  }
  const puerto = Number(opcion('--puerto')) || await puertoLibre(8777);
  const { obtenerToken } = await importar(AGENTE, 'lib', 'auth.mjs');
  const token = obtenerToken();

  // El agente lee sus opciones de process.argv, igual que por consola.
  process.argv = [
    process.argv[0], 'scaner-agent',
    '--puerto', String(puerto), '--web', join(AQUI, 'web'),
    ...(propios.includes('--simular') ? ['--simular'] : []),
    ...(propios.includes('--lan') ? ['--lan'] : []),
    ...(opcion('--j2534') ? ['--j2534', opcion('--j2534')] : []),
  ];
  await importar(AGENTE, 'scaner-agent.mjs');

  // Tras actualizar el programa no debe quedar una copia vieja en caché.
  // El historial (IndexedDB) y las preferencias no se tocan.
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });

  const origen = `http://127.0.0.1:${puerto}`;
  ventana = new BrowserWindow({
    width: 1360, height: 880, minWidth: 380, minHeight: 560,
    backgroundColor: '#0f1114',
    title: 'Scaner ELM327',
    icon: join(AQUI, 'icono.png'),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ventana.once('ready-to-show', () => ventana.show());
  ventana.on('closed', () => { ventana = null; });
  ventana.on('page-title-updated', (e) => e.preventDefault());

  // Nada de navegar afuera dentro de la ventana: los enlaces van al navegador.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origen)) { e.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Programa', submenu: [
      { label: 'Recargar', accelerator: 'F5', click: () => ventana?.loadURL(`${origen}/#agente=${token}`) },
      { label: 'Pantalla completa', role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Salir', role: 'quit' },
    ] },
    { label: 'Ver', submenu: [
      { label: 'Acercar', role: 'zoomIn' }, { label: 'Alejar', role: 'zoomOut' },
      { label: 'Tamaño normal', role: 'resetZoom' },
    ] },
    { label: 'Ayuda', submenu: [
      { label: 'Diagnóstico del equipo…', click: mostrarDiagnostico },
      { label: 'Usar desde tablet o teléfono…', click: () => dialog.showMessageBox(ventana, {
        type: 'info', title: 'Usar desde otro dispositivo',
        message: propios.includes('--lan')
          ? `En el otro dispositivo (misma red Wi-Fi) abrí:\n\nhttp://<IP de esta PC>:${puerto}/#agente=${token}`
          : 'Cerrá el programa y abrilo con "Usar desde tablet.cmd".\nAsí acepta conexiones de la red local.',
      }) },
      { label: 'Herramientas de desarrollo', role: 'toggleDevTools' },
    ] },
  ]));

  // El servidor del agente arranca en este mismo proceso; por las dudas se
  // reintenta la carga un par de veces si todavía no escucha.
  let intentos = 0;
  ventana.webContents.on('did-fail-load', (_e, _c, _d, url, principal) => {
    if (principal && url.startsWith(origen) && intentos++ < 10) {
      setTimeout(() => ventana?.loadURL(`${origen}/#agente=${token}`), 300);
    }
  });
  await ventana.loadURL(`${origen}/#agente=${token}`);

  // Solo para pruebas automáticas: guarda una captura y sale.
  if (process.env.SCANER_CAPTURA) {
    setTimeout(async () => {
      const img = await ventana.webContents.capturePage();
      writeFileSync(process.env.SCANER_CAPTURA, img.toPNG());
      app.exit(0);
    }, 6000);
  }
}

async function mostrarDiagnostico() {
  const { diagnostico } = await importar(AGENTE, 'lib', 'diagnostico.mjs');
  const r = await diagnostico({ version: app.getVersion(), web: true });
  await dialog.showMessageBox(ventana, {
    type: r.fallas === 0 ? 'info' : 'warning',
    title: 'Diagnóstico del equipo',
    message: r.fallas === 0 ? 'Todo en orden' : 'Hay problemas',
    detail: r.lineas.join('\n'),
  });
}

app.on('window-all-closed', () => app.quit());
