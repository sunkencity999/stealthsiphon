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

# Download files directly if needed
if [ "$DOWNLOAD_DIRECT" = true ]; then
    echo "Downloading Stealth Siphon files..."
    
    # List of files to download
    FILES=(
        "index.html"
        "style.css"
        "script.js"
        "server.js"
        "package.json"
        "README.md"
        "landing.html"
        "landing.css"
    )
    
    BASE_URL="https://raw.githubusercontent.com/yourusername/stealthsiphon/main"
    
    for file in "${FILES[@]}"; do
        echo "Downloading $file..."
        curl -s "$BASE_URL/$file" -o "$file"
    done
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Start the application
echo -e "${GREEN}Installation complete!${NC}"
echo "Starting Stealth Siphon..."
echo ""
echo -e "${BLUE}You can access Stealth Siphon at:${NC} http://localhost:3000"
echo -e "${BLUE}To stop the server, press:${NC} Ctrl+C"
echo ""

# Run the application
npm start
