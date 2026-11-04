param([switch]$Rotate, [switch]$NoClipboard)
$ErrorActionPreference = 'Stop'
$secretDirectory = Join-Path $env:LOCALAPPDATA 'SupportedHousingTour'
$credentialPath = Join-Path $secretDirectory 'pilot-staff.dpapi'
if ($Rotate) {
    $credential = (node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))").Trim()
    if ($credential -notmatch '^[a-f0-9]{64}$') { throw 'Could not generate a staff credential.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($credential)) | ForEach-Object { $_.ToString('x2') })
    New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
    $pendingPath = "$credentialPath.pending"
    ConvertTo-SecureString $credential -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $pendingPath
    $hash | npx --yes wrangler@4.157.0 secret put STAFF_RANDOM_HASH --config (Join-Path $PSScriptRoot 'wrangler.pilot.json')
    if ($LASTEXITCODE) { throw 'Wrangler could not configure the staff credential.' }
    Move-Item -LiteralPath $pendingPath -Destination $credentialPath -Force
}
if (!(Test-Path -LiteralPath $credentialPath)) { throw 'Run with -Rotate to enroll a staff credential using authorized Wrangler.' }
if ($NoClipboard) { return }
$saved = Get-Content -LiteralPath $credentialPath | ConvertTo-SecureString
Set-Clipboard -Value ([System.Net.NetworkCredential]::new('', $saved).Password)
Write-Output 'Staff passphrase copied. Paste it into the pilot sign-in page or your password manager.'
