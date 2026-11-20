const { chromium } = require('playwright');
const ARCHIVO = require('path').resolve(process.argv[2] || __dirname + '/Cargar-GolfDashboard-ESP32.html'); const fs = require('fs');
(async () => {
  const html = fs.readFileSync(ARCHIVO, 'utf8');
  const m = /[A-Za-z0-9+/]{100000,}/.exec(html); if (!m) throw new Error('sin base64');
  const pos = m.index + Math.floor(m[0].length / 2);
  const cambio = html[pos] === 'A' ? 'B' : 'A';
  fs.writeFileSync(__dirname + '/danado.html', html.slice(0, pos) + cambio + html.slice(pos + 1));
  console.log(`base64 de ${m[0].length} caracteres, alterado 1 en la posición ${pos}`);
  const b = await chromium.launch(); const q = await b.newPage();
  await q.goto('file://' + __dirname + '/danado.html');
  await q.waitForFunction(() => document.getElementById('estado').dataset.tipo === 'error' || !document.getElementById('cargar').disabled, null, { timeout: 20000 });
  console.log('imagen alterada →', await q.textContent('#estado'), '| botón deshabilitado:', await q.isDisabled('#cargar'));
  fs.unlinkSync(__dirname + '/danado.html'); await b.close();
})();
