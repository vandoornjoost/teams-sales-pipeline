// Global variables
let socket;
let currentUser = {
    id: 'user_1',
    name: 'Joost van Doorn',
    role: 'admin'
};
let stageChart = null; // Store chart instance for cleanup
let revenueChart = null;
let priorityChart = null;
let funnelChart = null;
let pendingStageUpdates = new Set(); // Track deals being updated by this user
let currentFilters = {}; // Store current filter settings
let currentView = 'dashboard'; // Track current view (dashboard, kanban, list, reports)
let currentTimePeriod = 'all'; // Track current time period for reports (all, week, month, quarter)
let currentPipelineFilter = ''; // Track current pipeline filter (empty = all pipelines)

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing app...');
    initializeSocket();
    setupNavigation();
    loadDashboardData();
    setupEventListeners();
    loadPipelineFilter();
    
    // Set user info
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userInitials').textContent = getInitials(currentUser.name);
});

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

// Load pipeline filter dropdown
async function loadPipelineFilter() {
    try {
        const pipelineFilter = document.getElementById('pipelineFilter');
        if (!pipelineFilter) {
            console.log('Pipeline filter element not found');
            return;
        }
        
        // Clear existing options except first one
        while (pipelineFilter.options.length > 1) {
            pipelineFilter.remove(1);
        }
        
        // Load pipelines from API
        const response = await fetch('/api/pipelines');
        const pipelines = await response.json();
        
        if (pipelines && pipelines.length > 0) {
            // Add pipeline options
            pipelines.forEach(pipeline => {
                const option = document.createElement('option');
                option.value = pipeline.id;
                option.textContent = pipeline.name;
                pipelineFilter.appendChild(option);
            });
            
            console.log(`Loaded ${pipelines.length} pipelines into filter`);
            
            // Add event listener for pipeline change
            pipelineFilter.addEventListener('change', function() {
                const selectedPipelineId = this.value;
                console.log('Pipeline filter changed to:', selectedPipelineId);
                
                // Update current pipeline filter
                currentPipelineFilter = selectedPipelineId;
                
                // Refresh current view
                if (currentView === 'kanban') {
                    loadKanbanBoard();
                } else if (currentView === 'list') {
                    loadDealList();
                }
            });
        }
    } catch (error) {
        console.error('Error loading pipeline filter:', error);
    }
}

function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to WebSocket server');
    });
    
    socket.on('stageChanged', (data) => {
        console.log('Stage changed WebSocket event:', data, 'Timestamp:', new Date().toISOString());
        console.log('Pending updates:', Array.from(pendingStageUpdates));
        
        // Check if this change was initiated by this user
        if (pendingStageUpdates.has(data.dealId)) {
            console.log(`Skipping refresh for user-initiated stage change on deal ${data.dealId}`);
            // Don't delete yet - keep it for potential duplicate WebSocket events
            // It will be deleted by the setTimeout in updateDealStage
            return; // Skip refresh for changes made by this user
        }
        
        console.log('Refreshing data for external stage change');
        showNotification(`Deal stage updated`, 'info');
        refreshData();
    });
    
    socket.on('newComment', (data) => {
        console.log('New comment:', data);
        showNotification(`New comment on deal`, 'info');
        refreshData();
    });
    
    socket.on('stageAdded', (data) => {
        console.log('New stage added:', data);
        showNotification(`New stage "${data.stage.name}" added`, 'success');
        
        // Refresh kanban view if currently viewing it
        if (currentView === 'kanban') {
            loadKanbanBoard();
        }
    });
    
    socket.on('stageDeleted', (data) => {
        console.log('Stage deleted:', data);
        showNotification(`Stage deleted`, 'info');
        
        // Refresh kanban view if currently viewing it
        if (currentView === 'kanban') {
            loadKanbanBoard();
        }
    });
    
    socket.on('pipelineUpdated', (data) => {
        console.log('Pipeline updated:', data);
        showNotification(`Pipeline updated`, 'info');
        
        // Refresh kanban view if currently viewing it
        if (currentView === 'kanban') {
            loadKanbanBoard();
        }
    });
    
    socket.on('dealChanged', (deal) => {
        console.log('Deal updated:', deal);
        showNotification(`Deal updated`, 'info');
        refreshData();
    });
}

function setupNavigation() {
    document.querySelectorAll('[data-view]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const view = this.getAttribute('data-view');
            
            // Update active nav link
            document.querySelectorAll('.nav-link').forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');
            
            // Show selected view
            document.querySelectorAll('.view-content').forEach(view => view.style.display = 'none');
            document.getElementById(`${view}View`).style.display = 'block';
            
            // Update current view
            currentView = view;
            
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
        });
    });
}

function destroyAllCharts() {
    console.log('Destroying all charts...');
    const charts = [stageChart, revenueChart, priorityChart, funnelChart];
    const chartNames = ['stageChart', 'revenueChart', 'priorityChart', 'funnelChart'];
    
    charts.forEach((chart, index) => {
        if (chart) {
            console.log(`Destroying ${chartNames[index]}`);
            try {
                chart.destroy();
            } catch (e) {
                console.warn(`Error destroying ${chartNames[index]}:`, e.message);
            }
        }
    });
    
    stageChart = null;
    revenueChart = null;
    priorityChart = null;
    funnelChart = null;
}

