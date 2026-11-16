/**
 * Autocomprobación sin hardware: dice si este equipo puede usar puerto serie
 * y J2534, que es lo que más falla al mover el programa a otra máquina.
 * Devuelve texto para mostrar en consola o en una ventana.
 */
export async function diagnostico({ version, web }) {
  let fallas = 0;
  const lineas = [];
  const linea = (ok, texto) => lineas.push(`${ok ? '[ ok ]' : '[FALLA]'} ${texto}`);
  lineas.push(
    `Diagnóstico  v${version} · ${process.platform} ${process.arch} · Node ${process.versions.node}`, '');
  try {
    const { SerialPort } = await import('serialport');
    const puertos = await SerialPort.list();
    linea(true, `Módulo de puerto serie cargado. Puertos: ${puertos.length}`);
    for (const p of puertos) lineas.push(`         ${p.path}  ${p.friendlyName ?? p.manufacturer ?? ''}`);
  } catch (err) {
    fallas++;
    linea(false, `Módulo de puerto serie: ${err?.message ?? err}`);
  }
  try {
    const koffi = (await import('koffi')).default;
    linea(true, `Módulo J2534 (carga de DLL) cargado. koffi ${koffi.version}`);
  } catch (err) {
    fallas++;
    linea(false, `Módulo J2534 (carga de DLL): ${err?.message ?? err}`);
  }
  if (process.platform === 'win32') {
    const { buscarInstaladas, avisoArquitectura } = await import('./j2534.mjs');
    const dlls = buscarInstaladas();
    lineas.push('', `Equipos J2534 registrados en Windows: ${dlls.length}`);
    for (const d of dlls) {
      lineas.push(`   ${d.nombre} (${d.proveedor})`, `      ${d.dll}`);
      const aviso = avisoArquitectura(d.dll);
      if (aviso) lineas.push(`      AVISO: ${aviso}`);
    }
    if (dlls.length === 0) lineas.push('   Ninguno. Instalá el software del fabricante del equipo.');
    lineas.push('');
  }
  linea(web, 'App web incluida');
  lineas.push('', fallas === 0 ? 'Todo en orden.' : `${fallas} problema(s).`);
  return { fallas, lineas };
}
