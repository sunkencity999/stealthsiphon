/**
 * Simplified Headless Browser Service for Stealth Siphon
 * This module provides a basic implementation of Puppeteer for web scraping
 */

const puppeteer = require('puppeteer');
const axios = require('axios');

// Browser instance cache
let browserInstance = null;

/**
 * Initialize the browser instance with minimal settings
 */
async function initBrowser() {
    if (browserInstance) {
        return browserInstance;
    }
    
    console.log('Initializing headless browser...');
    
    try {
        // Launch browser with minimal settings
        browserInstance = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });
        
        console.log('Headless browser initialized successfully');
        
        return browserInstance;
    } catch (error) {
        console.error('Failed to initialize browser:', error);
        browserInstance = null;
        throw error;
    }
}

/**
 * Close the browser instance
 */
async function closeBrowser() {
    if (browserInstance) {
        try {
            console.log('Closing browser instance...');
            await browserInstance.close();
            console.log('Browser instance closed successfully');
        } catch (error) {
            console.error('Error closing browser:', error);
        } finally {
            browserInstance = null;
        }
    }
}

/**
 * Scrape content from a URL using headless browser
 * @param {Object} options - Scraping options
 * @returns {Promise<Object>} - The scraped content and metadata
 */
async function scrapeWithHeadlessBrowser(options) {
    const {
        url,
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        waitForSelector = 'body',
        waitTime = 0,
        fullPage = false,
        extractFormat = 'html',
        screenshotFormat = 'png',
        bypassRobots = false,
        timeout = 30000
    } = options;
    
    // Fallback to axios if Puppeteer fails
    try {
        // Try using axios as a more reliable method first
        console.log(`[Headless] Using axios to fetch: ${url}`);
        
        const headers = {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        };
        
        if (bypassRobots) {
            headers['X-Robots-Tag'] = 'noindex';
            headers['From'] = 'friendly-bot@example.com';
        }
        
        const response = await axios.get(url, {
            headers,
            timeout: timeout,
            responseType: extractFormat === 'text' ? 'text' : 'document'
        });
        
        let result;
        let contentType;
        
        if (extractFormat === 'text') {
            result = response.data;
            contentType = 'text/plain';
        } else {
            result = response.data;
            contentType = 'text/html';
        }
        
        console.log(`[Headless] Content fetched successfully with axios (${result.length} bytes)`);
        
        return {
            success: true,
            content: result,
            contentType,
            status: response.status,
            url: response.request.res.responseUrl || url
        };
        
    } catch (axiosError) {
        console.log(`[Headless] Axios failed, trying Puppeteer: ${axiosError.message}`);
        
        // If axios fails, try Puppeteer as a fallback
        let browser = null;
        let page = null;
        
        try {
            console.log(`[Headless] Scraping URL with Puppeteer: ${url}`);
            
            // Initialize browser
            browser = await initBrowser();
            
            // Create a new page
            page = await browser.newPage();
            console.log('[Headless] New page created');
            
            // Set user agent
            await page.setUserAgent(userAgent);
            
            // Navigate to the URL with minimal settings
            console.log(`[Headless] Navigating to: ${url}`);
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: timeout
            });
            
            // Wait for a moment to ensure content loads
            await page.waitForTimeout(waitTime || 1000);
            
            // Extract content based on format
            let result;
            let contentType;
            
            if (extractFormat === 'text') {
                result = await page.evaluate(() => document.body.innerText);
                contentType = 'text/plain';
            } else {
                result = await page.content();
                contentType = 'text/html';
            }
            
            console.log(`[Headless] Content extracted successfully with Puppeteer`);
            
            return {
                success: true,
                content: result,
                contentType,
                status: 200,
                url: page.url()
            };
            
        } catch (puppeteerError) {
            console.error(`[Headless] Puppeteer error: ${puppeteerError.message}`);
            
            return {
                success: false,
                error: {
                    message: `Axios error: ${axiosError.message}, Puppeteer error: ${puppeteerError.message}`,
                    stack: puppeteerError.stack
                },
                url
            };
        } finally {
            if (page) {
                try {
                    await page.close();
                } catch (closeError) {
                    console.error('[Headless] Error closing page:', closeError);
                }
            }
        }
    }
}

/**
 * Close the browser instance
 */
async function closeBrowser() {
    if (browserInstance) {
        try {
            console.log('Closing browser instance...');
            await browserInstance.close();
            console.log('Browser instance closed successfully');
        } catch (error) {
            console.error('Error closing browser:', error);
        } finally {
            browserInstance = null;
        }
    }
}

// Ensure browser is properly closed on process exit
process.on('exit', async () => {
    await closeBrowser();
});

// Also handle SIGINT and SIGTERM
process.on('SIGINT', async () => {
    await closeBrowser();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeBrowser();
    process.exit(0);
});

module.exports = {
    initBrowser,
    closeBrowser,
    scrapeWithHeadlessBrowser
};
