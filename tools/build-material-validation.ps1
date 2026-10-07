param([Parameter(Mandatory=$true)][string]$Build)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Path $Build -Force | Out-Null
$lines=& cmd.exe /c '"C:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul && set'
foreach($line in $lines){if($line -match '^([^=]+)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')}}
$compiler=Join-Path $env:VCToolsInstallDir 'bin/Hostx64/x64/cl.exe'
& $compiler /nologo /std:c++17 /EHsc /O2 /openmp /DNOMINMAX /DWIN32_LEAN_AND_MEAN "/I$root/include" "$root/src/main.cpp" "/Fo$Build/cpu.obj" "/Fe$Build/cybr-light-cpu.exe"
if($LASTEXITCODE -ne 0){throw 'CPU material reference build failed'}
& $compiler /nologo /std:c++17 /EHsc /O2 /DNOMINMAX /DWIN32_LEAN_AND_MEAN "/I$root/include" "$root/tests/numerical.cpp" "/Fo$Build/numerical.obj" "/Fe$Build/numerical.exe"
if($LASTEXITCODE -ne 0){throw 'Numerical test build failed'}
& "$Build/numerical.exe"
if($LASTEXITCODE -ne 0){throw 'Numerical tests failed'}
