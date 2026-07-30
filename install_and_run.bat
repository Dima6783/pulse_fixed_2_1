@echo off
setlocal
title Pulse Messenger - установка и запуск
cd /d "%~dp0"

echo ================================================
echo   Pulse Messenger - установка зависимостей
echo ================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [ОШИБКА] Python не найден.
    echo Скачай и установи Python с https://www.python.org/downloads/
    echo При установке ОБЯЗАТЕЛЬНО поставь галочку "Add python.exe to PATH"
    echo.
    pause
    exit /b 1
)

echo Найден Python, устанавливаю библиотеки из requirements.txt...
echo (это может занять минуту-другую при первом запуске)
echo.
python -m pip install --upgrade pip >nul 2>nul
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Не удалось установить зависимости. Смотри текст ошибки выше.
    pause
    exit /b 1
)

echo.
echo Библиотеки установлены. Запускаю сервер Pulse Messenger в фоне...
start "Pulse Server (не закрывай без надобности)" /min cmd /k "python app.py"

echo Жду несколько секунд, пока сервер поднимется...
timeout /t 4 /nobreak >nul

echo Открываю страницу в браузере...
start "" "http://localhost:8000"

echo.
echo ================================================
echo   Готово! Сервер работает в свёрнутом окне.
echo   Найти его можно на панели задач Windows
echo   ("Pulse Server ..."), там же видны логи.
echo   Чтобы ОСТАНОВИТЬ сервер - закрой то окно.
echo ================================================
echo.
pause