async function loadDashboardData(period = 'all') {
    try {
        console.log('Loading dashboard data for period:', period);
        
        // Destroy any existing charts first
        destroyAllCharts();
        
        // Build URL with filters
        let url = period === 'all' ? '/api/dashboard/metrics' : `/api/dashboard/metrics?period=${period}`;
        
        // Add pipeline filter if set
        if (currentPipelineFilter) {
            url += (url.includes('?') ? '&' : '?') + `pipelineId=${currentPipelineFilter}`;
        }
        
        // Add company filter if set
        if (currentFilters && currentFilters.company) {
            url += (url.includes('?') ? '&' : '?') + `company=${encodeURIComponent(currentFilters.company)}`;
        }
        
        console.log('Fetching dashboard data from:', url);
        const response = await fetch(url);
        console.log('Dashboard API response status:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`Dashboard API failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Dashboard data loaded successfully:', {
            hasOverview: !!data.overview,
            hasUserPerformance: !!data.userPerformance,
            hasRecentActivities: !!data.recentActivities,
            userPerformanceCount: data.userPerformance ? data.userPerformance.length : 0
        });
        
        // Update metrics
        const overview = data.overview || {};
        document.getElementById('totalValue').textContent = `€${(overview.totalValue || 0).toLocaleString()}`;
        document.getElementById('activeDeals').textContent = overview.activeDeals || 0;
        document.getElementById('conversionRate').textContent = `${(overview.conversionRate || 0).toFixed(1)}%`;
        document.getElementById('avgDealSize').textContent = `€${(overview.avgDealSize || 0).toLocaleString()}`;
        
        // Update team performance table
        const teamTable = document.querySelector('#teamPerformanceTable tbody');
        teamTable.innerHTML = '';
        
        // Check if userPerformance exists in the response
        if (data.userPerformance && Array.isArray(data.userPerformance)) {
            data.userPerformance.forEach(member => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${member.userName || 'Unknown'}</td>
                    <td>${member.totalDeals || 0}</td>
                    <td>${member.wonDeals || 0}</td>
                    <td>€${(member.totalValue || 0).toLocaleString()}</td>
                    <td>${(member.conversionRate || 0).toFixed(1)}%</td>
                    <td>€${member.totalDeals > 0 ? ((member.totalValue || 0) / member.totalDeals).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}) : '0'}</td>
                `;
                teamTable.appendChild(row);
            });
        } else {
            console.warn('userPerformance not found in API response:', data);
        }
        
        // Update activity list
        const activityList = document.getElementById('activityList');
        activityList.innerHTML = '';
        const activities = data.recentActivities || [];
        activities.slice(0, 5).forEach(activity => {
            const item = document.createElement('a');
            item.className = 'list-group-item list-group-item-action';
            
            // Format timestamp to relative time
            let timeText = 'Recently';
            if (activity.timestamp) {
                const activityTime = new Date(activity.timestamp);
                const now = new Date();
                const diffMs = now - activityTime;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);
                
                if (diffMins < 60) {
                    timeText = `${diffMins}m ago`;
                } else if (diffHours < 24) {
                    timeText = `${diffHours}h ago`;
                } else {
                    timeText = `${diffDays}d ago`;
                }
            }
            
            item.innerHTML = `
                <div class="d-flex w-100 justify-content-between">
                    <small class="text-muted">${timeText}</small>
                </div>
                <p class="mb-1">${activity.details || 'Activity'}</p>
                <small class="text-muted">${activity.userName || ''} • ${activity.dealName || ''}</small>
            `;
            activityList.appendChild(item);
        });
        
        // Create charts
        const distributions = data.distributions || {};
        
        // Stage chart
        if (distributions.stages) {
            const stageData = Object.entries(distributions.stages).map(([stage, count]) => ({
                stage,
                count
            }));
            createStageChart(stageData);
        }
        
        // Priority chart
        if (distributions.priorities) {
            const priorityData = Object.entries(distributions.priorities).map(([priority, count]) => ({
                priority: priority.charAt(0).toUpperCase() + priority.slice(1),
                count
            }));
            createPriorityChart(priorityData);
        }
        
        // Generate revenue chart data based on deals and time period
        const revenueData = generateRevenueChartData(data.deals || [], period);
        createRevenueChart(revenueData);
        
        createFunnelChart([
            { stage: 'Prospect', count: distributions.stages?.Prospect || 0 },
            { stage: 'Pitching', count: distributions.stages?.Pitching || 0 },
            { stage: 'Secured Lead', count: distributions.stages?.['Secured Lead'] || 0 },
            { stage: 'Proposal sent', count: distributions.stages?.['Proposal sent'] || 0 },
            { stage: 'Closed', count: distributions.stages?.Closed || 0 }
        ]);
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showNotification('Failed to load dashboard data', 'danger');
    }
}

function createStageChart(stageData) {
    const canvas = document.getElementById('stageChart');
    if (!canvas) {
        console.error('stageChart canvas not found');
        return;
    }
    
    // Destroy existing chart if it exists
    if (stageChart) {
        console.log('Destroying existing stage chart');
        try {
            stageChart.destroy();
        } catch (e) {
            console.warn('Error destroying stage chart:', e.message);
        }
        stageChart = null;
    }
    
    const ctx = canvas.getContext('2d');
    stageChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stageData.map(s => s.stage),
            datasets: [{
                label: 'Deals',
                data: stageData.map(s => s.count),
                backgroundColor: '#0078D4',
                borderColor: '#005a9e',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

function generateRevenueChartData(deals, period) {
    if (!deals || deals.length === 0) {
        // Return empty data if no data
        return [{ label: 'No data', value: 0 }];
    }
    
    const now = new Date();
    let timeBuckets = [];
    let bucketLabels = [];
    
    // Determine time buckets based on period
    switch(period) {
        case 'week':
            // Create daily buckets for last 7 days
            for (let i = 6; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(now.getDate() - i);
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                bucketLabels.push(dayName);
                timeBuckets.push({
                    date: new Date(date), // Copy date
                    label: dayName,
                    value: 0
                });
            }
            break;
            
        case 'month':
            // Create weekly buckets for last 4 weeks
            for (let i = 3; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(now.getDate() - (i * 7));
                const weekLabel = `Week ${4 - i}`;
                bucketLabels.push(weekLabel);
                timeBuckets.push({
                    date: new Date(date), // Copy date
                    label: weekLabel,
                    value: 0
                });
            }
            break;
            
        case 'quarter':
            // Create monthly buckets for last 3 months
            for (let i = 2; i >= 0; i--) {
                const date = new Date(now);
                date.setMonth(now.getMonth() - i);
                const monthName = date.toLocaleDateString('en-US', { month: 'short' });
                bucketLabels.push(monthName);
                timeBuckets.push({
                    year: date.getFullYear(),
                    month: date.getMonth(),
                    label: monthName,
                    value: 0
                });
            }
            break;
            
        default:
            // 'all' - Create monthly buckets for last 6 months
            for (let i = 5; i >= 0; i--) {
                const date = new Date(now);
                date.setMonth(now.getMonth() - i);
                const monthName = date.toLocaleDateString('en-US', { month: 'short' });
                bucketLabels.push(monthName);
                timeBuckets.push({
                    year: date.getFullYear(),
                    month: date.getMonth(),
                    label: monthName,
                    value: 0
                });
            }
    }
    
    // Calculate revenue for each time bucket
    deals.forEach(deal => {
        // Use closeDate for won deals, createdAt for active deals
        let dealDate;
        if (deal.status === 'won' && deal.closeDate) {
            dealDate = new Date(deal.closeDate);
        } else if (deal.createdAt) {
            dealDate = new Date(deal.createdAt);
        } else {
            return; // No date to use
        }
        
        // Find which time bucket this deal belongs to
        let dealBucket;
        
        switch(period) {
            case 'week':
                // Check if deal is within the last 7 days
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                if (dealDate >= weekAgo) {
                    // Find which day of the week
                    const dayDiff = Math.floor((dealDate - weekAgo) / (1000 * 60 * 60 * 24));
                    if (dayDiff >= 0 && dayDiff < 7) {
                        dealBucket = timeBuckets[dayDiff];
                    }
                }
                break;
                
            case 'month':
                // Check if deal is within the last 28 days (4 weeks)
                const monthAgo = new Date(now);
                monthAgo.setDate(now.getDate() - 28);
                if (dealDate >= monthAgo) {
                    // Find which week
                    const weekDiff = Math.floor((dealDate - monthAgo) / (1000 * 60 * 60 * 24 * 7));
                    if (weekDiff >= 0 && weekDiff < 4) {
                        dealBucket = timeBuckets[weekDiff];
                    }
                }
                break;
                
            case 'quarter':
            default:
                // For monthly buckets
                dealBucket = timeBuckets.find(bucket => 
                    bucket.year === dealDate.getFullYear() && 
                    bucket.month === dealDate.getMonth()
                );
                break;
        }
        
        if (dealBucket && deal.value) {
            dealBucket.value += deal.value;
        }
    });
    
    // Format for chart
    return timeBuckets.map(bucket => ({
        month: bucket.label,
        value: bucket.value
    }));
}

function createRevenueChart(revenueData) {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) {
        console.error('revenueChart canvas not found');
        return;
    }
    
    // Destroy existing chart if it exists
    if (revenueChart) {
        console.log('Destroying existing revenue chart');
        try {
            revenueChart.destroy();
        } catch (e) {
            console.warn('Error destroying revenue chart:', e.message);
        }
        revenueChart = null;
    }
    
    const ctx = canvas.getContext('2d');
    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: revenueData.map(r => r.month),
            datasets: [{
                label: 'Revenue (€)',
                data: revenueData.map(r => r.value),
                borderColor: '#28a745',
                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function createPriorityChart(priorityData) {
    const canvas = document.getElementById('priorityChart');
    if (!canvas) {
        console.error('priorityChart canvas not found');
        return;
    }
    
    // Destroy existing chart if it exists
    if (priorityChart) {
        console.log('Destroying existing priority chart');
        try {
            priorityChart.destroy();
        } catch (e) {
            console.warn('Error destroying priority chart:', e.message);
        }
        priorityChart = null;
    }
    
    const ctx = canvas.getContext('2d');
    priorityChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: priorityData.map(p => p.priority),
            datasets: [{
                data: priorityData.map(p => p.count),
                backgroundColor: [
                    '#dc3545', // Critical
                    '#ffc107', // High
                    '#17a2b8', // Medium
                    '#28a745'  // Low
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

function createFunnelChart(funnelData) {
    const canvas = document.getElementById('funnelChart');
    if (!canvas) {
        console.error('funnelChart canvas not found');
        return;
    }
    
    // Destroy existing chart if it exists
    if (funnelChart) {
        console.log('Destroying existing funnel chart');
        try {
            funnelChart.destroy();
        } catch (e) {
            console.warn('Error destroying funnel chart:', e.message);
        }
        funnelChart = null;
    }
    
    const ctx = canvas.getContext('2d');
    funnelChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: funnelData.map(f => f.stage),
            datasets: [{
                label: 'Deals',
                data: funnelData.map(f => f.count),
                backgroundColor: '#6f42c1',
                borderColor: '#5a32a3',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

async function loadKanbanBoard() {
    try {
        console.log('Starting loadKanbanBoard...');
        // Get pipeline stages first
        const pipelineResponse = await fetch('/api/pipelines');
        const pipelines = await pipelineResponse.json();
        console.log('Pipelines loaded:', pipelines?.length);
        
        // Get deals with pipeline filter if set
        let dealsUrl = '/api/deals';
        if (currentPipelineFilter) {
            dealsUrl += `?pipelineId=${currentPipelineFilter}`;
        }
        const dealsResponse = await fetch(dealsUrl);
        const deals = await dealsResponse.json();
        console.log('Deals loaded:', deals?.length, 'with filter:', currentPipelineFilter || 'none');
        
        // Apply filters if any
        let filteredDeals = deals;
        if (currentFilters && Object.keys(currentFilters).length > 0) {
            filteredDeals = filterDeals(deals);
            console.log(`Deals after filtering: ${filteredDeals.length} (from ${deals.length})`);
        }
        
        const container = document.getElementById('kanbanContainer');
        container.innerHTML = '';
        
        // Get stages from selected pipeline or first pipeline
        let stages = [];
        let selectedPipeline = null;
        
        if (currentPipelineFilter) {
            // Find the selected pipeline
            selectedPipeline = pipelines.find(p => p.id === currentPipelineFilter);
        }
        
        if (selectedPipeline && selectedPipeline.stages) {
            stages = selectedPipeline.stages;
        } else if (pipelines && pipelines.length > 0 && pipelines[0].stages) {
            // Fall back to first pipeline
            stages = pipelines[0].stages;
        } else {
            // Default stages if no pipeline data
            stages = [
                { id: 'stage_1', name: 'Prospect' },
                { id: 'stage_2', name: 'Pitching' },
                { id: 'stage_3', name: 'Secured Lead' },
                { id: 'stage_4', name: 'Proposal sent' },
                { id: 'stage_5', name: 'Closed' },
                { id: 'stage_6', name: 'Execution' },
                { id: 'stage_7', name: 'Canceled' },
                { id: 'stage_8', name: 'Completed' }
            ];
        }
        
        // Create stage mapping for quick lookup
        const stageMap = {};
        stages.forEach(stage => {
            stageMap[stage.id] = stage.name;
        });
        
        // Create pipeline mapping
        const pipelineMap = {};
        pipelines.forEach(pipeline => {
            pipelineMap[pipeline.id] = pipeline.name.replace(' Pipeline', '');
        });
        
        // Create a horizontal scrolling container for kanban columns
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'kanban-scroll-container';
        scrollContainer.style.cssText = 'display: flex; overflow-x: auto; gap: 15px; padding: 10px 0;';
        
        // Group deals by stage
        stages.forEach(stage => {
            const stageDeals = filteredDeals.filter(deal => deal.stageId === stage.id);
            
            const col = document.createElement('div');
            col.className = 'kanban-column';
            col.style.cssText = 'min-width: 280px; max-width: 280px; flex-shrink: 0;';
            col.innerHTML = `
                <div class="card h-100">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h6 class="mb-0">${stage.name} <span class="badge bg-secondary">${stageDeals.length}</span></h6>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteStage('${stage.id}', '${stage.name.replace(/'/g, "\\'")}')" title="Delete stage">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                    <div class="card-body p-2" style="min-height: 400px; max-height: 600px; overflow-y: auto;">
                        <div id="stage-${stage.id}" class="kanban-stage" data-stage-id="${stage.id}">
                            ${stageDeals.map(deal => `
                                <div class="kanban-card" data-deal-id="${deal.id}">
                                    <div class="d-flex justify-content-between align-items-start mb-2">
                                        <strong>${deal.name}</strong>
                                        <span class="deal-priority priority-${(deal.priority || 'medium').toLowerCase()}">${deal.priority || 'Medium'}</span>
                                    </div>
                                    <div class="text-muted small mb-2">${pipelineMap[deal.pipelineId] || 'Unknown'}</div>
                                    <div class="d-flex justify-content-between align-items-center">
                                        <span class="fw-bold">€${(deal.value || 0).toLocaleString()}</span>
                                        <small>${deal.probability || 0}%</small>
                                    </div>
                                </div>
                            `).join('')}
                            ${stageDeals.length === 0 ? '<div class="empty-column-placeholder text-muted text-center p-4" style="min-height: 100px; pointer-events: none;">No deals in this stage</div>' : ''}
                            <!-- Bottom drop zone for empty columns -->
                            ${stageDeals.length === 0 ? '<div class="bottom-drop-zone" style="height: 20px; margin-top: 10px;"></div>' : ''}
                        </div>
                    </div>
                </div>
            `;
            scrollContainer.appendChild(col);
        });
        
        container.appendChild(scrollContainer);
        
        // Add CSS for kanban cards if not already present
        if (!document.getElementById('kanban-styles')) {
            const style = document.createElement('style');
            style.id = 'kanban-styles';
            style.textContent = `
                .kanban-scroll-container {
                    scrollbar-width: thin;
                    scrollbar-color: #ccc transparent;
                }
                .kanban-scroll-container::-webkit-scrollbar {
                    height: 8px;
                }
                .kanban-scroll-container::-webkit-scrollbar-track {
                    background: #f1f1f1;
                    border-radius: 4px;
                }
                .kanban-scroll-container::-webkit-scrollbar-thumb {
                    background: #ccc;
                    border-radius: 4px;
                }
                .kanban-scroll-container::-webkit-scrollbar-thumb:hover {
                    background: #aaa;
                }
                .kanban-column .card {
                    border: 1px solid #dee2e6;
                    border-radius: 8px;
                }
                .kanban-column .card-header {
                    background-color: #f8f9fa;
                    border-bottom: 1px solid #dee2e6;
                    padding: 10px 15px;
                }
                .kanban-card {
                    background: white;
                    border: 1px solid #e9ecef;
                    border-radius: 6px;
                    padding: 12px;
                    margin-bottom: 10px;
                    cursor: grab;
                    transition: all 0.2s;
                }
                .kanban-card:hover {
                    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                    transform: translateY(-2px);
                }
                .kanban-card:active {
                    cursor: grabbing;
                }
                .deal-priority {
                    font-size: 0.75rem;
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-weight: 600;
                }
                .priority-critical { background-color: #dc3545; color: white; }
                .priority-high { background-color: #fd7e14; color: white; }
                .priority-medium { background-color: #ffc107; color: #212529; }
                .priority-low { background-color: #28a745; color: white; }
                
                /* Sortable.js visual feedback */
                .sortable-ghost {
                    opacity: 0.4;
                    background-color: #f8f9fa;
                }
                .sortable-chosen {
                    background-color: #e9ecef;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.1);
                }
                .sortable-drag {
                    opacity: 0.8;
                    transform: rotate(3deg);
                }
                .sortable-fallback {
                    opacity: 0.5;
                }
                .bottom-drop-zone {
                    border-top: 2px dashed #dee2e6;
                    opacity: 0.3;
                }
            `;
            document.head.appendChild(style);
        }
        
        // Wait a bit for DOM to be fully rendered
        setTimeout(() => {
            // Initialize drag and drop
            initializeSortable(stageMap);
        }, 100);
        
    } catch (error) {
        console.error('Error loading kanban board:', error);
        showNotification('Failed to load kanban board', 'danger');
    }
}

function initializeSortable(stageMap) {
    console.log('Initializing Sortable.js for kanban board...');
    const stages = document.querySelectorAll('.kanban-stage');
    console.log(`Found ${stages.length} kanban stages`);
    
    // Log all stage IDs for debugging
    console.log('Stage IDs found:', Array.from(stages).map(s => s.id));
    
    // Clear any existing Sortable instances
    stages.forEach(stage => {
        if (stage.sortable) {
            stage.sortable.destroy();
            console.log(`Destroyed existing Sortable instance for ${stage.id}`);
        }
    });
    
    stages.forEach((stage, index) => {
        console.log(`Initializing stage ${index + 1}:`, stage.id, 'Element:', stage);
        
        // Check if container has content
        const hasItems = stage.children.length > 0;
        const isEmptyPlaceholder = stage.querySelector('.empty-column-placeholder');
        console.log(`Stage ${stage.id} has ${stage.children.length} items, has placeholder:`, isEmptyPlaceholder ? 'Yes' : 'No');
        
        try {
            const sortableInstance = new Sortable(stage, {
                group: {
                    name: 'kanban',
                    pull: true,  // Allow pulling from other containers
                    put: true    // Allow putting into this container
                },
                animation: 150,
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag',
                swapThreshold: 0.65,
                invertSwap: true,
                direction: 'vertical', // Cards move vertically within column
                emptyInsertThreshold: 50, // Increased threshold for easier dropping
                forceFallback: false,
                scroll: true,
                scrollSensitivity: 30,
                scrollSpeed: 10,
                fallbackOnBody: true,
                fallbackTolerance: 0,
                fallbackOffset: {x: 0, y: 0},
                fallbackClass: 'sortable-fallback',
                onChoose: function(evt) {
                    console.log('Item chosen for dragging:', evt.item.id);
                },
                onSort: function(evt) {
                    console.log('Sorting occurred:', {
                        oldIndex: evt.oldIndex,
                        newIndex: evt.newIndex,
                        from: evt.from.id,
                        to: evt.to.id
                    });
                },
                onStart: function(evt) {
                    console.log('Drag STARTED:', {
                        item: evt.item,
                        itemId: evt.item.id,
                        from: evt.from,
                        fromId: evt.from.id,
                        dealId: evt.item.getAttribute('data-deal-id')
                    });
                },
                onEnd: function(evt) {
                    console.log('Drag ENDED:', {
                        item: evt.item,
                        itemId: evt.item.id,
                        from: evt.from,
                        fromId: evt.from.id,
                        to: evt.to,
                        toId: evt.to.id,
                        oldIndex: evt.oldIndex,
                        newIndex: evt.newIndex,
                        dealId: evt.item.getAttribute('data-deal-id')
                    });
                    
                    const dealId = evt.item.getAttribute('data-deal-id');
                    const fromContainerId = evt.from.id;
                    const toContainerId = evt.to.id;
                    
                    if (!dealId) {
                        console.error('No deal ID found on dragged item');
                        showNotification('Error: Could not identify deal', 'danger');
                        return;
                    }
                    
                    if (!fromContainerId || !toContainerId) {
                        console.error('No container ID found');
                        showNotification('Error: Could not identify source or target stage', 'danger');
                        return;
                    }
                    
                    // Extract stage ID from container ID (remove "stage-" prefix)
                    const stageId = toContainerId.replace('stage-', '');
                    
                    // Check if dragging within the same column (reordering)
                    if (fromContainerId === toContainerId) {
                        console.log(`Dragging deal ${dealId} within same column ${fromContainerId} - no stage change needed`);
                        // Just reordering within column, no API call needed
                        return;
                    } else {
                        console.log(`Moving deal ${dealId} from ${fromContainerId} to ${toContainerId} (stage ${stageId})`);
                        
                        // Update deal stage via API
                        updateDealStage(dealId, stageId);
                    }
                },
                onAdd: function(evt) {
                    console.log('Item ADDED to container:', {
                        from: evt.from.id,
                        to: evt.to.id,
                        item: evt.item.id,
                        dealId: evt.item.getAttribute('data-deal-id')
                    });
                },
                onRemove: function(evt) {
                    console.log('Item REMOVED from container:', {
                        from: evt.from.id,
                        to: evt.to.id,
                        item: evt.item.id,
                        dealId: evt.item.getAttribute('data-deal-id')
                    });
                }
            });
            
            // Store reference to Sortable instance
            stage.sortable = sortableInstance;
            console.log(`✅ Successfully initialized Sortable for ${stage.id}`);
            
        } catch (error) {
            console.error(`❌ Failed to initialize Sortable for ${stage.id}:`, error);
            console.error('Error details:', error.message, error.stack);
        }
    });
    
    // Test if Sortable is working by checking if instances were created
    const sortableInstances = Array.from(stages).filter(s => s.sortable).length;
    console.log(`Sortable initialization complete: ${sortableInstances}/${stages.length} stages initialized`);
}

async function updateDealStage(dealId, newStageId) {
    try {
        console.log(`Starting stage update for deal ${dealId} to stage ${newStageId}`);
        
        // Mark this deal as being updated by this user
        pendingStageUpdates.add(dealId);
        console.log(`Added ${dealId} to pendingStageUpdates:`, Array.from(pendingStageUpdates));
        
        const response = await fetch(`/api/deals/${dealId}/stage`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                stageId: newStageId,
                userId: 'user_1',
                userName: 'Joost van Doorn'
            })
        });
        
        console.log(`API response received for ${dealId}:`, response.status, response.statusText);
        
        // Try to get response body for debugging
        let responseBody;
        try {
            responseBody = await response.text();
            console.log(`Response body (first 500 chars):`, responseBody.substring(0, 500));
        } catch (e) {
            console.log('Could not read response body:', e.message);
        }
        
        if (response.ok) {
            // Get the stage name from the container
            const stageContainerId = `stage-${newStageId}`;
            const stageElement = document.getElementById(stageContainerId);
            
            // Safely get stage name
            let stageName = 'new stage';
            if (stageElement && stageElement.parentElement && stageElement.parentElement.parentElement) {
                const cardElement = stageElement.parentElement.parentElement;
                const h6Element = cardElement.querySelector('.card-header h6');
                if (h6Element && h6Element.textContent) {
                    try {
                        // Get text before the badge (split by space and take first word)
                        const text = h6Element.textContent.trim();
                        stageName = text.split(' ')[0];
                    } catch (e) {
                        console.error(`Error extracting stage name:`, e);
                    }
                }
            }
            
            showNotification(`Deal moved to ${stageName}`, 'success');
            
            console.log(`Successfully updated ${dealId} to stage ${newStageId}`);
            
            // DO NOT emit stageChanged here - the server will emit it
            // socket.emit('stageChanged', { dealId, newStageId });
            
            // Keep in pending updates for a bit longer to catch any late WebSocket events
            setTimeout(() => {
                console.log(`Removing ${dealId} from pendingStageUpdates`);
                pendingStageUpdates.delete(dealId);
            }, 2000); // Increased from 1000 to 2000 ms
        } else {
            // If API fails, show error with more details
            console.log(`API failed for ${dealId}:`, response.status, response.statusText);
            showNotification(`Failed to update deal stage (${response.status})`, 'danger');
            console.log(`Removing ${dealId} from pendingStageUpdates`);
            // Remove from pending updates
            pendingStageUpdates.delete(dealId);
            // Sortable.js will automatically revert the visual position
        }
    } catch (error) {
        console.error('Error updating deal stage:', error);
        showNotification('Failed to update deal stage', 'danger');
        console.log(`Exception for ${dealId}, removing from pending`);
        // Remove from pending updates
        pendingStageUpdates.delete(dealId);
    }
}

async function loadDealList() {
    try {
        // Get deals with pipeline filter if set
        let dealsUrl = '/api/deals';
        if (currentPipelineFilter) {
            dealsUrl += `?pipelineId=${currentPipelineFilter}`;
        }
        
        // Fetch deals and stages in parallel
        const [dealsResponse, pipelinesResponse] = await Promise.all([
            fetch(dealsUrl),
            fetch('/api/pipelines')
        ]);
        
        const deals = await dealsResponse.json();
        const pipelines = await pipelinesResponse.json();
        
        console.log('Deal list loaded:', deals?.length, 'with pipeline filter:', currentPipelineFilter || 'none');
        
        // Create stage mapping
        const stageMap = {};
        // Create pipeline mapping
        const pipelineMap = {};
        pipelines.forEach(pipeline => {
            pipelineMap[pipeline.id] = pipeline.name;
            // Also map stages from all pipelines
            if (pipeline.stages) {
                pipeline.stages.forEach(stage => {
                    stageMap[stage.id] = stage.name;
                });
            }
        });
        
        const table = document.querySelector('#dealTable tbody');
        table.innerHTML = '';
        
        deals.forEach(deal => {
            try {
                // Get stage name from stageId
                const stageName = stageMap[deal.stageId] || 'Unknown';
                // Get pipeline name from pipelineId
                const pipelineName = pipelineMap[deal.pipelineId] || 'Unknown Pipeline';
                
                // Safely handle deal data
                const dealName = deal.name || 'Unnamed Deal';
                const company = pipelineName.replace(' Pipeline', ''); // Remove " Pipeline" suffix
                const value = typeof deal.value === 'number' ? deal.value : 0;
                const probability = typeof deal.probability === 'number' ? deal.probability : 0;
                const closeDate = deal.closeDate ? new Date(deal.closeDate).toLocaleDateString() : 'N/A';
                const priority = deal.priority || 'Medium';
                const assignedTo = deal.assignedTo || 'Unassigned';
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${dealName}</strong></td>
                    <td>${company}</td>
                    <td><span class="stage-badge">${stageName}</span></td>
                    <td class="fw-bold">€${value.toLocaleString()}</td>
                    <td>
                        <div class="progress" style="height: 6px;">
                            <div class="progress-bar" role="progressbar" style="width: ${probability}%"></div>
                        </div>
                        <small>${probability}%</small>
                    </td>
                    <td>${closeDate}</td>
                    <td><span class="deal-priority priority-${priority.toLowerCase()}">${priority}</span></td>
                    <td>
                        <div class="d-flex align-items-center">
                            <div class="user-avatar me-2">${getInitials(assignedTo)}</div>
                            ${assignedTo}
                        </div>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary me-1" data-deal-id="${deal.id}">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" data-deal-id="${deal.id}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                `;
                table.appendChild(row);
            } catch (dealError) {
                console.error('Error rendering deal row:', dealError, deal);
                // Continue with other deals
            }
        });
        
        // Setup edit button event listeners
        setupEditButtons();
        
    } catch (error) {
        console.error('Error loading deal list:', error);
        console.error('Error stack:', error.stack);
        showNotification(`Failed to load deal list: ${error.message}`, 'danger');
    }
}

