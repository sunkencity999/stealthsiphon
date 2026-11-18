#!/bin/bash

# Stealth Siphon Installation Script
# This script automatically installs Stealth Siphon and its dependencies

# Text colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

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

echo -e "${BLUE}Welcome to the Stealth Siphon installer!${NC}"
echo "This script will install Stealth Siphon and all required dependencies."
echo ""

# Check if Node.js is installed
echo "Checking for Node.js..."
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Installing Node.js..."
    
    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v apt-get &> /dev/null; then
            # Debian/Ubuntu
            curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v dnf &> /dev/null; then
            # Fedora
            sudo dnf install -y nodejs
        elif command -v yum &> /dev/null; then
            # CentOS/RHEL
            curl -fsSL https://rpm.nodesource.com/setup_16.x | sudo bash -
            sudo yum install -y nodejs
        else
            echo "Unsupported Linux distribution. Please install Node.js manually."
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install node
        else
            echo "Homebrew not found. Installing Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            brew install node
        fi
    else
        echo "Unsupported operating system. Please install Node.js manually."
        exit 1
    fi
else
    echo "Node.js is already installed."
fi

# Check Node.js version
NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"

# Create project directory
echo "Creating Stealth Siphon directory..."
mkdir -p stealthsiphon
cd stealthsiphon

# Clone repository if git is available
if command -v git &> /dev/null; then
    echo "Git is available. Cloning repository..."
    git clone https://github.com/yourusername/stealthsiphon.git .
    if [ $? -ne 0 ]; then
        echo "Failed to clone repository. Downloading files directly..."
        DOWNLOAD_DIRECT=true
    fi
else
    echo "Git not found. Downloading files directly..."
    DOWNLOAD_DIRECT=true
fi

if [ "$DOWNLOAD_DIRECT" = true ]; then
    echo "Error: git is required to install Stealth Siphon (direct download is not supported)."
    exit 1
fi

# Install dependencies from package.json (uses your installed Google Chrome; no browser download)
echo "Installing dependencies..."
PUPPETEER_SKIP_DOWNLOAD=1 npm install

echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo -e "${BLUE}Web UI / REST API:${NC} http://localhost:4200"
echo -e "${BLUE}MCP (Claude Code):${NC} claude mcp add stealthsiphon -- node \"$(pwd)/bin/mcp.js\""
echo -e "${BLUE}To stop the server, press:${NC} Ctrl+C"
echo ""

chmod +x start-stealthsiphon.sh start-stealthsiphon.command bin/*.js 2>/dev/null

npm start
