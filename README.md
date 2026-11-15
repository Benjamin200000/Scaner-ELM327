# Scaner-ELM327

Plataforma web de diagnóstico automotriz. Se conecta al vehículo mediante
interfaces ELM327 y presenta lectura de parámetros, códigos de falla e
interpretación asistida.

Funciona en notebook, PC, tablet y teléfono, desde el navegador, sin
instalación y sin backend.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 88 tests
npm run build
```

Sin hardware a mano, en la pantalla de conexión se elige **Simulador**: trae
un escenario gasolina y uno diésel con DPF saturado y overboost.

---

## Lo que hay que saber antes de usarlo

Hay tres límites que no son del código y que conviene conocer antes de
comprar un adaptador o prometerle algo a un cliente.

> **Hay un agente local** que levanta casi todos estos límites: ver
> [`agent/README.md`](agent/README.md). Lo de abajo describe qué puede y qué
> no puede hacer el navegador **por sí solo**.

### 1. La mayoría de los ELM327 Bluetooth NO funcionan desde el navegador

Los adaptadores Bluetooth baratos y más comunes son **Bluetooth Classic** y
hablan SPP (Serial Port Profile). Web Bluetooth, la API del navegador,
**solo soporta BLE/GATT**. Un adaptador SPP nunca va a aparecer en el
selector, por mucho que esté emparejado con el sistema operativo.

Desde el navegador funcionan solo los adaptadores **BLE**: Vgate iCar Pro
BLE, Veepeak OBDCheck BLE, OBDLink CX y clones BLE. La app trae los perfiles
GATT conocidos de esos adaptadores y los prueba en orden
(`src/core/transport/webbluetooth.ts`).

### 2. iOS no puede acceder al hardware desde ningún navegador

Ni Web Serial ni Web Bluetooth existen en iOS o iPadOS, y tampoco en Safari
de escritorio ni en Firefox. En iPhone y iPad la app abre y navega, pero no
se puede conectar a un adaptador.

| Plataforma | USB (Web Serial) | BLE (Web Bluetooth) | Con agente local |
|---|---|---|---|
| Chrome / Edge escritorio | Sí | Sí | Todo |
| Chrome Android | No | Sí | Todo, contra la notebook |
| Firefox, Safari | No | No | Todo, contra la notebook |
| iOS / iPadOS | No | No | Todo, contra la notebook |

La pantalla de conexión muestra las opciones no disponibles deshabilitadas y
con el motivo, en lugar de esconderlas: así queda claro que el límite lo pone
el navegador y no la aplicación.

### 3. Un ELM327 no es un equipo de diagnóstico de fabricante

Es un conversor de protocolo. El bloque OBD-II genérico (códigos, datos en
vivo, identificación) está garantizado por norma y **está implementado y
probado**.

Las funciones específicas de fabricante — adaptaciones, pruebas de
actuadores, regeneración de DPF, bloques de medición, ajustes básicos — son
alcanzables en principio sobre KWP2000 o CAN, pero dependen de cada ECU y de
su nivel de acceso. **Están modeladas y evaluadas, pero no implementadas**:
ejecutarlas requiere verificar cada secuencia contra una ECU real, y una
secuencia equivocada en una adaptación o una regeneración puede dejar el
vehículo peor que antes.

Un caso concreto para VAG: los vehículos anteriores a ~2001 suelen usar
**KW1281**, un protocolo por bloques con handshake byte a byte que el ELM327
no puede hablar aunque la ECU esté sobre K-Line. Para esos hace falta una
interfaz KKL o un equipo dedicado. La pantalla **Funciones** evalúa esto
contra la conexión activa y lo informa.

---

## El principio que ordena todo el diseño

**No inventar información.** No es una intención: está impuesto por los tipos
de datos.

- Toda búsqueda en la base de conocimiento devuelve `T | null`. No hay textos
  de relleno. Un código desconocido se informa como tal.
- Todo dato de referencia declara su `provenance` (norma, fabricante,
  práctica de taller, medido) y la UI puede mostrarlo distinto.
- Un parámetro sin rango fiable se muestra con su valor y estado
  `SIN REFERENCIA`. No se inventa un rango plausible.
- Un PID no soportado se muestra como `NO COMPATIBLE`, nunca como `0`.
- Un rango cuyas condiciones no se cumplen (motor frío, vehículo en
  movimiento) no se aplica: el estado es `FUERA DE CONDICIÓN`. Así un
  arranque en frío no se marca como anomalía.
- Las reglas de diagnóstico distinguen **dato anormal** de **diagnóstico
  confirmado**. El nivel más alto que la app afirma es `PATRÓN COMPATIBLE`;
  no existe un nivel "confirmado" y ninguna regla dice que una pieza esté
  defectuosa.
- Una regla que no se pudo evaluar se **informa** con qué le faltó. Que la
  regla de DPF no haya corrido no significa que el DPF esté bien.

Ejemplo de lo anterior funcionando: la regla que compara el caudal de aire
medido contra el teórico necesita la cilindrada. Sin ese dato no corre, y lo
dice, en lugar de comparar contra un número estimado al azar.

---

## Arquitectura

```
Interfaz (React)           src/ui/
Estado                     src/state/
Motor de diagnóstico       src/core/engine/     reglas, rangos, sistemas
Base de conocimiento       src/knowledge/       DTC, rangos, procedencia
Servicios                  src/core/obd2/       modos 01/03/04/07/09/0A
                           src/core/kwp2000/    SID y NRC de ISO 14230
