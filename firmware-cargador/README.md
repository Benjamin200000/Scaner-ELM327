# Cargador web del ESP32 (sin instalar programas)

Genera `Cargar-GolfDashboard-ESP32.html`: un solo archivo con el firmware
Golf Dashboard incluido. Se abre con doble clic en Chrome o Edge, se pulsa
**Cargar**, se elige el puerto de la placa y listo. No usa internet ni
páginas externas, y no hay que escribir direcciones de memoria.

Usa [esptool-js](https://github.com/espressif/esptool-js) 0.6.1 (Apache-2.0),
la biblioteca oficial de Espressif, empaquetada dentro del archivo.

Antes de escribir:
- comprueba que el firmware incluido sea idéntico a
  `firmware/downloads/GolfDashboard-ESP32-WROOM32-v3-4MB.bin` (SHA-256);
- comprueba que la placa sea ESP32 original y tenga al menos 4 MB.

Después de escribir, el ESP32 calcula el MD5 de lo escrito y se compara.

Se escribe desde 0x0 hasta el último byte con datos (1,68 MiB); el resto
de la imagen es relleno 0xFF de particiones que el firmware no usa. La
configuración guardada (NVS, 0x9000) sí queda dentro y se borra.

## Armar

La imagen está en `firmware/downloads/` de la rama `main`.

```bash
cd firmware-cargador
npm install
npm run typecheck && npm test
npm run armar
```

`probar-pagina.cjs` y `probar-danado.cjs` prueban la página en Chromium con
puertos simulados: carga, cancelación, placa que no responde e imagen
alterada. No reemplazan una carga en una placa real.
