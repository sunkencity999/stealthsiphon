const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const mongoose = require('mongoose');
const mysql = require('mysql2/promise');
const headlessBrowser = require('./headless-browser');
const scheduler = require('./scheduler');
const app = express();
const PORT = process.env.PORT || 4200;

// Database connections
let sqliteDb = null;
let mongoConnection = null;
let mysqlConnection = null;

// Initialize SQLite database
function initSqliteDb() {
    if (!sqliteDb) {
        console.log('Initializing SQLite database...');
        sqliteDb = new sqlite3.Database('./scraped_data.db', (err) => {
            if (err) {
                console.error('SQLite database connection error:', err.message);
            } else {
                console.log('Connected to SQLite database');
                // Create table if it doesn't exist
                sqliteDb.run(`CREATE TABLE IF NOT EXISTS scraped_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT,
                    data TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
            }
        });
    }
    return sqliteDb;
}

// Initialize MongoDB connection
async function initMongoDb(connectionString) {
    if (!mongoConnection) {
        try {
            console.log('Initializing MongoDB connection...');
            await mongoose.connect(connectionString, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
            console.log('Connected to MongoDB');
            
            // Define schema and model
            const scrapedDataSchema = new mongoose.Schema({
                url: String,
                data: mongoose.Schema.Types.Mixed,
                timestamp: { type: Date, default: Date.now }
            });
            
            // Create model if it doesn't exist
            if (!mongoose.models.ScrapedData) {
                mongoose.model('ScrapedData', scrapedDataSchema);
            }
            
            mongoConnection = mongoose.connection;
        } catch (error) {
            console.error('MongoDB connection error:', error);
            throw error;
        }
    }
    return mongoConnection;
}

// Initialize MySQL connection
async function initMySqlDb(config) {
    if (!mysqlConnection) {
        try {
            console.log('Initializing MySQL connection...');
            mysqlConnection = await mysql.createConnection(config);
            console.log('Connected to MySQL');
            
            // Create table if it doesn't exist
            await mysqlConnection.execute(`
                CREATE TABLE IF NOT EXISTS scraped_data (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    url VARCHAR(255),
                    data LONGTEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        } catch (error) {
            console.error('MySQL connection error:', error);
            throw error;
        }
    }
    return mysqlConnection;
}

// Initialize headless browser on startup
headlessBrowser.initBrowser().catch(err => {
    console.error('Error initializing headless browser at startup:', err);
    // Continue running the server even if browser init fails
});

// Close browser on process exit
process.on('exit', async () => {
    await headlessBrowser.closeBrowser();
    console.log('Headless browser closed');
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    await headlessBrowser.closeBrowser();
    console.log('Headless browser closed');
    process.exit(0);
});

// Enable CORS for all routes
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Serve static files from the current directory
app.use(express.static(__dirname));

// Standard proxy endpoint (using axios)
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
            timeout: 30000  // 30 second timeout
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

// Headless browser proxy endpoint (using our improved implementation)
app.get('/headless-proxy', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    // Get optional parameters
    const userAgent = req.query.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    const waitForSelector = req.query.waitForSelector || 'body';
    const waitTime = parseInt(req.query.waitTime) || 0;
    const fullPage = req.query.fullPage === 'true';
    const extractFormat = req.query.extractFormat || 'html'; // html, text, or screenshot
    const screenshotFormat = req.query.screenshotFormat || 'png'; // png or jpeg
    const bypassRobots = req.query.bypassRobots === 'true';
    
    // Call our headless browser service
    const result = await headlessBrowser.scrapeWithHeadlessBrowser({
        url,
        userAgent,
        waitForSelector,
        waitTime,
        fullPage,
        extractFormat,
        screenshotFormat,
        bypassRobots,
        timeout: 30000
    });
    
    if (result.success) {
        // Set the appropriate content type header
        res.setHeader('Content-Type', result.contentType);
        
        // Send the content
        res.send(result.content);
        console.log(`Successfully scraped ${url} with headless browser`);
    } else {
        // Return error details
        console.error(`Headless proxy error for ${url}:`, result.error.message);
        
        return res.status(500).json({
            error: 'Headless Browser Error',
            message: result.error.message,
            stack: result.error.stack,
            url: url
        });
    }
});

// Database export endpoint
app.post('/export-to-db', express.json(), async (req, res) => {
    const { url, data, dbType, connectionConfig } = req.body;
    
    if (!url || !data) {
        return res.status(400).json({ error: 'URL and data are required' });
    }
    
    if (!dbType) {
        return res.status(400).json({ error: 'Database type is required' });
    }
    
    try {
        let result;
        
        switch (dbType) {
            case 'sqlite':
                // Initialize SQLite
                const db = initSqliteDb();
                
                // Insert data
                result = await new Promise((resolve, reject) => {
                    const stmt = db.prepare('INSERT INTO scraped_data (url, data) VALUES (?, ?)');
                    stmt.run(url, JSON.stringify(data), function(err) {
                        if (err) reject(err);
                        else resolve({ id: this.lastID });
                    });
                    stmt.finalize();
                });
                
                return res.json({
                    success: true,
                    message: 'Data exported to SQLite successfully',
                    id: result.id
                });
                
            case 'mongodb':
                if (!connectionConfig || !connectionConfig.connectionString) {
                    return res.status(400).json({ error: 'MongoDB connection string is required' });
                }
                
                // Initialize MongoDB
                await initMongoDb(connectionConfig.connectionString);
                
                // Insert data
                const ScrapedData = mongoose.model('ScrapedData');
                const newData = new ScrapedData({
                    url,
                    data
                });
                
                result = await newData.save();
                
                return res.json({
                    success: true,
                    message: 'Data exported to MongoDB successfully',
                    id: result._id
                });
                
            case 'mysql':
                if (!connectionConfig) {
                    return res.status(400).json({ error: 'MySQL connection config is required' });
                }
                
                // Initialize MySQL
                const mysqlConn = await initMySqlDb(connectionConfig);
                
                // Insert data
                const [rows] = await mysqlConn.execute(
                    'INSERT INTO scraped_data (url, data) VALUES (?, ?)',
                    [url, JSON.stringify(data)]
                );
                
                return res.json({
                    success: true,
                    message: 'Data exported to MySQL successfully',
                    id: rows.insertId
                });
                
            default:
                return res.status(400).json({ error: 'Unsupported database type' });
        }
    } catch (error) {
        console.error(`Database export error:`, error.message);
        return res.status(500).json({
            error: 'Database Export Error',
            message: error.message
        });
    }
});

// Scheduler API endpoints

// Scrape with headless browser
app.post('/api/scrape/headless', async (req, res) => {
    try {
        const result = await headlessBrowser.scrapeWithHeadlessBrowser(req.body);
        res.json(result);
    } catch (error) {
        console.error('Error in headless scraping:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Scrape with link following (deep scraping)
app.post('/api/scrape/deep', async (req, res) => {
    try {
        const { url, depth = 2, ...options } = req.body;
        
        // Limit depth to a reasonable value (1-3)
        const safeDepth = Math.min(Math.max(parseInt(depth) || 1, 1), 3);
        
        const results = await headlessBrowser.followLinksAndScrape(url, safeDepth, options);
        res.json({ success: true, results });
    } catch (error) {
        console.error('Error in deep scraping:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all scheduled tasks
app.get('/api/scheduler/tasks', (req, res) => {
    try {
        const tasks = scheduler.getAllTasks();
        res.json(tasks);
    } catch (error) {
        console.error('Error getting tasks:', error);
        res.status(500).json({ error: 'Failed to get tasks', message: error.message });
    }
});

// Get a specific task
app.get('/api/scheduler/tasks/:id', (req, res) => {
    try {
        const task = scheduler.getTask(req.params.id);
        
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        
        res.json(task);
    } catch (error) {
        console.error(`Error getting task ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to get task', message: error.message });
    }
});

// Create a new scheduled task
app.post('/api/scheduler/tasks', (req, res) => {
    try {
        const taskConfig = req.body;
        
        // Validate required fields
        if (!taskConfig.name || !taskConfig.url || !taskConfig.schedule) {
            return res.status(400).json({ error: 'Missing required fields: name, url, schedule' });
        }
        
        const task = scheduler.scheduleTask(taskConfig);
        res.status(201).json(task);
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({ error: 'Failed to create task', message: error.message });
    }
});

// Update an existing task
app.put('/api/scheduler/tasks/:id', (req, res) => {
    try {
        const updates = req.body;
        const updatedTask = scheduler.updateTask(req.params.id, updates);
        
        if (!updatedTask) {
            return res.status(404).json({ error: 'Task not found' });
        }
        
        res.json(updatedTask);
    } catch (error) {
        console.error(`Error updating task ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to update task', message: error.message });
    }
});

// Delete a task
app.delete('/api/scheduler/tasks/:id', (req, res) => {
    try {
        const success = scheduler.deleteTask(req.params.id);
        
        if (!success) {
            return res.status(404).json({ error: 'Task not found' });
        }
        
        res.status(204).end();
    } catch (error) {
        console.error(`Error deleting task ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete task', message: error.message });
    }
});

// Run a task immediately
app.post('/api/scheduler/tasks/:id/run', (req, res) => {
    try {
        const success = scheduler.runTaskNow(req.params.id);
        
        if (!success) {
            return res.status(404).json({ error: 'Task not found' });
        }
        
        res.json({ message: 'Task execution triggered' });
    } catch (error) {
        console.error(`Error running task ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to run task', message: error.message });
    }
});

// Serve the main HTML file as a catch-all route (must be after all API routes)
app.get('*', (req, res) => {
    // Check if the request is for a file that exists
    const filePath = path.join(__dirname, req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.sendFile(filePath);
    } else {
        // Default to index.html for the SPA
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Stealth Siphon server running on http://localhost:${PORT}`);
    console.log(`Access the proxy via http://localhost:${PORT}/proxy?url=https://example.com`);
    console.log(`Access the headless browser via http://localhost:${PORT}/headless-proxy?url=https://example.com`);
    console.log(`Scheduler API available at http://localhost:${PORT}/api/scheduler/tasks`);
});