async function loadReports(period = 'all') {
    try {
        console.log('Loading reports for period:', period);
        currentTimePeriod = period;
        await loadDashboardData(period);
        
        // Update active time period button
        updateActiveTimePeriodButton(period);
        
        console.log('Reports loaded successfully for period:', period);
        
    } catch (error) {
        console.error('Error loading reports:', error);
        showNotification('Failed to load reports', 'danger');
    }
}

function updateActiveTimePeriodButton(period) {
    // Remove active class from all time period buttons
    document.querySelectorAll('.time-period-btn').forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline-secondary');
    });
    
    // Add active class to the correct button
    let buttonSelector;
    switch(period) {
        case 'week':
            buttonSelector = '.time-period-btn:nth-child(1)'; // This Week
            break;
        case 'month':
            buttonSelector = '.time-period-btn:nth-child(2)'; // This Month
            break;
        case 'quarter':
            buttonSelector = '.time-period-btn:nth-child(3)'; // This Quarter
            break;
        default:
            return;
    }
    
    const activeBtn = document.querySelector(buttonSelector);
    if (activeBtn) {
        activeBtn.classList.remove('btn-outline-secondary');
        activeBtn.classList.add('btn-primary');
    }
}

function setupEventListeners() {
    // Search functionality
    const dealSearch = document.getElementById('dealSearch');
    if (dealSearch) {
        dealSearch.addEventListener('input', function(e) {
            const searchTerm = e.target.value.toLowerCase();
            const rows = document.querySelectorAll('#dealTable tbody tr');
            
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(searchTerm) ? '' : 'none';
            });
        });
    }
    
    // Filter functionality
    const dealFilter = document.getElementById('dealFilter');
    if (dealFilter) {
        dealFilter.addEventListener('change', function(e) {
            const filter = e.target.value;
            // Implement filtering logic
        });
    }
    
    // Kanban Add Stage button
    const addStageBtn = document.getElementById('addStageBtn');
    if (addStageBtn) {
        addStageBtn.addEventListener('click', showAddStageModal);
    }
    
    // Kanban Filter button
    const filterKanbanBtn = document.getElementById('filterKanbanBtn');
    if (filterKanbanBtn) {
        filterKanbanBtn.addEventListener('click', showFilterModal);
    }
    
    // Save deal changes button
    const saveDealChangesBtn = document.getElementById('saveDealChanges');
    if (saveDealChangesBtn) {
        saveDealChangesBtn.addEventListener('click', saveDealChanges);
    }
    
    // Export buttons
    const exportDealsButton = document.getElementById('exportDealsButton');
    if (exportDealsButton) {
        exportDealsButton.addEventListener('click', exportDealsToCSV);
    }
    
    const exportReportButton = document.getElementById('exportReportButton');
    if (exportReportButton) {
        exportReportButton.addEventListener('click', exportReportToCSV);
    }
    
    // Time period buttons for reports
    document.querySelectorAll('.time-period-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const period = this.getAttribute('data-period');
            console.log('Time period button clicked:', period, 'button:', this);
            loadReports(period);
        });
    });
    
    // Handle dealChanged WebSocket event
    socket.on('dealChanged', (data) => {
        console.log('Deal changed WebSocket event:', data);
        // Refresh the current view if it's showing deals
        refreshData();
    });
    
    // Handle dealDeleted WebSocket event
    socket.on('dealDeleted', (data) => {
        console.log('Deal deleted WebSocket event:', data);
        // Refresh the current view if it's showing deals
        refreshData();
    });
    
    // Handle dealCreated WebSocket event
    socket.on('dealCreated', (data) => {
        console.log('Deal created WebSocket event:', data);
        // Refresh the current view if it's showing deals
        refreshData();
    });
}

