param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Message,
  [ValidateSet('info', 'warning', 'urgent')][string]$Severity = 'info',
  [ValidateRange(3, 30)][int]$DurationSeconds = 8
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = [System.Windows.Forms.NotifyIcon]::new()
$icon.Visible = $true
$icon.Icon = switch ($Severity) {
  'urgent' { [System.Drawing.SystemIcons]::Error }
  'warning' { [System.Drawing.SystemIcons]::Warning }
  default { [System.Drawing.SystemIcons]::Information }
}
$icon.BalloonTipTitle = $Title
$icon.BalloonTipText = $Message
$icon.BalloonTipIcon = switch ($Severity) {
  'urgent' { [System.Windows.Forms.ToolTipIcon]::Error }
  'warning' { [System.Windows.Forms.ToolTipIcon]::Warning }
  default { [System.Windows.Forms.ToolTipIcon]::Info }
}

$icon.ShowBalloonTip($DurationSeconds * 1000)
Start-Sleep -Seconds $DurationSeconds
$icon.Visible = $false
$icon.Dispose()
