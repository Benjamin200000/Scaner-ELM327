# Cobertura y límites de la aplicación nativa

| Función | Estado nativo |
|---|---|
| Interfaz de escritorio | Windows Forms, controles nativos, sin navegador ni servidor |
| x86 y x64 | Dos publicaciones independientes con .NET incluido; usar la arquitectura de la DLL |
| ELM327 USB/Bluetooth Classic | Puerto COM de Windows; inicialización y solicitudes OBD, headers y checksum |
| Bluetooth BLE/GATT | Sin transporte GATT nativo en esta versión; no confundir con Bluetooth Classic SPP |
| KKL USB K-Line | KW1281: inicialización lenta, eco local, complemento, bloques, identificación, fallas y grupos |
| Cable VCDS/HEX | Solo un cable que ofrezca COM/KKL compatible. HEX-V2 y HEX-NET propietarios no se declaran compatibles |
| Autel J2534 | Descubrimiento de drivers 04.04, comprobación de arquitectura, FFI directa y canal ISO15765 CAN 11/29 bits |
| Otros protocolos J2534 | ISO9141/ISO14230/J1850 no están implementados en el transporte nativo actual |
| Datos OBD | Descubrimiento de PID, selección, actualización, gráfico RPM y PID genéricos del proyecto |
| PID ampliados diésel | Se mantienen marcados como escala sin verificar y no alimentan diagnósticos como dato fiable |
| Códigos | Modos 03, 07, 0A y 04 con confirmación doble; contador CAN explícito y formato K-Line separado |
| Datos congelados | Modo 02, cuadro 00, selección de PID |
| Identidad | VIN, calibración, CVN, nombre ECU por modo 09; DID UDS de identificación |
| Emisiones | Monitores de PID 01 gasolina/diésel; no certifica revisión técnica chilena |
| Modo 06 | Descubrimiento CAN, resultados por ECU, valores internos con límites y signo; sin convertir escalas supuestas |
| Interpretación | Siete reglas portadas; datos ausentes, combustible y cilindrada se muestran como requisitos pendientes |
| Conocimiento | 11 DTC con causas y pruebas, 12 rangos, 36 fallas VAG y grupos del proyecto, consultables dentro del EXE |
| Lectura de ECU | UDS 0x23 manual por J2534, progreso, cancelación, validación de longitud y manifiesto de lectura parcial |
| RequestUpload / 0x35 | Sesión extendida, tamaño negociado, TransferData con contador y finalización; progreso y cancelación |
| Seguridad ECU | No se adivinan llaves ni se incluyen módulos comerciales o algoritmos universales |
| Mapas | BIN/XDF entero 8/16/32 bits, signo/endian, fórmulas aritméticas, edición cruda, comparación y exportación con SHA-256 |
| Referencia ME7.5 | Se conserva la definición de referencia del ROM 1.8T y la demostración; selección explícita, sin aplicar al Golf automáticamente |
| XDF avanzado | No interpreta fórmulas arbitrarias, datos flotantes ni BASEOFFSET no nulo; rechaza lo no soportado |
| Ejes y superficies | Metadatos originales conservados en conocimiento; visor nativo por celdas, sin gráfico 3D ni ejes interpolados |
| Checksum y escritura flash | No implementados; exportación de remap offline marcada como no validada |
| Funciones de servicio | Borrado OBD implementado; no se trasladan secuencias VAG ni regeneración DPF no verificadas |
| Terminal | Servicios de lectura explícitos; borrado desde su flujo de confirmación |
| Informes e historial | JSON local, traza y diálogo nativo de impresión/PDF |

El código web se conserva íntegro como referencia y por sus pruebas; **no se afirma paridad total** con todas sus funciones. Estas diferencias no se ocultan detrás de un EXE que muestre la web. Los elementos pendientes requieren trabajo adicional; tampoco se declara cobertura universal para vehículos del mercado chileno.

## Golf y Autel del usuario

El usuario indicó un Golf con ECU «ME3.7» y una interfaz Autel J2534. Aún no confirmó año, motorización, número de pieza/versión de software ni modelo exacto de la interfaz. ME3.7 no se sustituye por ME7.1 o ME7.5. No se incluyó ningún perfil automático de memoria ni se presentó una lectura UDS genérica como compatible con ese Golf. La identificación y una traza real son el siguiente requisito para su perfil.
