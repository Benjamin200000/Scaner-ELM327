# Agente local

Alcanza las interfaces que un navegador no puede tocar:

| Interfaz | Desde el navegador | Con el agente |
|---|---|---|
| ELM327 BLE | Sí | Sí |
| ELM327 Bluetooth Classic (SPP) | **No** | Sí |
| ELM327 USB | Solo Chrome/Edge escritorio | Sí, cualquier navegador |
| Cable K-Line / KKL 409.1 | **No** | Sí |
| J2534 | **No** | Sí |

Y resuelve iOS de costado: el agente corre en la notebook con el adaptador
enchufado, y el iPhone o el iPad abren la app apuntando a esa dirección.

## Levantarlo

Hace falta Node 20 o más nuevo.

```bash
cd agent
npm install
node scaner-agent.mjs
```

Al arrancar imprime la dirección y el token. Los dos se pegan en la pantalla
de Conexión de la app.

### Opciones

| Opción | Para qué |
|---|---|
| `--simular` | Ofrece un ELM327 simulado. Sirve para verificar que el enlace agente-app funciona **antes** de pelearse con el adaptador. |
| `--lan` | Escucha en toda la red local, para usar la app desde una tablet o un teléfono. |
| `--puerto <n>` | Otro puerto, si el 8777 está ocupado. |
| `--token` | Imprime el token y sale. |

## Bluetooth Classic en Windows: no hace falta nada especial

Este es el caso que motivó el agente, y resulta ser el más simple.

Un ELM327 Bluetooth Classic emparejado con Windows **aparece como un puerto
COM**. El agente lo abre como cualquier puerto serie, sin una línea de código
de Bluetooth.

Para encontrarlo: Configuración → Bluetooth y dispositivos → Más opciones de
Bluetooth → pestaña **COM**. Ahí figura el COM saliente del adaptador. El
agente lo va a listar marcado como `bluetooth-spp`.

Si pide PIN al emparejar, en estos adaptadores suele ser `1234` o `0000`.

## J2534

En Windows el agente descubre solo las bibliotecas instaladas: cada
instalador de fabricante se registra bajo `PassThruSupport.04.04` en el
registro. Aparecen en la lista de interfaces sin configurar nada.

Para apuntar a una en concreto:

```bash
node scaner-agent.mjs --j2534 "C:\Program Files (x86)\Autel\...\MaxiFlash.dll"
```

El agente traduce entre la API de mensajes de J2534 y el flujo de texto que
espera el driver del ELM327. Para la app es un adaptador más: el motor de
reglas, los códigos y el informe funcionan igual.

### Si la DLL es de 32 bits

Node de 64 bits no puede cargar una DLL de 32. El agente lo detecta y lo
dice con todas las letras en vez de fallar con un mensaje del sistema.
Soluciones: usar la variante de 64 bits si el fabricante la provee, o
instalar un Node de 32 bits para correr el agente.

### Qué está verificado y qué no

El enlace FFI (estructuras, punteros, traducción de errores) y el puente a
ELM327 están probados contra una biblioteca J2534 falsa compilada para los
tests, con una ECU mínima detrás. Lo que **no** está probado es contra un
equipo real: eso necesita el hardware. La primera vez que lo conectes,
activá el modo debug en Terminal y exportá la sesión.

## Baud rate

El agente usa 38400, que es el de fábrica del ELM327. Varios clones vienen a
9600 o a 115200. Si el adaptador no contesta, ese es el primer sospechoso.

Para el **cable K-Line / KKL 409.1** el puerto se abre igual, pero el baud
rate del enlace lo negocia el protocolo, no el puerto.

## Seguridad

El token se genera en el primer arranque y queda en
`~/.scaner-elm327/token` (`C:\Users\<vos>\.scaner-elm327\token` en Windows).
Sin token válido el agente no enumera ni abre nada.

Por defecto escucha solo en `127.0.0.1`, o sea únicamente en esa máquina. Con
`--lan` acepta conexiones de toda la red local y **el token pasa a ser lo
único que lo protege**. En la red de un taller compartido, eso importa.

El enlace es `ws://`, sin cifrar. En una red local propia es aceptable; sobre
una red que no controlás, no.

## Verificar que funciona, sin hardware

```bash
node scaner-agent.mjs --simular
```

En la app: Conexión → Agente local → pegar dirección y token → Buscar
interfaces → elegir "ELM327 simulado" → Conectar por el agente.

Si eso anda y el adaptador real no, el problema está en el adaptador, el baud
rate o el conector del vehículo, no en el enlace. Separar esas dos cosas
ahorra mucho tiempo.

El simulado del agente es mínimo a propósito: responde los comandos AT de
inicialización y unos pocos PID. El simulador completo, con escenarios de
DPF saturado y overboost, vive en la app y se elige en "Simulador".

## Protocolo

Está en [PROTOCOLO.md](PROTOCOLO.md). El agente mueve bytes y no sabe qué es
un ELM327, que es lo que permite agregar J2534 después sin tocar nada de lo
que está por encima.

El test de integración de la app (`src/core/transport/agent.test.ts`) levanta
este proceso de verdad y habla con él por WebSocket. El agente es JavaScript
plano sin build y la app es TypeScript, así que nada los ata en compilación:
ese test es lo que los mantiene sincronizados.
