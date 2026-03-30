// Configuration for SharePoint integration
const SHAREPOINT_CONFIG = {
    // Your SharePoint site URL
    siteUrl: 'https://mpindustriesou.sharepoint.com/sites/SalesPipelineApp2',
    
    // List names
    lists: {
        deals: 'Deals',
        pipelines: 'Pipelines',
        users: 'Users'
    },
    
    // API endpoints
    api: {
        // Azure Functions URL (we'll create this)
        functions: 'https://YOUR-FUNCTION-APP.azurewebsites.net/api',
        
        // Direct SharePoint REST API
        sharepoint: '_api/web/lists'
    }
};

// Teams authentication
let teamsContext = null;

// Initialize Microsoft Teams SDK
function initializeTeams() {
    return new Promise((resolve, reject) => {
        if (typeof microsoftTeams !== 'undefined') {
            microsoftTeams.initialize(() => {
                microsoftTeams.getContext((context) => {
                    teamsContext = context;
                    console.log('Teams context:', context);
                    resolve(context);
                });
            });
        } else {
            console.warn('Microsoft Teams SDK not available');
            resolve(null);
        }
    });
}

// Get authentication token for SharePoint
async function getAuthToken() {
    if (teamsContext && microsoftTeams) {
        return new Promise((resolve, reject) => {
            microsoftTeams.authentication.getAuthToken({
                successCallback: (token) => {
                    resolve(token);
                },
                failureCallback: (error) => {
                    console.error('Failed to get auth token:', error);
                    reject(error);
                }
            });
        });
    }
    return null;
}

// Make authenticated request to SharePoint
async function sharepointRequest(endpoint, options = {}) {
    const token = await getAuthToken();
    const url = `${SHAREPOINT_CONFIG.siteUrl}/${endpoint}`;
    
    const headers = {
        'Accept': 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose'
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(url, {
        ...options,
        headers: {
            ...headers,
            ...options.headers
        }
    });
    
    if (!response.ok) {
        throw new Error(`SharePoint request failed: ${response.statusText}`);
    }
    
    return response.json();
}