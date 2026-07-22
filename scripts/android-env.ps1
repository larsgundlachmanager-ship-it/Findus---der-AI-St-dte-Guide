# Gemeinsame Android-Build-Umgebung für Findus (JAVA_HOME, SDK, kurze Pfade).
# Wird von run-android.ps1 und open-android-dev.ps1 dot-sourced.

function Set-FindusAndroidEnv {
    param(
        [string]$JavaHome,
        [string]$AndroidHome,
        [string]$GradleUserHome,
        [string]$TempDir = 'C:\Temp'
    )

    if (-not $JavaHome) {
        $candidates = @(
            $env:JAVA_HOME,
            'C:\Program Files\Android\Android Studio\jbr',
            'C:\Program Files\Java\jdk-21',
            'C:\Program Files\Eclipse Adoptium\jdk-21*'
        ) | Where-Object { $_ }

        foreach ($candidate in $candidates) {
            if (Test-Path "$candidate\bin\java.exe") {
                $JavaHome = $candidate
                break
            }

            if ($candidate.Contains('*')) {
                $resolved = Get-ChildItem -Path $candidate -Directory -ErrorAction SilentlyContinue |
                    Sort-Object FullName -Descending |
                    Where-Object { Test-Path "$($_.FullName)\bin\java.exe" } |
                    Select-Object -First 1 -ExpandProperty FullName
                if ($resolved) {
                    $JavaHome = $resolved
                    break
                }
            }
        }
    }

    if (-not $JavaHome -or -not (Test-Path "$JavaHome\bin\java.exe")) {
        throw @"
JAVA_HOME nicht gefunden.
Installiere Android Studio oder setze JAVA_HOME manuell, z. B.:
  `$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
"@
    }

    if (-not $AndroidHome) {
        $AndroidHome = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
    }

    if (-not (Test-Path $AndroidHome)) {
        throw "Android SDK nicht gefunden: $AndroidHome"
    }

    if (-not $GradleUserHome) {
        $GradleUserHome = "$env:USERPROFILE\.gradle"
    }

    New-Item -ItemType Directory -Force -Path $TempDir, $GradleUserHome | Out-Null

    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $AndroidHome
    $env:GRADLE_USER_HOME = $GradleUserHome
    $env:TEMP = $TempDir
    $env:TMP = $TempDir

    $pathParts = @(
        "$JavaHome\bin",
        "$AndroidHome\platform-tools",
        "$AndroidHome\emulator",
        $env:PATH
    )
    $env:PATH = ($pathParts -join ';')

    Write-Host "JAVA_HOME=$JavaHome"
    Write-Host "ANDROID_HOME=$AndroidHome"
    Write-Host "GRADLE_USER_HOME=$GradleUserHome"
}

function Get-FindusMetroPort {
    param([int[]]$Candidates = @(8081, 8082, 8083, 8084, 8085, 8086, 8087))

    $listening = @()
    foreach ($port in $Candidates) {
        $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($inUse) {
            $listening += $port
        }
    }

    if ($listening.Count -gt 0) {
        return ($listening | Measure-Object -Maximum).Maximum
    }

    return 8081
}