Protocolo                  src/core/elm327/     driver, parser, errores
Transporte                 src/core/transport/  Web Serial, BLE, simulador
Vehículo
```

Cada capa solo conoce la de abajo. El transporte mueve bytes y no sabe qué es
un ELM327; el driver habla ELM327 y no sabe qué es un PID; el motor de reglas
no sabe si los datos vinieron de un auto o del simulador. Por eso se puede
agregar J2534, WebUSB o un agente local sin tocar nada por encima.

**La comunicación no depende de React.** Toda la lógica vive en `src/core/` y
se prueba sin montar un DOM: los 88 tests corren en Node en ~2 segundos.

### Decisiones que vale la pena conocer

**Sin backend.** El acceso al hardware ocurre en el navegador, así que un
servidor no podría tocar el vehículo. El historial va a IndexedDB y la app
funciona sin conexión, que es lo que hace falta en un taller con mala señal.

**El sondeo se reprograma con `setTimeout`, no con `setInterval`.** Un
ELM327 sobre K-Line hace 8-12 solicitudes por segundo; con intervalo fijo se
encolarían solicitudes sobre un adaptador ocupado. Los parámetros rápidos se
piden en cada vuelta y los lentos rotan. Un PID que falla tres veces se
descarta para no arruinar la frecuencia de refresco del resto.

**Gráficos con uPlot sobre canvas.** Con SVG y re-render de React por punto,
la interfaz se arrastra justo cuando más importa, que es mirando una
aceleración.

**Un PID puede entregar varios parámetros.** Los PID diésel ampliados (0x70,
0x7A, 0x7C) traen un byte de máscara y después varios campos. Modelarlos como
"un PID, un valor" obliga a parchear la UI después.

---

## Estado actual

**Implementado y probado**

- Transporte: Web Serial, Web Bluetooth BLE, simulador
- Driver ELM327: cola serializada, framing por prompt, timeouts,
  12 códigos de error distintos con consejo, detección de clones
- Detección de protocolo y descubrimiento de PID soportados
- OBD-II: modos 01, 03, 04, 07, 09, 0A
- 40 parámetros decodificados, agrupados en 10 sistemas
- Motor de reglas con 7 reglas y niveles de confianza
- 11 códigos de falla interpretados con causas, pruebas y qué los descartaría
- Interfaz: conexión, resumen, códigos, datos en vivo con gráficos
  comparativos, funciones, terminal de debug
- Historial en IndexedDB

- Capa KWP2000 (ISO 14230-3): sesiones, testerPresent periódico,
  respuestas negativas traducidas, lectura por identificador local
- **Lectura agrupada**: hasta seis PID en una sola solicitud sobre CAN,
  con detección de capacidad y camino de vuelta. Un ciclo de diez
  parámetros pasa de diez idas y vueltas a dos.
- **Reensamblado ISO-TP**: las respuestas largas con headers activos
  llegan partidas en varias tramas CAN con bytes de control. Sin
  tratarlo, el VIN y cualquier lectura agrupada salen corruptas.
- **Respuestas separadas por ECU**: con cabeceras activas cada línea dice
  quién la envió. Motor y transmisión pueden contestar la misma pregunta,
  y mezclarlas fabricaba datos. El armado sigue las reglas de python-OBD
  para CAN (ISO-TP) y para K-Line (cabecera, checksum, byte de orden).
- **Identificación de la computadora**: unidades que contestan en el bus,
  y de cada una nombre, calibración y CVN (modo 09); por UDS, número de
  repuesto, versiones de software y hardware y número de serie.
- **Decodificación del VIN**: fabricante, país y año modelo.
- **Modo 06**: resultados de los autodiagnósticos contra sus límites, para
  ver un componente que aprueba raspando antes de que haya código.
- **Prueba del adaptador**: qué comandos soporta el clon que está conectado.
- **Bitácora de conexión**: qué hizo la app, paso por paso y con tiempos.
- **Instalable y sin conexión** (PWA).
- **Monitores de emisiones** (PID 01) con veredicto de revisión técnica
- **Datos congelados** (modo 02): la foto de los sensores en el momento
  en que la ECU guardó el código
- Funciones de servicio con precondiciones verificadas contra datos reales,
  modo simulación y confirmación doble

**Modelado pero no implementado**

- Regeneración de DPF: declarada con sus condiciones, deliberadamente sin
  secuencia. Es la operación de mayor riesgo físico del catálogo y no se
  publica una secuencia sin verificar para algo que calienta el escape a
  más de 600 °C con el vehículo parado.
- Bloques de medición de VAG, datos congelados (modo 02), informe en PDF

### Funciones de servicio: cómo están protegidas

Toda rutina que escribe en la ECU pasa por una puerta en
`src/core/service/runner.ts`, no por una comprobación en la interfaz:

1. Una rutina sin secuencia implementada no corre nunca, ni en simulación.
2. Una rutina cuya secuencia **no está verificada** contra una ECU real solo
   corre en modo simulación.
3. Las precondiciones se evalúan contra datos medidos, no contra una lista
   para tildar a mano. En modo real, si una no se cumple, no se envía un
   solo byte.
4. En una rutina de riesgo físico, una precondición que **no se puede
   verificar** bloquea igual que una que no se cumple. No saber si el motor
   está detenido no es lo mismo que saber que lo está.
5. Si un paso falla, la secuencia se corta. Una secuencia a medias es peor
   que una no empezada.
6. Las escrituras exigen habilitar el modo avanzado y una confirmación que
   enumera los pasos que modifican la ECU, con sus bytes.

De las cuatro rutinas del catálogo, **solo el borrado de códigos está
verificado**, porque es la única cuya secuencia está en norma pública y es
idéntica en todo vehículo OBD-II. Las de VAG siguen la norma pero su
identificador de bloque es específico de la familia de ECU.

**El modo simulación es el camino para verificarlas.** Arma la secuencia
completa y muestra byte por byte lo que se enviaría, sin enviar nada. Con el
vehículo delante se contrasta contra la documentación, y recién ahí se marca
`verified: true`.

**Cobertura honesta de la base de conocimiento**

11 códigos de falla y 12 rangos de referencia. Hay miles de códigos genéricos
y decenas de miles específicos de fabricante. La base crece agregando
entradas con su procedencia declarada; agregar números plausibles pero no
verificados rompería la garantía central del proyecto.

La decodificación de los **monitores de emisiones** está contrastada contra
python-OBD, la implementación abierta de referencia. Falta confirmarla en un
vehículo real, y la interfaz sigue mostrando los cuatro bytes crudos.

Los **nombres de monitores del modo 06** fuera de las sondas lambda no están
contrastados contra una fuente primaria y van marcados. El aprobado o
reprobado no depende de ellos: es el valor contra los límites que informa la
propia ECU.

### Leer el mapa de la ECU

No está implementado, y con un ELM327 no es viable en general. Leer la
memoria flash usa servicios de fabricante (lectura de memoria por dirección
o carga de datos) detrás de un acceso de seguridad cuya clave es propia de
cada ECU, y el ELM327 limita el largo de los mensajes y la temporización.
Varias ECU modernas directamente no permiten leer la flash por el conector.
Lo que sí se lee por OBD es la identidad de la calibración: número de
repuesto, versión de software y CVN, que es lo que hace falta para
conseguir el archivo correcto y para detectar una reprogramación.

Las escalas de los PID ampliados (0x70, 0x78, 0x7A, 0x7C) están marcadas
`verified: false`: su layout varía entre fabricantes y no se pudo verificar
contra norma ni contra una ECU real. La UI las muestra marcadas como tales en
modo técnico.

### Cómo verificar contra un vehículo real

1. Conectar el adaptador y entrar a **Terminal**
2. Activar **Debug**: se registra cada TX/RX con su tiempo de ida y vuelta
3. Recorrer las pantallas y, si corresponde, simular la rutina de servicio
4. **Exportar sesión**: descarga un JSON con la traza completa, el VIN, la
   ECU, los PID soportados, los que todavía no se decodifican y los valores
   leídos

Ese archivo es lo que permite corregir una escala o confirmar una secuencia
sin tener el vehículo delante. La pantalla de conexión además muestra un
**veredicto del adaptador**: qué se puede hacer con el que está conectado y
dónde está el techo.
