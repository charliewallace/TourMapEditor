@echo off

:: 1. Start the server on 8085
:: The "cmd /c" ensures the window stays open to keep the server alive
start "Dev Server" cmd /c "python -m http.server 8085"

:: 2. Wait 2 seconds for the port to bind
timeout /t 2 /nobreak > nul

:: 3. Launch Chrome to the EXACT same port
start chrome "http://localhost:8085/index.html"

exit