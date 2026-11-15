import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DispositivoJ2534, J2534Error, PROTOCOLO, buscarInstaladas } from '../lib/j2534.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FAKE = join(AQUI, 'libfakej2534.so');

const conDispositivo = (fn) => {
  const d = new DispositivoJ2534(FAKE);
  try { return fn(d); } finally { d.cerrar(); }
};

test('abre el equipo y devuelve un identificador', () => {
  conDispositivo((d) => {
    const id = d.abrir();
    assert.equal(typeof id, 'number');
    assert.ok(id > 0);
  });
});

test('lee las versiones de firmware, DLL y API', () => {
  conDispositivo((d) => {
    d.abrir();
    const v = d.version();
    assert.equal(v.api, '04.04');
    assert.equal(v.firmware, 'FAKE-FW 1.00');
    assert.equal(v.dll, 'FAKE-DLL 0.1');
  });
});

test('lee la tensión de batería por ioctl', () => {
  conDispositivo((d) => {
    d.abrir();
    assert.equal(d.tension(), 13.95);
  });
});

test('conecta un canal ISO15765 a 500 kbaud', () => {
  conDispositivo((d) => {
    d.abrir();
    const canal = d.conectar({ protocolo: PROTOCOLO.ISO15765, baudRate: 500000 });
    assert.equal(typeof canal, 'number');
  });
});

test('rechaza un protocolo que el equipo no soporta, con texto entendible', () => {
  conDispositivo((d) => {
    d.abrir();
    assert.throws(
      () => d.conectar({ protocolo: PROTOCOLO.J1850PWM }),
      (e) => e instanceof J2534Error
        && e.codigo === 0x03
        && /no soportado/i.test(e.message),
    );
  });
});

test('rechaza un baud rate inválido', () => {
  conDispositivo((d) => {
    d.abrir();
    assert.throws(() => d.conectar({ baudRate: 123 }), J2534Error);
  });
});

test('conectar sin abrir falla con un mensaje claro', () => {
  conDispositivo((d) => {
    assert.throws(() => d.conectar(), /no está abierto/i);
  });
});

test('escribe y lee: la ECU falsa contesta el PID de régimen', () => {
  conDispositivo((d) => {
    d.abrir();
    d.conectar();
    d.escribir(new Uint8Array([0x01, 0x0c]));
    const r = d.leer(500);
    assert.ok(r !== null, 'no llegó respuesta');
    // 41 0C 0D 48 -> 0x0D48 = 3400, /4 = 850 rpm
    assert.deepEqual([...r.payload], [0x41, 0x0c, 0x0d, 0x48]);
    const rpm = ((r.payload[2] << 8) | r.payload[3]) / 4;
    assert.equal(rpm, 850);
  });
});

test('la cabecera CAN se saca al leer y se agrega al escribir', () => {
  conDispositivo((d) => {
    d.abrir();
    d.conectar();
    d.escribir(new Uint8Array([0x01, 0x05]));
    const r = d.leer(500);
    // El payload no debe traer el 00 00 07 E8 de la cabecera.
    assert.equal(r.payload[0], 0x41);
    assert.equal(r.payload.length, 3);
    assert.equal(r.payload[2] - 40, 83); // 83 °C
  });
});

test('leer sin nada pendiente devuelve null, no un error', () => {
  conDispositivo((d) => {
    d.abrir();
    d.conectar();
    assert.equal(d.leer(50), null);
  });
});

test('un PID que la ECU no soporta simplemente no contesta', () => {
  conDispositivo((d) => {
    d.abrir();
    d.conectar();
    d.escribir(new Uint8Array([0x01, 0x7a]));
    assert.equal(d.leer(50), null);
  });
});

test('lee códigos de falla por modo 03', () => {
  conDispositivo((d) => {
    d.abrir();
    d.conectar();
    d.escribir(new Uint8Array([0x03]));
    const r = d.leer(500);
    assert.deepEqual([...r.payload], [0x43, 0x01, 0x01, 0x33]);
  });
});

test('soporta payloads largos sin corromperlos', () => {
  conDispositivo((d) => {
    d.abrir();
    d.conectar();
    d.escribir(new Uint8Array([0x09, 0x02]));
    const r = d.leer(500);
    const texto = Buffer.from(r.payload.slice(3)).toString('ascii');
    assert.equal(texto, 'WVWZZZ');
  });
});

test('escribir sin canal conectado falla en vez de corromper memoria', () => {
  conDispositivo((d) => {
    d.abrir();
    assert.throws(() => d.escribir(new Uint8Array([0x01, 0x0c])), /canal conectado/i);
  });
});

test('cerrar dos veces no explota', () => {
  const d = new DispositivoJ2534(FAKE);
  d.abrir();
  d.conectar();
  d.cerrar();
  d.cerrar();
});

test('reabrir después de cerrar funciona', () => {
  const a = new DispositivoJ2534(FAKE);
  a.abrir();
  a.conectar();
  a.cerrar();
  const b = new DispositivoJ2534(FAKE);
  assert.ok(b.abrir() > 0);
  b.cerrar();
});

test('cargar una biblioteca inexistente da un error explicativo', () => {
  assert.throws(
    () => new DispositivoJ2534('/no/existe/libj2534.so'),
    /No se pudo cargar/,
  );
});

test('la búsqueda en el registro no corre fuera de Windows', () => {
  const r = buscarInstaladas();
  assert.ok(Array.isArray(r));
  if (process.platform !== 'win32') assert.equal(r.length, 0);
});
