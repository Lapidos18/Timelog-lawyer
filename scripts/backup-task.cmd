@echo off
rem Запуск резервного копирования из Планировщика заданий Windows.
rem
rem Обёртка нужна по двум причинам: задание должно стартовать из папки
rem проекта (иначе скрипт не найдёт .env.local) и должно оставлять след
rem в журнале — чтобы потом было видно, отработало оно или нет.
rem
rem Путь не задан жёстко: %~dp0 — это папка, где лежит сам файл.

cd /d "%~dp0.."

set "LOGDIR=%~dp0..\..\Timelog-backups"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

echo. >> "%LOGDIR%\backup-log.txt"
echo ===== %DATE% %TIME% ===== >> "%LOGDIR%\backup-log.txt"

"C:\Program Files\nodejs\node.exe" scripts\backup-local.mjs >> "%LOGDIR%\backup-log.txt" 2>&1

rem Код возврата передаём Планировщику: ненулевой — задание красное,
rem сразу видно, что копия не сделалась.
exit /b %ERRORLEVEL%
