@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  Base de Prix - Publication de release sur GitHub
REM  Double-cliquer sur ce fichier pour publier la version
REM  configurée dans package.json
REM ============================================================

echo.
echo ============================================================
echo   PUBLICATION BASE DE PRIX
echo ============================================================
echo.

REM 1. Vérifier que GH_TOKEN est défini
if "%GH_TOKEN%"=="" (
    echo [ERREUR] La variable d'environnement GH_TOKEN n'est pas definie.
    echo.
    echo Configure-la avec cette commande PowerShell :
    echo   [Environment]::SetEnvironmentVariable^("GH_TOKEN", "ghp_TON_TOKEN", "User"^)
    echo.
    echo Puis ferme et rouvre ce terminal.
    echo.
    pause
    exit /b 1
)
echo [OK] Token GitHub detecte.

REM 2. Vérifier la présence de package.json
if not exist "package.json" (
    echo [ERREUR] package.json introuvable. Place ce script dans le dossier du projet.
    pause
    exit /b 1
)

REM 3. Lire la version
for /f "tokens=2 delims=:," %%a in ('findstr /C:"\"version\"" package.json') do (
    set VERSION=%%a
)
set VERSION=%VERSION:"=%
set VERSION=%VERSION: =%
echo [OK] Version a publier : %VERSION%

REM 4. Demander confirmation
echo.
set /p CONFIRM="Confirmer la publication de la version %VERSION% sur GitHub ? (O/N) : "
if /I not "%CONFIRM%"=="O" (
    echo Publication annulee.
    pause
    exit /b 0
)

REM 5. Installer les deps si node_modules manque
if not exist "node_modules" (
    echo.
    echo [INFO] Installation des dependances npm...
    call npm install
    if errorlevel 1 (
        echo [ERREUR] npm install a echoue.
        pause
        exit /b 1
    )
)

REM 6. Build + publish
echo.
echo [INFO] Lancement du build et de la publication...
echo Cela peut prendre 3 a 5 minutes.
echo.
call npm run publish
if errorlevel 1 (
    echo.
    echo [ERREUR] La publication a echoue. Verifie les logs ci-dessus.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   PUBLICATION TERMINEE
echo ============================================================
echo.
echo Etapes restantes :
echo   1. Va sur https://github.com/DustProgram/base-de-prix/releases
echo   2. Trouve la release "v%VERSION%" en mode DRAFT
echo   3. Clique "Edit" et ajoute les notes de version
echo   4. Clique "Publish release"
echo.
pause