function refreshData() {
    const activeLink = document.querySelector('.nav-link.active');
    if (!activeLink) return;
    
    const activeView = activeLink.getAttribute('data-view');
    switch(activeView) {
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
            loadReports(currentTimePeriod);
            break;
    }
}

// Show Add Stage Modal
function showAddStageModal() {
    const modal = new bootstrap.Modal(document.getElementById('addStageModal'));
    modal.show();
    
    // Reset form
    document.getElementById('stageName').value = '';
    document.getElementById('stageDescription').value = '';
    document.getElementById('stageColor').value = '#6c757d';
    
    // Set up save button
    const saveStageBtn = document.getElementById('saveStageBtn');
    saveStageBtn.onclick = saveNewStage;
}

// Save new stage
async function saveNewStage() {
    const stageName = document.getElementById('stageName').value.trim();
    const stageDescription = document.getElementById('stageDescription').value.trim();
    const stageColor = document.getElementById('stageColor').value;
    
    if (!stageName) {
        showNotification('Stage name is required', 'danger');
        return;
    }
    
    try {
        // Get first pipeline (assuming single pipeline for now)
        const pipelinesResponse = await fetch('/api/pipelines');
        console.log('Pipelines response status:', pipelinesResponse.status);
        const pipelines = await pipelinesResponse.json();
        console.log('Pipelines data:', pipelines);
        
        if (pipelines.length === 0) {
            showNotification('No pipeline found', 'danger');
            return;
        }
        
        const pipelineId = pipelines[0].id;
        console.log('Pipeline ID:', pipelineId);
        console.log('Pipeline ID type:', typeof pipelineId);
        console.log('Pipeline ID length:', pipelineId.length);
        console.log('Full URL:', `/api/pipelines/${pipelineId}/stages`);
        
        const url = `/api/pipelines/${pipelineId}/stages`;
        console.log('Making POST request to:', url);
        console.log('Request body:', {
            name: stageName,
            description: stageDescription,
            color: stageColor,
            order: pipelines[0].stages.length
        });
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: stageName,
                description: stageDescription,
                color: stageColor,
                order: pipelines[0].stages.length
            })
        });
        
        console.log('Response status:', response.status);
        console.log('Response headers:', [...response.headers.entries()]);
        
        if (response.ok) {
            const newStage = await response.json();
            showNotification(`Stage "${stageName}" added successfully`, 'success');
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('addStageModal'));
            modal.hide();
            
            // Refresh kanban view to show new stage
            if (currentView === 'kanban') {
                loadKanbanBoard();
            }
        } else {
            const error = await response.json();
            showNotification(`Failed to add stage: ${error.error || 'Unknown error'}`, 'danger');
        }
    } catch (error) {
        console.error('Error adding stage:', error);
        console.error('Error details:', error.message, error.stack);
        showNotification(`Failed to add stage: ${error.message}. Please try again.`, 'danger');
    }
}

