# One-step publish. In PowerShell, from this folder run:   .\push-to-github.ps1
# (If scripts are blocked:  Set-ExecutionPolicy -Scope Process Bypass  and run it again.)
$default = "https://github.com/MuthamAnirudh/AI-POWERED-CAMPUS-A-Z-PLACEMENT-AND-TRAINING-PORTAL-.git"
$url = Read-Host "GitHub repo URL [Enter = $default]"
if ([string]::IsNullOrWhiteSpace($url)) { $url = $default }
if (-not (Test-Path .git)) { git init | Out-Null }
git add -A
git commit -m "Campus placement portal - final" 2>$null
git branch -M main
if (git remote 2>$null | Select-String -SimpleMatch "origin") { git remote set-url origin $url } else { git remote add origin $url }
git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nPush was rejected (the GitHub repo already has other history)." -ForegroundColor Yellow
  $a = Read-Host "Replace what is on GitHub with this folder? Type YES to confirm"
  if ($a -eq "YES") { git push -u origin main --force }
}
