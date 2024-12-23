const Orchestrator = require('./orchestrator');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');

class AgentCLI {
    constructor() {
        this.orchestrator = new Orchestrator(config);
        this.contextFile = path.join(__dirname, '../data/context.json');
    }

    async loadContext() {
        try {
            const data = await fs.readFile(this.contextFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return null;
        }
    }

    async start() {
        try {
            console.log('\n🤖 AI Agent CLI');
            console.log('Type "exit" to quit, "context" to view current context\n');

            const savedContext = await this.loadContext();
            if (savedContext) {
                console.log('📂 Found saved context from previous session');
                const useSaved = await this.prompt('Would you like to continue from previous session? (y/n)');
                
                if (useSaved.toLowerCase() === 'y') {
                    this.orchestrator.initializeContext(savedContext);
                    console.log('Context loaded:', savedContext.originalPrompt);
                } else {
                    try {
                        await fs.unlink(this.contextFile);
                        console.log('Previous context cleared');
                    } catch (error) {
                        // File might not exist, which is fine
                    }
                    this.orchestrator.initializeContext();
                }
            }

            while (true) {
                let taskInput = await this.prompt('Enter your task (or command)');

                if (taskInput.toLowerCase() === 'exit') {
                    break;
                }

                try {
                    await this.orchestrator.setup(taskInput);

                    const result = await this.orchestrator.execute();
                    
                    if (!result.success) {
                        console.log('\n❌ Task failed:', result.error);

                        const retry = await this.prompt('Would you like to try a different approach? (y/n)');
                        if (retry.toLowerCase() !== 'y') {
                            continue;
                        }

                        const followUp = await this.prompt('Enter your follow-up task');
                        if (followUp) {
                            await this.orchestrator.execute(followUp);
                        }
                    }
                } catch (error) {
                    console.error('Error:', error);
                }
            }

        } finally {
            this.orchestrator.cleanup();
        }
    }

    async prompt(question) {
        return this.orchestrator.promptUser(question);
    }

    async saveContext(context) {
        try {
            await fs.mkdir(path.dirname(this.contextFile), { recursive: true });
            await fs.writeFile(this.contextFile, JSON.stringify(context, null, 2));
        } catch (error) {
            console.error('Error saving context:', error);
        }
    }
}

// Start the CLI
new AgentCLI().start().catch(console.error); 