async function deleteStage(stageId, stageName) {
    if (!confirm(`Are you sure you want to delete the stage "${stageName}"?`)) {
        return;
    }
    
    try {
        // Get first pipeline (assuming single pipeline for now)
        const pipelinesResponse = await fetch('/api/pipelines');
        const pipelines = await pipelinesResponse.json();
        
        if (pipelines.length === 0) {
            showNotification('No pipeline found', 'danger');
            return;
        }
        
        const pipelineId = pipelines[0].id;
        const url = `/api/pipelines/${pipelineId}/stages/${stageId}`;
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            showNotification(result.message || 'Stage deleted successfully', 'success');
            
            // The WebSocket event will trigger UI refresh
        } else {
            const error = await response.json();
            showNotification(`Failed to delete stage: ${error.message || error.error || 'Unknown error'}`, 'danger');
        }
    } catch (error) {
        console.error('Error deleting stage:', error);
        showNotification(`Failed to delete stage: ${error.message || 'Unknown error'}`, 'danger');
    }
}

// Show Filter Modal
function showFilterModal() {
    const modal = new bootstrap.Modal(document.getElementById('filterModal'));
    modal.show();
    
    // Set up apply button
    const applyFilterBtn = document.getElementById('applyFilterBtn');
    applyFilterBtn.onclick = applyKanbanFilter;
    
    // Set up reset button
    const resetFilterBtn = document.getElementById('resetFilterBtn');
    resetFilterBtn.onclick = resetKanbanFilter;
    
    // Update probability slider value display
    const probabilitySlider = document.getElementById('filterProbabilityMin');
    const probabilityValue = document.getElementById('probabilityMinValue');
    probabilitySlider.addEventListener('input', function() {
        probabilityValue.textContent = `${this.value}%`;
    });
}

