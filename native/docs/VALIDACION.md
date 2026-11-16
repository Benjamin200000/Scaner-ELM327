# Evidencia de validación

La compilación y las pruebas de núcleo se ejecutan en la máquina Linux de desarrollo. La interfaz WinForms y el driver Autel necesitan Windows; no se presenta una compilación cruzada como prueba de funcionamiento físico.

## Comandos reproducibles

```bash
dotnet run --project native/Scaner.Core.Tests -c Release
dotnet build native/Scaner.Windows/Scaner.Windows.csproj -c Release
```

Las pruebas del núcleo cubren ELM/ISO-TP por ECU, checksum K-Line, formatos de DTC, monitores, simulador, identificación, lectura UDS completa/parcial/cancelada, orden de bytes, edición y comparación de BIN y rechazo de fórmulas XDF no soportadas. El ejecutable de pruebas informa el número de aprobadas/fallidas y devuelve error si falla alguna.

## Windows y hardware

El workflow `.github/workflows/native-windows.yml` está preparado para ejecutar en Windows cada EXE publicado, construir una DLL falsa de su misma arquitectura y comprobar:

- Creación de controles y pantallas, lectura en vivo, DTC, VIN, emisiones y memoria por el simulador nativo.
- Carga de DLL x86/x64, paso de estructuras J2534 de 4152 bytes, filtro de flujo, envío/recepción, exclusión de indicaciones TX y respuestas pendientes UDS.
- Lectura de RPM y DTC y memoria byte a byte por la ABI de la DLL falsa.
- Resultado JSON, captura de pantalla y ZIP descargable por arquitectura.

Un workflow escrito o enviado a GitHub **no demuestra que haya terminado correctamente**. Se deben consultar sus resultados de ejecución. Una DLL simulada tampoco valida la temporización de KKL ni el comportamiento del driver Autel. Quedan pendientes pruebas con adaptadores reales y la identificación exacta del Golf. Los ejecutables no están firmados.

## Evidencia local de esta revisión

Se ejecutaron 57 pruebas del núcleo: 57 aprobadas, 0 fallidas. La compilación Release pasó sin errores ni advertencias. Se publicaron ambos EXE self-contained desde Linux y se comprobaron sus formatos PE x86/x64. Esto no constituye una ejecución de Windows ni una prueba del hardware real.
