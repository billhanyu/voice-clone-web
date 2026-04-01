$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$srcPath = Join-Path $root "src"

if (-not (Test-Path $venvPython)) {
    throw "Virtual environment not found at .venv. Run 'python -m venv .venv' and install dependencies first."
}

$env:PYTHONPATH = $srcPath

Push-Location $root
try {
    & $venvPython -m voice_clone_web @args
}
finally {
    Pop-Location
}
