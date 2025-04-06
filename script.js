// Global variables to store scraped data and state
let scrapedData = null;
let selectedFormat = 'json';
let isLoading = false;

// Collection of common user agents for rotation
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36 OPR/78.0.4093.112'
];

// Default proxy services (these would need API keys in production)
const proxyServices = {
    corsAnywhere: 'https://cors-anywhere.herokuapp.com/',
    scraperApi: 'http://api.scraperapi.com?api_key={API_KEY}&url=',
    proxyMesh: 'http://proxy-mesh.example.com?api_key={API_KEY}&url='
};

// Initialize the UI event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Toggle advanced options panel
    const optionsToggle = document.getElementById('optionsToggle');
    const optionsContent = document.getElementById('optionsContent');
    
    optionsToggle.addEventListener('click', () => {
        optionsToggle.classList.toggle('open');
        optionsContent.classList.toggle('visible');
    });
    
    // Format selector
    const formatOptions = document.querySelectorAll('.format-option');
    formatOptions.forEach(option => {
        option.addEventListener('click', () => {
            formatOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            selectedFormat = option.getAttribute('data-format');
            
            // Update download link extension
            const downloadLink = document.getElementById('downloadLink');
            if (downloadLink.getAttribute('href') !== '#') {
                downloadLink.setAttribute('download', `scraped_data.${selectedFormat}`);
            }
        });
    });
    
    // Toggle proxy input fields
    const useProxyCheckbox = document.getElementById('useProxy');
    const proxyInput = document.getElementById('proxyInput');
    const proxyApiKey = document.getElementById('proxyApiKey');
    
    useProxyCheckbox.addEventListener('change', () => {
        proxyInput.disabled = !useProxyCheckbox.checked;
        proxyApiKey.disabled = !useProxyCheckbox.checked;
    });
    
    // Toggle delay input field
    const useDelayCheckbox = document.getElementById('useDelay');
    const delayInput = document.getElementById('delayInput');
    
    useDelayCheckbox.addEventListener('change', () => {
        delayInput.disabled = !useDelayCheckbox.checked;
    });
    
    // Toggle headless browser options
    const useHeadlessBrowserCheckbox = document.getElementById('useHeadlessBrowser');
    const headlessBrowserOptions = document.getElementById('headlessBrowserOptions');
    
    useHeadlessBrowserCheckbox.addEventListener('change', () => {
        headlessBrowserOptions.style.display = useHeadlessBrowserCheckbox.checked ? 'block' : 'none';
    });
    
    // Handle extract format changes
    const extractFormatSelect = document.getElementById('extractFormat');
    const fullPageScreenshotCheckbox = document.getElementById('fullPageScreenshot');
    
    extractFormatSelect.addEventListener('change', () => {
        // Only show full page option for screenshots
        const isScreenshot = extractFormatSelect.value === 'screenshot';
        fullPageScreenshotCheckbox.parentElement.style.display = isScreenshot ? 'flex' : 'none';
    });
    
    // Toggle database options
    const dbExportRadio = document.getElementById('dbExport');
    const databaseOptions = document.getElementById('databaseOptions');
    
    dbExportRadio.addEventListener('change', () => {
        databaseOptions.style.display = dbExportRadio.checked ? 'block' : 'none';
    });
    
    // Toggle database-specific options based on database type
    const dbTypeSelect = document.getElementById('dbType');
    const mongoDbOptions = document.getElementById('mongoDbOptions');
    const mysqlOptions = document.getElementById('mysqlOptions');
    
    dbTypeSelect.addEventListener('change', () => {
        // Hide all database-specific options first
        document.querySelectorAll('.db-specific-options').forEach(el => {
            el.style.display = 'none';
        });
        
        // Show options for the selected database type
        switch (dbTypeSelect.value) {
            case 'mongodb':
                mongoDbOptions.style.display = 'block';
                break;
            case 'mysql':
                mysqlOptions.style.display = 'block';
                break;
            // SQLite doesn't need additional options
        }
    });
});

