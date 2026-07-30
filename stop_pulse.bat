@echo off
echo Останавливаю Pulse Messenger (если запущен через run_silent.vbs)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*app.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host 'Остановлен процесс' $_.ProcessId }"
echo.
echo Готово.
pause
