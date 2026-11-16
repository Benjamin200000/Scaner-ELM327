param([ValidateSet('x86','x64','all')][string]$Architecture='all')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $architectures=if ($Architecture -eq 'all') { @('x86','x64') } else { @($Architecture) }
    foreach ($arch in $architectures) {
        $out=Join-Path $root "release/native/$arch"
        dotnet publish native/Scaner.Windows/Scaner.Windows.csproj -c Release -r "win-$arch" --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -o $out
        if ($LASTEXITCODE -ne 0) { throw "Publicación $arch falló" }
        Move-Item "$out/ScanerELM327.exe" "$out/ScanerELM327-$arch.exe" -Force
        Copy-Item native/LEEME.txt,native/THIRD_PARTY_NOTICES.md $out
        Copy-Item native/licenses $out -Recurse -Force
        Get-FileHash "$out/ScanerELM327-$arch.exe" -Algorithm SHA256 | ForEach-Object { "$($_.Hash)  ScanerELM327-$arch.exe" } | Set-Content "$out/SHA256.txt"
        Compress-Archive -Path "$out/*" -DestinationPath "$root/release/ScanerELM327-nativo-$arch.zip" -Force
    }
} finally { Pop-Location }
