# Validacion v3: OLED y Wi-Fi local

- Core Arduino-ESP32 3.3.4, ESP32 Dev Module, CPU 240 MHz, flash 4 MB, particion Huge APP.
- Adafruit SSD1306 2.5.15, Adafruit GFX 1.12.4 y BusIO 1.17.4. WiFi, WebServer y Preferences vienen con el core.
- Archivo unico compilado: 1.697.255 bytes de programa (53 % de particion) y 64.300 bytes de variables globales (19 % de la region RAM indicada). Esto no mide RAM libre durante ejecucion.
- Pruebas C++ con AddressSanitizer/UndefinedBehaviorSanitizer correctas: PIDs base, MAF, lambda medida, rechazo de lambda solicitada, temperatura de admision, MAP bar absolutos, carga, acelerador, tension, prioridad de consulta, extras opcionales y desbordamiento del reloj.
- Interfaz probada en Chromium a 390x844 con API simulada: numeros y unidades, N/D, datos cero, peticiones de pagina/seleccion/configuracion con token, limpieza del PIN del formulario, AFR y retirada de valores al perder comunicacion. No se detectaron errores JavaScript ni desbordamiento horizontal.
- Sin pruebas fisicas de ESP32, Wi-Fi + Bluetooth simultaneos, OLED, persistencia NVS o ECU real del Golf. No se ha medido latencia ni consumo reales. La simulacion del navegador no valida el protocolo Bluetooth ni las respuestas reales de la ECU.
- El core emite aviso de futura retirada por defecto de BluetoothSerial en version 4.0; esta entrega se compila con 3.3.4.
- Entrega del firmware para GitHub; las pruebas fisicas y la medicion de latencia siguen pendientes.