/**
 * Get a random user agent from the list or use a custom one
 */
function getEffectiveUserAgent(customUserAgent, shouldRotate) {
    if (customUserAgent) {
        return customUserAgent;
    }
    
    if (shouldRotate) {
        const randomIndex = Math.floor(Math.random() * userAgents.length);
        return userAgents[randomIndex];
    }
    
    // Default user agent
    return userAgents[0];
}

/**
 * Prepare the URL with appropriate proxy if needed
 */
function prepareRequestUrl(originalUrl, useProxy, proxyUrl, proxyApiKey, userAgent, bypassRobots, useHeadlessBrowser, headlessOptions) {
    // Check if we should use headless browser
    if (useHeadlessBrowser) {
        // Build headless browser proxy URL
        let headlessProxyUrl = `/headless-proxy?url=${encodeURIComponent(originalUrl)}`;
        
        // Add common parameters
        headlessProxyUrl += `&userAgent=${encodeURIComponent(userAgent)}&bypassRobots=${bypassRobots}`;
        
        // Add headless browser specific parameters
        if (headlessOptions) {
            if (headlessOptions.waitForSelector) {
                headlessProxyUrl += `&waitForSelector=${encodeURIComponent(headlessOptions.waitForSelector)}`;
            }
            
            if (headlessOptions.waitTime) {
                headlessProxyUrl += `&waitTime=${headlessOptions.waitTime}`;
            }
            
            if (headlessOptions.fullPage) {
                headlessProxyUrl += `&fullPage=true`;
            }
            
            if (headlessOptions.extractFormat) {
                headlessProxyUrl += `&extractFormat=${headlessOptions.extractFormat}`;
                
                // Add screenshot format if needed
                if (headlessOptions.extractFormat === 'screenshot') {
                    headlessProxyUrl += `&screenshotFormat=png`;
                }
            }
        }
        
        return headlessProxyUrl;
    }
    
    // Default to our built-in proxy server
    const localProxyUrl = `/proxy?url=${encodeURIComponent(originalUrl)}`;
    
    // Add additional parameters to our local proxy
    const localProxyWithParams = `${localProxyUrl}&userAgent=${encodeURIComponent(userAgent)}&bypassRobots=${bypassRobots}`;
    
    if (!useProxy) {
        // Use our built-in proxy by default
        return localProxyWithParams;
    }
    
    // Use custom proxy if provided
    if (proxyUrl) {
        let fullProxyUrl = proxyUrl;
        if (proxyApiKey && fullProxyUrl.includes('{API_KEY}')) {
            fullProxyUrl = fullProxyUrl.replace('{API_KEY}', proxyApiKey);
        }
        return `${fullProxyUrl}${encodeURIComponent(originalUrl)}`;
    }
    
    // Default to our built-in proxy
    return localProxyWithParams;
}

/**
 * Fallback method to fetch content when proxies fail
 * Note: This has limited capabilities due to CORS restrictions
 */
