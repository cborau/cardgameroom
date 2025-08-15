@echo off
cd /d %~dp0
python -m venv .venv
call .venv\Scripts\activate
pip install -r server\requirements.txt
uvicorn server.app:app --reload --host 0.0.0.0 --port 8000
