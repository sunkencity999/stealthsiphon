#!/bin/bash

# Stealth Siphon Launcher for Linux
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
    echo "Please install Node.js from https://nodejs.org/ or using your package manager"
    echo "Press Enter to exit..."
    read
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed."
    echo "Please install Node.js from https://nodejs.org/ or using your package manager"
    echo "Press Enter to exit..."
    read
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install dependencies."
        echo "Press Enter to exit..."
        read
        exit 1
    fi
fi

# Function to detect the default browser and open URL
open_url() {
    url="$1"
    
    # Try different browser openers
    if command -v xdg-open &> /dev/null; then
        xdg-open "$url" &> /dev/null &
    elif command -v gnome-open &> /dev/null; then
        gnome-open "$url" &> /dev/null &
    elif command -v kde-open &> /dev/null; then
        kde-open "$url" &> /dev/null &
    elif command -v firefox &> /dev/null; then
        firefox "$url" &> /dev/null &
    elif command -v google-chrome &> /dev/null; then
        google-chrome "$url" &> /dev/null &
    elif command -v chromium-browser &> /dev/null; then
        chromium-browser "$url" &> /dev/null &
    else
        echo "Could not detect a browser to open the URL."
        echo "Please open $url manually in your browser."
        return 1
    fi
    
    return 0
}

# Function to open browser after server starts
function open_browser() {
    # Wait for server to start (up to 10 seconds)
    for i in {1..10}; do
        if command -v nc &> /dev/null; then
            if nc -z localhost 4200 &>/dev/null; then
                echo -e "${GREEN}Server is running!${NC}"
                echo -e "${BLUE}Opening Stealth Siphon in your default browser...${NC}"
                open_url "http://localhost:4200"
                break
            fi
        else
            # If netcat is not available, just wait a bit longer
            sleep 5
            echo -e "${GREEN}Server should be running now!${NC}"
            echo -e "${BLUE}Opening Stealth Siphon in your default browser...${NC}"
            open_url "http://localhost:4200"
            break
        fi
        sleep 1
    done
}

# Make the script executable
chmod +x "$0"

# Start the open_browser function in the background
open_browser &

# Start the server
echo -e "${BLUE}Server starting at:${NC} http://localhost:4200"
echo -e "${BLUE}Press Ctrl+C to stop the server${NC}"
npm start

# This will execute when the server is stopped
echo -e "${BLUE}Stealth Siphon server has been stopped.${NC}"
echo "Press Enter to exit..."
read
