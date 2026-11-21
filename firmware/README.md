# Tablero Golf MK4/A4 con ESP32 y ELM327

Firmware v3 de lectura para ESP32-WROOM-32 de 38 pines, OLED SSD1306 128×64 I2C y ELM327 Bluetooth clasico SPP. Incluye dos paginas en la misma OLED. Crea una red Wi-Fi local para el movil, no modifica mapas y no borra averias.

La compatibilidad fisica con el Golf, el adaptador y la disponibilidad de aceite requieren una prueba real. No hay hardware conectado en el entorno de compilacion. Un ELM327 BLE o Wi-Fi no sirve para este firmware.

## Wi-Fi local y configuracion desde el telefono (v3)

El ESP32 usa Bluetooth clasico para el ELM y Wi-Fi en modo punto de acceso para el telefono. No necesita router ni conexion a internet. No convierte un ELM BLE o Wi-Fi en uno Bluetooth SPP.

- Red: **GolfDashboard**.
- Clave inicial: **GolfOBD2026**. Se puede cambiar en Config.h antes de subir el programa.
- Direccion: **http://192.168.4.1/** (HTTP, no HTTPS). En iPhone, Mac y la mayoria de los equipos tambien funciona **http://golfdash.local/**.
- En Android/iPhone, mantener la conexion aunque aparezca el aviso de red sin internet. Si el navegador no abre, verificar que no haya cambiado a otra red o que una VPN impida acceder a la IP local.
- El panel se actualiza aproximadamente cada 500 ms; esa frecuencia no equivale a la frecuencia de las respuestas OBD.
- Permite elegir la pagina OLED y cambiar nombre Bluetooth, PIN o MAC del adaptador. La MAC opcional tiene prioridad sobre el nombre. Se requiere un ELM Bluetooth clasico SPP. Si el PIN se deja vacio, se conserva el actual.
- Los ajustes del adaptador se guardan como un bloque en Preferences/NVS y se conservan al apagar. Tras guardarlos se descarta la lectura anterior y se reconecta. Una busqueda Bluetooth ya en curso puede tardar varias decenas de segundos antes de aplicar el cambio.
- Si el ELM no aparece, tras dos busquedas fallidas el ESP32 espera 15 s entre busquedas, o 2 minutos si hay un telefono o computador conectado a la red. Cada busqueda por nombre ocupa la radio hasta 32 s y comparte radio con el Wi-Fi: sin estas pausas el telefono podia no lograr unirse a GolfDashboard o el panel no cargaba. Guardar ajustes nuevos en el panel corta la espera y busca de inmediato.
- El PIN guardado no se devuelve al navegador. Las escrituras exigen un token de la pagina actual para impedir formularios de otros sitios. Cualquier persona con acceso a esta red local puede ver datos y configurar el adaptador; usar una clave Wi-Fi propia.

Datos adicionales implementados: temperatura de admision (010F), presion de admision en **bar absolutos** (010B), carga calculada (0104), posicion de acelerador (0111) y tension de la ECU (0142). No es tension medida directamente en los bornes de la bateria. Se comprueba el soporte antes de consultar y se muestra N/D cuando no esta disponible.

La seleccion de consultas extra empieza vacia. En el movil, marcar los datos deseados y pulsar **Aplicar seleccion**. El plan intercala como maximo una consulta lenta entre dos rapidas; entre consultas adicionales deja al menos un segundo y recorre los campos elegidos. Elegir muchos campos hace que cada uno se actualice con menor frecuencia. El boton **Priorizar latencia** quita estas consultas adicionales. Los datos extra aparecen con su edad y se marcan antiguos al caducar; no son lecturas nuevas si la casilla no esta seleccionada. Las temperaturas base de la pagina 1 conservan sus intervalos.

El Wi-Fi y Bluetooth del ESP32 comparten radio de 2,4 GHz. La implementacion separa las tareas y limita las consultas, pero la latencia real y el consumo con ambos activos requieren medicion fisica. Preferir un solo movil conectado. La red Wi-Fi no convierte en datos disponibles los que la ECU no expone.

### Si ChatGPT no descarga el ZIP

Se entrega tambien **GolfDashboardWiFi.ino**, un archivo unico que contiene los mismos componentes y la pagina web. Abrirlo como texto y copiar TODO en un sketch nuevo de Arduino IDE, guardar con nombre GolfDashboardWiFi y compilar con los mismos ajustes. No necesita las cabeceras separadas del paquete. La version `.txt` contiene exactamente el mismo codigo para copiarlo desde el visor del chat.

