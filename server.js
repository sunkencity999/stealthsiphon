const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files from the current directory
app.use(express.static(__dirname));

// Proxy endpoint
app.get('/proxy', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    try {
        // Get optional parameters
        const userAgent = req.query.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
        const bypassRobots = req.query.bypassRobots === 'true';
        
        // Set up request headers
        const headers = {
            'User-Agent': userAgent
        };
        
        // Add headers to bypass robots.txt if requested
        if (bypassRobots) {
            headers['X-Robots-Tag'] = 'noindex';
            headers['From'] = 'friendly-bot@example.com';
        }
        
        // Make the request to the target URL
        const response = await axios({
            method: 'GET',
            url: url,
            headers: headers,
            responseType: 'arraybuffer',  // Handle binary data properly
            timeout: 10000  // 10 second timeout
        });
        
        // Set response headers based on the target response
        const contentType = response.headers['content-type'] || 'text/plain';
        res.setHeader('Content-Type', contentType);
        
        // Return the response data
        res.send(response.data);
        
    } catch (error) {
        console.error(`Proxy error for ${url}:`, error.message);
        
        // Send a more detailed error response
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            return res.status(error.response.status).json({
                error: `Target server responded with ${error.response.status}`,
                message: error.message,
                statusText: error.response.statusText
            });
        } else if (error.request) {
            // The request was made but no response was received
            return res.status(504).json({
                error: 'Gateway Timeout',
                message: 'No response received from target server',
                details: error.message
            });
        } else {
            // Something happened in setting up the request that triggered an Error
            return res.status(500).json({
                error: 'Internal Server Error',
                message: error.message
            });
        }
    }
});

// Fallback route to serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Stealth Siphon server running on http://localhost:${PORT}`);
    console.log(`Access the proxy via http://localhost:${PORT}/proxy?url=https://example.com`);
});
