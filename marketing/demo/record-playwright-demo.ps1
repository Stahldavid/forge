$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$session = "forgeos-demo"
$port = 4897
$url = "http://127.0.0.1:$port/marketing/demo/playwright-demo.html"
$assets = Join-Path $PSScriptRoot "assets"
$webm = Join-Path $assets "forgeos-demo-playwright.webm"
$mp4 = Join-Path $assets "forgeos-demo-playwright.mp4"
$gif = Join-Path $assets "forgeos-demo-playwright.gif"
$palette = Join-Path $assets "forgeos-demo-playwright-palette.png"

New-Item -ItemType Directory -Force -Path $assets | Out-Null

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  throw "python is required to serve the demo page locally."
}

$playwright = Get-Command playwright-cli -ErrorAction SilentlyContinue
if (-not $playwright) {
  throw "playwright-cli is required. Install it with: npm install -g @playwright/cli@latest"
}

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  throw "ffmpeg is required to convert WebM into MP4 and GIF."
}

$server = Start-Process -FilePath $python.Source `
  -ArgumentList @("-m", "http.server", "$port", "--bind", "127.0.0.1") `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -PassThru

try {
  Start-Sleep -Seconds 2

  playwright-cli "-s=$session" open $url
  playwright-cli "-s=$session" resize 1280 720
  playwright-cli "-s=$session" video-start $webm --size 1280x720
  playwright-cli "-s=$session" run-code "async page => { await page.evaluate(() => window.dispatchEvent(new Event('forge-demo-start'))); await page.waitForFunction(() => window.__forgeDemoDone === true, null, { timeout: 90000 }); await page.waitForTimeout(800); }"
  playwright-cli "-s=$session" video-stop

  ffmpeg -y -i $webm -vf "fps=25,scale=1280:-2:flags=lanczos" -pix_fmt yuv420p -movflags +faststart $mp4
  ffmpeg -y -i $webm -vf "fps=8,scale=800:-1:flags=lanczos,palettegen=max_colors=80" -frames:v 1 -update 1 $palette
  ffmpeg -y -i $webm -i $palette -lavfi "fps=8,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" $gif
}
finally {
  playwright-cli "-s=$session" close 2>$null
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
  }
  if (Test-Path $palette) {
    Remove-Item $palette
  }
}
