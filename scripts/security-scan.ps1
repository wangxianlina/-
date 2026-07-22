$ErrorActionPreference = 'Stop'

$patterns = @(
  'cli_[a-zA-Z0-9]{10,}',
  'gh[opusr]_[a-zA-Z0-9]{20,}',
  'sk-[a-zA-Z0-9_-]{20,}',
  'oc_[a-zA-Z0-9]{20,}',
  '(?i)appSecret\s*[=:]\s*["''][^<>"'']{8,}',
  '(?i)api[_-]?key\s*[=:]\s*["''][^<>"'']{8,}'
)

$excluded = @('.git', 'node_modules', 'dist', '.venv', '__pycache__')
$files = Get-ChildItem -LiteralPath (Split-Path -Parent $PSScriptRoot) -Recurse -File |
  Where-Object {
    $path = $_.FullName
    -not ($excluded | Where-Object { $path -match "[\\/]$([regex]::Escape($_))[\\/]" })
  }

$findings = @()
foreach ($file in $files) {
  $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
  foreach ($pattern in $patterns) {
    if ($text -match $pattern) {
      $findings += "$($file.FullName): matched $pattern"
    }
  }
}

if ($findings.Count -gt 0) {
  Write-Error ("Potential secrets found:`n" + ($findings -join "`n"))
}

Write-Host "Secret scan passed: $($files.Count) files checked."
