#!/usr/bin/env python3
"""
CardGameRoom One-Click Installer
================================

This script will automatically install all the required dependencies
and set up the CardGameRoom project for you.

Just double-click this file or run it with Python!
"""

import subprocess
import sys
import os
from pathlib import Path

def print_step(step, message):
    print(f"\n{'='*50}")
    print(f"STEP {step}: {message}")
    print('='*50)

def run_command(cmd, description):
    """Run a command and handle errors gracefully"""
    print(f"\n🔄 {description}...")
    try:
        if isinstance(cmd, str):
            result = subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)
        else:
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"✅ {description} - SUCCESS")
        if result.stdout.strip():
            print(f"Output: {result.stdout.strip()}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} - FAILED")
        print(f"Error: {e.stderr.strip() if e.stderr else str(e)}")
        return False
    except Exception as e:
        print(f"❌ {description} - FAILED")
        print(f"Error: {str(e)}")
        return False

def check_python():
    """Check if Python is installed and get version"""
    try:
        result = subprocess.run([sys.executable, "--version"], capture_output=True, text=True, check=True)
        version = result.stdout.strip()
        print(f"✅ Python found: {version}")
        
        # Check if Python is 3.8+
        version_info = sys.version_info
        if version_info.major == 3 and version_info.minor >= 8:
            return True
        else:
            print(f"❌ Python 3.8+ required, found Python {version_info.major}.{version_info.minor}")
            return False
    except Exception as e:
        print(f"❌ Python not found or not working: {e}")
        return False

def main():
    print("🎮 Welcome to CardGameRoom One-Click Installer! 🎮")
    print("\nThis script will set up everything you need to run the CardGameRoom server.")
    print("Please wait while we install the required dependencies...")
    
    # Get the directory where this script is located
    script_dir = Path(__file__).resolve().parent
    requirements_file = script_dir / "server" / "requirements.txt"
    
    # Step 1: Check Python
    print_step(1, "Checking Python Installation")
    if not check_python():
        print("\n❌ INSTALLATION FAILED")
        print("Please install Python 3.8 or newer from https://python.org")
        input("Press Enter to exit...")
        return False
    
    # Step 2: Upgrade pip
    print_step(2, "Upgrading pip (Python package manager)")
    if not run_command([sys.executable, "-m", "pip", "install", "--upgrade", "pip"], 
                      "Upgrading pip"):
        print("⚠️  Warning: Could not upgrade pip, but continuing anyway...")
    
    # Step 3: Install requirements
    print_step(3, "Installing Required Python Packages")
    if not requirements_file.exists():
        print(f"❌ Requirements file not found at: {requirements_file}")
        print("Make sure this script is in the CardGameRoom project folder!")
        input("Press Enter to exit...")
        return False
    
    if not run_command([sys.executable, "-m", "pip", "install", "-r", str(requirements_file)], 
                      "Installing project dependencies"):
        print("\n❌ INSTALLATION FAILED")
        print("Could not install required packages. Check your internet connection and try again.")
        input("Press Enter to exit...")
        return False
    
    # Step 4: Test installation
    print_step(4, "Testing Installation")
    test_imports = [
        ("fastapi", "FastAPI web framework"),
        ("uvicorn", "ASGI server"),
        ("pydantic", "Data validation"),
        ("requests", "HTTP requests"),
        ("tqdm", "Progress bars"),
    ]
    
    all_good = True
    for module, description in test_imports:
        try:
            __import__(module)
            print(f"✅ {description} - OK")
        except ImportError:
            print(f"❌ {description} - MISSING")
            all_good = False
    
    # Test mtg-parser separately as it might have a different import name
    try:
        import mtg_parser
        print(f"✅ MTG deck parser - OK")
    except ImportError:
        print(f"❌ MTG deck parser - MISSING")
        all_good = False
    
    if not all_good:
        print("\n❌ INSTALLATION INCOMPLETE")
        print("Some packages failed to install. Please check the error messages above.")
        input("Press Enter to exit...")
        return False
    
    # Step 5: Success!
    print_step(5, "Installation Complete!")
    print("🎉 SUCCESS! All dependencies have been installed.")
    print("\n📋 NEXT STEPS:")
    print("1. To start the server, run: python run_server.py")
    print("2. Open your web browser and go to: http://localhost:8000")
    print("3. Enjoy playing with your card game room!")
    print("\n💡 TIP: To download MTG decks, edit the deck_download.py file")
    print("   and add your deck URLs or text files, then run: python deck_download.py")
    
    print(f"\n📁 Project location: {script_dir}")
    print("\n" + "="*50)
    input("Press Enter to exit...")
    return True

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n❌ Installation cancelled by user.")
        input("Press Enter to exit...")
    except Exception as e:
        print(f"\n\n❌ Unexpected error: {e}")
        input("Press Enter to exit...")
