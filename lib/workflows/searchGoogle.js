import puppeteer from 'puppeteer';

import { z } from 'zod';
import AIClient from '../aiClients/index.js';

const SearchResult = z.object({
    url: z.string(),
    title: z.string(),
    description: z.string(),
    relevanceScore: z.number(),
    priority: z.number(),
    reason: z.string(),
}).required({
    url: true,
    title: true,
    description: true,
    relevanceScore: true,
    priority: true,
    reason: true
}).strict();

export const Args = z.object({
    searchQuery: z.string(),
    reason: z.string(),
}).required({
    searchQuery: true,
    reason: true,
}).strict();

export const Output = z.object({
    searchResults: z.array(SearchResult),
}).required({
    searchResults: true,
}).strict();

class GoogleSearchWorkflow {
    constructor(config) {
        this.name = 'searchGoogle';
        this.config = config;
        this.ai = new AIClient()
        this.definition = {
            name: this.name,
            goal: 'Search Google for relevant information',
            args: {
                searchQuery: "string",
                reason: "string",
            },
            returns: Output,
        }

    }

    async analyzeSearchResults(searchResults, reason, context) {
        const completion = await this.ai.run({
            responseFormat: Output,
            messages: [
                {
                    role: "system",
                    content: `You are a search results analyzer. Return only the requested JSON structure without any additional formatting or text.
                    Analyze and prioritize relevant search results.`
                },
                {
                    role: "user",
                    content: `Context: "${context}"
                    Search Results: ${JSON.stringify(searchResults, null, 2)}
                    Reason For Search: "${reason}"

                    Extract relevant results from the search results and return them in the following format:
                    {
                        "searchResults": [
                            {
                                "url": "string",
                                "title": "string",
                                "description": "string",
                                "relevanceScore": "number",
                                "priority": "number",
                                "reason": "string"
                            }
                        ]
                    }`
                }
            ]
        });

        const results = completion

        return results;
    }

    async execute(context, args) {
        console.log(`\n🔍 Searching Google for: ${args.searchQuery}`);
        
        const browser = await puppeteer.launch(this.config.puppeteer);
        
        try {
            const page = await browser.newPage();
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(args.searchQuery)}`, { 
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            const searchResults = await page.evaluate(() => {
                const results = document.querySelectorAll('.g');
                return Array.from(results).map(result => ({
                    url: result.querySelector('a')?.href || '',
                    title: result.querySelector('h3')?.textContent || '',
                }));
            });

            // Analyze results using AI
            const analysis = await this.analyzeSearchResults(searchResults, args.reason, context);

            console.log(`✅ Found ${analysis.searchResults.length} relevant results`);
            
            return {
                success: true,
                results: analysis,
            };

        } catch (error) {
            console.error('❌ Error in Google search:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            await browser.close();
        }
    }
}

export default GoogleSearchWorkflow;
