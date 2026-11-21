# Descargar Golf Dashboard ESP32 Wi-Fi v3

## Lo más fácil: cargador web, sin instalar nada

[`firmware-cargador/Cargar-GolfDashboard-ESP32.html`](../../firmware-cargador/Cargar-GolfDashboard-ESP32.html):
descargarlo (Download raw file) y abrirlo con doble clic en Chrome o Edge.
Trae esta misma imagen adentro y la verifica antes y después de escribir.

La imagen y el cargador los compila el workflow **Firmware ESP32** desde
`firmware/GolfDashboardWiFi/`; `GolfDashboard-ESP32-WROOM32-manifest.json`
indica de qué commit salieron.

## Imagen lista para Flash Download Tool (sin Arduino IDE)

[Descargar .bin para ESP32-WROOM-32](GolfDashboard-ESP32-WROOM32-4MB.bin)

[Instrucciones para cargarlo](CARGAR_CON_ESPRESSIF.md). Imagen completa de 4 MiB, ESP32 original, DIO, 40 MHz y direccion **0x0**. Reemplaza programa/configuracion anteriores. No es para ESP32-C3/S3.

## Codigo fuente para Arduino IDE

[Descargar ZIP](https://github.com/Benjamin200000/Scaner-ELM327/raw/refs/heads/main/firmware/downloads/GolfDashboard-ESP32-v3-WiFi.zip)

El repositorio es privado: iniciar sesion en GitHub con una cuenta que tenga acceso. Si no comienza la descarga, abrir el archivo ZIP en GitHub y pulsar **Download raw file**.

Descomprimir y abrir `GolfDashboardWiFi/GolfDashboardWiFi.ino` en Arduino IDE. El ZIP incluye el codigo y las instrucciones; no es un ejecutable de Windows.

SHA-256: `19a136582fa16df9e0b4ea6e9b3a27359fbd1968d4f57fe026607d1ac10a547f`

Compilacion y pruebas de software aprobadas; pendiente prueba con ESP32, pantalla, ELM y Golf reales.
