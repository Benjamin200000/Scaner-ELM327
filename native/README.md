# Scaner ELM327 nativo para Windows

Aplicación C#/.NET 10 con Windows Forms. La interfaz utiliza controles de Windows: no abre un navegador, no usa WebView ni ejecuta JavaScript, Node, HTTP o WebSocket. Cada EXE incluye su runtime de .NET; no es un binario NativeAOT ni un envoltorio de la web.

## Descargar y usar

En GitHub → **Releases**, las etiquetas `native-v*` publican los ZIP después de pasar las pruebas Windows. Como alternativa: **Actions → Windows nativo x86 y x64**, abre una ejecución correcta y descarga el artefacto `ScanerELM327-nativo-x64` o `ScanerELM327-nativo-x86`. Extrae el ZIP y ejecuta el EXE. GitHub conserva estos artefactos durante 30 días; el código y el procedimiento de compilación quedan en Git. No se añaden binarios de más de 100 MB al historial de Git.

Consulta [LEEME.txt](LEEME.txt), [cobertura](docs/COBERTURA.md), [validación](docs/VALIDACION.md) y [fuentes investigadas](docs/FUENTES.md).

## Compilar

Requiere SDK .NET 10 y acceso a NuGet (referencias oficiales de Windows Desktop y System.IO.Ports).

```powershell
# En la raíz del checkout existente. No requiere worktrees.
dotnet run --project native/Scaner.Core.Tests -c Release
./native/build.ps1                     # win-x86 y win-x64, self-contained
```

En Linux se pueden compilar ambos PE para Windows con `EnableWindowsTargeting`; para iniciar la interfaz y probar las DLL de Windows se usa el workflow en Windows. El script PowerShell funciona también con PowerShell 7 en Linux, salvo las pruebas de ejecución Windows.

```bash
dotnet publish native/Scaner.Windows -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:DebugType=None -o release/native/x64
# Repetir con win-x86 para la DLL Autel de 32 bits.
```

La app genera historial únicamente al elegir Guardar sesión. La configuración del adaptador no se toma del país o nombre del vehículo. La lectura manual y los mapas siempre requieren la identificación exacta de la ECU y su software.

## Estructura

- `Scaner.Core`: protocolo, reensamblado, OBD, UDS, simulador, mapas, reglas y datos embebidos.
- `Scaner.Windows`: controles nativos, serial/ELM/KKL y carga directa de DLL J2534.
- `Scaner.Core.Tests`: pruebas ejecutables sin hardware ni interfaz Windows, con código de salida no cero ante fallas.
- `tests/fake_j2534.c`: biblioteca de prueba de ABI x86/x64; solo CI, nunca se distribuye como driver real.

Los datos existentes de DTC, rangos, fallas VAG, grupos y definiciones se incorporaron como JSON embebido. Para regenerarlo tras cambiar las fuentes TypeScript:

```bash
npm ci
node scripts/export-native-knowledge.mjs
```

El JSON resultante está versionado: compilar la app nativa no requiere npm.
