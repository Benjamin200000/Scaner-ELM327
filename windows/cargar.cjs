// Cargado desde disco por el .exe. Arranca el agente (ESM) y, si algo falla,
// deja la ventana abierta unos segundos para que el error se pueda leer.
process.on('exit', (codigo) => {
  if (codigo !== 0 && process.platform === 'win32' && !process.env.SCANER_SIN_PAUSA) {
    console.error('\nEsta ventana se cierra en 15 segundos.');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000);
  }
});
import('./scaner-agent.mjs').catch((err) => {
  console.error('\nNo se pudo iniciar el programa:\n');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
