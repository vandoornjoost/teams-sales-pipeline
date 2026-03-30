// Sales Pipeline App - SharePoint Version
let currentUser = {
    name: 'Joost van Doorn',
    role: 'admin'
};

let currentView = 'dashboard';
let currentPipelineFilter = '';

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded, initializing SharePoint app...');
    
    // Initialize Microsoft Teams
    await initializeTeams();
    
    // Setup navigation
    setupNavigation();
    
    // Load initial data
    await loadDashboardData();
    
    // Setup event listeners
    setupEventListeners();
    
    // Set user info
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userInitials').textContent = getInitials(currentUser.name);
});

// Initialize Microsoft Teams SDK
async function initializeTeams() {
    if (typeof microsoftTeams !== 'undefined') {
        return new Promise((resolve) => {
            microsoftTeams.initialize(() => {
                microsoftTeams.getContext((context) => {
                    console.log('Teams context:', context);
                    // Update current user from Teams context
                    if (context.userPrincipalName) {
                        currentUser.name = context.upn || context.userPrincipalName;
                    }
                    resolve(context);
                });
            });
        });
    }
    return null;
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

// Navigation
function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const view = this.getAttribute('data-view');
            switchView(view);
        });
    });
}

function switchView(view) {
    currentView = view;
    
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.add('d-none'));
    
    // Show selected view
    document.getElementById(`${view}View`).classList.remove('d-none');
    
    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-view') === view) {
            link.classList.add('active');
        }
    });
    
    // Load view-specific data
    switch(view) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'kanban':
            loadKanbanBoard();
            break;
        case 'list':
            loadDealList();
            break;
        case 'reports':
            loadReports();
            break;
    }
}

