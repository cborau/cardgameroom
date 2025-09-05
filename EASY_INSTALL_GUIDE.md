# 🎮 CardGameRoom - Easy Installation Guide

## For People with ZERO Coding Experience

Don't worry! We've made this super easy for you. Just follow these simple steps:

### Windows Users (Easiest Way):
1. **Double-click** the file called `INSTALL.bat`
2. Wait for it to finish (it might take a few minutes)
3. When it's done, **double-click** `run_server.py` to start the game
4. Open your web browser and go to `http://localhost:8000`
5. Enjoy! 🎉

### Alternative Method (All Operating Systems):
1. **Double-click** the file called `install_everything.py`
2. Wait for it to finish installing everything
3. **Double-click** `run_server.py` to start the server
4. Open your web browser and go to `http://localhost:8000`

## What Gets Installed

The installer will automatically download and install:
- FastAPI (web framework)
- Uvicorn (web server)
- Pydantic (data validation)
- Requests (for downloading stuff from the internet)
- TQDM (fancy progress bars)
- MTG-Parser (for reading Magic: The Gathering deck files)
- Pytest (for testing the code)

## Troubleshooting

### "Python is not recognized" error:
- You need to install Python first
- Go to https://python.org and download Python 3.8 or newer
- Make sure to check "Add Python to PATH" during installation

### "Permission denied" or "Access denied":
- Try running as administrator (right-click → "Run as administrator")
- Or install Python just for your user account

### Something else went wrong:
- Try running the installer again
- Make sure you have an internet connection
- Check that you have enough disk space (about 100MB needed)

## After Installation

1. **To start the server**: Double-click `run_server.py`
2. **To add new card decks**: Edit `deck_download.py` and run it
3. **To stop the server**: Close the command window that opened

## Need Help?

If you're still having trouble:
1. Take a screenshot of any error messages
2. Ask someone tech-savvy to help
3. Or search online for the specific error message

---

**Remember**: You only need to run the installer ONCE. After that, just use `run_server.py` to start playing!
