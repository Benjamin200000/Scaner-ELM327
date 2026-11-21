import { ESPLoader, Transport } from 'esptool-js';
import { md5Hex } from './md5';

declare const FIRMWARE_B64: string;
declare const FIRMWARE_SHA256: string;
declare const FIRMWARE_TOTAL: number;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $<HTMLPreElement>('log');
const estado = $<HTMLDivElement>('estado');
const barra = $<HTMLDivElement>('barra');
const porcentaje = $<HTMLSpanElement>('porcentaje');
const boton = $<HTMLButtonElement>('cargar');
const velocidad = $<HTMLSelectElement>('velocidad');
const manual = $<HTMLInputElement>('manual');
const todos = $<HTMLInputElement>('todos');
const borrarTodo = $<HTMLInputElement>('borrar');
const pasosManual = $<HTMLDivElement>('pasos-manual');

/** Chips USB-serie habituales en placas ESP32. Filtrar por ellos oculta los COM de Bluetooth. */
const PUENTES: Record<number, string> = {
  0x10c4: 'Silicon Labs CP210x', 0x1a86: 'WCH CH340/CH9102', 0x0403: 'FTDI',
  0x067b: 'Prolific PL2303', 0x303a: 'Espressif USB nativo',
};
const actualizarManual = () => { pasosManual.hidden = !manual.checked; };
manual.addEventListener('change', actualizarManual);

function escribir(texto: string) {
  log.textContent += texto;
  log.scrollTop = log.scrollHeight;
}
function linea(texto: string) { escribir(texto + '\n'); }
function aviso(tipo: 'ok' | 'error' | 'info', texto: string) {
  estado.dataset.tipo = tipo;
  estado.textContent = texto;
}
function progreso(p: number) {
  barra.style.width = `${p}%`;
  porcentaje.textContent = `${p.toFixed(0)} %`;
}