// Apply kanban filter
function applyKanbanFilter() {
    const priority = document.getElementById('filterPriority').value;
    const minValue = document.getElementById('filterValueMin').value;
    const maxValue = document.getElementById('filterValueMax').value;
    const minProbability = document.getElementById('filterProbabilityMin').value;
    const company = document.getElementById('filterCompany').value;
    
    // Store filter settings
    currentFilters = {
        priority,
        minValue: minValue ? parseInt(minValue) : null,
        maxValue: maxValue ? parseInt(maxValue) : null,
        minProbability: minProbability ? parseInt(minProbability) : null,
        company
    };
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('filterModal'));
    modal.hide();
    
    // Apply filter to current view
    if (currentView === 'kanban') {
        loadKanbanBoard();
    }
    
    showNotification('Filter applied', 'success');
}

// Reset kanban filter
function resetKanbanFilter() {
    document.getElementById('filterPriority').value = '';
    document.getElementById('filterValueMin').value = '';
    document.getElementById('filterValueMax').value = '';
    document.getElementById('filterProbabilityMin').value = '0';
    document.getElementById('probabilityMinValue').textContent = '0%';
    document.getElementById('filterCompany').value = '';
    
    currentFilters = {};
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('filterModal'));
    modal.hide();
    
    // Refresh current view
    if (currentView === 'kanban') {
        loadKanbanBoard();
    }
    
    showNotification('Filter reset', 'info');
}

// Filter deals based on current filters
function filterDeals(deals) {
    if (!currentFilters || Object.keys(currentFilters).length === 0) {
        return deals;
    }
    
    return deals.filter(deal => {
        // Priority filter
        if (currentFilters.priority && deal.priority !== currentFilters.priority) {
            return false;
        }
        
        // Value range filter
        if (currentFilters.minValue !== null && deal.value < currentFilters.minValue) {
            return false;
        }
        if (currentFilters.maxValue !== null && deal.value > currentFilters.maxValue) {
            return false;
        }
        
        // Probability filter
        if (currentFilters.minProbability !== null && deal.probability < currentFilters.minProbability) {
            return false;
        }
        
        // Company filter
        if (currentFilters.company && deal.company !== currentFilters.company) {
            return false;
        }
        
        return true;
    });
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show notification`;
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Edit and delete deal functionality
function setupEditButtons() {
    // Add event listeners to all edit buttons in the deal table
    const editButtons = document.querySelectorAll('#dealTable .btn-outline-primary');
    editButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            const row = this.closest('tr');
            const dealName = row.querySelector('td:first-child strong').textContent;
            const dealId = this.getAttribute('data-deal-id');
            
            if (dealId) {
                openEditModal(dealId);
            } else {
                console.error('No deal ID found on edit button');
                showNotification('Could not find deal to edit', 'danger');
            }
        });
    });
    
    // Add event listeners to all delete buttons in the deal table
    const deleteButtons = document.querySelectorAll('#dealTable .btn-outline-danger');
    deleteButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            const row = this.closest('tr');
            const dealName = row.querySelector('td:first-child strong').textContent;
            const dealId = this.getAttribute('data-deal-id');
            
            if (dealId && confirm(`Are you sure you want to delete "${dealName}"? This action cannot be undone.`)) {
                deleteDeal(dealId, row);
            }
        });
    });
}

async function deleteDeal(dealId, rowElement) {
    try {
        console.log('Deleting deal:', dealId);
        
        const response = await fetch(`/api/deals/${dealId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            const result = await response.json();
            showNotification(`Deal "${result.deletedDeal.name}" deleted successfully`, 'success');
            
            // Remove the row from the table
            if (rowElement) {
                rowElement.remove();
            }
            
            // Refresh dashboard metrics
            refreshData();
            
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete deal');
        }
        
    } catch (error) {
        console.error('Error deleting deal:', error);
        showNotification(`Failed to delete deal: ${error.message}`, 'danger');
    }
}

async function openEditModal(dealId) {
    try {
        console.log('Opening edit modal for deal:', dealId);
        
        // Fetch deal details
        const response = await fetch(`/api/deals/${dealId}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch deal: ${response.status}`);
        }
        const deal = await response.json();
        
        // Fetch stages for dropdown
        const stagesResponse = await fetch('/api/pipelines');
        const pipelines = await stagesResponse.json();
        let stages = [];
        if (pipelines && pipelines.length > 0 && pipelines[0].stages) {
            stages = pipelines[0].stages;
        }
        
        // Populate modal fields
        document.getElementById('editDealId').value = deal.id;
        document.getElementById('editDealName').value = deal.name || '';
        document.getElementById('editDealCompany').value = deal.company || '';
        document.getElementById('editDealValue').value = deal.value || 0;
        document.getElementById('editDealProbability').value = deal.probability || 50;
        document.getElementById('editDealPriority').value = deal.priority?.toLowerCase() || 'medium';
        document.getElementById('editDealCloseDate').value = deal.closeDate ? deal.closeDate.split('T')[0] : '';
        document.getElementById('editDealAssignedTo').value = deal.assignedTo || '';
        document.getElementById('editDealDescription').value = deal.description || '';
        document.getElementById('editDealNotes').value = deal.notes || '';
        document.getElementById('editDealSource').value = deal.source || '';
        
        // Populate pipeline dropdown
        const pipelineSelect = document.getElementById('editDealPipeline');
        pipelineSelect.innerHTML = '';
        pipelines.forEach(pipeline => {
            const option = document.createElement('option');
            option.value = pipeline.id;
            option.textContent = pipeline.name;
            if (pipeline.id === deal.pipelineId) {
                option.selected = true;
            }
            pipelineSelect.appendChild(option);
        });
        
        // Populate stages dropdown
        const stageSelect = document.getElementById('editDealStage');
        stageSelect.innerHTML = '';
        stages.forEach(stage => {
            const option = document.createElement('option');
            option.value = stage.id;
            option.textContent = stage.name;
            if (stage.id === deal.stageId) {
                option.selected = true;
            }
            stageSelect.appendChild(option);
        });
        
        // Track if user has manually selected a pipeline
        let userManuallySelectedPipeline = false;
        
        // Add event listener to auto-update pipeline based on company
        const companyInput = document.getElementById('editDealCompany');
        companyInput.addEventListener('input', function() {
            // Only auto-update if user hasn't manually selected a pipeline
            if (!userManuallySelectedPipeline) {
                updatePipelineBasedOnCompany(this.value, pipelineSelect);
                // Update stages when pipeline changes
                updateStagesForPipeline(pipelineSelect.value, stageSelect);
            }
        });
        
        // Also update stages when pipeline is manually changed
        pipelineSelect.addEventListener('change', function() {
            // User manually changed pipeline - mark it
            userManuallySelectedPipeline = true;
            updateStagesForPipeline(this.value, stageSelect);
        });
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('editDealModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error opening edit modal:', error);
        showNotification('Failed to load deal details for editing', 'danger');
    }
}

