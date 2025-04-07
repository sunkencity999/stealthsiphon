/**
 * Scheduler UI for Stealth Siphon
 * Provides the user interface for managing scheduled scraping tasks
 */

// Global state
let currentTaskId = null;
let tasks = [];

// DOM Elements
const tasksList = document.getElementById('tasksList');
const taskModal = document.getElementById('taskModal');
const detailsModal = document.getElementById('detailsModal');
const confirmModal = document.getElementById('confirmModal');
const taskForm = document.getElementById('taskForm');
const modalTitle = document.getElementById('modalTitle');
const toastContainer = document.getElementById('toastContainer');

// Initialize the UI when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Load tasks
    loadTasks();
    
    // Setup event listeners
    setupEventListeners();
});

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // New Task button
    document.getElementById('newTaskBtn').addEventListener('click', () => {
        openTaskModal();
    });
    
    // Close modal buttons
    document.getElementById('closeModal').addEventListener('click', () => {
        closeTaskModal();
    });
    
    document.getElementById('closeDetailsModal').addEventListener('click', () => {
        closeDetailsModal();
    });
    
    document.getElementById('closeConfirmModal').addEventListener('click', () => {
        closeConfirmModal();
    });
    
    // Cancel buttons
    document.getElementById('cancelButton').addEventListener('click', () => {
        closeTaskModal();
    });
    
    document.getElementById('cancelConfirmBtn').addEventListener('click', () => {
        closeConfirmModal();
    });
    
    // Task form submission
    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveTask();
    });
    
    // Headless browser checkbox toggle
    document.getElementById('taskHeadlessBrowser').addEventListener('change', (e) => {
        const headlessOptions = document.getElementById('headlessOptions');
        headlessOptions.style.display = e.target.checked ? 'block' : 'none';
    });
    
    // Follow links checkbox toggle
    document.getElementById('taskFollowLinks').addEventListener('change', (e) => {
        const linkOptions = document.getElementById('linkFollowingOptions');
        linkOptions.style.display = e.target.checked ? 'block' : 'none';
    });
    
    // Schedule type toggle
    document.getElementById('scheduleType').addEventListener('change', (e) => {
        const presetOptions = document.getElementById('presetScheduleOptions');
        const customOptions = document.getElementById('customScheduleOptions');
        
        if (e.target.value === 'preset') {
            presetOptions.style.display = 'block';
            customOptions.style.display = 'none';
        } else {
            presetOptions.style.display = 'none';
            customOptions.style.display = 'block';
        }
    });
    
    // Preset schedule type toggle
    document.getElementById('presetSchedule').addEventListener('change', (e) => {
        const dailyOptions = document.getElementById('timeSelectionDaily');
        const weeklyOptions = document.getElementById('weeklyOptions');
        const monthlyOptions = document.getElementById('monthlyOptions');
        
        // Hide all first
        dailyOptions.style.display = 'none';
        weeklyOptions.style.display = 'none';
        monthlyOptions.style.display = 'none';
        
        // Show the relevant options based on selection
        switch (e.target.value) {
            case 'hourly':
                // No additional options needed
                break;
            case 'daily':
            case 'daily-morning':
            case 'daily-evening':
            case 'weekdays':
            case 'weekends':
                dailyOptions.style.display = 'block';
                break;
            case 'weekly':
                weeklyOptions.style.display = 'block';
                break;
            case 'monthly':
                monthlyOptions.style.display = 'block';
                break;
        }
    });
    
    // Edit task button in details modal
    document.getElementById('editTaskBtn').addEventListener('click', () => {
        closeDetailsModal();
        openTaskModal(currentTaskId);
    });
    
    // Run task button in details modal
    document.getElementById('runTaskBtn').addEventListener('click', () => {
        runTask(currentTaskId);
    });
    
    
}

/**
 * Load all tasks from the API
 */
async function loadTasks() {
    try {
        showLoadingIndicator();
        
        const response = await fetch('/api/scheduler/tasks');
        
        if (!response.ok) {
            throw new Error(`Failed to load tasks: ${response.status} ${response.statusText}`);
        }
        
        tasks = await response.json();
        renderTasks();
    } catch (error) {
        console.error('Error loading tasks:', error);
        showToast('Error loading tasks: ' + error.message, 'error');
        renderError('Failed to load tasks. Please try again later.');
    }
}

