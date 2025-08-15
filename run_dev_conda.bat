@echo off
setlocal
for /f "delims=" %%i in ('conda info --base') do set "CONDA_BASE=%%i"
call "%CONDA_BASE%\Scripts\activate.bat" cardgameroom

rem Open the browser after a short delay
start "" powershell -NoProfile -Command "Start-Sleep -s 1; Start-Process 'http://localhost:8000'"

uvicorn server.app:app --reload --host 0.0.0.0 --port 8000