function updatePipelineBasedOnCompany(companyName, pipelineSelect) {
    if (!companyName || !pipelineSelect) return;
    
    const companyLower = companyName.toLowerCase();
    let targetPipelineId = 'pipeline_4'; // Default to B2B Consulting Pipeline
    
    if (companyLower.includes('baltichydrogen')) {
        targetPipelineId = 'pipeline_1';
    } else if (companyLower.includes('mpindustries')) {
        targetPipelineId = 'pipeline_2';
    } else if (companyLower.includes('iberianhydrogen')) {
        targetPipelineId = 'pipeline_3';
    }
    
    // Find and select the matching pipeline
    for (let i = 0; i < pipelineSelect.options.length; i++) {
        if (pipelineSelect.options[i].value === targetPipelineId) {
            pipelineSelect.selectedIndex = i;
            console.log(`Auto-updated pipeline to ${pipelineSelect.options[i].textContent} for company: ${companyName}`);
            break;
        }
    }
}

async function updateStagesForPipeline(pipelineId, stageSelect) {
    if (!pipelineId || !stageSelect) return;
    
    try {
        // Fetch pipelines to get stages for the selected pipeline
        const response = await fetch('/api/pipelines');
        const pipelines = await response.json();
        
        // Find the selected pipeline
        const selectedPipeline = pipelines.find(p => p.id === pipelineId);
        if (!selectedPipeline || !selectedPipeline.stages) {
            console.warn(`No stages found for pipeline ${pipelineId}`);
            return;
        }
        
        // Clear and repopulate stages dropdown
        stageSelect.innerHTML = '';
        selectedPipeline.stages.forEach(stage => {
            const option = document.createElement('option');
            option.value = stage.id;
            option.textContent = stage.name;
            if (stage.order === 1) { // Default to first stage
                option.selected = true;
            }
            stageSelect.appendChild(option);
        });
        
        console.log(`Updated stages for pipeline ${pipelineId}: ${selectedPipeline.stages.length} stages`);
    } catch (error) {
        console.error('Error updating stages for pipeline:', error);
    }
}

async function saveDealChanges() {
    const dealId = document.getElementById('editDealId').value;
    if (!dealId) {
        showNotification('No deal selected', 'danger');
        return;
    }
    
    try {
        const updates = {
            name: document.getElementById('editDealName').value,
            company: document.getElementById('editDealCompany').value,
            value: parseFloat(document.getElementById('editDealValue').value),
            probability: parseInt(document.getElementById('editDealProbability').value),
            priority: document.getElementById('editDealPriority').value,
            closeDate: document.getElementById('editDealCloseDate').value,
            assignedTo: document.getElementById('editDealAssignedTo').value,
            description: document.getElementById('editDealDescription').value,
            notes: document.getElementById('editDealNotes').value,
            source: document.getElementById('editDealSource').value,
            stageId: document.getElementById('editDealStage').value,
            pipelineId: document.getElementById('editDealPipeline').value
        };
        
        console.log('Saving deal updates:', updates);
        
        const response = await fetch(`/api/deals/${dealId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });
        
        if (response.ok) {
            const updatedDeal = await response.json();
            showNotification('Deal updated successfully', 'success');
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('editDealModal'));
            modal.hide();
            
            // Refresh the data
            refreshData();
            
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update deal');
        }
        
    } catch (error) {
        console.error('Error saving deal changes:', error);
        showNotification(`Failed to update deal: ${error.message}`, 'danger');
    }
}

// New deal functionality
function setupNewDealButtons() {
    // Setup new deal button in list view
    const newDealButton = document.getElementById('newDealButton');
    if (newDealButton) {
        newDealButton.addEventListener('click', openNewDealModal);
    }
    
    // Setup new deal button in sidebar
    const sidebarNewDeal = document.getElementById('sidebarNewDeal');
    if (sidebarNewDeal) {
        sidebarNewDeal.addEventListener('click', openNewDealModal);
    }
    
    // Setup create deal button in modal
    const createNewDealButton = document.getElementById('createNewDeal');
    if (createNewDealButton) {
        createNewDealButton.addEventListener('click', createNewDeal);
    }
}

async function openNewDealModal() {
    try {
        console.log('Opening new deal modal');
        
        // Fetch pipelines to get stages
        const response = await fetch('/api/pipelines');
        const pipelines = await response.json();
        
        let stages = [];
        if (pipelines && pipelines.length > 0 && pipelines[0].stages) {
            stages = pipelines[0].stages;
        }
        
        // Populate pipeline dropdown
        const pipelineSelect = document.getElementById('newDealPipeline');
        pipelineSelect.innerHTML = '';
        pipelines.forEach(pipeline => {
            const option = document.createElement('option');
            option.value = pipeline.id;
            option.textContent = pipeline.name;
            if (pipeline.id === 'pipeline_4') { // Default to B2B Consulting Pipeline
                option.selected = true;
            }
            pipelineSelect.appendChild(option);
        });
        
        // Populate stages dropdown
        const stageSelect = document.getElementById('newDealStage');
        stageSelect.innerHTML = '';
        stages.forEach(stage => {
            const option = document.createElement('option');
            option.value = stage.id;
            option.textContent = stage.name;
            if (stage.order === 1) { // Default to first stage
                option.selected = true;
            }
            stageSelect.appendChild(option);
        });
        
        // Clear form fields
        document.getElementById('newDealName').value = '';
        document.getElementById('newDealCompany').value = '';
        document.getElementById('newDealValue').value = '';
        document.getElementById('newDealProbability').value = '50';
        document.getElementById('newDealPriority').value = 'medium';
        document.getElementById('newDealCloseDate').value = '';
        document.getElementById('newDealAssignedTo').value = 'user_1';
        document.getElementById('newDealDescription').value = '';
        document.getElementById('newDealNotes').value = '';
        document.getElementById('newDealSource').value = '';
        
        // Track if user has manually selected a pipeline
        let userManuallySelectedPipeline = false;
        
        // Add event listener to auto-update pipeline based on company
        const companyInput = document.getElementById('newDealCompany');
        companyInput.addEventListener('input', function() {
            console.log('Company input event:', this.value, 'manual flag:', userManuallySelectedPipeline);
            // Only auto-update if user hasn't manually selected a pipeline
            if (!userManuallySelectedPipeline) {
                console.log('Auto-updating pipeline for company:', this.value);
                updatePipelineBasedOnCompany(this.value, pipelineSelect);
                // Update stages when pipeline changes
                updateStagesForPipeline(pipelineSelect.value, stageSelect);
            } else {
                console.log('Skipping auto-update - user manually selected pipeline');
            }
        });
        
        // Also update stages when pipeline is manually changed
        pipelineSelect.addEventListener('change', function() {
            console.log('Pipeline manually changed to:', this.value);
            // User manually changed pipeline - mark it
            userManuallySelectedPipeline = true;
            updateStagesForPipeline(this.value, stageSelect);
        });
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('newDealModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error opening new deal modal:', error);
        showNotification('Failed to load stages for new deal', 'danger');
    }
}

async function createNewDeal() {
    const name = document.getElementById('newDealName').value;
    const value = document.getElementById('newDealValue').value;
    
    if (!name || !value) {
        showNotification('Deal name and value are required', 'danger');
        return;
    }
    
    try {
        const newDeal = {
            name: document.getElementById('newDealName').value,
            company: document.getElementById('newDealCompany').value,
            value: parseFloat(document.getElementById('newDealValue').value),
            probability: parseInt(document.getElementById('newDealProbability').value),
            priority: document.getElementById('newDealPriority').value,
            closeDate: document.getElementById('newDealCloseDate').value,
            assignedTo: document.getElementById('newDealAssignedTo').value,
            description: document.getElementById('newDealDescription').value,
            notes: document.getElementById('newDealNotes').value,
            source: document.getElementById('newDealSource').value,
            stageId: document.getElementById('newDealStage').value,
            pipelineId: document.getElementById('newDealPipeline').value
        };
        
        console.log('Creating new deal:', newDeal);
        
        const response = await fetch('/api/deals', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newDeal)
        });
        
        if (response.ok) {
            const createdDeal = await response.json();
            showNotification(`Deal "${createdDeal.name}" created successfully`, 'success');
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('newDealModal'));
            modal.hide();
            
            // Refresh the data
            refreshData();
            
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create deal');
        }
        
    } catch (error) {
        console.error('Error creating new deal:', error);
        showNotification(`Failed to create deal: ${error.message}`, 'danger');
    }
}

// Settings functionality
function setupSettingsButtons() {
    // Setup settings button in user dropdown
    const userSettings = document.getElementById('userSettings');
    if (userSettings) {
        userSettings.addEventListener('click', openSettingsModal);
    }
    
    // Setup settings button in sidebar
    const sidebarSettings = document.getElementById('sidebarSettings');
    if (sidebarSettings) {
        sidebarSettings.addEventListener('click', openSettingsModal);
    }
    
    // Setup save settings button
    const saveSettingsBtn = document.getElementById('saveSettings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', saveSettings);
    }
    
    // Setup add stage button
    const addStageBtn = document.getElementById('addStageBtn');
    if (addStageBtn) {
        addStageBtn.addEventListener('click', addNewStage);
    }
}

async function openSettingsModal() {
    try {
        console.log('Opening settings modal');
        
        // Load pipeline stages for pipeline tab
        await loadPipelineStages();
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('settingsModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error opening settings modal:', error);
        showNotification('Failed to load settings', 'danger');
    }
}

async function loadPipelineStages() {
    try {
        const response = await fetch('/api/pipelines');
        const pipelines = await response.json();
        
        const stagesList = document.getElementById('pipelineStagesList');
        if (!stagesList) return;
        
        if (pipelines && pipelines.length > 0 && pipelines[0].stages) {
            const stages = pipelines[0].stages;
            
            let html = '';
            stages.forEach(stage => {
                html += `
                <div class="d-flex justify-content-between align-items-center mb-2 p-2 border rounded">
                    <div>
                        <span class="badge me-2" style="background-color: ${stage.color || '#6c757d'}">${stage.order}</span>
                        <strong>${stage.name}</strong>
                        <div class="text-muted small">${stage.id}</div>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-outline-primary me-1" data-stage-id="${stage.id}">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" data-stage-id="${stage.id}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
                `;
            });
            
            stagesList.innerHTML = html;
        } else {
            stagesList.innerHTML = '<div class="text-center text-muted"><i class="bi bi-exclamation-circle"></i> No pipeline stages found</div>';
        }
        
    } catch (error) {
        console.error('Error loading pipeline stages:', error);
        const stagesList = document.getElementById('pipelineStagesList');
        if (stagesList) {
            stagesList.innerHTML = '<div class="text-center text-danger"><i class="bi bi-exclamation-triangle"></i> Failed to load stages</div>';
        }
    }
}

function addNewStage() {
    showNotification('Add stage functionality coming soon', 'info');
}

async function saveSettings() {
    try {
        // Get user profile settings
        const userProfile = {
            name: document.getElementById('userNameInput').value,
            email: document.getElementById('userEmailInput').value,
            role: document.getElementById('userRoleInput').value,
            timezone: document.getElementById('userTimezone').value
        };
        
        // Get notification settings
        const notifications = {
            email: document.getElementById('emailNotifications').checked,
            browser: document.getElementById('browserNotifications').checked,
            dealAssigned: document.getElementById('dealAssignedNotifications').checked,
            stageChange: document.getElementById('stageChangeNotifications').checked,
            frequency: document.getElementById('notificationFrequency').value
        };
        
        console.log('Saving settings:', { userProfile, notifications });
        
        // In a real app, you would save these to the server
        // For now, just update the current user display
        currentUser.name = userProfile.name;
        document.getElementById('userName').textContent = currentUser.name;
        document.getElementById('userInitials').textContent = getInitials(currentUser.name);
        
        // Show success message
        showNotification('Settings saved successfully', 'success');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('settingsModal'));
        modal.hide();
        
    } catch (error) {
        console.error('Error saving settings:', error);
        showNotification('Failed to save settings', 'danger');
    }
}

// Export deals to CSV
function exportDealsToCSV() {
    try {
        console.log('Exporting deals to CSV...');
        
        // Get deals from API
        fetch('/api/deals')
            .then(response => response.json())
            .then(deals => {
                if (!deals || deals.length === 0) {
                    showNotification('No deals to export', 'warning');
                    return;
                }
                
                // Convert to CSV
                const headers = ['ID', 'Name', 'Stage', 'Value', 'Probability', 'Close Date', 'Status', 'Source', 'Priority', 'Created'];
                const csvRows = [];
                
                // Add headers
                csvRows.push(headers.join(','));
                
                // Add data rows
                deals.forEach(deal => {
                    const row = [
                        deal.id,
                        `"${deal.name.replace(/"/g, '""')}"`, // Escape quotes in CSV
                        deal.stageId,
                        deal.value,
                        deal.probability,
                        deal.closeDate,
                        deal.status,
                        deal.source,
                        deal.priority,
                        deal.createdAt
                    ];
                    csvRows.push(row.join(','));
                });
                
                // Create CSV string
                const csvString = csvRows.join('\n');
                
                // Create download link
                const blob = new Blob([csvString], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.setAttribute('hidden', '');
                a.setAttribute('href', url);
                a.setAttribute('download', `deals_export_${new Date().toISOString().split('T')[0]}.csv`);
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                showNotification('Deals exported successfully', 'success');
            })
            .catch(error => {
                console.error('Error exporting deals:', error);
                showNotification('Failed to export deals', 'danger');
            });
            
    } catch (error) {
        console.error('Error in exportDealsToCSV:', error);
        showNotification('Export failed', 'danger');
    }
}