function decodificar(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const imagen = decodificar(FIRMWARE_B64);

/** Comprueba que lo embebido es exactamente la imagen publicada (rellena con 0xFF hasta 4 MiB). */
async function verificarImagen(): Promise<boolean> {
  const completa = new Uint8Array(FIRMWARE_TOTAL).fill(0xff);
  completa.set(imagen);
  const hash = await crypto.subtle.digest('SHA-256', completa);
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex === FIRMWARE_SHA256;
}

async function cargar() {
  boton.disabled = true;
  botonConsola.disabled = true;
  velocidad.disabled = true;
  borrarTodo.disabled = true;
  log.textContent = '';
  progreso(0);
  let transport: Transport | null = null;
  try {
    aviso('info', 'Elegí el puerto de la placa en la ventana del navegador…');
    const port = await navigator.serial.requestPort(
      todos.checked ? {} : { filters: Object.keys(PUENTES).map((v) => ({ usbVendorId: Number(v) })) },
    );
    const info = port.getInfo();
    if (info.usbVendorId === undefined) {
      throw new Error('PUERTO_BLUETOOTH');
    }
    linea(`> Puerto USB: ${PUERTOS_NOMBRE(info.usbVendorId)} (VID 0x${info.usbVendorId.toString(16).padStart(4, '0')})`);
    transport = new Transport(port, false);
    const loader = new ESPLoader({
      transport,
      baudrate: Number(velocidad.value),
      terminal: { clean: () => { log.textContent = ''; }, writeLine: linea, write: escribir },
    });

    // En Windows, abrir el puerto ya reinicia la placa: por eso el modo manual
    // no evita el reinicio, sino que da tiempo (unos 30 s) a tener BOOT apretado
    // mientras ocurre. Con BOOT abajo, cualquier reinicio entra en modo carga.
    const intentos = manual.checked ? 30 : 12;
    const conectar = loader.connect.bind(loader);
    loader.connect = (modo = 'default_reset', _a = 7, detectar = true) => conectar(modo, intentos, detectar);
    aviso('info', manual.checked
      ? 'Mantené BOOT apretado. Si sigue en "Connecting...", sin soltar BOOT tocá EN una vez.'
      : 'Conectando con el ESP32… (la placa se reinicia sola en modo carga)');
    const chip = await loader.main('default_reset');
    if (manual.checked) aviso('info', 'Conectado: ya podés soltar BOOT.');
    linea(`\n> Chip detectado: ${chip}`);
    if (loader.chip.CHIP_NAME !== 'ESP32') {
      throw new Error(`Esta imagen es para ESP32 original y la placa es ${loader.chip.CHIP_NAME}. No se escribió nada.`);
    }
    const flash = await loader.detectFlashSize();
    linea(`> Memoria flash: ${flash}`);
    const mb = /^(\d+)MB$/.exec(flash);
    if (mb && Number(mb[1]) < 4) {
      throw new Error(`La placa tiene ${flash} de flash y esta imagen necesita 4MB. No se escribió nada.`);
    }

    if (borrarTodo.checked) {
      aviso('info', 'Borrando toda la memoria (puede tardar hasta un minuto). No desconectes la placa.');
      await loader.eraseFlash();
      linea('> Memoria borrada por completo.');
    }
    aviso('info', 'Escribiendo el firmware. No desconectes la placa.');
    await loader.writeFlash({
      fileArray: [{ data: imagen, address: 0x0 }],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_i, escrito, total) => progreso((escrito / total) * 100),
      calculateMD5Hash: md5Hex,
    });
    progreso(100);
    linea('> Escritura verificada por el ESP32 (MD5).');
    await loader.after('hard_reset');
    aviso('ok', manual.checked
      ? 'Listo. Pulsá EN/RST una vez para que arranque el firmware nuevo.'
      : 'Listo. El ESP32 se reinició con el firmware nuevo. Ya podés desenchufarlo.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linea(`\n> ERROR: ${msg}`);
    if (msg === 'PUERTO_BLUETOOTH') {
      aviso('error', 'Ese puerto es Bluetooth, no el USB de la placa (puede ser el ELM327 emparejado). Pulsá Cargar y elegí el que dice CP210x, CH340 o USB.');
    } else if (/No port selected|cancel/i.test(msg)) {
      aviso('error', todos.checked
        ? 'No se eligió ningún puerto. Si la lista estaba vacía, revisá el cable USB (que sea de datos) y el driver.'
        : 'No se eligió ningún puerto. Si la placa no aparecía, marcá "Mostrar todos los puertos" y probá de nuevo; si sigue sin aparecer, revisá el cable USB y el driver.');
    } else if (/Failed to connect|Timeout|sync/i.test(msg)) {
      if (!manual.checked) {
        manual.checked = true;
        actualizarManual();
        aviso('error', 'La placa no entró sola en modo carga. Activé el modo manual: seguí los pasos de abajo y volvé a pulsar Cargar.');
      } else {
        aviso('error', 'Sigue sin responder. Probá de nuevo con BOOT apretado todo el tiempo y tocando EN durante "Connecting...". Si nunca responde: otro puerto USB del PC, otro cable, o velocidad 115200.');
      }
    } else if (/Failed to open|already open|in use/i.test(msg)) {
      aviso('error', 'El puerto está ocupado. Cerrá Arduino IDE, monitores serie u otras pestañas que lo usen.');
    } else {
      aviso('error', `Falló: ${msg} Si fue durante la escritura, probá con 115200.`);
    }
  } finally {
    if (transport) await transport.disconnect().catch(() => {});
    boton.disabled = false;
    botonConsola.disabled = false;
    velocidad.disabled = false;
    borrarTodo.disabled = false;
  }
}

function PUERTOS_NOMBRE(vid: number): string {
  return PUENTES[vid] ?? 'chip USB-serie';
}

// ---- Consola: ver lo que la placa escribe por el puerto serie (115200) ----
const botonConsola = $<HTMLButtonElement>('consola');
const botonCopiar = $<HTMLButtonElement>('copiar');
let consolaPuerto: SerialPort | null = null;
let consolaLector: ReadableStreamDefaultReader<Uint8Array> | null = null;

async function detenerConsola() {
  const lector = consolaLector, puerto = consolaPuerto;
  consolaLector = null; consolaPuerto = null;
  try { await lector?.cancel(); } catch { /* ya cerrado */ }
  try { lector?.releaseLock(); } catch { /* ya liberado */ }
  try { await puerto?.close(); } catch { /* ya cerrado */ }
  botonConsola.textContent = 'Ver mensajes de la placa';
  boton.disabled = false;
}

async function verConsola() {
  if (consolaPuerto) { await detenerConsola(); aviso('info', 'Consola detenida.'); return; }
  try {
    const port = await navigator.serial.requestPort(
      todos.checked ? {} : { filters: Object.keys(PUENTES).map((v) => ({ usbVendorId: Number(v) })) },
    );
    if (port.getInfo().usbVendorId === undefined) throw new Error('PUERTO_BLUETOOTH');
    await port.open({ baudRate: 115200 });
    consolaPuerto = port;
    boton.disabled = true;
    botonConsola.textContent = 'Detener';
    log.textContent = '';
    // Reinicio normal (EN abajo y arriba, BOOT suelto) para ver el arranque completo.
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise((r) => setTimeout(r, 120));
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    aviso('info', 'Mostrando lo que escribe la placa. Si no aparece nada, tocá EN/RST. Pulsá Detener al terminar.');
    const texto = new TextDecoder();
    consolaLector = port.readable!.getReader();
    for (;;) {
      const { value, done } = await consolaLector.read();
      if (done) break;
      if (value) escribir(texto.decode(value, { stream: true }));
      if (log.textContent!.length > 200000) log.textContent = log.textContent!.slice(-100000);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'PUERTO_BLUETOOTH') aviso('error', 'Ese puerto es Bluetooth, no el USB de la placa.');
    else if (/No port selected|cancel/i.test(msg)) aviso('error', 'No se eligió ningún puerto.');
    else if (/Failed to open|already open|in use/i.test(msg)) aviso('error', 'El puerto está ocupado. Cerrá Arduino IDE u otras pestañas que lo usen.');
    else if (consolaPuerto) aviso('error', `Se cortó la lectura: ${msg}`);
  } finally {
    if (consolaPuerto) await detenerConsola();
  }
}

async function copiarConsola() {
  try {
    await navigator.clipboard.writeText(log.textContent ?? '');
    aviso('ok', 'Copiado. Pegalo en el chat.');
  } catch {
    const r = document.createRange(); r.selectNodeContents(log);
    const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    aviso('info', 'Texto seleccionado: copialo con Ctrl+C.');
  }
}

async function iniciar() {
  if (!('serial' in navigator)) {
    aviso('error', 'Este navegador no puede usar puertos USB. Abrí este archivo con Google Chrome o Microsoft Edge en un computador.');
    return;
  }
  aviso('info', 'Verificando la imagen incluida…');
  if (!(await verificarImagen())) {
    aviso('error', 'La imagen incluida no coincide con la publicada. El archivo se dañó: volvé a descargarlo.');
    return;
  }
  aviso('info', 'Imagen verificada. Enchufá el ESP32 y pulsá Cargar.');
  boton.disabled = false;
  boton.addEventListener('click', () => void cargar());
  botonConsola.disabled = false;
  botonConsola.addEventListener('click', () => void verConsola());
  botonCopiar.addEventListener('click', () => void copiarConsola());
}

void iniciar();
