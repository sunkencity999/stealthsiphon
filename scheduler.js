/**
 * Scheduler Module for Stealth Siphon
 * Provides functionality for scheduling recurring scraping tasks
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const headlessBrowser = require('./headless-browser');

// Store for active scheduled tasks
const scheduledTasks = new Map();

// Directory for storing scheduled task configurations
const TASKS_DIR = path.join(__dirname, 'scheduled_tasks');

// Ensure the tasks directory exists
if (!fs.existsSync(TASKS_DIR)) {
    fs.mkdirSync(TASKS_DIR, { recursive: true });
}

/**
 * Load all saved scheduled tasks from disk
 */
function loadScheduledTasks() {
    try {
        if (!fs.existsSync(TASKS_DIR)) return;
        
        const files = fs.readdirSync(TASKS_DIR);
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const taskConfig = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, file), 'utf8'));
                    scheduleTask(taskConfig, false); // Don't save again when loading
                    console.log(`Loaded scheduled task: ${taskConfig.name} (${taskConfig.id})`);
                } catch (err) {
                    console.error(`Error loading task from ${file}:`, err);
                }
            }
        }
        
        console.log(`Loaded ${scheduledTasks.size} scheduled tasks`);
    } catch (err) {
        console.error('Error loading scheduled tasks:', err);
    }
}

/**
 * Save a task configuration to disk
 * @param {Object} taskConfig - The task configuration
 */
function saveTaskConfig(taskConfig) {
    try {
        if (!fs.existsSync(TASKS_DIR)) {
            fs.mkdirSync(TASKS_DIR, { recursive: true });
        }
        
        fs.writeFileSync(
            path.join(TASKS_DIR, `${taskConfig.id}.json`),
            JSON.stringify(taskConfig, null, 2),
            'utf8'
        );
        
        console.log(`Saved task configuration: ${taskConfig.name} (${taskConfig.id})`);
    } catch (err) {
        console.error('Error saving task configuration:', err);
    }
}

/**
 * Delete a task configuration from disk
 * @param {string} taskId - The ID of the task to delete
 */