/**
 * Render the tasks list
 */
function renderTasks() {
    if (!tasks || tasks.length === 0) {
        tasksList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-calendar-times"></i>
                <p>No scheduled tasks found</p>
                <button id="emptyStateNewBtn" class="primary-button">
                    <i class="fas fa-plus"></i> Create Your First Task
                </button>
            </div>
        `;
        
        // Add event listener to the empty state button
        document.getElementById('emptyStateNewBtn')?.addEventListener('click', () => {
            openTaskModal();
        });
        
        return;
    }
    
    // Sort tasks by name
    tasks.sort((a, b) => a.name.localeCompare(b.name));
    
    // Render each task
    tasksList.innerHTML = tasks.map(task => `
        <div class="task-card ${!task.active ? 'inactive' : ''}">
            <div class="task-header">
                <h3 class="task-name">${escapeHtml(task.name)}</h3>
                <div class="task-status">
                    ${task.active ? '<span class="status active">Active</span>' : '<span class="status inactive">Inactive</span>'}
                </div>
            </div>
            
            <div class="task-details">
                <div class="task-url">
                    <i class="fas fa-link"></i> ${escapeHtml(task.url)}
                </div>
                
                <div class="task-schedule">
                    <i class="fas fa-clock"></i> ${escapeHtml(task.schedule)}
                </div>
                
                <div class="task-last-run">
                    <i class="fas fa-history"></i> 
                    ${task.lastRun ? `Last run: ${formatDate(task.lastRun.timestamp)}` : 'Never run'}
                </div>
            </div>
            
            <div class="task-actions">
                <button class="action-btn view-btn" data-id="${task.id}" title="View Details">
                    <i class="fas fa-eye"></i>
                </button>
                
                <button class="action-btn edit-btn" data-id="${task.id}" title="Edit Task">
                    <i class="fas fa-edit"></i>
                </button>
                
                <button class="action-btn run-btn" data-id="${task.id}" title="Run Now">
                    <i class="fas fa-play"></i>
                </button>
                
                <button class="action-btn delete-btn" data-id="${task.id}" title="Delete Task">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    // Add event listeners to task action buttons AFTER they are added to the DOM
    attachTaskActionListeners();
}

/**
 * Attach event listeners to task action buttons
 */
function attachTaskActionListeners() {
    // View button listeners
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-id');
            openDetailsModal(taskId);
        });
    });
    
    // Edit button listeners
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-id');
            openTaskModal(taskId);
        });
    });
    
    // Run button listeners
    document.querySelectorAll('.run-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-id');
            runTask(taskId);
        });
    });
    
    // Delete button listeners
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-id');
            confirmDeleteTask(taskId);
        });
    });
}

/**
 * Show a loading indicator in the tasks list
 */
function showLoadingIndicator() {
    tasksList.innerHTML = `
        <div class="loading-indicator">
            <i class="fas fa-spinner fa-spin"></i> Loading tasks...
        </div>
    `;
}

/**
 * Show an error message in the tasks list
 * @param {string} message - The error message to display
 */
function renderError(message) {
    tasksList.innerHTML = `
        <div class="error-state">
            <p><i class="fas fa-exclamation-triangle"></i> ${message}</p>
            <button id="retryBtn" class="secondary-button">Retry</button>
        </div>
    `;
    
    document.getElementById('retryBtn').addEventListener('click', loadTasks);
}

/**
 * Open the task modal for creating or editing a task
 * @param {string} taskId - The ID of the task to edit (optional)
 */
