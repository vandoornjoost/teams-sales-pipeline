// SharePoint Configuration for MP Industries Sales Pipeline
const SHAREPOINT_CONFIG = {
    // Your SharePoint site
    siteUrl: 'https://mpindustriesou.sharepoint.com/sites/SalesPipelineApp2',
    
    // List IDs (from your existing lists)
    lists: {
        deals: '674a71f2-05b3-46c5-8066-c3382613de64',      // Sales Deals
        pipelines: '6c7cdfd1-b0a8-45ad-8108-405ea67d4435',  // Sales Pipelines
        stages: '35d367e7-f1e9-4cb5-b4a0-ce2d338f2b7e',     // Sales Stages
        users: '2ec731ba-e7d1-425f-b20e-c961bbdbfaf3'       // Sales Users
    },
    
    // Column mappings (your existing column names)
    columns: {
        deals: {
            title: 'Title',
            description: 'Description',
            pipelineId: 'PipelineId',
            stageId: 'StageId',
            value: 'Value',
            probability: 'Probability',
            closeDate: 'CloseDate',
            assignedTo: 'AssignedTo',
            company: 'Company',
            contactPerson: 'ContactPerson',
            email: 'Email',
            phone: 'Phone',
            source: 'Source',
            priority: 'Priority',
            tags: 'Tags',
            notes: 'Notes'
        },
        pipelines: {
            title: 'Title',
            description: 'Description'
        },
        stages: {
            title: 'Title',
            order: 'Order',
            color: 'Color'
        }
    }
};

// SharePoint API Service for your existing lists
class MPISharePointService {
    constructor() {
        this.siteUrl = SHAREPOINT_CONFIG.siteUrl;
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

    // Get all deals with expanded lookups
    async getDeals() {
        const listId = SHAREPOINT_CONFIG.lists.deals;
        const cols = SHAREPOINT_CONFIG.columns.deals;
        
        // Build select query with your column names
        const selectFields = [
            'Id',
            cols.title,
            cols.description,
            cols.pipelineId,
            cols.stageId,
            cols.value,
            cols.probability,
            cols.closeDate,
            cols.assignedTo,
            cols.company,
            cols.contactPerson,
            cols.email,
            cols.phone
        ].join(',');

        return this.request(`lists(guid'${listId}')/items?$select=${selectFields}&$expand=${cols.assignedTo}`);
    }

    // Get all pipelines
    async getPipelines() {
        const listId = SHAREPOINT_CONFIG.lists.pipelines;
        return this.request(`lists(guid'${listId}')/items?$select=Id,${SHAREPOINT_CONFIG.columns.pipelines.title}`);
    }

    // Get all stages
    async getStages() {
        const listId = SHAREPOINT_CONFIG.lists.stages;
        const cols = SHAREPOINT_CONFIG.columns.stages;
        return this.request(`lists(guid'${listId}')/items?$select=Id,${cols.title},${cols.order},${cols.color}&$orderby=${cols.order}`);
    }

    // Create new deal
    async createDeal(deal) {
        const listId = SHAREPOINT_CONFIG.lists.deals;
        const cols = SHAREPOINT_CONFIG.columns.deals;
        
        const dealData = {
            __metadata: { type: 'SP.Data.Sales_x0020_DealsListItem' },
            [cols.title]: deal.title,
            [cols.description]: deal.description,
            [cols.pipelineId]: deal.pipelineId,
            [cols.stageId]: deal.stageId,
            [cols.value]: deal.value,
            [cols.probability]: deal.probability,
            [cols.closeDate]: deal.closeDate,
            [cols.company]: deal.company,
            [cols.contactPerson]: deal.contactPerson,
            [cols.email]: deal.email,
            [cols.phone]: deal.phone
        };

        return this.request(`lists(guid'${listId}')/items`, {
            method: 'POST',
            body: JSON.stringify(dealData)
        });
    }

    // Update deal stage (for kanban drag-drop)
    async updateDealStage(dealId, stageId) {
        const listId = SHAREPOINT_CONFIG.lists.deals;
        const cols = SHAREPOINT_CONFIG.columns.deals;
        
        return this.request(`lists(guid'${listId}')/items(${dealId})`, {
            method: 'MERGE',
            headers: {
                'IF-MATCH': '*',
                'X-HTTP-Method': 'MERGE'
            },
            body: JSON.stringify({
                __metadata: { type: 'SP.Data.Sales_x0020_DealsListItem' },
                [cols.stageId]: stageId
            })
        });
    }

    // Get dashboard metrics
    async getDashboardMetrics() {
        const deals = await this.getDeals();
        const stages = await this.getStages();
        
        // Calculate metrics
        const totalDeals = deals.length;
        const activeDeals = deals.filter(d => {
            const stage = stages.find(s => s.Id == d[SHAREPOINT_CONFIG.columns.deals.stageId]);
            return stage && !['Closed Won', 'Closed Lost'].includes(stage[SHAREPOINT_CONFIG.columns.stages.title]);
        }).length;
        
        const wonDeals = deals.filter(d => {
            const stage = stages.find(s => s.Id == d[SHAREPOINT_CONFIG.columns.deals.stageId]);
            return stage && stage[SHAREPOINT_CONFIG.columns.stages.title] === 'Closed Won';
        }).length;
        
        const totalValue = deals.reduce((sum, deal) => sum + (deal[SHAREPOINT_CONFIG.columns.deals.value] || 0), 0);
        const weightedValue = deals.reduce((sum, deal) => {
            const value = deal[SHAREPOINT_CONFIG.columns.deals.value] || 0;
            const probability = deal[SHAREPOINT_CONFIG.columns.deals.probability] || 0;
            return sum + (value * probability / 100);
        }, 0);

        return {
            overview: {
                totalDeals,
                activeDeals,
                wonDeals,
                totalValue,
                weightedValue
            },
            stageDistribution: this.calculateStageDistribution(deals, stages)
        };
    }

    // Calculate deals per stage
    calculateStageDistribution(deals, stages) {
        const distribution = {};
        
        stages.forEach(stage => {
            const stageId = stage.Id;
            const stageName = stage[SHAREPOINT_CONFIG.columns.stages.title];
            const stageDeals = deals.filter(d => d[SHAREPOINT_CONFIG.columns.deals.stageId] == stageId);
            
            distribution[stageName] = {
                count: stageDeals.length,
                value: stageDeals.reduce((sum, deal) => sum + (deal[SHAREPOINT_CONFIG.columns.deals.value] || 0), 0)
            };
        });
        
        return distribution;
    }
}

// Create global instance
const sharepointService = new MPISharePointService();

// Export for use in app.js
window.SHAREPOINT_CONFIG = SHAREPOINT_CONFIG;
window.sharepointService = sharepointService;

console.log('MPI SharePoint service loaded');