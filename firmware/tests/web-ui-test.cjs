// Prueba de la interfaz en Chromium con API simulada, sin ESP32 fisico.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../GolfDashboard/WebUi.h'), 'utf8');
  const html = source.split('R"GOLFHTML(')[1].split(')GOLFHTML"')[0].replace('%TOKEN%', 'test-token');
  const values = [900, 0, 92, null, 12.34, null, 28, 0.35, 25, 3, 14.1];
  const data = {
    state: 'OBD conectado', page: 0, mask: 0, rpmHz: 5.5, speedHz: 5,
    reference: 14.7, afr: null,
    fields: values.map((value, i) => ({
      support: value === null ? 0 : 1, value, age: value === null ? null : 100,
      stale: false, digits: i === 5 ? 3 : [4, 7, 10].includes(i) ? 2 : 0
    }))
  };
  let failLive = false;
  const posts = [], errors = [];
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://golf.local/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST') {
        assert.equal(request.headers()['x-golf-token'], 'test-token');
        posts.push({ path: url.pathname, data: new URLSearchParams(request.postData()) });
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Guardado' });
      }
      if (url.pathname === '/api/live') {
        if (failLive) return route.abort();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (url.pathname === '/api/config') return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'ELM 327', mac: '' })
      });
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    await page.goto('http://golf.local/');
    await page.waitForFunction(() => document.querySelectorAll('#cards .card').length === 12);
    assert.equal(await page.locator('#cards .value').nth(0).textContent(), '900');
    assert.equal(await page.locator('#cards .value').nth(1).textContent(), '0');
    assert.equal(await page.locator('#cards .value').nth(3).textContent(), 'N/D');
    assert.equal(await page.locator('#cards .value').nth(4).textContent(), '12.34');
    assert.equal(await page.locator('#cards .value').nth(11).textContent(), 'N/D');
    assert(await page.locator('#extras input[value="5"]').isDisabled());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'OLED: mezcla' }).click();
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('cambiada'));
    assert.equal(posts.at(-1).path, '/api/page');
    assert.equal(posts.at(-1).data.get('page'), '1');
    await page.locator('#extras input[value="4"]').check();
    await page.getByRole('button', { name: 'Aplicar selección' }).click();
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('aplicada'));
    assert.equal(posts.at(-1).data.get('mask'), '16');
    await page.getByRole('button', { name: 'Priorizar latencia' }).click();
    await page.waitForTimeout(100);
    assert.equal(posts.at(-1).data.get('mask'), '0');
    await page.locator('#name').fill('OBDII');
    await page.locator('#pin').fill('0000');
    await page.getByRole('button', { name: 'Guardar y reconectar' }).click();
    await page.waitForFunction(() => document.querySelector('#msg').textContent === 'Guardado');
    assert.equal(posts.at(-1).data.get('name'), 'OBDII');
    assert.equal(posts.at(-1).data.get('pin'), '0000');
    assert.equal(await page.locator('#pin').inputValue(), '');
    data.fields[5] = { support: 1, value: 1, age: 50, stale: false, digits: 3 };
    data.afr = 14.7;
    await page.waitForFunction(() => document.querySelectorAll('#cards .value')[11].textContent === '14.70');
    if (process.env.GOLF_SCREENSHOT) await page.screenshot({ path: process.env.GOLF_SCREENSHOT, fullPage: true });
    // Diesel informado por la ECU (PID 51): la referencia del AFR cambia y se indica.
    data.fuel = 'diesel'; data.reference = 14.5;
    await page.waitForFunction(() => document.querySelector('#cards').lastElementChild.textContent.includes('14.50 (diesel, informado por la ECU)'));
    failLive = true;
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Sin respuesta del ESP32'));
    assert((await page.locator('#cards .value').allTextContents()).every(x => x === '—'));
    // Tras un corte espera 2 s antes de reintentar (no amontona pedidos) y se recupera sola.
    failLive = false;
    const t0 = Date.now();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('OBD conectado'), null, { timeout: 6000 });
    assert(Date.now() - t0 < 5000, 'la pagina tardo demasiado en recuperarse');
    // Mientras busca el ELM indica como corregir el nombre.
    data.state = 'Conectando Bluetooth';
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('nombre Bluetooth exacto'));
    assert.deepEqual(errors, []);
    console.log('Interfaz movil correcta: datos, N/D, extras, configuracion, AFR, desconexion, recuperacion y aviso de busqueda. API simulada.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
