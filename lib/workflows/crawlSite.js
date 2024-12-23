const puppeteer = require('puppeteer');
const z = require('zod');
const { default: OllamaClass } = require('../aiClients/ollama');
const { default: OpenAIClass } = require('../aiClients/openai');

const NextUrl = z.object({
    url: z.string(),
    reason: z.string(),
    referrer: z.string()
}).required({
    url: true,
    reason: true,
    referrer: true
}).strict();

const PageContent = z.object({
    relevantData: z.array(z.object({
        title: z.string(),
        reason: z.string(),
        data: z.string(),
        sourceURL: z.string(),
    })),
    nextUrls: z.array(NextUrl),
}).required({
    relevantData: true,
    nextUrls: true
}).strict();

const Output = z.object({
    results: PageContent,
    nextUrls: z.array(z.string()),
    confidence: z.number()
}).required({
    results: true,
    nextUrls: true,
    confidence: true
}).strict();

class CrawlSiteWorkflow {
    constructor(config) {
        this.name = 'crawlSite';
        this.definition = {
            name: this.name,
            goal: 'Crawls a website to extract relevant information and find next URLs to crawl, if applicable.',
            args: {
                url: "string",
                reason: "string",
            },
            returns: Output,
        }
        this.config = config;
        this.ai = new OpenAIClass()
    }

    async analyzePageContent(content, reason, context) {
        const completion = await this.ai.run({
            responseFormat: PageContent,
            messages: [
                {
                    role: "system",
                    content: `You are an expert at analyzing web pages and extracting structured information. 
                    Return structured data matching our schema requirements, and if applicable, the next URLs to crawl.`
                },
                {
                    role: "user",
                    content: `Analyze this webpage content in the context of: "${context}"

                    We are looking for: "${reason}"
                    
                    Content:
                    ${content}
                    
                    Return well-structured data matching the data we are searching for. Do not repeat URLs which we have already crawled in nextURLs`
                }
            ]
        });

        const analysis = completion;
        
        // Enhanced logging
        console.log(`\n📊 Page Analysis:`);
        if (analysis.relevantData.length > 0) {
            console.log(`Found ${analysis.relevantData.length} relevant items:`);
            analysis.relevantData.forEach((item, index) => {
                console.log(`  ${index + 1}. ${item.title}`);
            });
        } else {
            console.log(`⚠️ No relevant items found. Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);
        }

        if (analysis.nextUrls.length > 0) {
            console.log(`\n🔗 Found ${analysis.nextUrls.length} relevant navigation links`);
        }

        return analysis;
    }

    async execute(step, args) {
        console.log(`\n🌐 Crawling: ${args.url}`);
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });
        
        try {
            const page = await browser.newPage();
            
            // Set longer timeouts
            page.setDefaultNavigationTimeout(30000);
            page.setDefaultTimeout(30000);

            // Handle navigation errors
            page.on('error', err => {
                console.error('Page error:', err);
            });

            // Navigate with retry logic
            let content = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await page.goto(args.url, { 
                        waitUntil: 'networkidle0',
                        timeout: 30000
                    });
                    
                    // Wait for content to load
                    await page.waitForSelector('body', { timeout: 10000 });

                    await page.evaluate(() => {
                        const scripts = document.querySelectorAll('script');
                        scripts.forEach(script => script.remove());

                        // Remove <style> tags
                        const styles = document.querySelectorAll('style');
                        styles.forEach(style => style.remove());

                        // Remove <img> tags
                        const images = document.querySelectorAll('img');
                        images.forEach(img => img.remove());

                        const svg = document.querySelectorAll('svg');
                        svg.forEach(svg => svg.remove());

                        const iframe = document.querySelectorAll('iframe');
                        iframe.forEach(iframe => iframe.remove());
                    });

                    content = await page.content();
                    
                    break;
                } catch (error) {
                    if (attempt === 3) throw error;
                    console.log(`\n⚠️ Retry attempt ${attempt}/3...`);
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                }
            }

            if (!content) {
                throw new Error('Failed to extract page content');
            }

            // Analyze content using AI
            const analysis = await this.analyzePageContent(
                JSON.stringify(content),
                args.reason,
                step
            );
            
            return analysis;

        } catch (error) {
            console.error('\n❌ Error crawling site:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            await browser.close();
        }
    }
}

module.exports = CrawlSiteWorkflow; 