async function openTaskModal(taskId = null) {
    currentTaskId = taskId;
    
    // Reset form
    taskForm.reset();
    document.getElementById('taskId').value = '';
    document.getElementById('headlessOptions').style.display = 'none';
    document.getElementById('linkFollowingOptions').style.display = 'none';
    
    // Default to preset schedule
    const scheduleType = document.getElementById('scheduleType');
    scheduleType.value = 'preset';
    document.getElementById('presetScheduleOptions').style.display = 'block';
    document.getElementById('customScheduleOptions').style.display = 'none';
    
    // Default to daily schedule
    const presetSchedule = document.getElementById('presetSchedule');
    presetSchedule.value = 'daily';
    document.getElementById('timeSelectionDaily').style.display = 'block';
    document.getElementById('weeklyOptions').style.display = 'none';
    document.getElementById('monthlyOptions').style.display = 'none';
    
    if (taskId) {
        // Edit existing task
        modalTitle.textContent = 'Edit Task';
        const task = tasks.find(t => t.id === taskId);
        
        if (task) {
            document.getElementById('taskId').value = task.id;
            document.getElementById('taskName').value = task.name;
            document.getElementById('taskUrl').value = task.url;
            document.getElementById('taskSelector').value = task.selector || '';
            document.getElementById('taskActive').checked = task.active !== false;
            document.getElementById('taskHeadlessBrowser').checked = task.useHeadlessBrowser || false;
            document.getElementById('taskBypassRobots').checked = task.bypassRobots !== false;
            document.getElementById('taskUserAgent').value = task.userAgent || '';
            document.getElementById('taskOutputFormat').value = task.outputFormat || 'auto';
            
            // Set up schedule display
            if (isPresetSchedule(task.schedule)) {
                scheduleType.value = 'preset';
                document.getElementById('presetScheduleOptions').style.display = 'block';
                document.getElementById('customScheduleOptions').style.display = 'none';
                
                const scheduleInfo = parseScheduleToPreset(task.schedule);
                presetSchedule.value = scheduleInfo.type;
                
                // Set the appropriate time fields
                if (scheduleInfo.time) {
                    document.getElementById('dailyTime').value = scheduleInfo.time;
                    document.getElementById('weeklyTime').value = scheduleInfo.time;
                    document.getElementById('monthlyTime').value = scheduleInfo.time;
                }
                
                if (scheduleInfo.day !== undefined) {
                    if (scheduleInfo.type === 'weekly') {
                        document.getElementById('weeklyDay').value = scheduleInfo.day;
                        document.getElementById('weeklyOptions').style.display = 'block';
                        document.getElementById('timeSelectionDaily').style.display = 'none';
                    } else if (scheduleInfo.type === 'monthly') {
                        document.getElementById('monthlyDay').value = scheduleInfo.day;
                        document.getElementById('monthlyOptions').style.display = 'block';
                        document.getElementById('timeSelectionDaily').style.display = 'none';
                    }
                }
            } else {
                scheduleType.value = 'custom';
                document.getElementById('presetScheduleOptions').style.display = 'none';
                document.getElementById('customScheduleOptions').style.display = 'block';
                document.getElementById('taskSchedule').value = task.schedule;
            }
            
            // Headless browser options
            if (task.useHeadlessBrowser) {
                document.getElementById('headlessOptions').style.display = 'block';
                document.getElementById('taskWaitForSelector').value = task.waitForSelector || '';
                document.getElementById('taskWaitTime').value = task.waitTime || 1000;
                document.getElementById('taskExtractFormat').value = task.extractFormat || 'html';
            }
            
            // Link following options
            if (task.followLinks) {
                document.getElementById('taskFollowLinks').checked = true;
                document.getElementById('linkFollowingOptions').style.display = 'block';
                document.getElementById('taskLinkDepth').value = task.linkDepth || '2';
            }
        }
    } else {
        // Create new task
        modalTitle.textContent = 'Create New Task';
    }
    
    // Show modal
    taskModal.style.display = 'block';
}

/**
 * Close the task modal
 */
function closeTaskModal() {
    taskModal.style.display = 'none';
    currentTaskId = null;
}

/**
 * Save a task (create or update)
 */