function deleteTaskConfig(taskId) {
    try {
        const filePath = path.join(TASKS_DIR, `${taskId}.json`);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted task configuration: ${taskId}`);
        }
    } catch (err) {
        console.error(`Error deleting task configuration ${taskId}:`, err);
    }
}

/**
 * Schedule a new scraping task
 * @param {Object} taskConfig - The task configuration
 * @param {boolean} save - Whether to save the task configuration to disk
 * @returns {Object} The scheduled task information
 */
function scheduleTask(taskConfig, save = true) {
    // Generate a unique ID if not provided
    if (!taskConfig.id) {
        taskConfig.id = uuidv4();
    }
    
    // Validate the cron expression
    if (!cron.validate(taskConfig.schedule)) {
        throw new Error(`Invalid cron expression: ${taskConfig.schedule}`);
    }
    
    // Stop any existing task with the same ID
    if (scheduledTasks.has(taskConfig.id)) {
        scheduledTasks.get(taskConfig.id).task.stop();
        console.log(`Stopped existing task: ${taskConfig.id}`);
    }
    
    // Create a new scheduled task
    const task = cron.schedule(taskConfig.schedule, async () => {
        console.log(`Running scheduled task: ${taskConfig.name} (${taskConfig.id})`);
        
        try {
            // Record the start time
            const startTime = new Date();
            
            // Execute the task
            const result = await executeTask(taskConfig);
            
            // Record the end time
            const endTime = new Date();
            const duration = (endTime - startTime) / 1000; // in seconds
            
            // Save the result
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            const outputDir = path.join(__dirname, 'scheduled_results', taskConfig.id);
            
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            // Determine file extension based on output format preference
            let fileExtension = 'html';
            
            if (taskConfig.outputFormat && taskConfig.outputFormat !== 'auto') {
                // Use the explicitly specified format
                fileExtension = taskConfig.outputFormat;
            } else {
                // Auto-detect based on content type
                if (taskConfig.extractFormat === 'text') {
                    fileExtension = 'txt';
                } else if (taskConfig.extractFormat === 'screenshot') {
                    fileExtension = 'png';
                } else if (result.followedLinks) {
                    fileExtension = 'json';
                }
            }
            
            const outputFile = path.join(outputDir, `${timestamp}.${fileExtension}`);
            
            // Save the result content
            let contentToSave = result.content;
            if (typeof contentToSave === 'string') {
                fs.writeFileSync(outputFile, contentToSave, 'utf8');
            } else if (Buffer.isBuffer(contentToSave)) {
                fs.writeFileSync(outputFile, contentToSave);
            } else {
                fs.writeFileSync(outputFile, JSON.stringify(contentToSave, null, 2), 'utf8');
            }
            
            // Update the task's last run information
            taskConfig.lastRun = {
                timestamp: endTime.toISOString(),
                duration,
                status: 'success',
                outputFile,
                pagesScraped: result.pagesScraped || 1
            };
            
            console.log(`Task ${taskConfig.id} completed successfully in ${duration}s`);
            
            // Save the updated task configuration
            if (save) {
                saveTaskConfig(taskConfig);
            }
        } catch (error) {
            console.error(`Error running scheduled task ${taskConfig.id}:`, error);
            
            // Update the task's last run information with the error
            taskConfig.lastRun = {
                timestamp: new Date().toISOString(),
                status: 'error',
                error: error.message
            };
            
            // Save the updated task configuration
            if (save) {
                saveTaskConfig(taskConfig);
            }
        }
    }, {
        scheduled: taskConfig.active !== false
    });
    
    // Store the task in the map
    scheduledTasks.set(taskConfig.id, {
        config: taskConfig,
        task
    });
    
    // Save the task configuration to disk
    if (save) {
        saveTaskConfig(taskConfig);
    }
    
    return {
        id: taskConfig.id,
        name: taskConfig.name,
        url: taskConfig.url,
        schedule: taskConfig.schedule,
        active: taskConfig.active !== false
    };
}

/**
 * Get all scheduled tasks
 * @returns {Array} Array of task configurations
 */
function getAllTasks() {
    const tasks = [];
    
    for (const [id, { config }] of scheduledTasks.entries()) {
        tasks.push({
            id,
            name: config.name,
            url: config.url,
            schedule: config.schedule,
            active: config.active !== false,
            lastRun: config.lastRun
        });
    }
    
    return tasks;
}

/**
 * Get a specific task by ID
 * @param {string} taskId - The ID of the task to retrieve
 * @returns {Object|null} The task configuration or null if not found
 */
function getTask(taskId) {
    if (scheduledTasks.has(taskId)) {
        return scheduledTasks.get(taskId).config;
    }
    
    return null;
}

/**
 * Update an existing task
 * @param {string} taskId - The ID of the task to update
 * @param {Object} updates - The updates to apply to the task
 * @returns {Object|null} The updated task or null if not found
 */
function updateTask(taskId, updates) {
    if (!scheduledTasks.has(taskId)) {
        return null;
    }
    
    const { config, task } = scheduledTasks.get(taskId);
    
    // Apply updates
    Object.assign(config, updates);
    
    // If the schedule changed, we need to recreate the task
    if (updates.schedule || updates.active !== undefined) {
        task.stop();
        return scheduleTask(config);
    }
    
    // Save the updated configuration
    saveTaskConfig(config);
    
    return config;
}

/**
 * Delete a scheduled task
 * @param {string} taskId - The ID of the task to delete
 * @returns {boolean} Whether the task was successfully deleted
 */
function deleteTask(taskId) {
    if (!scheduledTasks.has(taskId)) {
        return false;
    }
    
    // Stop the task
    scheduledTasks.get(taskId).task.stop();
    
    // Remove from the map
    scheduledTasks.delete(taskId);
    
    // Delete the configuration file
    deleteTaskConfig(taskId);
    
    return true;
}

/**
 * Run a task immediately (outside of its schedule)
 * @param {string} taskId - The ID of the task to run
 * @returns {boolean} Whether the task was successfully triggered
 */
function runTaskNow(taskId) {
    if (!scheduledTasks.has(taskId)) {
        return false;
    }
    
    // Get the task and execute it
    const { task } = scheduledTasks.get(taskId);
    task.now();
    
    return true;
}

/**
 * Execute a scheduled task
 * @param {Object} taskConfig - The task configuration
 * @returns {Promise<Object>} - The result of the task execution
 */
async function executeTask(taskConfig) {
    console.log(`Executing task: ${taskConfig.name}`);
    
    try {
        let result;
        
        // Check if we should follow links
        if (taskConfig.followLinks) {
            console.log(`Task ${taskConfig.name} is configured to follow links with depth ${taskConfig.linkDepth || 2}`);
            
            // Use headless browser with link following
            const crawlResults = await headlessBrowser.followLinksAndScrape(
                taskConfig.url, 
                parseInt(taskConfig.linkDepth || 2),
                {
                    selector: taskConfig.selector,
                    waitForSelector: taskConfig.waitForSelector,
                    waitTime: taskConfig.waitTime,
                    extractFormat: taskConfig.extractFormat || 'html',
                    bypassRobots: taskConfig.bypassRobots !== false,
                    userAgent: taskConfig.userAgent || getRandomUserAgent()
                }
            );
            
            // Format the result to match our expected structure
            result = {
                success: true,
                content: crawlResults,
                url: taskConfig.url,
                followedLinks: true,
                linkDepth: taskConfig.linkDepth || 2,
                pagesScraped: Object.keys(crawlResults).length,
                timestamp: new Date().toISOString()
            };
        } else if (taskConfig.useHeadlessBrowser) {
            // Use headless browser for scraping
            const browserResult = await headlessBrowser.scrapeWithHeadlessBrowser({
                url: taskConfig.url,
                selector: taskConfig.selector,
                waitForSelector: taskConfig.waitForSelector,
                waitTime: taskConfig.waitTime,
                extractFormat: taskConfig.extractFormat,
                bypassRobots: taskConfig.bypassRobots !== false,
                userAgent: taskConfig.userAgent
            });
            
            result = browserResult;
        } else {
            // Use basic HTTP request for scraping
            const response = await axios.get(taskConfig.url, {
                headers: {
                    'User-Agent': taskConfig.userAgent || getRandomUserAgent()
                }
            });
            
            let content = response.data;
            
            // Extract content based on selector if provided
            if (taskConfig.selector && typeof content === 'string') {
                const $ = cheerio.load(content);
                const selected = $(taskConfig.selector);
                
                if (selected.length > 0) {
                    content = selected.map((i, el) => $(el).html()).get().join('\n');
                }
            }
            
            result = {
                success: true,
                content,
                url: taskConfig.url,
                timestamp: new Date().toISOString()
            };
        }
        
        return result;
    } catch (error) {
        console.error(`Error executing task ${taskConfig.name}:`, error);
        return {
            success: false,
            error: error.message,
            url: taskConfig.url,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Get a random user agent string
 * @returns {string} A random user agent string
 */
function getRandomUserAgent() {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Load any saved tasks when the module is initialized
loadScheduledTasks();

module.exports = {
    scheduleTask,
    getAllTasks,
    getTask,
    updateTask,
    deleteTask,
    runTaskNow
};
