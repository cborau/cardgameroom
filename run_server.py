#!/usr/bin/env python3
import sys
import os
from pathlib import Path

# Add the parent directory to the Python path
sys.path.insert(0, str(Path(__file__).parent))

if __name__ == "__main__":
    import uvicorn
    from server.app import app
    
    uvicorn.run(app, host="0.0.0.0", port=8001)
