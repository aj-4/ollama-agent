import puppeteer from 'puppeteer';

import { z } from 'zod';
import AIClient from '../aiClients/index.js';

const LinkedInResult = z.object({
    personName: z.string(),
    personLinkedInURL: z.string(),
    personTitle: z.string(),
    personCompany: z.string(),
    wasFound: z.boolean(),
}).required({
    personName: true,
    personLinkedInURL: true,
    personTitle: true,
    personCompany: true,
    wasFound: true,
}).strict();

class FindLinkedInWorkflow {
    constructor(config) {
        this.name = 'findLinkedIn';
        this.config = config;
        this.ai = new AIClient()
        this.definition = {
            name: this.name,
            goal: 'Find LinkedIn URLs and names of individuals',
            args: {
                person: "<Title> at <Company> (string)"
            },
            returns: LinkedInResult,
        }

    }

    async analyzeLinkedInSerps(searchResults, person, pastResults) {
        const completion = await this.ai.run({
            responseFormat: LinkedInResult,
            messages: [
                {
                    role: "system",
                    content: `You are a search results analyzer. Return only the requested JSON structure without any additional formatting or text.
                    Analyze and prioritize relevant search results.`
                },
                {
                    role: "user",
                    content: `Search Results: ${JSON.stringify(searchResults, null, 2)}
                    Trying to find LinkedIn URL and name of people matching the following: ${person}

                    Make sure they are not already in the past results:
                    ${JSON.stringify(pastResults, null, 2)}

                    Extract relevant results from the search results and return them in the specified format.
                    If they could not be found, set wasFound to false.
                    `
                }
            ]
        });

        const results = completion

        if (results.wasFound) {
            console.log('Found', results.personName,',', results.personTitle, 'at', results.personCompany)
        } else {
            console.log('Could not find')
        }

        return results;
    }

    async execute(step, args) {
        console.log(`\n🔍 Finding LinkedIN ${args.person}`);
        
        const browser = await puppeteer.launch(this.config.puppeteer);
        
        try {
            const page = await browser.newPage();
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(`LinkedIn ${args.person}`)}`, { 
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
            const analysis = await this.analyzeLinkedInSerps(searchResults, args.person, step.workflowHistory?.filter(w => w.name === this.name));
            
            return {
                analysis
            }

        } catch (error) {
            console.error('❌ Error in LinkedIn search:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            await browser.close();
        }
    }
}

export default FindLinkedInWorkflow;
