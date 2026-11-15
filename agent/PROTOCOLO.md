# Protocolo del agente

WebSocket, mensajes JSON, un objeto por frame. El campo `t` es el tipo.

El agente mueve **bytes**, no comandos: no sabe qué es un ELM327. Esa es la
misma separación que tiene la app, y es lo que permite agregar J2534 después
sin tocar nada de lo de arriba.

## Cliente → agente

| Mensaje | Campos | Qué hace |
|---|---|---|
| `hello` | `token`, `client` | Autentica. Obligatorio antes que nada. |
| `list` | — | Enumera las interfaces disponibles. |
| `open` | `id`, `options?` | Abre una interfaz. `options.baudRate` para serie. |
| `write` | `data` (base64) | Escribe bytes en la interfaz abierta. |
| `close` | — | Cierra la interfaz, deja la sesión abierta. |
| `ping` | — | Mantiene viva la conexión. |

## Agente → cliente

| Mensaje | Campos | Qué significa |
|---|---|---|
| `hello-ok` | `agent`, `features` | Autenticado. |
| `interfaces` | `items[]` | Lista de interfaces: `{id, kind, label, detail}`. |
| `opened` | `info` | Interfaz abierta: `{kind, name, link}`. |
| `data` | `data` (base64) | Bytes recibidos de la interfaz. |
| `closed` | `reason?` | La interfaz se cerró. Con `reason` si no fue pedido. |
| `error` | `code`, `message`, `detail?` | Falla. Los códigos son estables. |
| `pong` | — | Respuesta a `ping`. |

## Códigos de error

`no-autenticado`, `token-invalido`, `mensaje-invalido`, `interfaz-desconocida`,
`ya-abierta`, `no-abierta`, `fallo-al-abrir`, `fallo-al-escribir`,
`enlace-caido`, `ocupado`.

## Autenticación

El agente genera un token en el primer arranque y lo guarda en
`~/.scaner-elm327/token`. Lo imprime al iniciar. Se copia a la app.

Sin token válido el agente **no enumera ni abre nada**. Importa porque con
`--lan` el agente queda accesible desde la red local, que es como una tablet
puede usar el adaptador conectado a la notebook.

## Sobre Bluetooth Classic en Windows

No hace falta código de Bluetooth. Un ELM327 Bluetooth Classic emparejado con
Windows aparece como un **puerto COM** (Configuración → Bluetooth → Más
opciones de Bluetooth → pestaña COM). El agente lo abre como cualquier puerto
serie. Eso resuelve justamente los adaptadores que el navegador no puede
alcanzar.