### iPhone y navegadores

- El panel usa un servidor web asincrono (ESPAsyncWebServer). El WebServer del core atendia una conexion a la vez y esperaba hasta 5 s a una conexion abierta sin pedido; Safari y Chrome abren conexiones asi por adelantado y el panel podia no cargar nunca. `tests/server-sim.cjs` reproduce ese caso.
- En el iPhone: Ajustes > Wi-Fi > GolfDashboard, clave GolfOBD2026. Aparece "Sin conexion a Internet": es normal, mantenerse conectado. Abrir Safari y escribir la direccion completa con `http://`.
- Si el telefono no logra unirse: esperar un minuto tras encender el ESP32 y reintentar. Al unirse un telefono, si el ELM aun no esta conectado, el ESP32 corta la busqueda Bluetooth en curso y la pausa hasta 2 minutos (o hasta guardar ajustes), porque comparte radio con el Wi-Fi.
- Si el iPhone tenia guardada la red con otra clave: Ajustes > Wi-Fi > (i) > Omitir esta red, y volver a unirse.
- La red acepta hasta 4 equipos a la vez.

### Otros vehiculos (no solo VAG)

El firmware no depende de la marca: usa deteccion automatica de protocolo (`ATSP0`: CAN 11/29 bit, ISO 9141, KWP2000 y J1850) y solo datos OBD-II estandar (modo 01).

- En CAN, tras detectar el protocolo, pregunta solo a la computadora del motor (7E0, o 18DA10F1 en 29 bit). Asi la caja automatica u otras computadoras no responden encima, algo comun en camionetas Toyota, Ford, Mitsubishi o Nissan. Si el motor no contesta por esa direccion, vuelve a la consulta general.
- En los otros protocolos, si responden varias computadoras, se suman sus mapas de datos disponibles.
- El AFR calculado usa la relacion estequiometrica del combustible que informa la ECU (PID 51: gasolina 14,7; diesel 14,5; GLP 15,5; GNC 17,2; etanol 9,0). Si no lo informa, usa `STOICHIOMETRIC_AFR` de Config.h.
- Lo que la ECU no ofrece aparece como N/D. Muchos diesel no informan lambda de banda ancha ni temperatura de aceite por OBD-II estandar.
- Requiere un vehiculo con OBD-II/EOBD (en general gasolina desde 2001 y diesel desde 2004 en Europa; en Chile depende del mercado de origen del modelo).

## Dos paginas: un solo programa

Se carga una sola vez `GolfDashboard.ino`; no se necesitan dos pantallas fisicas ni dos programas.

- **Pagina 1:** RPM, velocidad km/h, refrigerante y aceite si la ECU lo ofrece. Mantiene las consultas rapidas de RPM y velocidad.
- **Pagina 2:** MAF en g/s, lambda reportada por sonda de banda ancha y `AFR calc`. La pagina de mezcla consulta alternadamente MAF y lambda; por defecto no consulta los parametros ocultos de la primera pagina. Al volver a la primera se reanudan RPM/velocidad y temperaturas.
- Para cambiar, pulsar y soltar **BOOT** (GPIO0) con el programa ya ejecutandose. Una pulsacion de unos 0,2 segundos basta. No mantener BOOT al encender o reiniciar: eso activa el modo de carga del ESP32.
- Alternativa desde el Monitor serie a 115200: enviar la letra **p**. No se requiere un pulsador adicional. La lectura del boton tiene antirrebote y no interrumpe la consulta OBD en curso.

La segunda pagina **no garantiza que el Golf entregue lambda medida**. Se comprueba el mapa de soporte antes de consultar. Se usa el sensor 1 de banda ancha: PID **0124**, o **0134** si el primero no esta disponible. No se usa **0144** (lambda solicitada), ni se infiere AFR a partir del voltaje de una sonda estrecha o del MAF solo. Tampoco se sustituye el sensor 1 por una sonda posterior al catalizador.

`AFR calc = lambda reportada × STOICHIOMETRIC_AFR`. La constante inicial de Config.h es **14.7** y representa una referencia de gasolina, no una identificacion del combustible de tu tanque. Cambiarla si se conoce otra referencia estequiometrica. El AFR se muestra siempre como **calculado**; no es una medicion independiente de masa de combustible ni una comprobacion de exactitud del sensor. Si falta lambda, el AFR tambien aparece N/D o --. Con lambda caducada, ambos muestran OLD.

