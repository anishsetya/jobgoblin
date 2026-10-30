# Render a RenderCV YAML to PDF with the shared design, then run guardrail checks.
# Usage: scripts/render.ps1 <resume.yaml> [-OutDir <dir>] [-Keywords "kafka,go,rag"] [-Png]
param(
    [Parameter(Mandatory = $true)][string]$Yaml,
    [string]$OutDir,
    [string]$Keywords = "",
    [switch]$Png
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv\Scripts"
$Yaml = (Resolve-Path $Yaml).Path
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $Yaml) "out" }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$pdf = Join-Path $OutDir "Resume.pdf"

$rcvArgs = @(
    "render", $Yaml,
    "--design", (Join-Path $root "resume\design.yaml"),
    "--pdf-path", $pdf,
    "--typst-path", (Join-Path $OutDir "resume.typ"),
    "--dont-generate-html", "--dont-generate-markdown", "--quiet"
)
if ($Png) { $rcvArgs += @("--png-path", (Join-Path $OutDir "preview.png")) } else { $rcvArgs += "--dont-generate-png" }
& "$venv\rendercv.exe" @rcvArgs
if ($LASTEXITCODE -ne 0) { throw "rendercv failed" }
Write-Output "pdf: $pdf"

& "$venv\python.exe" (Join-Path $PSScriptRoot "check_resume.py") $pdf "--keywords=$Keywords"
exit $LASTEXITCODE
