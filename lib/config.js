require('dotenv').config();

const config = {
    // API Keys
    openaiApiKey: process.env.OPENAI_API_KEY,
    
    // Crawling Limits
    maxPages: 50,
    maxDepth: 3,
    requestDelay: 2000, // Delay between requests in ms
    
    // Browser Settings
    puppeteer: {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    },
    
    // Workflow Settings
    searchSettings: {
        resultsPerPage: 10,
        maxRetries: 3
    }
};

module.exports = config; 