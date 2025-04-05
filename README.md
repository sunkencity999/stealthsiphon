# Stealth Siphon

An advanced web scraper with a built-in proxy server to bypass CORS restrictions and other web scraping blockers.

## Features

- **Modern Dark-Themed UI**: Clean, minimalist design with excellent typography
- **Multiple Export Formats**: JSON, CSV, and TXT
- **Advanced Scraping Options**: Extract links, images, text content, and more
- **Built-in Proxy Server**: No reliance on external CORS services
- **Countermeasures**: Bypass common anti-scraping techniques
  - User-Agent Rotation
  - Request Delays
  - Robots.txt Bypass
  - Custom Proxy Support
  - Fallback Methods

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
4. Open your browser and navigate to `http://localhost:3000`

## How It Works

Stealth Siphon includes a Node.js backend server that acts as a proxy for your web scraping requests. This eliminates the need for external CORS services like CORS Anywhere, making the application more reliable and self-contained.

The proxy server:
- Forwards your requests to target websites
- Handles CORS headers
- Applies countermeasures like user-agent spoofing
- Provides detailed error information

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

### Countermeasures
- **Bypass robots.txt**: Ignore robots.txt restrictions
- **Rotate User-Agents**: Cycle through different browser identities
- **Custom User Agent**: Specify your own user agent string
- **Use Proxy**: Configure external proxy services
- **Request Delay**: Add time between requests to avoid rate limiting
- **Fallback Method**: Try alternative methods if the primary request fails

## License

MIT
