$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvRoot = Join-Path $root ".venv"
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$venvScripts = Join-Path $root ".venv\Scripts"
$srcPath = Join-Path $root "src"

if (-not (Test-Path $venvPython)) {
    $bootstrapPython = Get-Command py -ErrorAction SilentlyContinue
    if ($bootstrapPython) {
        & $bootstrapPython.Source -3.11 -m venv $venvRoot
    }
    else {
        $bootstrapPython = Get-Command python -ErrorAction SilentlyContinue
        if (-not $bootstrapPython) {
            throw "Python was not found on PATH, so .venv could not be created automatically."
        }
        & $bootstrapPython.Source -m venv $venvRoot
    }

    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -e $root
}

$env:VIRTUAL_ENV = $venvRoot
$env:PATH = "$venvScripts;$env:PATH"
$env:PYTHONPATH = $srcPath

Push-Location $root
try {
    & $venvPython -m voice_clone_web @args
}
finally {
    Pop-Location
}
