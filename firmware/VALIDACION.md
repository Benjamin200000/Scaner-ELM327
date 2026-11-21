# Validacion v3: OLED y Wi-Fi local

- Core Arduino-ESP32 3.3.4, ESP32 Dev Module, CPU 240 MHz, flash 4 MB, particion Huge APP.
- Adafruit SSD1306 2.5.15, Adafruit GFX 1.12.4 y BusIO 1.17.4. WiFi, WebServer y Preferences vienen con el core.
- Archivo unico compilado: 1.697.255 bytes de programa (53 % de particion) y 64.300 bytes de variables globales (19 % de la region RAM indicada). Esto no mide RAM libre durante ejecucion.
- Pruebas C++ con AddressSanitizer/UndefinedBehaviorSanitizer correctas: PIDs base, MAF, lambda medida, rechazo de lambda solicitada, temperatura de admision, MAP bar absolutos, carga, acelerador, tension, prioridad de consulta, extras opcionales y desbordamiento del reloj.
- Interfaz probada en Chromium a 390x844 con API simulada: numeros y unidades, N/D, datos cero, peticiones de pagina/seleccion/configuracion con token, limpieza del PIN del formulario, AFR y retirada de valores al perder comunicacion. No se detectaron errores JavaScript ni desbordamiento horizontal.
- Sin pruebas fisicas de ESP32, Wi-Fi + Bluetooth simultaneos, OLED, persistencia NVS o ECU real del Golf. No se ha medido latencia ni consumo reales. La simulacion del navegador no valida el protocolo Bluetooth ni las respuestas reales de la ECU.
- El core emite aviso de futura retirada por defecto de BluetoothSerial en version 4.0; esta entrega se compila con 3.3.4.
- Entrega del firmware para GitHub; las pruebas fisicas y la medicion de latencia siguen pendientes.

## Revision del panel web (servidor asincrono)

- El servidor HTTP del firmware paso de `WebServer` (sincrono, una conexion a la vez) a ESPAsyncWebServer 3.12.1 con Async TCP 3.5.0.
- `tests/server-sim.cjs` modela ambos servidores en Node, sirve la pagina real a Chromium emulando un iPhone 15 Pro y abre preconexiones como Safari. Con preconexiones el modelo sincrono no llega a mostrar datos en 15 s; el asincrono carga al instante y mantiene datos el 100 % del tiempo. Es un modelo del comportamiento documentado del servidor, no una ejecucion del firmware.
- `tests/web-ui-test.cjs` comprueba ademas que la pagina se recupera sola tras un corte (reintenta cada 2 s) y que indica como corregir el nombre del ELM mientras lo busca.
- No probado en WebKit real ni en un iPhone fisico: el entorno de pruebas solo tiene Chromium.
- La pausa de la busqueda Bluetooth al unirse un telefono y el uso de radio compartida Wi-Fi/Bluetooth requieren prueba fisica.