`WB24` o `WB34` en la cabecera indica el PID elegido. MAF usa PID **0110**, `(256A+B)/100` g/s; lambda usa `(256A+B)/32768` de la respuesta de cuatro bytes de 0124/0134. Se rechazan tramas incompletas y lambda cero. Un valor cero de MAF, por ejemplo con motor detenido, no se trata como falta de dato.

Los datos de la pagina oculta pueden caducar y aparecer OLD brevemente al regresar, hasta recibir respuestas nuevas. La segunda pagina no consume consultas mientras esta oculta, salvo parametros seleccionados explicitamente como extras desde el movil. Para comprobar su rapidez, el monitor serie muestra tambien tasas MAF/lambda y milisegundos por consulta.

## Cableado

| OLED | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

Alimentar el ESP32 por USB desde el PC o desde un cargador USB de automovil regulado a 5 V. La toma del encendedor sin cargador entrega tension de bateria, no 5 V. No alimentar esta OLED a 5 V ni conectar los GPIO directamente a OBD. El ELM327 se conecta al OBD y se comunica por Bluetooth con el ESP32; no hay cables de senal entre ambos.

## Subir con Arduino IDE 2

1. Descargar Arduino IDE desde https://www.arduino.cc/en/software e instalarlo.
2. En Archivo > Preferencias > Gestor de URLs adicionales de tarjetas, agregar:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. En Gestor de placas, instalar **esp32 by Espressif Systems, version 3.3.4**. El codigo usa la API `BluetoothSerial.setPin(pin, longitud)` de esa version; no se ha comprobado con el core 2.x.
4. En el Gestor de bibliotecas, instalar **Adafruit SSD1306 2.5.15**, **Adafruit GFX Library 1.12.4** y su dependencia **Adafruit BusIO 1.17.4**, y ademas **ESP Async WebServer 3.12.1** y **Async TCP 3.5.0** (ambas de ESP32Async). Aceptar la instalacion de dependencias.
5. Descomprimir el paquete y abrir **GolfDashboard/GolfDashboard.ino**. Mantener juntos los archivos `.ino` y `.h` de esa carpeta.
6. En Herramientas, seleccionar **ESP32 Dev Module**, CPU **240 MHz**, Flash **4 MB**, Partition Scheme **Huge APP (3MB No OTA/1MB SPIFFS)** y Upload Speed **460800**. Seleccionar el puerto COM de la placa.
7. Conectar un cable USB de datos y pulsar **Verificar** y despues **Subir**. Si queda en `Connecting...`, mantener BOOT pulsado hasta que empiece la escritura y soltarlo. Si falla la carga, bajar Upload Speed a **115200**. La velocidad de carga USB no determina la velocidad OBD.
8. Abrir Monitor serie a **115200 baudios**. Si no aparece puerto COM, revisar cable y controlador CP2102 oficial: https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers
9. Conectar el ELM al Golf, poner contacto y dejarlo encendido. Desconectar el telefono del ELM para que no ocupe su unica conexion. El ESP32 intentara conectarse y detectar automaticamente el protocolo de la ECU. La primera deteccion puede tardar decenas de segundos.
10. Con el vehiculo detenido, comprobar RPM y refrigerante. La velocidad se verifica posteriormente con registro o un acompanante; el conductor no manipula el equipo en marcha.

## Nombre y PIN Bluetooth

En `GolfDashboard/Config.h`, el nombre inicial es `ELM 327`, incluidos el espacio y las mayusculas. Si el adaptador anuncia `OBDII`, `OBD2`, `ELM327` u otro nombre, cambiarlo por el nombre real y volver a subir.

El firmware proporciona PIN `1234` si el ELM lo solicita. No es una confirmacion del PIN de tu adaptador. Si no conecta, probar `0000` o el PIN del fabricante en `ELM_PIN`. Tener Bluetooth en el telefono sin haber escrito un PIN no identifica el tipo de radio ni su codigo.

Para evitar la busqueda por nombre se puede configurar su direccion MAC en los seis bytes `ELM_MAC` y poner `USE_ELM_MAC = true`. No habilitar esta opcion con la direccion de ejemplo en ceros. Solo usar la MAC del adaptador propio.
## Rapidez y significado de la pantalla

