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
  velocidad.disabled = true;
  log.textContent = '';
  progreso(0);
  let transport: Transport | null = null;
  try {
    aviso('info', 'Elegí el puerto de la placa en la ventana del navegador…');
    const port = await navigator.serial.requestPort();
    transport = new Transport(port, false);
    const loader = new ESPLoader({
      transport,
      baudrate: Number(velocidad.value),
      terminal: { clean: () => { log.textContent = ''; }, writeLine: linea, write: escribir },
    });

    aviso('info', 'Conectando con el ESP32…');
    const chip = await loader.main();
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
    aviso('ok', 'Listo. El ESP32 se reinició con el firmware nuevo. Ya podés desenchufarlo.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    linea(`\n> ERROR: ${msg}`);
    if (/No port selected|cancel/i.test(msg)) {
      aviso('error', 'No se eligió ningún puerto. Si la lista estaba vacía, revisá el cable USB y el driver.');
    } else if (/Failed to connect|Timeout|sync/i.test(msg)) {
      aviso('error', 'No respondió. Mantené BOOT, tocá EN/RST, soltá BOOT y volvé a pulsar Cargar.');
    } else if (/Failed to open|already open|in use/i.test(msg)) {
      aviso('error', 'El puerto está ocupado. Cerrá Arduino IDE, monitores serie u otras pestañas que lo usen.');
    } else {
      aviso('error', `Falló: ${msg} Si fue durante la escritura, probá con 115200.`);
    }
  } finally {
    if (transport) await transport.disconnect().catch(() => {});
    boton.disabled = false;
    velocidad.disabled = false;
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
}

void iniciar();