async function saveTask() {
    const taskId = document.getElementById('taskId').value;
    const useHeadlessBrowser = document.getElementById('taskHeadlessBrowser').checked;
    const followLinks = document.getElementById('taskFollowLinks').checked;
    const scheduleType = document.getElementById('scheduleType').value;
    
    // Determine the schedule
    let schedule;
    if (scheduleType === 'preset') {
        schedule = buildCronFromPreset();
    } else {
        schedule = document.getElementById('taskSchedule').value;
    }
    
    // Build task object
    const task = {
        name: document.getElementById('taskName').value,
        url: document.getElementById('taskUrl').value,
        schedule: schedule,
        selector: document.getElementById('taskSelector').value || null,
        active: document.getElementById('taskActive').checked,
        useHeadlessBrowser,
        followLinks,
        bypassRobots: document.getElementById('taskBypassRobots').checked,
        userAgent: document.getElementById('taskUserAgent').value || null,
        outputFormat: document.getElementById('taskOutputFormat').value
    };
    
    // Add headless browser options if enabled
    if (useHeadlessBrowser) {
        task.waitForSelector = document.getElementById('taskWaitForSelector').value || null;
        task.waitTime = parseInt(document.getElementById('taskWaitTime').value) || 1000;
        task.extractFormat = document.getElementById('taskExtractFormat').value;
    }
    
    // Add link following options if enabled
    if (followLinks) {
        task.linkDepth = document.getElementById('taskLinkDepth').value;
    }
    
    // Add task ID if editing
    if (taskId) {
        task.id = taskId;
    }
    
    let response;
    
    if (taskId) {
        // Update existing task
        response = await fetch(`/api/scheduler/tasks/${taskId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(task)
        });
    } else {
        // Create new task
        response = await fetch('/api/scheduler/tasks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(task)
        });
    }
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed with status: ${response.status}`);
    }
    
    // Close the modal and reload tasks
    closeTaskModal();
    showToast(`Task ${taskId ? 'updated' : 'created'} successfully`, 'success');
    loadTasks();
}

/**
 * Open the task details modal
 * @param {string} taskId - The ID of the task to view
 */
