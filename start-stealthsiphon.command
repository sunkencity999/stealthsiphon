#!/bin/bash

# Stealth Siphon Launcher for macOS
# This script starts the Stealth Siphon server and opens it in the default browser

# Text colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Get the directory where the script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Display banner
echo -e "${PURPLE}"
echo "  ███████╗████████╗███████╗ █████╗ ██╗  ████████╗██╗  ██╗"
echo "  ██╔════╝╚══██╔══╝██╔════╝██╔══██╗██║  ╚══██╔══╝██║  ██║"
echo "  ███████╗   ██║   █████╗  ███████║██║     ██║   ███████║"
echo "  ╚════██║   ██║   ██╔══╝  ██╔══██║██║     ██║   ██╔══██║"
echo "  ███████║   ██║   ███████╗██║  ██║███████╗██║   ██║  ██║"
echo "  ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═╝"
echo "   ███████╗██╗██████╗ ██╗  ██╗ ██████╗ ███╗   ██╗        "
echo "   ██╔════╝██║██╔══██╗██║  ██║██╔═══██╗████╗  ██║        "
echo "   ███████╗██║██████╔╝███████║██║   ██║██╔██╗ ██║        "
echo "   ╚════██║██║██╔═══╝ ██╔══██║██║   ██║██║╚██╗██║        "
echo "   ███████║██║██║     ██║  ██║╚██████╔╝██║ ╚████║        "
echo "   ╚══════╝╚═╝╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝        "
echo -e "${NC}"

echo -e "${BLUE}Starting Stealth Siphon...${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed."
    echo "Please install Node.js from https://nodejs.org/"
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed."
    echo "Please install Node.js from https://nodejs.org/"
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install dependencies."
        echo "Press any key to exit..."
        read -n 1
        exit 1
    fi
fi

# Function to open browser after server starts
function open_browser() {
    # Wait for server to start (up to 10 seconds)
    for i in {1..10}; do
        if nc -z localhost 4200 &>/dev/null; then
            echo -e "${GREEN}Server is running!${NC}"
            echo -e "${BLUE}Opening Stealth Siphon in your default browser...${NC}"
            open "http://localhost:4200"
            break
        fi
        sleep 1
    done
}

# Start the open_browser function in the background
open_browser &

# Start the server
echo -e "${BLUE}Server starting at:${NC} http://localhost:4200"
echo -e "${BLUE}Press Ctrl+C to stop the server${NC}"
npm start

# This will execute when the server is stopped
echo -e "${BLUE}Stealth Siphon server has been stopped.${NC}"
echo "Press any key to exit..."
read -n 1