// Export report to CSV
function exportReportToCSV() {
    try {
        console.log('Exporting report to CSV...');
        
        // Get dashboard data from API
        fetch('/api/dashboard/metrics')
            .then(response => response.json())
            .then(data => {
                if (!data) {
                    showNotification('No report data to export', 'warning');
                    return;
                }
                
                // Create CSV content
                const csvRows = [];
                
                // Add overview section
                csvRows.push('OVERVIEW');
                csvRows.push('Metric,Value');
                csvRows.push(`Total Deals,${data.overview.totalDeals}`);
                csvRows.push(`Active Deals,${data.overview.activeDeals}`);
                csvRows.push(`Won Deals,${data.overview.wonDeals}`);
                csvRows.push(`Lost Deals,${data.overview.lostDeals}`);
                csvRows.push(`Total Value,${data.overview.totalValue}`);
                csvRows.push(`Weighted Value,${data.overview.weightedValue}`);
                csvRows.push(`Conversion Rate,${data.overview.conversionRate}`);
                csvRows.push(`Average Deal Size,${data.overview.avgDealSize}`);
                csvRows.push('');
                
                // Add stage distribution
                csvRows.push('STAGE DISTRIBUTION');
                csvRows.push('Stage,Count');
                Object.entries(data.distributions.stages).forEach(([stage, count]) => {
                    csvRows.push(`${stage},${count}`);
                });
                csvRows.push('');
                
                // Add source distribution
                csvRows.push('SOURCE DISTRIBUTION');
                csvRows.push('Source,Count');
                Object.entries(data.distributions.sources).forEach(([source, count]) => {
                    csvRows.push(`${source},${count}`);
                });
                csvRows.push('');
                
                // Add user performance
                csvRows.push('USER PERFORMANCE');
                csvRows.push('User,Total Deals,Won Deals,Total Value,Conversion Rate');
                data.userPerformance.forEach(user => {
                    csvRows.push(`${user.userName},${user.totalDeals},${user.wonDeals},${user.totalValue},${user.conversionRate}`);
                });
                
                // Create CSV string
                const csvString = csvRows.join('\n');
                
                // Create download link
                const blob = new Blob([csvString], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.setAttribute('hidden', '');
                a.setAttribute('href', url);
                a.setAttribute('download', `sales_report_${new Date().toISOString().split('T')[0]}.csv`);
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                showNotification('Report exported successfully', 'success');
            })
            .catch(error => {
                console.error('Error exporting report:', error);
                showNotification('Failed to export report', 'danger');
            });
            
    } catch (error) {
        console.error('Error in exportReportToCSV:', error);
        showNotification('Export failed', 'danger');
    }
}

// Initialize new deal buttons when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing app...');
    initializeSocket();
    setupNavigation();
    loadDashboardData();
    setupEventListeners();
    setupNewDealButtons();
    setupSettingsButtons(); // Add this line
    
    // Set user info
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userInitials').textContent = getInitials(currentUser.name);
});