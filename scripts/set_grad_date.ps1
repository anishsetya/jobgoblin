# One-off: change the education end date in tailored resumes (degree conferred Nov 2026) and re-render.
# Usage: scripts/set_grad_date.ps1 [-Folders a,b,c]   (default: every tailored folder)
param([string[]]$Folders)
$root = Split-Path -Parent $PSScriptRoot
if (-not $Folders) { $Folders = Get-ChildItem "$root\applications" -Directory | Where-Object { Test-Path "$($_.FullName)\resume.yaml" } | ForEach-Object { $_.Name } }
foreach ($f in $Folders) {
    $y = "$root\applications\$f\resume.yaml"
    $t = [IO.File]::ReadAllText($y)
    if ($t -match 'end_date: 2026-05') {
        [IO.File]::WriteAllText($y, ($t -replace 'end_date: 2026-05', 'end_date: 2026-11'), (New-Object Text.UTF8Encoding $false))
    }
    $out = & "$root\scripts\render.ps1" $y -OutDir "$root\applications\$f\out" 2>&1 | Out-String
    $ok = ($out -match 'pages: 1') -and ($out -match '\bOK\b')
    "{0,-4} {1}" -f ($(if ($ok) { 'OK' } else { 'FAIL' })), $f
}