// SharePoint API calls
async function fetchFromSharePoint(endpoint, options = {}) {
    const siteUrl = 'https://mpindustriesou.sharepoint.com/sites/SalesPipelineApp2';
    const url = `${siteUrl}/_api/web/${endpoint}`;
    
    const headers = {
        'Accept': 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose'
    };
    
    // Get auth token from Teams
    if (typeof microsoftTeams !== 'undefined') {
        const token = await getAuthToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
    }
    
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...headers,
                ...options.headers
            }
        });
        
        if (!response.ok) {
            throw new Error(`SharePoint error: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.d || data;
    } catch (error) {
        console.error('SharePoint API error:', error);
        // Fallback to mock data for development
        return getMockData(endpoint);
    }
}

async function getAuthToken() {
    if (typeof microsoftTeams !== 'undefined') {
        return new Promise((resolve) => {
            microsoftTeams.authentication.getAuthToken({
                successCallback: (token) => resolve(token),
                failureCallback: () => resolve(null)
            });
        });
    }
    return null;
}

// Dashboard functions
async function loadDashboardData() {
    try {
        // Get deals from SharePoint
        const deals = await fetchFromSharePoint("lists/getbytitle('Deals')/items?$select=Id,Title,Amount,Stage,CloseDate,Probability");
        
        // Calculate metrics
        const metrics = calculateMetrics(deals);
        
        // Update UI
        updateDashboardMetrics(metrics);
        createCharts(deals);
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showError('Failed to load dashboard data');
    }
}

function calculateMetrics(deals) {
    const totalDeals = deals.length;
    const activeDeals = deals.filter(d => !['Closed Won', 'Closed Lost'].includes(d.Stage)).length;
    const wonDeals = deals.filter(d => d.Stage === 'Closed Won').length;
    const lostDeals = deals.filter(d => d.Stage === 'Closed Lost').length;
    
    const totalValue = deals.reduce((sum, deal) => sum + (deal.Amount || 0), 0);
    const weightedValue = deals.reduce((sum, deal) => sum + ((deal.Amount || 0) * (deal.Probability || 0) / 100), 0);
    
    return {
        totalDeals,
        activeDeals,
        wonDeals,
        lostDeals,
        totalValue,
        weightedValue
    };
}

function updateDashboardMetrics(metrics) {
    document.getElementById('totalDeals').textContent = metrics.totalDeals;
    document.getElementById('activeDeals').textContent = metrics.activeDeals;
    document.getElementById('wonDeals').textContent = metrics.wonDeals;
    document.getElementById('totalValue').textContent = formatCurrency(metrics.totalValue);
    document.getElementById('weightedValue').textContent = formatCurrency(metrics.weightedValue);
}

// Kanban board
async function loadKanbanBoard() {
    try {
        // Get deals and pipelines
        const [deals, pipelines] = await Promise.all([
            fetchFromSharePoint("lists/getbytitle('Deals')/items?$expand=Pipeline&$select=Id,Title,Amount,Stage,Pipeline/Title,Probability"),
            fetchFromSharePoint("lists/getbytitle('Pipelines')/items?$select=Id,Title,Stages")
        ]);
        
        renderKanbanBoard(deals, pipelines);
        
    } catch (error) {
        console.error('Error loading kanban:', error);
        showError('Failed to load kanban board');
    }
}

// Deal list
async function loadDealList() {
    try {
        const deals = await fetchFromSharePoint("lists/getbytitle('Deals')/items?$expand=Owner,Pipeline&$select=Id,Title,Amount,Stage,Pipeline/Title,Owner/Title,CloseDate,Probability");
        renderDealList(deals);
    } catch (error) {
        console.error('Error loading deal list:', error);
        showError('Failed to load deals');
    }
}

// Reports
async function loadReports() {
    try {
        const deals = await fetchFromSharePoint("lists/getbytitle('Deals')/items?$select=Id,Title,Amount,Stage,CloseDate,Probability");
        renderReports(deals);
    } catch (error) {
        console.error('Error loading reports:', error);
        showError('Failed to load reports');
    }
}

// Event listeners
function setupEventListeners() {
    // Time period filter
    document.querySelectorAll('.time-period-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const period = this.getAttribute('data-period');
            filterByTimePeriod(period);
        });
    });
    
    // Create deal button
    const createDealBtn = document.getElementById('createDealBtn');
    if (createDealBtn) {
        createDealBtn.addEventListener('click', showCreateDealModal);
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            switchView(currentView);
        });
    }
}

// Utility functions
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR'
    }).format(amount);
}

function showError(message) {
    // Simple error display
    const errorDiv = document.getElementById('errorAlert') || createErrorElement();
    errorDiv.textContent = message;
    errorDiv.classList.remove('d-none');
    
    setTimeout(() => {
        errorDiv.classList.add('d-none');
    }, 5000);
}

function createErrorElement() {
    const div = document.createElement('div');
    div.id = 'errorAlert';
    div.className = 'alert alert-danger alert-dismissible fade show';
    div.innerHTML = `
        <span></span>
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.querySelector('.container-fluid').prepend(div);
    return div.querySelector('span');
}

// Mock data for development (remove in production)
function getMockData(endpoint) {
    console.log('Using mock data for:', endpoint);
    
    if (endpoint.includes("lists/getbytitle('Deals')")) {
        return [
            { Id: 1, Title: 'Enterprise Deal', Amount: 50000, Stage: 'Proposal', Probability: 70 },
            { Id: 2, Title: 'SMB Deal', Amount: 15000, Stage: 'Discovery', Probability: 50 },
            { Id: 3, Title: 'Government Contract', Amount: 100000, Stage: 'Negotiation', Probability: 90 },
            { Id: 4, Title: 'Startup Pilot', Amount: 10000, Stage: 'Qualification', Probability: 30 },
            { Id: 5, Title: 'Enterprise Renewal', Amount: 75000, Stage: 'Closed Won', Probability: 100 }
        ];
    }
    
    if (endpoint.includes("lists/getbytitle('Pipelines')")) {
        return [
            { Id: 1, Title: 'Enterprise Sales', Stages: '["Qualification","Discovery","Proposal","Negotiation","Closed Won","Closed Lost"]' },
            { Id: 2, Title: 'SMB Sales', Stages: '["Lead","Qualification","Demo","Proposal","Closed"]' }
        ];
    }
    
    return [];
}

// Note: Chart rendering functions and detailed UI rendering
// would be added here. This is a simplified version.

console.log('Sales Pipeline App - SharePoint version loaded');