async function openDetailsModal(taskId) {
    try {
        currentTaskId = taskId;
        
        const task = await getTaskDetails(taskId);
        
        if (!task) {
            showToast('Task not found', 'error');
            return;
        }
        
        // Set the title
        document.getElementById('detailsTitle').textContent = escapeHtml(task.name);
        
        // Build the details HTML
        let detailsHtml = `
            <div class="task-detail-item">
                <div class="task-detail-label">URL</div>
                <div class="task-detail-value">${escapeHtml(task.url)}</div>
            </div>
            
            <div class="task-detail-item">
                <div class="task-detail-label">Schedule</div>
                <div class="task-detail-value"><code>${escapeHtml(task.schedule)}</code></div>
            </div>
            
            <div class="task-detail-item">
                <div class="task-detail-label">Status</div>
                <div class="task-detail-value">
                    <span class="task-status ${task.active ? 'status-active' : 'status-inactive'}">
                        ${task.active ? 'Active' : 'Inactive'}
                    </span>
                </div>
            </div>
        `;
        
        // Add selector if present
        if (task.selector) {
            detailsHtml += `
                <div class="task-detail-item">
                    <div class="task-detail-label">CSS Selector</div>
                    <div class="task-detail-value"><code>${escapeHtml(task.selector)}</code></div>
                </div>
            `;
        }
        
        // Add headless browser info
        detailsHtml += `
            <div class="task-detail-item">
                <div class="task-detail-label">Headless Browser</div>
                <div class="task-detail-value">${task.useHeadlessBrowser ? 'Enabled' : 'Disabled'}</div>
            </div>
        `;
        
        if (task.useHeadlessBrowser) {
            if (task.waitForSelector) {
                detailsHtml += `
                    <div class="task-detail-item">
                        <div class="task-detail-label">Wait for Selector</div>
                        <div class="task-detail-value"><code>${escapeHtml(task.waitForSelector)}</code></div>
                    </div>
                `;
            }
            
            detailsHtml += `
                <div class="task-detail-item">
                    <div class="task-detail-label">Wait Time</div>
                    <div class="task-detail-value">${task.waitTime || 1000} ms</div>
                </div>
                
                <div class="task-detail-item">
                    <div class="task-detail-label">Extract Format</div>
                    <div class="task-detail-value">${task.extractFormat || 'HTML'}</div>
                </div>
            `;
        }
        
        // Add other settings
        detailsHtml += `
            <div class="task-detail-item">
                <div class="task-detail-label">Bypass robots.txt</div>
                <div class="task-detail-value">${task.bypassRobots !== false ? 'Yes' : 'No'}</div>
            </div>
        `;
        
        if (task.userAgent) {
            detailsHtml += `
                <div class="task-detail-item">
                    <div class="task-detail-label">User Agent</div>
                    <div class="task-detail-value">${escapeHtml(task.userAgent)}</div>
                </div>
            `;
        }
        
        // Add task configuration details
        detailsHtml += `
            <div class="task-details">
                <h4>Configuration</h4>
                <ul>
                    <li><strong>URL:</strong> <a href="${escapeHtml(task.url)}" target="_blank">${escapeHtml(task.url)}</a></li>
                    <li><strong>Schedule:</strong> ${escapeHtml(task.schedule)}</li>
                    <li><strong>Active:</strong> ${task.active !== false ? 'Yes' : 'No'}</li>
                    <li><strong>Selector:</strong> ${task.selector ? escapeHtml(task.selector) : 'None'}</li>
                    <li><strong>Headless Browser:</strong> ${task.useHeadlessBrowser ? 'Yes' : 'No'}</li>
                    <li><strong>Output Format:</strong> ${task.outputFormat ? escapeHtml(task.outputFormat) : 'Auto'}</li>
                    <li><strong>Bypass robots.txt:</strong> ${task.bypassRobots !== false ? 'Yes' : 'No'}</li>
                    <li><strong>User Agent:</strong> ${task.userAgent ? escapeHtml(task.userAgent) : 'Random'}</li>
                    ${task.followLinks ? `<li><strong>Follow Links:</strong> Yes (Depth: ${task.linkDepth || 2})</li>` : ''}
                </ul>
            </div>
        `;
        
        // Add last run information if available
        if (task.lastRun) {
            detailsHtml += `
                <div class="last-run-info">
                    <h4>Last Execution</h4>
                    <div class="task-detail-item">
                        <div class="task-detail-label">Time</div>
                        <div class="task-detail-value">${formatDate(task.lastRun.timestamp)}</div>
                    </div>
                    <div class="task-detail-item">
                        <div class="task-detail-label">Status</div>
                        <div class="task-detail-value ${task.lastRun.status === 'success' ? 'status-success' : 'status-error'}">
                            ${task.lastRun.status === 'success' ? 'Success' : 'Error'}
                        </div>
                    </div>
            `;
            
            if (task.lastRun.duration) {
                detailsHtml += `
                    <div class="task-detail-item">
                        <div class="task-detail-label">Duration</div>
                        <div class="task-detail-value">${task.lastRun.duration.toFixed(2)} seconds</div>
                    </div>
                `;
            }
            
            if (task.lastRun.pagesScraped) {
                detailsHtml += `
                    <div class="task-detail-item">
                        <div class="task-detail-label">Pages Scraped</div>
                        <div class="task-detail-value">${task.lastRun.pagesScraped}</div>
                    </div>
                `;
            }
            
            detailsHtml += `</div>`;
            
            if (task.lastRun.outputFile) {
                detailsHtml += `
                    <div class="task-detail-item">
                        <div class="task-detail-label">Output File</div>
                        <div class="task-detail-value">${escapeHtml(task.lastRun.outputFile)}</div>
                    </div>
                `;
            }
            
            if (task.lastRun.error) {
                detailsHtml += `
                    <div class="task-detail-item">
                        <div class="task-detail-label">Error</div>
                        <div class="task-detail-value last-run-error">${escapeHtml(task.lastRun.error)}</div>
                    </div>
                `;
            }
            
            detailsHtml += `</div>`;
        }
        
        // Set the details content
        document.getElementById('taskDetails').innerHTML = detailsHtml;
        
        // Show the modal
        detailsModal.style.display = 'block';
    } catch (error) {
        console.error('Error opening details modal:', error);
        showToast('Error loading task details', 'error');
    }
}

/**
 * Close the details modal
 */
function closeDetailsModal() {
    detailsModal.style.display = 'none';
    currentTaskId = null;
}

