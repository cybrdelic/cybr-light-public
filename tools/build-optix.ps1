param([string]$Build='D:/CYBR-build/exploded-instrument/native-optix',[switch]$MixedMath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$cuda='C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.9'
$optix='C:/ProgramData/NVIDIA Corporation/OptiX SDK 9.1.0'
$toolchain='C:/VSBuildTools/VC/Auxiliary/Build/vcvars64.bat'
foreach($required in @("$cuda/bin/nvcc.exe","$optix/include/optix.h",$toolchain)){if(!(Test-Path -LiteralPath $required)){throw "Missing dependency: $required"}}
New-Item -ItemType Directory -Path $Build -Force | Out-Null
# Import the installed compiler environment in this process only.
$environmentLines = & cmd.exe /c "`"$toolchain`" >nul && set"
foreach($line in $environmentLines){if($line -match '^([^=]+)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')}}
$deviceFlags=@()
$compilerDir=Join-Path $env:VCToolsInstallDir 'bin/Hostx64/x64'
if(!(Test-Path -LiteralPath "$compilerDir/cl.exe")){throw 'MSVC x64 compiler directory was not initialized'}
if($MixedMath){$deviceFlags+='-DCYBR_OPTIX_MIXED_MATH=1'}
& "$cuda/bin/nvcc.exe" --compiler-bindir $compilerDir --ptx -std=c++17 -arch=compute_89 @deviceFlags "-I$optix/include" "$root/src/optix/device.cu" -o "$Build/device.ptx"
if($LASTEXITCODE -ne 0){throw 'GPU device compilation failed'}
& "$compilerDir/cl.exe" /nologo /std:c++17 /EHsc /O2 /DNOMINMAX /DWIN32_LEAN_AND_MEAN "/I$cuda/include" "/I$optix/include" "/I$root/include" "$root/src/optix/main.cpp" "/Fo$Build/main.obj" "/Fe$Build/cybr-light-optix.exe" /link "/LIBPATH:$cuda/lib/x64" cudart.lib cuda.lib advapi32.lib
if($LASTEXITCODE -ne 0){throw 'GPU host compilation failed'}
Get-Item "$Build/cybr-light-optix.exe","$Build/device.ptx" | Select-Object Name,Length
