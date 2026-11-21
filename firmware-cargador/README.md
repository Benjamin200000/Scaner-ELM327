# Cargador web del ESP32 (sin instalar programas)

**Para usarlo:** abrí `Cargar-GolfDashboard-ESP32.html` en GitHub, pulsá
**Download raw file** (ícono de descarga, arriba a la derecha), y abrí el
archivo descargado con doble clic en Chrome o Edge. Verlo dentro de GitHub
solo muestra el código: hay que descargarlo.

`Cargar-GolfDashboard-ESP32.html`: un solo archivo con el firmware
Golf Dashboard incluido. Se abre con doble clic en Chrome o Edge, se pulsa
**Cargar**, se elige el puerto de la placa y listo. No usa internet ni
páginas externas, y no hay que escribir direcciones de memoria.

Usa [esptool-js](https://github.com/espressif/esptool-js) 0.6.1 (Apache-2.0),
la biblioteca oficial de Espressif, empaquetada dentro del archivo.

Antes de escribir:
- comprueba que el firmware incluido sea idéntico a
  `firmware/downloads/GolfDashboard-ESP32-WROOM32-4MB.bin` (SHA-256);
- comprueba que la placa sea ESP32 original y tenga al menos 4 MB.

Después de escribir, el ESP32 calcula el MD5 de lo escrito y se compara.

Se escribe desde 0x0 hasta el último byte con datos (1,68 MiB); el resto
de la imagen es relleno 0xFF de particiones que el firmware no usa. La
configuración guardada (NVS, 0x9000) sí queda dentro y se borra.

## Armar

Lo regenera el workflow **Firmware ESP32** cada vez que cambia el firmware. Para hacerlo a mano:

```bash
cd firmware-cargador
npm install
npm run typecheck && npm test
npm run armar
```

`probar-pagina.cjs`, `probar-danado.cjs`, `probar-manual.cjs`, `probar-windows.cjs`, `probar-consola.cjs` y `probar-escritura.cjs` (carga completa contra un ESP32 simulado, incluido el error "status 201,0" y el reintento automático a 115200) (con un ESP32 simulado que responde sincronización e identificación del chip) prueban la página en Chromium con
puertos simulados: carga, cancelación, placa que no responde e imagen
alterada. No reemplazan una carga en una placa real.

## Ver mensajes de la placa

El botón **Ver mensajes de la placa** abre el puerto a 115200 baudios,
reinicia el ESP32 y muestra lo que escribe al arrancar (si levantó el Wi-Fi,
si busca el ELM, reinicios por falta de energía o fallas). **Copiar texto**
lo copia para pegarlo en un reporte.