async function fallbackFetch(url, userAgent) {
    console.log('Using fallback fetch method for:', url);
    
    // Try using a public CORS proxy if available
    const publicProxies = [
        'https://corsproxy.io/?',
        'https://api.allorigins.win/raw?url=',
        'https://api.codetabs.com/v1/proxy?quest=',
        'https://cors-anywhere.herokuapp.com/'
    ];
    
    // Try each proxy in order
    for (const proxy of publicProxies) {
        try {
            console.log(`Trying public proxy: ${proxy}`);
            const response = await fetch(proxy + encodeURIComponent(url), {
                headers: {
                    'User-Agent': userAgent,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Origin': window.location.origin
                }
            });
            
            if (response.ok) {
                const content = await response.text();
                if (content.length > 500) { // Basic check to ensure we got meaningful content
                    console.log('Fallback fetch successful with proxy:', proxy);
                    return content;
                }
            }
        } catch (error) {
            console.warn(`Proxy ${proxy} failed:`, error.message);
            // Continue to next proxy
        }
    }
    
    // If all proxies fail, try a direct fetch with no-cors mode
    // This will have very limited capabilities
    console.log('All proxies failed, trying direct fetch with no-cors mode');
    
    try {
        const response = await fetch(url, {
            mode: 'no-cors',
            headers: {
                'User-Agent': userAgent,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        // Note: With no-cors, we can't actually read the response content
        // So we return a limited mode message
        return '<html><body><h1>Limited Access Mode</h1><p>The content was fetched in limited mode due to CORS restrictions.</p><p>Try using the headless browser option for better results.</p></body></html>';
        
    } catch (error) {
        console.error('Direct fetch also failed:', error.message);
        throw new Error('All fallback methods failed');
    }
}

/**
 * Sleep function for implementing delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function to scrape a URL with the specified options
 */
async function scrapeURL() {
    const url = document.getElementById('urlInput').value;
    if (!url) {
        showStatus('Please enter a valid URL', 'error');
        return;
    }
    
    // Get all options
    const selector = document.getElementById('selectorInput').value;
    const extractLinks = document.getElementById('extractLinks') ? document.getElementById('extractLinks').checked : false;
    const useProxy = document.getElementById('useProxy') ? document.getElementById('useProxy').checked : false;
    const proxyUrl = document.getElementById('proxyInput') ? document.getElementById('proxyInput').value.trim() : '';
    const proxyApiKey = document.getElementById('proxyApiKey') ? document.getElementById('proxyApiKey').value.trim() : '';
    const customUserAgent = document.getElementById('userAgentInput') ? document.getElementById('userAgentInput').value.trim() : '';
    const rotateUserAgent = document.getElementById('rotateUserAgent') ? document.getElementById('rotateUserAgent').checked : true;
    const useDelay = document.getElementById('useDelay') ? document.getElementById('useDelay').checked : false;
    const delayMs = document.getElementById('delayInput') ? parseInt(document.getElementById('delayInput').value) || 0 : 0;
    const bypassRobots = document.getElementById('bypassRobots') ? document.getElementById('bypassRobots').checked : true;
    const followLinks = document.getElementById('followLinks') ? document.getElementById('followLinks').checked : false;
    const useHeadlessBrowser = document.getElementById('useHeadlessBrowser') ? document.getElementById('useHeadlessBrowser').checked : false;
    const useEnhancedFallback = document.getElementById('useEnhancedFallback') ? document.getElementById('useEnhancedFallback').checked : true;
    let headlessOptions = null;
    
    if (useHeadlessBrowser) {
        headlessOptions = {
            waitForSelector: document.getElementById('waitForSelector') ? document.getElementById('waitForSelector').value : '',
            waitTime: document.getElementById('waitTime') ? parseInt(document.getElementById('waitTime').value) : 1000,
            fullPage: document.getElementById('fullPageScreenshot') ? document.getElementById('fullPageScreenshot').checked : false,
            extractFormat: document.getElementById('extractFormat') ? document.getElementById('extractFormat').value : 'html'
        };
    }
    
    // Get effective user agent
    const effectiveUserAgent = getEffectiveUserAgent(customUserAgent, rotateUserAgent);
    
    // Update UI to loading state
    setLoading(true);
    showStatus('Scraping in progress... This may take a moment.', 'loading');
    
    if (useHeadlessBrowser) {
        showStatus('Using headless browser. This may take longer than usual...', 'loading');
    }
    
    try {
        let html;
        let usedFallback = false;
        let fallbackLimited = false;
        
        // Prepare the request URL with proxy if needed
        const requestUrl = prepareRequestUrl(url, useProxy, proxyUrl, proxyApiKey, effectiveUserAgent, bypassRobots, useHeadlessBrowser, headlessOptions);
        
        // Prepare headers with countermeasures
        const headers = {
            'User-Agent': effectiveUserAgent
        };
        
        // Add headers to bypass robots.txt
        if (bypassRobots) {
            headers['X-Robots-Tag'] = 'noindex';
            headers['From'] = 'friendly-bot@example.com';
        }
        
        try {
            // Make the primary request
            const response = await fetch(requestUrl, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                // If fallback is enabled and we get a 403, try the fallback method
                if ((useEnhancedFallback || document.getElementById('useFallbackMethod')?.checked) && 
                    (response.status === 403 || response.status === 429 || response.status === 500)) {
                    throw new Error('Using fallback method');
                }
                
                // Special handling for common error codes
                if (response.status === 403) {
                    throw new Error(`Access Forbidden (403): The website or proxy is blocking your request. Try: \n` +
                        `1. Request temporary access to CORS Anywhere: https://cors-anywhere.herokuapp.com/corsdemo \n` +
                        `2. Use a different proxy service \n` +
                        `3. Try a different user-agent or enable rotation \n` +
                        `4. Enable the fallback method option`);
                } else if (response.status === 429) {
                    throw new Error(`Too Many Requests (429): You're being rate limited. Try: \n` +
                        `1. Enable request delays \n` +
                        `2. Use a different proxy \n` +
                        `3. Wait a few minutes before trying again \n` +
                        `4. Enable the fallback method option`);
                } else {
                    throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);
                }
            }
            
            html = await response.text();
            
        } catch (error) {
            console.error('Primary request failed:', error.message);
            
            // Try fallback methods
            if (useFallbackMethod) {
                // First try headless browser if not already using it
                if (!useHeadlessBrowser) {
                    try {
                        showStatus('Primary request failed. Trying headless browser...', 'loading');
                        
                        // Prepare headless browser options
                        const headlessFallbackOptions = {
                            waitForSelector: 'body',
                            waitTime: 2000,
                            fullPage: true,
                            extractFormat: 'html'
                        };
                        
                        // Create headless browser request URL
                        const headlessRequestUrl = prepareRequestUrl(
                            url, 
                            useProxy, 
                            proxyUrl, 
                            proxyApiKey, 
                            effectiveUserAgent, 
                            bypassRobots, 
                            true, // Force headless browser
                            headlessFallbackOptions
                        );
                        
                        // Make the request
                        const headlessResponse = await fetch(headlessRequestUrl, {
                            method: 'GET',
                            headers: headers
                        });
                        
                        if (!headlessResponse.ok) {
                            throw new Error(`Headless browser request failed: ${headlessResponse.status}`);
                        }
                        
                        html = await headlessResponse.text();
                        usedFallback = true;
                        
                        // Add metadata about using headless browser
                        scrapedData.metadata = scrapedData.metadata || {};
                        scrapedData.metadata.usedHeadlessBrowser = true;
                        
                    } catch (headlessError) {
                        console.error('Headless browser fallback failed:', headlessError.message);
                        
                        // If headless browser fails, try the original fallback method
                        showStatus('Headless browser failed. Trying basic fallback method...', 'loading');
                        try {
                            html = await fallbackFetch(url, effectiveUserAgent);
                            usedFallback = true;
                            
                            // Check if the fallback method returned limited content
                            if (html.includes('Limited Access Mode') || html.length < 1000) {
                                fallbackLimited = true;
                                console.warn('Fallback method returned limited content');
                            }
                        } catch (fallbackError) {
                            console.error('All fallback methods failed:', fallbackError.message);
                            throw new Error(`All request methods failed. Original error: ${error.message}`);
                        }
                    }
                } else {
                    // If already using headless browser, try the original fallback
                    showStatus('Primary request failed. Trying fallback method...', 'loading');
                    try {
                        html = await fallbackFetch(url, effectiveUserAgent);
                        usedFallback = true;
                        
                        // Check if the fallback method returned limited content
                        if (html.includes('Limited Access Mode') || html.length < 1000) {
                            fallbackLimited = true;
                            console.warn('Fallback method returned limited content');
                        }
                    } catch (fallbackError) {
                        console.error('Fallback method failed:', fallbackError.message);
                        throw new Error(`All request methods failed. Original error: ${error.message}`);
                    }
                }
            } else {
                // If fallback is not enabled, just throw the original error
                throw primaryError;
            }
        }
        
        // Parse the HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Initialize data structure
        scrapedData = {
            url: url,
            title: doc.title,
            timestamp: new Date().toISOString(),
            data: {},
            metadata: {
                userAgent: effectiveUserAgent,
                bypassedRobots: bypassRobots,
                usedProxy: useProxy,
                usedFallback: usedFallback,
                fallbackLimited: fallbackLimited
            }
        };
        
        // Add a note to the status if fallback was used
        if (usedFallback) {
            if (fallbackLimited) {
                showStatus('Using limited fallback mode. Some data may be incomplete.', 'warning');
            } else {
                showStatus('Using fallback method. Scraping in progress...', 'loading');
            }
        }
        
        // Apply selector if provided
        const targetElements = selector ? 
            Array.from(doc.querySelectorAll(selector)) : 
            [doc.body];
        
        // Extract text content if enabled
        if (extractText) {
            scrapedData.data.textContent = targetElements.map(el => el.textContent.trim()).filter(text => text);
        }
        
        // Extract links if enabled
        if (extractLinks) {
            const links = [];
            targetElements.forEach(el => {
                el.querySelectorAll('a').forEach(a => {
                    if (a.href) {
                        links.push({
                            text: a.textContent.trim(),
                            url: a.href,
                            title: a.title || ''
                        });
                    }
                });
            });
            scrapedData.data.links = links;
            
            // Follow links if enabled (with a limit to prevent too many requests)
            if (followLinks && links.length > 0) {
                showStatus('Following links... This may take a while.', 'loading');
                await followLinksAndScrape(links.slice(0, 5), effectiveUserAgent, useDelay, delayMs, useProxy, proxyUrl, proxyApiKey, bypassRobots, rotateUserAgent);
            }
        }
        
        // Extract images if enabled
        if (extractImages) {
            const images = [];
            targetElements.forEach(el => {
                el.querySelectorAll('img').forEach(img => {
                    if (img.src) {
                        images.push({
                            src: img.src,
                            alt: img.alt || '',
                            title: img.title || ''
                        });
                    }
                });
            });
            scrapedData.data.images = images;
        }
        
        // Get the selected export format
        const exportFormat = document.querySelector('input[name="exportFormat"]:checked').value;
        
        // Export the data in the selected format
        try {
            await exportData(scrapedData, exportFormat, url);
            
            // Enable preview button
            document.getElementById('previewButton').disabled = false;
            
            // Show success message
            showStatus('Scraping completed successfully!', 'success');
        } catch (error) {
            showStatus(`Export error: ${error.message}`, 'error');
        }

    } catch (error) {
        console.error('There was a problem with the scraping operation:', error);
        showStatus(`Failed to scrape the URL: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}

/**
 * Follow links and scrape their content (limited depth)
 */
async function followLinksAndScrape(links, userAgent, useDelay, delayMs, useProxy, proxyUrl, proxyApiKey, bypassRobots, rotateUserAgent) {
    scrapedData.linkedPages = [];
    
    // Only process up to 5 links to avoid overloading
    const linksToFollow = links.slice(0, 5);
    
    for (const link of linksToFollow) {
        try {
            // Skip non-http links or same-page anchors
            if (!link.url.startsWith('http') || link.url.includes('#')) continue;
            
            // Apply delay if enabled (helps avoid rate limiting)
            if (useDelay && delayMs > 0) {
                await sleep(delayMs);
            }
            
            // Rotate user agent if enabled
            const currentUserAgent = rotateUserAgent ? 
                getEffectiveUserAgent('', true) : userAgent;
            
            // Prepare the request URL with proxy if needed
            const requestUrl = prepareRequestUrl(link.url, useProxy, proxyUrl, proxyApiKey, currentUserAgent, bypassRobots);
            
            // Prepare headers with countermeasures
            const headers = {
                'User-Agent': currentUserAgent
            };
            
            // Add headers to bypass robots.txt
            if (bypassRobots) {
                headers['X-Robots-Tag'] = 'noindex';
                headers['From'] = 'friendly-bot@example.com';
            }
            
            // Make the request
            const response = await fetch(requestUrl, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                // Log specific errors but continue with other links
                if (response.status === 403) {
                    console.error(`Access Forbidden (403) for link ${link.url}: The website or proxy is blocking your request.`);
                } else if (response.status === 429) {
                    console.error(`Too Many Requests (429) for link ${link.url}: You're being rate limited.`);
                } else {
                    console.error(`Failed to fetch link ${link.url}: ${response.status} ${response.statusText}`);
                }
                continue;
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            scrapedData.linkedPages.push({
                url: link.url,
                title: doc.title,
                textContent: doc.body.textContent.substring(0, 1000) + '...', // Limit text content
                userAgent: currentUserAgent // Track which user agent was used
            });
            
            // Log successful scrape with countermeasures
            console.log(`Successfully scraped linked page: ${link.url}`);
            console.log(`Used user agent: ${currentUserAgent.substring(0, 50)}...`);
            console.log(`Proxy used: ${useProxy ? 'Yes' : 'No'}`);
            
        } catch (error) {
            console.error(`Error following link ${link.url}:`, error);
            // Continue with other links even if one fails
        }
    }
}

/**
 * Convert the scraped data to CSV format
 */
function convertToCSV(data) {
    let csv = 'URL,Title,Timestamp\n';
    csv += `"${data.url}","${data.title}","${data.timestamp}"\n\n`;
    
    // Add links if available
    if (data.data.links && data.data.links.length > 0) {
        csv += '\nLINKS:\nText,URL,Title\n';
        data.data.links.forEach(link => {
            csv += `"${link.text.replace(/"/g, '""')}","${link.url}","${link.title.replace(/"/g, '""')}"\n`;
        });
    }
    
    // Add images if available
    if (data.data.images && data.data.images.length > 0) {
        csv += '\nIMAGES:\nSource,Alt Text,Title\n';
        data.data.images.forEach(img => {
            csv += `"${img.src}","${img.alt.replace(/"/g, '""')}","${img.title.replace(/"/g, '""')}"\n`;
        });
    }
    
    // Add linked pages if available
    if (data.linkedPages && data.linkedPages.length > 0) {
        csv += '\nLINKED PAGES:\nURL,Title\n';
        data.linkedPages.forEach(page => {
            csv += `"${page.url}","${page.title.replace(/"/g, '""')}"\n`;
        });
    }
    
    return csv;
}

/**
 * Convert the scraped data to plain text format
 */
function convertToPlainText(data) {
    let text = `URL: ${data.url}\n`;
    text += `Title: ${data.title}\n`;
    text += `Timestamp: ${data.timestamp}\n\n`;
    
    // Add text content if available
    if (data.data.textContent && data.data.textContent.length > 0) {
        text += 'CONTENT:\n';
        data.data.textContent.forEach(content => {
            text += `${content}\n\n`;
        });
    }
    
    // Add links if available
    if (data.data.links && data.data.links.length > 0) {
        text += '\nLINKS:\n';
        data.data.links.forEach(link => {
            text += `- ${link.text} (${link.url})\n`;
        });
    }
    
    // Add images if available
    if (data.data.images && data.data.images.length > 0) {
        text += '\nIMAGES:\n';
        data.data.images.forEach(img => {
            text += `- ${img.alt || 'Image'}: ${img.src}\n`;
        });
    }
    
    // Add linked pages if available
    if (data.linkedPages && data.linkedPages.length > 0) {
        text += '\nLINKED PAGES:\n';
        data.linkedPages.forEach(page => {
            text += `- ${page.title} (${page.url})\n`;
        });
    }
    
    return text;
}

/**
 * Export the scraped data in the selected format
 */
async function exportData(data, format, url) {
    let exportedData;
    let filename;
    let mimeType;
    
    // Handle database export
    if (format === 'database') {
        try {
            const dbType = document.getElementById('dbType').value;
            let connectionConfig = null;
            
            // Prepare connection config based on database type
            switch (dbType) {
                case 'mongodb':
                    const mongoConnectionString = document.getElementById('mongoConnectionString').value;
                    if (!mongoConnectionString) {
                        throw new Error('MongoDB connection string is required');
                    }
                    connectionConfig = { connectionString: mongoConnectionString };
                    break;
                    
                case 'mysql':
                    const host = document.getElementById('mysqlHost').value || 'localhost';
                    const port = document.getElementById('mysqlPort').value || '3306';
                    const user = document.getElementById('mysqlUser').value;
                    const password = document.getElementById('mysqlPassword').value;
                    const database = document.getElementById('mysqlDatabase').value;
                    
                    if (!user || !database) {
                        throw new Error('MySQL username and database name are required');
                    }
                    
                    connectionConfig = {
                        host,
                        port: parseInt(port),
                        user,
                        password,
                        database
                    };
                    break;
                    
                case 'sqlite':
                    // No additional config needed for SQLite
                    break;
                    
                default:
                    throw new Error(`Unsupported database type: ${dbType}`);
            }
            
            // Send data to server for database export
            const response = await fetch('/export-to-db', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url,
                    data,
                    dbType,
                    connectionConfig
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to export to database');
            }
            
            const result = await response.json();
            showStatus(`${result.message} (ID: ${result.id})`, 'success');
            return data;
            
        } catch (error) {
            showStatus(`Database export error: ${error.message}`, 'error');
            throw error;
        }
    }
    
    // Handle file exports
    switch (format) {
        case 'json':
            exportedData = JSON.stringify(data, null, 2);
            filename = 'scraped-data.json';
            mimeType = 'application/json';
            break;
            
        case 'csv':
            exportedData = convertToCSV(data);
            filename = 'scraped-data.csv';
            mimeType = 'text/csv';
            break;
            
        case 'txt':
            exportedData = convertToPlainText(data);
            filename = 'scraped-data.txt';
            mimeType = 'text/plain';
            break;
            
        default:
            throw new Error(`Unsupported export format: ${format}`);
    }
    
    // Create a download link
    const blob = new Blob([exportedData], { type: mimeType });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.click();
    
    // Clean up
    URL.revokeObjectURL(downloadUrl);
    
    return exportedData;
}

/**
 * Preview the scraped results in the UI
 */
function previewResults() {
    if (!scrapedData) return;
    
    const previewElement = document.getElementById('resultPreview');
    let content;
    
    switch (selectedFormat) {
        case 'json':
            content = JSON.stringify(scrapedData, null, 2);
            break;
        case 'csv':
            content = convertToCSV(scrapedData);
            break;
        case 'txt':
            content = convertToPlainText(scrapedData);
            break;
        default:
            content = JSON.stringify(scrapedData, null, 2);
    }
    
    previewElement.textContent = content;
    previewElement.classList.add('visible');
    
    // Scroll to preview
    previewElement.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Set the loading state of the UI
 */
function setLoading(loading) {
    isLoading = loading;
    const scrapeButton = document.getElementById('scrapeButton');
    
    if (loading) {
        scrapeButton.disabled = true;
        scrapeButton.innerHTML = '<span class="loading-spinner"></span> Scraping...';
    } else {
        scrapeButton.disabled = false;
        scrapeButton.innerHTML = '<i class="fas fa-download"></i> Start Scraping';
    }
}

/**
 * Show a status message with the specified type
 */
function showStatus(message, type = 'loading') {
    const statusElement = document.getElementById('statusMessage');
    statusElement.textContent = message;
    statusElement.className = 'status'; // Reset classes
    statusElement.classList.add(type);
}