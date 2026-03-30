// SharePoint REST API Service
class SharePointService {
    constructor() {
        this.siteUrl = 'https://mpindustriesou.sharepoint.com/sites/SalesPipelineApp2';
        this.token = null;
    }

    // Initialize with Teams authentication
    async initialize() {
        if (typeof microsoftTeams !== 'undefined') {
            return new Promise((resolve, reject) => {
                microsoftTeams.initialize(() => {
                    microsoftTeams.authentication.getAuthToken({
                        successCallback: (token) => {
                            this.token = token;
                            console.log('Teams authentication successful');
                            resolve(token);
                        },
                        failureCallback: (error) => {
                            console.error('Teams authentication failed:', error);
                            // Fallback to app-only or mock data
                            resolve(null);
                        }
                    });
                });
            });
        }
        return null;
    }

    // Make authenticated request to SharePoint
    async request(endpoint, options = {}) {
        const url = `${this.siteUrl}/_api/web/${endpoint}`;
        
        const headers = {
            'Accept': 'application/json;odata=verbose',
            'Content-Type': 'application/json;odata=verbose'
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
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
                throw new Error(`SharePoint request failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.d ? data.d : data;
        } catch (error) {
            console.error('SharePoint API error:', error);
            throw error;
        }
    }

    // Get all deals
    async getDeals(filter = '') {
        let endpoint = "lists/getbytitle('Deals')/items?$expand=Owner,Pipeline&$select=Id,Title,Amount,Stage,Pipeline/Title,Owner/Title,CloseDate,Probability,Description";
        
        if (filter) {
            endpoint += `&$filter=${filter}`;
        }

        return this.request(endpoint);
    }

    // Get deal by ID
    async getDeal(id) {
        return this.request(`lists/getbytitle('Deals')/items(${id})?$expand=Owner,Pipeline`);
    }

    // Create new deal
    async createDeal(deal) {
        return this.request(`lists/getbytitle('Deals')/items`, {
            method: 'POST',
            body: JSON.stringify({
                __metadata: { type: 'SP.Data.DealsListItem' },
                Title: deal.title,
                Amount: deal.amount,
                Stage: deal.stage,
                PipelineId: deal.pipelineId,
                OwnerId: deal.ownerId,
                CloseDate: deal.closeDate,
                Probability: deal.probability,
                Description: deal.description
            })
        });
    }

    // Update deal
    async updateDeal(id, updates) {
        return this.request(`lists/getbytitle('Deals')/items(${id})`, {
            method: 'MERGE',
            headers: {
                'IF-MATCH': '*',
                'X-HTTP-Method': 'MERGE'
            },
            body: JSON.stringify({
                __metadata: { type: 'SP.Data.DealsListItem' },
                ...updates
            })
        });
    }

    // Get all pipelines
    async getPipelines() {
        return this.request("lists/getbytitle('Pipelines')/items?$select=Id,Title,Stages");
    }

    // Get dashboard metrics
    async getDashboardMetrics(period = 'all') {
        const deals = await this.getDeals();
        
        // Calculate metrics client-side
        const totalDeals = deals.length;
        const activeDeals = deals.filter(d => !['Closed Won', 'Closed Lost'].includes(d.Stage)).length;
        const wonDeals = deals.filter(d => d.Stage === 'Closed Won').length;
        const lostDeals = deals.filter(d => d.Stage === 'Closed Lost').length;
        
        const totalValue = deals.reduce((sum, deal) => sum + (deal.Amount || 0), 0);
        const weightedValue = deals.reduce((sum, deal) => sum + ((deal.Amount || 0) * (deal.Probability || 0) / 100), 0);

        return {
            overview: {
                totalDeals,
                activeDeals,
                wonDeals,
                lostDeals,
                totalValue,
                weightedValue
            },
            // Add more metrics as needed
        };
    }

    // Get user performance
    async getUserPerformance() {
        const deals = await this.getDeals();
        
        // Group by owner and calculate performance
        const performanceByUser = {};
        
        deals.forEach(deal => {
            const ownerName = deal.Owner?.Title || 'Unknown';
            if (!performanceByUser[ownerName]) {
                performanceByUser[ownerName] = {
                    deals: 0,
                    value: 0,
                    won: 0,
                    active: 0
                };
            }
            
            performanceByUser[ownerName].deals++;
            performanceByUser[ownerName].value += deal.Amount || 0;
            
            if (deal.Stage === 'Closed Won') {
                performanceByUser[ownerName].won++;
            } else if (!['Closed Won', 'Closed Lost'].includes(deal.Stage)) {
                performanceByUser[ownerName].active++;
            }
        });

        return Object.entries(performanceByUser).map(([name, stats]) => ({
            name,
            ...stats
        }));
    }
}

// Create global instance
const sharepointService = new SharePointService();

// Initialize when Teams SDK is ready
if (typeof microsoftTeams !== 'undefined') {
    microsoftTeams.initialize(() => {
        sharepointService.initialize().then(() => {
            console.log('SharePoint service initialized');
        });
    });
}

export default sharepointService;