/**
 * Confirm task deletion
 * @param {string} taskId - The ID of the task to delete
 */
function confirmDeleteTask(taskId) {
    currentTaskId = taskId;
    
    // Find the task name
    const task = tasks.find(t => t.id === taskId);
    const taskName = task ? task.name : 'this task';
    
    // Set the confirmation message
    document.getElementById('confirmMessage').textContent = `Are you sure you want to delete "${taskName}"?`;
    
    // Set up the confirm button
    const confirmBtn = document.getElementById('confirmActionBtn');
    confirmBtn.textContent = 'Delete';
    confirmBtn.onclick = () => {
        deleteTask(taskId);
    };
    
    // Show the modal
    confirmModal.style.display = 'block';
}

/**
 * Close the confirmation modal
 */
function closeConfirmModal() {
    confirmModal.style.display = 'none';
}

/**
 * Delete a task
 * @param {string} taskId - The ID of the task to delete
 */
async function deleteTask(taskId) {
    try {
        const response = await fetch(`/api/scheduler/tasks/${taskId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to delete task: ${response.status}`);
        }
        
        // Close the modal and reload tasks
        closeConfirmModal();
        showToast('Task deleted successfully', 'success');
        loadTasks();
    } catch (error) {
        console.error('Error deleting task:', error);
        showToast('Error deleting task: ' + error.message, 'error');
    }
}

/**
 * Run a task immediately
 * @param {string} taskId - The ID of the task to run
 */
