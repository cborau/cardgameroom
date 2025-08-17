#!/usr/bin/env python3
import sys
from pathlib import Path

# Add the parent directory to the Python path
sys.path.insert(0, str(Path(__file__).parent))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server.app:app",      # import string, not the app object
        host="0.0.0.0",
        port=8001,
        reload=True,
        # Optional: also watch these folders for changes
        # reload_dirs=[str(Path(__file__).parent / "server"), str(Path(__file__).parent / "client")],
    )

