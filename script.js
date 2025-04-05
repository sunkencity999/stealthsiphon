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
function prepareRequestUrl(originalUrl, useProxy, proxyUrl, proxyApiKey, userAgent, bypassRobots) {
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
    // Try to use a few different approaches that might work for some sites
    
    // 1. Try direct fetch (will only work for CORS-enabled sites)
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': userAgent
            },
            mode: 'no-cors' // This allows the request but limits access to the response
        });
        
        // With no-cors we can't actually read the response, but we can check if it succeeded
        if (response.type === 'opaque') {
            return {
                success: true,
                message: 'Request succeeded but content is opaque due to CORS restrictions',
                limited: true
            };
        }
    } catch (error) {
        console.log('Direct fetch failed:', error);
    }
    
    // 2. Try using our built-in proxy first, then alternative public proxies
    const alternativeProxies = [
        `/proxy?url=${encodeURIComponent(url)}&userAgent=${encodeURIComponent(userAgent)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];
    
    for (const proxyUrl of alternativeProxies) {
        try {
            const response = await fetch(proxyUrl);
            if (response.ok) {
                const text = await response.text();
                return {
                    success: true,
                    content: text,
                    limited: false
                };
            }
        } catch (error) {
            console.log(`Alternative proxy ${proxyUrl} failed:`, error);
        }
    }
    
    // 3. If all else fails, inform the user
    return {
        success: false,
        message: 'All fallback methods failed. Please try using a different proxy service or request CORS Anywhere access.',
        limited: true
    };
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
    const extractLinks = document.getElementById('extractLinks').checked;
    const extractImages = document.getElementById('extractImages').checked;
    const extractText = document.getElementById('extractText').checked;
    const followLinks = document.getElementById('followLinks').checked;
    
    // Get countermeasure options
    const bypassRobots = document.getElementById('bypassRobots').checked;
    const rotateUserAgent = document.getElementById('rotateUserAgent').checked;
    const customUserAgent = document.getElementById('userAgentInput').value;
    const useProxy = document.getElementById('useProxy').checked;
    const proxyUrl = document.getElementById('proxyInput').value;
    const proxyApiKey = document.getElementById('proxyApiKey').value;
    const useDelay = document.getElementById('useDelay').checked;
    const delayMs = useDelay ? parseInt(document.getElementById('delayInput').value) : 0;
    const useFallbackMethod = document.getElementById('useFallbackMethod').checked;
    
    // Get effective user agent
    const effectiveUserAgent = getEffectiveUserAgent(customUserAgent, rotateUserAgent);
    
    // Update UI to loading state
    setLoading(true);
    showStatus('Scraping in progress... This may take a moment.', 'loading');
    
    try {
        let html;
        let usedFallback = false;
        let fallbackLimited = false;
        
        // Prepare the request URL with proxy if needed
        const requestUrl = prepareRequestUrl(url, useProxy, proxyUrl, proxyApiKey, effectiveUserAgent, bypassRobots);
        
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
                if (useFallbackMethod && (response.status === 403 || response.status === 429)) {
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
        } catch (primaryError) {
            // If fallback is enabled, try it
            if (useFallbackMethod) {
                showStatus('Primary request failed. Trying fallback methods...', 'loading');
                console.log('Primary request failed, trying fallback:', primaryError);
                
                const fallbackResult = await fallbackFetch(url, effectiveUserAgent);
                
                if (fallbackResult.success) {
                    usedFallback = true;
                    fallbackLimited = fallbackResult.limited;
                    
                    if (fallbackResult.limited) {
                        showStatus('Using limited fallback mode. Some features may not work.', 'loading');
                        // For limited mode, we'll create a simple HTML document with a message
                        html = `<html><body><h1>Limited Access Mode</h1><p>The content was fetched in limited mode due to CORS restrictions.</p></body></html>`;
                    } else {
                        html = fallbackResult.content;
                    }
                } else {
                    // If fallback also failed, re-throw the original error
                    throw primaryError;
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
        
        // Create the appropriate file format
        let fileContent;
        let mimeType;
        
        switch (selectedFormat) {
            case 'json':
                fileContent = JSON.stringify(scrapedData, null, 2);
                mimeType = 'application/json';
                break;
            case 'csv':
                fileContent = convertToCSV(scrapedData);
                mimeType = 'text/csv';
                break;
            case 'txt':
                fileContent = convertToPlainText(scrapedData);
                mimeType = 'text/plain';
                break;
            default:
                fileContent = JSON.stringify(scrapedData, null, 2);
                mimeType = 'application/json';
        }
        
        // Create a Blob from the content
        const blob = new Blob([fileContent], { type: mimeType });
        const downloadLink = document.getElementById('downloadLink');
        const blobUrl = URL.createObjectURL(blob);

        // Set the href attribute to the Blob URL
        downloadLink.href = blobUrl;
        downloadLink.download = `scraped_data.${selectedFormat}`;
        
        // Show the download section
        document.getElementById('downloadSection').classList.add('visible');
        
        // Enable preview button
        document.getElementById('previewButton').disabled = false;
        
        // Show success message
        showStatus('Scraping completed successfully!', 'success');

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