async function runTask(taskId) {
    try {
        const response = await fetch(`/api/scheduler/tasks/${taskId}/run`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Failed with status: ${response.status}`);
        }
        
        showToast('Task execution triggered successfully', 'success');
        
        // Close the details modal if open
        if (detailsModal.style.display === 'block') {
            closeDetailsModal();
        }
        
        // Reload tasks after a short delay to show updated last run info
        setTimeout(() => {
            loadTasks();
        }, 2000);
    } catch (error) {
        console.error('Error running task:', error);
        showToast('Error running task: ' + error.message, 'error');
    }
}

/**
 * Get details for a specific task
 * @param {string} taskId - The ID of the task to get
 * @returns {Promise<Object>} The task details
 */
async function getTaskDetails(taskId) {
    // First check if we already have the task in our local cache
    const cachedTask = tasks.find(t => t.id === taskId);
    
    if (cachedTask) {
        return cachedTask;
    }
    
    // If not in cache, fetch from API
    const response = await fetch(`/api/scheduler/tasks/${taskId}`);
    
    if (!response.ok) {
        throw new Error(`Failed to get task details: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - The type of toast (success, error, info)
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas fa-${icon}"></i>
        </div>
        <div class="toast-message">${escapeHtml(message)}</div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Remove the toast after 5 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 5000);
}

/**
 * Format a date string
 * @param {string} dateString - The ISO date string to format
 * @returns {string} The formatted date
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    
    const options = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    
    return date.toLocaleDateString('en-US', options);
}

/**
 * Build a cron expression from the preset schedule form
 * @returns {string} The cron expression
 */
function buildCronFromPreset() {
    const presetType = document.getElementById('presetSchedule').value;
    let cronExpression;
    
    switch (presetType) {
        case 'hourly':
            cronExpression = '0 * * * *'; // At minute 0 of every hour
            break;
            
        case 'daily':
            const dailyTime = document.getElementById('dailyTime').value;
            const [dailyHour, dailyMinute] = dailyTime.split(':');
            cronExpression = `${dailyMinute} ${dailyHour} * * *`;
            break;
            
        case 'daily-morning':
            cronExpression = '0 9 * * *'; // Every day at 9:00 AM
            break;
            
        case 'daily-evening':
            cronExpression = '0 18 * * *'; // Every day at 6:00 PM
            break;
            
        case 'weekdays':
            const weekdayTime = document.getElementById('dailyTime').value;
            const [weekdayHour, weekdayMinute] = weekdayTime.split(':');
            cronExpression = `${weekdayMinute} ${weekdayHour} * * 1-5`; // Monday-Friday
            break;
            
        case 'weekends':
            const weekendTime = document.getElementById('dailyTime').value;
            const [weekendHour, weekendMinute] = weekendTime.split(':');
            cronExpression = `${weekendMinute} ${weekendHour} * * 0,6`; // Sunday,Saturday
            break;
            
        case 'weekly':
            const weeklyTime = document.getElementById('weeklyTime').value;
            const [weeklyHour, weeklyMinute] = weeklyTime.split(':');
            const weeklyDay = document.getElementById('weeklyDay').value;
            cronExpression = `${weeklyMinute} ${weeklyHour} * * ${weeklyDay}`;
            break;
            
        case 'monthly':
            const monthlyTime = document.getElementById('monthlyTime').value;
            const [monthlyHour, monthlyMinute] = monthlyTime.split(':');
            const monthlyDay = document.getElementById('monthlyDay').value;
            
            if (monthlyDay === 'L') {
                cronExpression = `${monthlyMinute} ${monthlyHour} L * *`; // Last day of month
            } else {
                cronExpression = `${monthlyMinute} ${monthlyHour} ${monthlyDay} * *`;
            }
            break;
            
        default:
            cronExpression = '0 0 * * *'; // Default: daily at midnight
    }
    
    return cronExpression;
}

/**
 * Check if a cron expression matches one of our preset patterns
 * @param {string} cronExpression - The cron expression to check
 * @returns {boolean} True if it matches a preset pattern
 */
function isPresetSchedule(cronExpression) {
    // Common preset patterns
    const presetPatterns = [
        /^0 \* \* \* \*$/, // hourly
        /^\d{1,2} \d{1,2} \* \* \*$/, // daily at specific time
        /^0 9 \* \* \*$/, // daily morning
        /^0 18 \* \* \*$/, // daily evening
        /^\d{1,2} \d{1,2} \* \* [1-5]$/, // weekday
        /^\d{1,2} \d{1,2} \* \* 0,6$/, // weekend
        /^\d{1,2} \d{1,2} \* \* [0-6]$/, // weekly
        /^\d{1,2} \d{1,2} (?:\d{1,2}|L) \* \*$/ // monthly
    ];
    
    return presetPatterns.some(pattern => pattern.test(cronExpression));
}

/**
 * Parse a cron expression into a preset schedule configuration
 * @param {string} cronExpression - The cron expression to parse
 * @returns {Object} The schedule configuration
 */
function parseScheduleToPreset(cronExpression) {
    const parts = cronExpression.split(' ');
    const minute = parts[0];
    const hour = parts[1];
    const dayOfMonth = parts[2];
    const dayOfWeek = parts[4];
    
    // Format time as HH:MM
    const formatTime = (h, m) => {
        return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    };
    
    // Hourly
    if (cronExpression === '0 * * * *') {
        return { type: 'hourly' };
    }
    
    // Daily at specific times
    if (cronExpression === '0 9 * * *') {
        return { type: 'daily-morning', time: '09:00' };
    }
    
    if (cronExpression === '0 18 * * *') {
        return { type: 'daily-evening', time: '18:00' };
    }
    
    // Weekdays
    if (dayOfWeek === '1-5') {
        return { 
            type: 'weekdays', 
            time: formatTime(hour, minute)
        };
    }
    
    // Weekends
    if (dayOfWeek === '0,6') {
        return { 
            type: 'weekends', 
            time: formatTime(hour, minute)
        };
    }
    
    // Weekly
    if (/^\d{1,2} \d{1,2} \* \* [0-6]$/.test(cronExpression)) {
        return { 
            type: 'weekly', 
            day: dayOfWeek,
            time: formatTime(hour, minute)
        };
    }
    
    // Monthly
    if (/^\d{1,2} \d{1,2} (?:\d{1,2}|L) \* \*$/.test(cronExpression)) {
        return { 
            type: 'monthly', 
            day: dayOfMonth,
            time: formatTime(hour, minute)
        };
    }
    
    // Default: assume it's a daily schedule
    return { 
        type: 'daily', 
        time: formatTime(hour, minute)
    };
}

/**
 * Escape HTML special characters
 * @param {string} str - The string to escape
 * @returns {string} The escaped string
 */
function escapeHtml(str) {
    if (!str) return '';
    
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
