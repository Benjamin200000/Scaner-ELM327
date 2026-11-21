"""Comprime web/panel.html y lo incrusta en las dos versiones del firmware.

El panel se sirve comprimido (gzip) directamente desde la flash: ocupa menos
de la mitad y no se copia a la RAM, que con Wi-Fi y Bluetooth clasico activos
es escasa. Editar siempre web/panel.html y volver a correr este script.

Uso:  python3 -I tools/generar-panel.py            (genera)
      python3 -I tools/generar-panel.py --verificar (falla si no coincide)
"""
import gzip
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
PANEL = os.path.join(RAIZ, 'web', 'panel.html')
HEADER = os.path.join(RAIZ, 'GolfDashboard', 'WebUi.h')
UNICO = os.path.join(RAIZ, 'GolfDashboardWiFi', 'GolfDashboardWiFi.ino')
INICIO = '// --- panel web: generado por tools/generar-panel.py desde web/panel.html; no editar a mano ---'
FIN = '// --- fin del panel web ---'


def arreglo(datos):
    filas = []
    for i in range(0, len(datos), 20):
        filas.append('  ' + ','.join(f'0x{b:02x}' for b in datos[i:i + 20]) + ',')
    return (f'{INICIO}\nstatic const uint8_t WEB_UI_GZ[] PROGMEM = {{\n' + '\n'.join(filas) +
            f'\n}};\nstatic const size_t WEB_UI_GZ_LEN = sizeof(WEB_UI_GZ);\n{FIN}')


def extraer(texto):
    m = re.search(re.escape(INICIO) + r'.*?' + re.escape(FIN), texto, re.S)
    if not m:
        return None
    nums = re.findall(r'0x([0-9a-f]{2})', m.group(0).split('{', 1)[1].split('}', 1)[0])
    return bytes(int(n, 16) for n in nums)


def main():
    html = open(PANEL, 'rb').read()
    if '--verificar' in sys.argv:
        malos = []
        for ruta in (HEADER, UNICO):
            datos = extraer(open(ruta, encoding='utf-8').read())
            if datos is None or gzip.decompress(datos) != html:
                malos.append(os.path.relpath(ruta, RAIZ))
        if malos:
            print('El panel incrustado no coincide con web/panel.html en: ' + ', '.join(malos))
            print('Correr: python3 -I firmware/tools/generar-panel.py')
            sys.exit(1)
        print(f'Panel incrustado correcto ({len(html)} bytes de HTML).')
        return
    gz = gzip.compress(html, compresslevel=9, mtime=0)
    bloque = arreglo(gz)
    with open(HEADER, 'w', encoding='utf-8') as f:
        f.write('#pragma once\n#include <Arduino.h>\n\n' + bloque + '\n')
    texto = open(UNICO, encoding='utf-8').read()
    if INICIO in texto:
        texto = re.sub(re.escape(INICIO) + r'.*?' + re.escape(FIN), lambda _: bloque, texto, flags=re.S)
    else:
        texto, n = re.subn(r'static const char WEB_UI\[\] PROGMEM = R"GOLFHTML\(.*?\)GOLFHTML";', lambda _: bloque, texto, flags=re.S)
        if n != 1:
            sys.exit('No se encontró el panel en GolfDashboardWiFi.ino')
    with open(UNICO, 'w', encoding='utf-8') as f:
        f.write(texto)
    print(f'HTML {len(html)} bytes -> gzip {len(gz)} bytes')


main()
