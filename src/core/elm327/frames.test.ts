import { describe, expect, it } from 'vitest';
import { describeEcu, direccionSolicitud, parseEcuMessages } from './frames';

describe('tramas CAN de 11 bits', () => {
  it('arma una trama única usando el largo del PCI', () => {
    const m = parseEcuMessages(['7E8 04 41 0C 1A F8 00 00 00'], 'can11');
    expect(m).toEqual([{ ecu: '7E8', data: [0x41, 0x0c, 0x1a, 0xf8] }]);
  });

  it('funciona igual sin espacios (ATS0)', () => {
    const m = parseEcuMessages(['7E804410C1AF8'], 'can11');
    expect(m[0]?.data).toEqual([0x41, 0x0c, 0x1a, 0xf8]);
  });

  it('separa las respuestas de dos ECU a la misma pregunta', () => {
    const m = parseEcuMessages([
      '7E8 06 41 00 BE 3E B8 11',
      '7E9 06 41 00 80 00 00 01',
    ], 'can11');
    expect(m.map((x) => x.ecu)).toEqual(['7E8', '7E9']);
    expect(m[1]?.data).toEqual([0x41, 0x00, 0x80, 0x00, 0x00, 0x01]);
  });

  it('reensambla una respuesta larga y la recorta al largo declarado', () => {
    const m = parseEcuMessages([
      '7E8 10 14 49 02 01 57 56 57',
      '7E8 21 5A 5A 5A 31 4B 5A 41',
      '7E8 22 57 36 35 34 33 32 31',
    ], 'can11');
    expect(m).toHaveLength(1);
    expect(m[0]?.data).toHaveLength(0x14);
    expect(String.fromCharCode(...m[0]!.data.slice(3))).toBe('WVWZZZ1KZAW654321');
  });

  it('arma dos mensajes largos entrelazados, uno por ECU', () => {
    const m = parseEcuMessages([
      '7E8 10 08 49 04 01 41 42 43',
      '7E9 10 08 49 04 01 58 59 5A',
      '7E8 21 44 45 00 00 00 00 00',
      '7E9 21 31 32 00 00 00 00 00',
    ], 'can11');
    expect(String.fromCharCode(...m.find((x) => x.ecu === '7E8')!.data.slice(3))).toBe('ABCDE');
    expect(String.fromCharCode(...m.find((x) => x.ecu === '7E9')!.data.slice(3))).toBe('XYZ12');
  });

  it('ordena las consecutivas aunque lleguen desordenadas', () => {
    const m = parseEcuMessages([
      '7E8 10 0F 49 02 01 41 42 43',
      '7E8 22 4B 4C 00 00 00 00 00',
      '7E8 21 44 45 46 47 48 49 4A',
    ], 'can11');
    expect(String.fromCharCode(...m[0]!.data.slice(3))).toBe('ABCDEFGHIJKL');
  });

  it('descarta un mensaje al que le falta una trama del medio', () => {
    const m = parseEcuMessages([
      '7E8 10 14 49 02 01 57 56 57',
      '7E8 22 57 36 35 34 33 32 31',
    ], 'can11');
    expect(m).toEqual([]);
  });

  it('ignora líneas que no son tramas', () => {
    expect(parseEcuMessages(['OK'], 'can11')).toEqual([]);
    expect(parseEcuMessages(['41 0C 1A F8'], 'can11')).toEqual([]);
  });
});

describe('tramas CAN de 29 bits', () => {
  it('toma los ocho dígitos como identificador', () => {
    const m = parseEcuMessages(['18DAF110 04 41 0C 1A F8'], 'can29');
    expect(m).toEqual([{ ecu: '18DAF110', data: [0x41, 0x0c, 0x1a, 0xf8] }]);
  });
});

describe('tramas K-Line', () => {
  it('quita la cabecera de tres bytes y el checksum', () => {
    const m = parseEcuMessages(['86 F1 10 41 00 BE 3E B8 11 FF'], 'legacy');
    expect(m).toEqual([{ ecu: '10', data: [0x41, 0x00, 0xbe, 0x3e, 0xb8, 0x11] }]);
  });

  it('junta los códigos de varias líneas sin inventar un contador', () => {
    const m = parseEcuMessages([
      '48 6B 10 43 01 71 03 00 04 20 C4',
      '48 6B 10 43 01 02 00 00 00 00 C5',
    ], 'legacy');
    expect(m[0]?.data).toEqual([
      0x43, 0x01, 0x71, 0x03, 0x00, 0x04, 0x20, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00,
    ]);
  });

  it('NO mezcla la cabecera de una segunda ECU con los códigos de la primera', () => {
    // Este era el bug: 48 6B 18 se decodificaba como un código de falla.
    const m = parseEcuMessages([
      '48 6B 10 43 01 71 00 00 00 00 C4',
      '48 6B 18 43 07 15 00 00 00 00 C5',
    ], 'legacy');
    expect(m).toHaveLength(2);
    expect(m.find((x) => x.ecu === '10')?.data).toEqual([0x43, 0x01, 0x71, 0, 0, 0, 0]);
    expect(m.find((x) => x.ecu === '18')?.data).toEqual([0x43, 0x07, 0x15, 0, 0, 0, 0]);
  });

  it('arma el VIN de cinco líneas usando el byte de orden', () => {
    const m = parseEcuMessages([
      '87 F1 10 49 02 02 56 57 5A 5A 00',
      '87 F1 10 49 02 01 00 00 00 57 00',
      '87 F1 10 49 02 03 5A 31 4A 5A 00',
      '87 F1 10 49 02 05 33 34 35 36 00',
      '87 F1 10 49 02 04 39 57 31 32 00',
    ], 'legacy');
    const texto = String.fromCharCode(...m[0]!.data.slice(2).filter((c) => c >= 0x20));
    expect(texto).toBe('WVWZZZ1JZ9W123456');
  });

  it('descarta una respuesta larga a la que le falta una línea', () => {
    const m = parseEcuMessages([
      '87 F1 10 49 02 01 00 00 00 57 00',
      '87 F1 10 49 02 03 5A 31 4A 5A 00',
    ], 'legacy');
    expect(m).toEqual([]);
  });
});

describe('direcciones', () => {
  it('nombra las ECU habituales y deja el resto por su dirección', () => {
    expect(describeEcu('7E8')).toBe('Motor (7E8)');
    expect(describeEcu('7E9')).toBe('Transmisión (7E9)');
    expect(describeEcu('10')).toBe('Motor (10)');
    expect(describeEcu('7EC')).toBe('ECU 7EC');
  });

  it('deduce la dirección de solicitud física', () => {
    expect(direccionSolicitud('7E8')).toBe('7E0');
    expect(direccionSolicitud('7E9')).toBe('7E1');
    expect(direccionSolicitud('10')).toBeNull();
    expect(direccionSolicitud('700')).toBeNull();
  });
});
