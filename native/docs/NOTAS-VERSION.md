Aplicación nativa C#/.NET para Windows, con controles Windows Forms y dos EXE self-contained: x86 y x64. No requiere navegador, Node ni instalar .NET.

Incluye diagnóstico OBD, datos en vivo, DTC y congelados, identidad de ECU, monitores/mode 06, transporte serial ELM327, KW1281 con cable KKL y carga directa de drivers J2534 ISO15765. Añade lectura UDS por dirección o por subida de bloques, edición offline de BIN/XDF, comparación, SHA-256, informes e historial local.

Usa el EXE que coincida con la arquitectura de la DLL Autel. El driver oficial del fabricante no se incluye. No se declara soporte universal para todos los protocolos del driver ni para todos los vehículos del mercado chileno. La temporización KKL y los adaptadores reales aún requieren verificación física. El perfil de lectura del Golf requiere confirmar año, motor y referencia exacta de ECU.

Los mapas exportados se marcan no validados; no se corrigen checksums ni se escribe flash. Consulta `native/docs/COBERTURA.md` para funciones y límites. Los ejecutables no están firmados con certificado de editor.

La publicación de estos ZIP exige que terminen correctamente las pruebas de núcleo y de ejecución Windows en ambas arquitecturas, incluida una DLL J2534 simulada. Eso no sustituye la prueba con hardware real.
