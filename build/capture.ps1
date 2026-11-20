<#
    Records the suggested questions offline, with the real model.

    Run it from the repo root:

        .\build\capture.ps1

    It sets up an isolated Python environment the first time, records every
    question in $Questions, and rebuilds the page. Nothing it installs leaves
    the .venv folder next to this repo, and .gitignore already excludes it.

    Why this has to happen on your machine: the model's weights come from
    huggingface.co, which is blocked from both the cloud sandbox and the
    Linux VM the assistant can reach. This Windows shell is not.
#>

$ErrorActionPreference = "Stop"

$Questions = @(
    "What happens when you heat water?",
    "Why is the sky blue?",
    "What is a prime number?",
    "How does a fridge keep things cold?",
    "What makes bread rise?"
)

# run from the repo root whichever folder this was invoked from
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
Write-Host "repo: $repo" -ForegroundColor DarkGray

# --- python ---------------------------------------------------------------
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw "Python is not on PATH. Install it from python.org (3.9 or newer) and reopen PowerShell." }
$ver = (& python --version) 2>&1
Write-Host "using $ver" -ForegroundColor DarkGray

# --- isolated environment, created once -----------------------------------
$venv = Join-Path $repo ".venv"
$vpy  = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $vpy)) {
    Write-Host "`ncreating .venv ..." -ForegroundColor Cyan
    & python -m venv $venv
    if (-not (Test-Path $vpy)) { throw "could not create the virtual environment at $venv" }
}

# --- dependencies, installed once -----------------------------------------
# The CPU build is about 250MB. Plain `pip install torch` fetches the CUDA
# one, which is roughly ten times that and buys nothing for a 360M model.
& $vpy -c "import torch, transformers" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "`ninstalling torch (CPU build, ~250MB) and transformers ..." -ForegroundColor Cyan
    & $vpy -m pip install --quiet --upgrade pip
    & $vpy -m pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu
    & $vpy -m pip install --quiet transformers
    & $vpy -c "import torch, transformers"
    if ($LASTEXITCODE -ne 0) { throw "torch or transformers would not import after installing" }
}
Write-Host "dependencies ready" -ForegroundColor DarkGray

# --- record ---------------------------------------------------------------
# The first run also downloads ~1.5GB of weights into your HuggingFace cache.
Write-Host "`nrecording $($Questions.Count) questions ..." -ForegroundColor Cyan
& $vpy "build/capture-seeds.py" "--replace" @Questions
if ($LASTEXITCODE -ne 0) { throw "capture-seeds.py failed, see the output above" }

# --- rebuild --------------------------------------------------------------
Write-Host "`nrebuilding the page ..." -ForegroundColor Cyan
& $vpy "build/build-into-the-network.py"
if ($LASTEXITCODE -ne 0) { throw "the build failed, see the output above" }

Write-Host "`nDone." -ForegroundColor Green
Write-Host "Changed:  build/into-the-network/seeds.js  and  into-the-network/index.html"
Write-Host "Next:     git add -A; git commit -m 'recapture seeds'; git push"
