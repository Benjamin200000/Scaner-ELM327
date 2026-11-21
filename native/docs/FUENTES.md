# Investigación técnica y procedencia

Repositorios consultados por Git y lectura de documentación, 16 de noviembre de 2026. Se utilizan como referencias de protocolo, no como catálogo de compatibilidad universal. No se descargan ROM comerciales ni se incorporan binarios de terceros.

| Fuente | Revisión inspeccionada | Uso y límite |
|---|---|---|
| [gmenounos/kw1281test](https://github.com/gmenounos/kw1281test) | `6b3567f68db5aa8ce205d43694ad5decf3db787d` | `KwpCommon.cs` y `KW1281Dialog.cs`: eco, inicialización, contadores y protocolo KW1281. Compatibilidad de cables COM/VCP; no equivale a soportar interfaces HEX modernas |
| [rnd-ash/OpenVehicleDiag](https://github.com/rnd-ash/OpenVehicleDiag) | `0d9a6bdf88e219a6b9375b45a638cc5acc2fbcf3` | Arquitectura J2534/diagnóstico y esquema de ECU. No se copió su motor ni se convirtieron sus descripciones en compatibilidad confirmada |
| [bri3d/VW_Flash](https://github.com/bri3d/VW_Flash) | `293f46d782bae2ced930497889b71eb782f122cb` | README y límites de familias Simos/DSG; evidencia de que los procedimientos de remapeo son específicos de ECU. No se aplican sus procedimientos a ME3.7 |
| [NefMoto/NefMotoOpenSource](https://github.com/NefMoto/NefMotoOpenSource) | HEAD localizado: `5a130354d59b5aec87d7946fcd17697adde1a76b` | Referencia para investigar ME7 y KWP2000; no se portó ni se verificó su soporte para el vehículo del usuario |

La aplicación conserva la procedencia de la base de conocimiento original al exportarla como JSON. Las escalas ampliadas diésel y las direcciones ME7.5 siguen sujetas a los mismos límites documentados en el proyecto. Las fórmulas KW1281 que derivan de la referencia MIT conservan su atribución en THIRD_PARTY_NOTICES.md.

No se considera suficiente encontrar el nombre de una ECU en GitHub para habilitar escritura de flash, fabricar una llave de seguridad o declarar correcto un checksum.