- En la pagina 1, RPM y velocidad se consultan alternadamente, con una unica solicitud en vuelo y sin pausa fija tras cada respuesta.
- En la pagina 1, refrigerante se consulta aproximadamente cada 1,5 s; aceite cada 4 s, solo si el mapa de PIDs lo admite. Como maximo se intercala una consulta lenta entre dos rapidas. En la pagina 2 las consultas principales son MAF/lambda disponibles. La seleccion movil puede intercalar otras consultas en cualquiera de las paginas.
- Se configura `ATAT2` (temporizacion adaptativa agresiva) con alternativa `ATAT1` si el adaptador no confirma el comando; `ATST20` fija 128 ms de espera ELM antes del ajuste adaptativo. No equivale a un retraso impuesto entre solicitudes ni garantiza 128 ms de extremo a extremo.
- La tarea OBD esta separada del renderizado OLED. I2C a 400 kHz y oportunidades de refresco cada 50 ms, hasta 20/s. Solo se repinta al recibir datos o para actualizar el estado de caducidad.
- No hay interpolacion ni suavizado que inventen lecturas o anadan retardo. La pantalla se actualiza con las respuestas reales de la ECU.
- `R:... V:... Hz` indica respuestas validas por segundo de RPM y velocidad, medidas en ventanas de unos 3 s. El monitor serie incluye tambien los milisegundos de la ultima consulta de cada una, no el retardo interno completo de la ECU.
- Ejemplo matematico, no medicion de este Golf: si el conjunto responde 8 consultas/s, no puede entregar 8 lecturas/s de cada parametro; las consultas se reparten y las temperaturas consumen parte del tiempo.
- `N/D`: el mapa de soporte declara el parametro no disponible. `--`: aun no hay una lectura o no se pudo determinar el soporte. `OLD`: lectura caducada, mas de 1,8 s en RPM/velocidad; 10 s en refrigerante; 15 s en aceite. Al perder la conexion se muestran mensajes de reconexion, no valores antiguos.

La temperatura de aceite usa **modo 01 PID 5C** (A−40 °C). No se deduce del refrigerante. Si solo esta disponible mediante funciones especificas VAG/cuadro, esta version no las implementa: se muestra N/D o -- segun la respuesta de soporte.

RPM usa PID 0C ((256A+B)/4), velocidad 0D (A km/h), refrigerante 05 (A−40 °C). El formato de velocidad tiene resolucion de 1 km/h porque asi lo define el PID estandar.

## Si hay fallos o lecturas lentas

- No conecta: verificar nombre exacto, Bluetooth clasico SPP, PIN, adaptador encendido y ausencia de otra conexion activa. Probar MAC si la busqueda por nombre es inestable.
- Pantalla negra: revisar 3,3 V, GND, SDA/SCL y probar direccion `0x3D` en Config.h. Confirmar que el controlador sea SSD1306 y no SH1106. Si el modulo no admite el bus rapido, bajar `OLED_I2C_HZ` a 100000; esto afecta al refresco de pantalla.
- `NO DATA` o reconexiones al consultar: en Config.h cambiar modo adaptativo a `ATAT1` y tiempo a `ATST32` (200 ms). Aumentar `FAST_STALE_MS` si la conexion es valida pero naturalmente lenta. Volver a compilar/subir y comparar Hz y estabilidad.
- La deteccion inicial usa ATSP0. No se fuerza CAN: un Golf que utilice ISO 9141 o KWP por K-Line tiene otros tiempos. Bluetooth mas rapido o mas consumo no elimina esa limitacion.
- Si se pierde el prompt `>`, hay desbordamiento de respuesta o caen consultas sucesivas, se reconecta para evitar mezclar respuestas tardias con la siguiente consulta.

No hay una frecuencia minima garantizada. La mejora debe medirse con este ELM y la ECU real. Un adaptador mas rapido puede ayudar, pero no cambia la frecuencia a la que la ECU ofrece cada dato.

## Validacion del codigo

El analizador tiene pruebas de conversiones, deteccion de PIDs, eco, respuestas incompletas, mensajes de error, MAF, lambda y rechazo de lambda solicitada. El planificador tiene pruebas de alternancia, prioridades de temperaturas, pagina oculta, parametros no disponibles y desbordamiento del reloj. Ejecutar desde la raiz del repositorio:

```sh
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined firmware/tests/obd_codec_test.cpp -o /tmp/golf-obd-test
/tmp/golf-obd-test
```

Compilacion Arduino CLI equivalente al IDE:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32:PartitionScheme=huge_app,FlashSize=4M,CPUFreq=240 firmware/GolfDashboard
```

La compilacion y las pruebas de analisis no demuestran funcionamiento fisico de Bluetooth, pantalla o parametros del Golf. No se ha probado contra la ECU real. No se ha publicado ni enviado el codigo a servicios externos.
