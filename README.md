# Stealth Siphon

An advanced web scraper with a built-in proxy server to bypass CORS restrictions and other web scraping blockers.

## Created by Christopher Bradford

## Features

- **Modern Dark-Themed UI**: Clean, minimalist design with excellent typography
- **Multiple Export Formats**: JSON, CSV, and TXT
- **Advanced Scraping Options**: Extract links, images, text content, and more
- **Built-in Proxy Server**: No reliance on external CORS services
- **Headless Browser Integration**: Scrape JavaScript-rendered content with automatic fallback
- **Database Export**: Export scraped data directly to SQLite, MongoDB, or MySQL
- **Custom SVG Favicon**: Modern, sleek branding
- **Countermeasures**: Bypass common anti-scraping techniques
  - User-Agent Rotation
  - Request Delays
  - Robots.txt Bypass
  - Custom Proxy Support
  - Enhanced Fallback Methods

## Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open your browser and navigate to `http://localhost:4200`

## How It Works

Stealth Siphon includes a Node.js backend server that acts as a proxy for your web scraping requests. This eliminates the need for external CORS services like CORS Anywhere, making the application more reliable and self-contained.

The proxy server:

- Forwards your requests to target websites
- Handles CORS headers
- Applies countermeasures like user-agent spoofing
- Provides detailed error information
- Renders JavaScript content via headless browser

## Usage

1. Enter the URL you want to scrape
2. Configure scraping options (optional)
3. Select your preferred export format
4. Click "Start Scraping"
5. Download or preview the results

## Advanced Options

### Content Extraction

- **CSS Selector**: Target specific elements on the page
- **Extract Links**: Get all hyperlinks from the page
- **Extract Images**: Get all image URLs
- **Extract Text**: Get all text content
- **Follow Links**: Recursively scrape linked pages (limited depth)

### Headless Browser

- **Use Headless Browser**: Enable Puppeteer for JavaScript-rendered content
- **Wait for Selector**: Wait for a specific element to appear before scraping
- **Additional Wait Time**: Add delay after page load for dynamic content
- **Extract Format**: Choose between HTML, text-only, or screenshot
- **Capture Full Page**: For screenshots, capture the entire page length

### Countermeasures

- **Bypass robots.txt**: Ignore robots.txt restrictions
- **Rotate User-Agents**: Cycle through different browser identities
- **Custom User Agent**: Specify your own user agent string
- **Use Proxy**: Configure external proxy services
- **Request Delay**: Add time between requests to avoid rate limiting
- **Fallback Method**: Try alternative methods if the primary request fails

## Recent Updates

### Version 1.1.0 (April 2025)

- Changed default port from 3000 to 4200 to avoid conflicts with common development servers
- Added custom SVG favicon for better branding
- Implemented database export functionality (SQLite, MongoDB, MySQL)
- Enhanced headless browser implementation with reliable fallback mechanisms
- Improved error handling and debugging for scraping operations

## License

MIT

## Credits

Developed by Christopher Bradford
