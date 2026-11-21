"""Verifica una imagen completa de ESP32 antes de publicarla.

Comprueba tamaño (4 MiB), cabeceras de bootloader y aplicación (ESP32
original, DIO, 40 MHz, 4 MB) y la tabla de particiones Huge APP.
Uso: python3 -I verificar-imagen.py imagen.bin
"""
import struct
import sys

b = open(sys.argv[1], 'rb').read()
fallas = []
if len(b) != 4 * 1024 * 1024:
    fallas.append(f'tamaño {len(b)}, se esperaban 4194304')
for nombre, off in (('bootloader', 0x1000), ('aplicación', 0x10000)):
    if b[off] != 0xE9:
        fallas.append(f'{nombre}: sin cabecera de imagen ESP')
        continue
    modo, tam_frec = b[off + 2], b[off + 3]
    chip = struct.unpack('<H', b[off + 12:off + 14])[0]
    if modo != 2:
        fallas.append(f'{nombre}: modo flash {modo}, se esperaba DIO (2)')
    if tam_frec & 0xF != 0:
        fallas.append(f'{nombre}: frecuencia distinta de 40 MHz')
    if tam_frec >> 4 != 2:
        fallas.append(f'{nombre}: tamaño de flash distinto de 4 MB')
    if chip != 0:
        fallas.append(f'{nombre}: chip id {chip}, se esperaba ESP32 original (0)')
particiones = {}
off = 0x8000
while b[off:off + 2] == b'\xaa\x50':
    o, sz = struct.unpack('<II', b[off + 4:off + 12])
    particiones[b[off + 12:off + 28].rstrip(b'\0').decode()] = (o, sz)
    off += 32
if particiones.get('app0') != (0x10000, 0x300000):
    fallas.append(f'partición app0 inesperada: {particiones.get("app0")}')
if 'nvs' not in particiones:
    fallas.append('falta la partición nvs')
print('particiones:', ', '.join(f'{k}@0x{v[0]:X}' for k, v in particiones.items()))
if fallas:
    print('FALLAS:\n  ' + '\n  '.join(fallas))
    sys.exit(1)
print('imagen correcta')
