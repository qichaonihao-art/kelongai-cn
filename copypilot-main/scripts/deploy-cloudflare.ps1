$ErrorActionPreference = "Stop"

$secretFile = Join-Path $env:USERPROFILE ".copypilot\cloudflare.env"
if (-not (Test-Path -LiteralPath $secretFile)) {
  throw "Missing local Cloudflare credential file: $secretFile"
}

Get-Content -LiteralPath $secretFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) {
    return
  }

  $parts = $line.Split("=", 2)
  if ($parts.Count -eq 2) {
    [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
  }
}

if (-not $env:CLOUDFLARE_API_TOKEN) {
  throw "CLOUDFLARE_API_TOKEN is not set in $secretFile"
}

if (-not $env:CLOUDFLARE_PAGES_PROJECT) {
  $env:CLOUDFLARE_PAGES_PROJECT = "copypilot"
}

npm run build
npx wrangler pages deploy dist --project-name $env:CLOUDFLARE_PAGES_PROJECT --branch main
