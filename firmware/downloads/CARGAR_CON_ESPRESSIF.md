# Cargar Golf Dashboard con Flash Download Tool

Para ESP32-WROOM-32 de 4 MB, ESP32 original (ESP32-D0WD), NO ESP32-C3 ni ESP32-S3. No requiere Arduino IDE ni instalar bibliotecas: esta imagen ya esta compilada.

## Descargar

[Descargar imagen completa .bin](GolfDashboard-ESP32-WROOM32-4MB.bin)

El archivo debe medir exactamente **4.194.304 bytes (4 MiB)**. El repositorio es privado: iniciar sesion en GitHub. Si no empieza la descarga, abrir el archivo en GitHub y usar **Download raw file**.

Esta imagen escribe la flash completa y reemplaza el programa y la configuracion guardada que hubiera en el ESP32. Se entrega sin prueba fisica de la placa o el vehiculo.

## Flash Download Tool

1. Abrir la herramienta seleccionando **ChipType: ESP32**. La ventana debe indicar ESP32, no ESP32C3. Si la herramienta solo admite C3, descargar Flash Download Tools para ESP32 desde https://www.espressif.com/en/support/download/other-tools
2. Si pregunta, elegir **WorkMode: Develop** y **LoadMode: UART**.
3. Conectar el ESP32 por USB de datos. Cerrar Monitor serie/Arduino IDE si ocupan el puerto.
4. En la primera fila, elegir `GolfDashboard-ESP32-WROOM32-4MB.bin`, marcar la casilla izquierda y escribir **0x0** en la direccion a la derecha de @. El binario ya incluye bootloader, tabla de particiones y aplicacion. Se carga en una sola fila.
5. **SPI SPEED: 40 MHz**; **SPI MODE: DIO**; mantener **DoNotChgBin** marcado.
6. Seleccionar el **COM** de la placa y **BAUD: 115200**.
7. Pulsar **START**. Si no conecta, mantener **BOOT**, dar un toque a **EN/RESET** y soltar BOOT cuando comience la escritura.
8. Esperar **FINISH**; puede tardar varios minutos. Soltar BOOT si sigue pulsado y pulsar **EN/RESET** para iniciar el programa.

Si COM esta vacio: revisar cable de datos y el controlador CP2102 oficial de Silicon Labs: https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers

## Despues de cargar

OLED: VCC a 3V3, GND a GND, SDA a GPIO21, SCL a GPIO22. Alimentar el ESP32 por USB a 5 V regulados.

Con el movil, conectarse a **GolfDashboard**, clave inicial **GolfOBD2026**, y abrir **http://192.168.4.1/**. Mantener la red aunque no tenga internet. Desde el panel se configura el ELM Bluetooth clasico SPP (nombre inicial ELM 327, PIN inicial 1234).

Una pulsacion corta BOOT con el programa ya ejecutandose alterna las dos paginas OLED. No mantener BOOT al encender, excepto para entrar al modo de carga.

Fuentes de esta compilacion: `firmware/GolfDashboardWiFi/GolfDashboardWiFi.ino`. Core ESP32 3.3.4, Minimal SPIFFS (OTA), CPU 240 MHz, flash 4 MB, DIO y 40 MHz. Bibliotecas Adafruit y sus versiones en README.md. Avisos de componentes en `licenses/`; fuentes Arduino-ESP32: https://github.com/espressif/arduino-esp32/tree/3.3.4 y ESP-IDF: https://github.com/espressif/esp-idf/tree/v5.5

Comprobaciones: compilacion correcta; checksums y hashes de bootloader/aplicacion validados con esptool; componentes encontrados en sus offsets de la imagen combinada; identidad ESP32, DIO/40 MHz y tabla Minimal SPIFFS con dos particiones de programa comprobadas. Pendiente validar en hardware real.
