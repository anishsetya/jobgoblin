# Runs audit specs and prints a short summary. Full output goes to AUDIT_DIR\runs\<name>-run<N>.txt.
#   powershell -File e2e\audit\run.ps1 -Spec j1 -Run 1            (reuses builds; add -Build to rebuild first)
#   powershell -File e2e\audit\run.ps1 -Spec "h" -Run 2 -Grep "H2"
param(
  [string]$Spec = "",
  [string]$Run = "1",
  [string]$Grep = "",
  [string]$Project = "chromium",
  [switch]$Build
)
$audit = if ($env:AUDIT_DIR) { $env:AUDIT_DIR } else { "<home>\AppData\Local\Temp\claude\<project>\859c954c-890e-44a8-9a2c-82528f47ac4a\scratchpad\audit" }
New-Item -ItemType Directory -Force "$audit\runs" | Out-Null
Set-Location (Join-Path $PSScriptRoot "..\..")
$env:AUDIT_RUN = $Run
if (-not $Build) { $env:E2E_SKIP_BUILD = "1" }
$name = if ($Spec -eq "") { "all" } else { $Spec }
$out = "$audit\runs\$name-run$Run.txt"
$args2 = "--filter @jobgoblin/e2e exec playwright test --config audit/playwright.audit.config.ts --project=$Project"
if ($Spec -ne "") { $args2 += " $Spec" }
if ($Grep -ne "") { $args2 += " -g `"$Grep`"" }
cmd /c "pnpm $args2 > $out 2>&1"
$code = $LASTEXITCODE
$text = Get-Content $out -Encoding UTF8
$text | Select-String -Pattern '^\s+(ok|x|-)\s+\d+|passed|failed|skipped|flaky' | ForEach-Object { $_.Line }
"exit $code; full output: $out"
