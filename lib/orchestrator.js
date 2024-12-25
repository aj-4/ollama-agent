const AIClient = require('./aiClients/index.js')
const fs = require('fs').promises
const path = require('path');
const readline = require('readline');
const { z } = require('zod');
const SaveResultsWorkflow = require('./workflows/saveResults.js');
const Workflows = require('./workflows/index.js').default;

console.log(Workflows)

const WorkflowSchema = z.object({
    name: z.string(),
    stepID: z.number(),
    args: z.array(z.object({
        key: z.string(),
        value: z.string(),
    })),
    goal: z.string(),
}).required({
    name: true,
    stepID: true,
    args: true,
    goal: true,
}).strict();

const StepSchema = z.object({
    id: z.number(),
    description: z.string(),
    requiredFields: z.array(z.string()),
    completionCriteria: z.string(),
    suggestedWorkflows: z.array(z.string()),
}).required({
    id: true,
    description: true,
    completionCriteria: true,
    requiredFields: true,
    suggestedWorkflows: true,
}).strict();

const ResultSchema = z.object({
    data: z.array(z.object({
        id: z.string(),
        fields: z.array(z.object({
            key: z.string(),
            value: z.string(),
            sourceUrls: z.array(z.string())
        })),
    })),
}).required({
    data: true,
}).strict();

class Orchestrator {
    constructor(config) {
        this.config = config;
        this.ai = new AIClient()
        this.workflows = {}
        for (const Workflow of Workflows) {
            const wf = new Workflow(config);
            this.workflows[wf.name] = wf;
        }
        this.context = null
        this.startTimeMS = Date.now()

        // Initialize readline interface
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    initializeContext(savedContext = null) {
        this.context = savedContext;
    }

    async promptUser(question) {
        return new Promise((resolve) => {
            this.rl.question(`\n❓ ${question}\n> `, (answer) => {
                resolve(answer);
            });
        });
    }

    cleanup() {
        if (this.rl) {
            this.rl.close();
        }
    }

    async saveContext() {
        try {
            const dataDir = path.join(process.cwd(), 'data');
            await fs.mkdir(dataDir, { recursive: true });

            await fs.writeFile(
                path.join(dataDir, 'context.json'),
                JSON.stringify(this.context, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving context:', error);
        }
    }

    async generateTasks(prompt) {
        const completion = await this.ai.run({
            responseFormat: z.object({
                steps: z.array(StepSchema),
            }),
            messages: [
                {
                    role: "system",
                    content: `Break down a data collection task into steps.
                    Use as few steps as possible.

                    Think of the steps in terms of what could be completed for a given record with a single workflow.
                    For example, scraping data from a website could find the company name, product prices, and other details, so it could be a single step.

                    Possible workflows are: ${Object.values(this.workflows).map(w => w.definition).join(', ')}
                    
                    Return JSON format:
                    {
                        "steps": [
                            {
                                "id": number,
                                "description": "what this step does",
                                "requiredFields": ["fields", "to", "collect"],
                                "completionCriteria": "when is this step done",
                                "suggestedWorkflows": ["searchGoogle", "crawlSite x10", "findLinkedIn x10"]
                            }
                        ]
                    }

                    Example Task: "Find 10 shopify apps and their founder LinkedIn profiles"
                    {
                        "steps": [
                            {
                                "id": 1,
                                "description": "Get Shopify 10 app names and URLs from a Google search",
                                "requiredFields": ["appName", "appUrl"],
                                "completionCriteria": "10 Shopify apps found",
                                "suggestedWorkflows": ["searchGoogle", "crawlSite x as many as needed"]
                            },
                            {
                                "id": 2,
                                "description": "Get Founder names and LinkedIn URLs",
                                "requiredFields": ["founderName", "founderLinkedinUrl"],
                                "completionCriteria": "10 founders found",
                                "suggestedWorkflows": ["findLinkedIn x10"]
                            }
                        ]
                    }

                    Example 2: "Find 10 Shopify apps and their pricing"
                    {
                        "steps": [
                            {
                                "id": 1,
                                "description": "Get Shopify 10 app names and URLs from a Google search",
                                "requiredFields": ["appName", "appUrl"],
                                "completionCriteria": "10 Shopify apps found",
                                "suggestedWorkflows": ["searchGoogle", "crawlSite x as many as needed"]
                            }
                        ]
                    }
                    `
                },
                {
                    role: "user",
                    content: `Task: "${prompt}"`
                }
            ]
        });

        console.log(completion)

        const steps = completion.steps;

        console.log('\n📋 Task Steps:', steps.map(step => `${step.id}: ${step.description}`).join('\n') + '\n\n');

return steps
    }

    async selectWorkflow(step, resultsSoFar=[], retry=false) {
        // Log current state for debugging
        // Select a workflow to run based on context data
        const completion = await this.ai.run({
            responseFormat: WorkflowSchema,
            messages: [
                {
                    role: "system",
                    content: `Select the next workflow to run to complete the this step
                    Return the name and parameters of the workflow to run. If a workflow with the same parameters has already been run (in workflowHistory), skip it.
                    Ex, do not run the same Google search, or scrape the same site twice.

                    If you're not making progress, try backing up. For example multiple scrapes in a row without finding the data we need, back up to google search.

                    For parameter generation, only use the params in the function definition and ensure they are populated with the correct values.

                    Prioritize using web data, in other words, all data we collect should have a source URL that we have crawled.
                    Do not hallucinate data, make sure any sources are returned directly from either Google search results or the sites we have crawled.
                    If we have a sourceURL, we should have explicitly crawled the site or found the url in a Google SERP - don't just add random URLs otherwise.

                    If applicable, use urls / data from the resultsSoFar to inform the workflow.

                    Also if we ask for specific data, such as pricing, do not just save a link. Try to find the pricing value on a specific web page.

                    return the workflow name and args as a JSON object (IMPORTANT! you must return the args):
                    {
                        "name": "workflowName",
                        "stepID": ${step.id},
                        "args": {
                            "argName": "argValue" // example: "searchQuery": "shopify apps" (must be provided in function definition)
                        },
                        "goal": "what this workflow is trying to achieve?"
                    }
                    `
                },
                {
                    role: "user",
                    content: `
                    Current Step: ${JSON.stringify(step)}
                    Workflow Function Options (Choose one): ${JSON.stringify(Object.values(this.workflows).map(w => w.definition))}
                    Results So Far: ${JSON.stringify(resultsSoFar)}
                    `
                }
            ]
        });

        const selectedWorkflow = completion;
        if (!selectedWorkflow.name || !this.workflows[selectedWorkflow.name]) {
            if (retry) {
                throw new Error('Generated workflow not found')
            }
            console.error('Workflow not found, retrying...')
            return this.selectWorkflow(step, resultsSoFar, true)
        }
        const args = {}
        selectedWorkflow.args.forEach(arg => {
            args[arg.key] = arg.value
        })
        selectedWorkflow.args = args
        return selectedWorkflow;
    }

    async updateStep(workflowResult, stepID, workflowName, args) {
        // merge results into context with ai
        const step = this.context.steps.find(step => step.id === stepID)
        const completion = await this.ai.run({
            responseFormat: ResultSchema,
            messages: [
                {
                    role: "system",
                    content: `According to the input prompt and the results of the workflow, if we have found the data we need, mergethe results into our existing results array.
                    If we have not found the data we need, return the results array as is
                    `
                },
                {
                    role: "user",
                    content: `
                    Description: ${step.description}
                    Required Fields: ${step.requiredFields.join(', ')}
                    Existing Results: ${JSON.stringify(step.results)}
                    New Results: ${JSON.stringify(workflowResult)}
                    `
                }
            ]
        });

        const mergedResults = completion

        console.log('mergedResults', mergedResults)

        step.results = mergedResults.data
        step.workflowHistory.push({...workflowResult, workflowName, args});

        const completion2 = await this.ai.run({
            responseFormat: StepSchema,
            messages: [
                {
                    role: "system",
                    content: `
                    According to the current step, if it has been achieved according to the results & completion criteria, mark it as completed.

                    Ex. if it says we need 10 results, and we have 10 results, mark it as true. Otherwise false
                    `
                },
                {
                    role: "user",
                    content: `
                    Step: ${JSON.stringify(step)}
                    `
                }
            ]
        });

        const updatedStep = {...step, ...completion2};
        console.log('updatedStep', updatedStep)
        this.context.steps = this.context.steps.map(step => step.id === stepID ? updatedStep : step);

        // save context
        await this.saveContext();
    }

    async checkStepIsComplete(step) {
        const completion = await this.ai.run({
            responseFormat: z.object({
                complete: z.boolean(),
                explanation: z.string(),
            }),
            messages: [
                {role: "user", content: `
                    Check if the step is complete according to the results and completion criteria: 
                    ${JSON.stringify(step)}`}
            ]
        });
        if (completion.complete) {
            console.log('Step is complete:', completion.explanation)
        } 
        return completion.complete
    }

    async setup(userPrompt) {
        try {
            
            const steps = await this.generateTasks(userPrompt)

            this.context = {
                originalPrompt: userPrompt,
                steps: steps.map(step => ({
                    ...step,
                    completed: false,
                    workflowHistory: [],
                    results: []
                })),
            };

            console.log('Context:', this.context)
            await this.saveContext();

            return this.context;
        } catch (error) {
            console.error('Orchestrator error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async mergeResults(completeStepsData) {
        const completion = await this.ai.run({
            responseFormat: ResultSchema,
            messages: [
                {
                    role: "system",
                    content: `Merge the results of the completed steps into a single results array`
                },
                {
                    role: "user",
                    content: `Completed Steps: ${JSON.stringify(completeStepsData)}`
                }
            ]
        });
        return completion.data;
    }

    async execute() {
        try {
            let complete = false
            while (!complete) {
                const completeStepsData = this.context.steps.filter(step => step.completed).map(step => ({
                    id: step.id,
                    results: step.results
                }))
                const step = this.context.steps.find(step => !step.completed)
                const selectedWorkflow = await this.selectWorkflow(step, completeStepsData);
                console.log('Running Workflow:', selectedWorkflow.name, 'to', selectedWorkflow.goal, 'args:', selectedWorkflow.args);
                const result = await this.workflows[selectedWorkflow.name].execute(step, selectedWorkflow.args);
                await this.updateStep(result, step.id, selectedWorkflow.name, selectedWorkflow.args);
                const completed = await this.checkStepIsComplete(step);
                if (completed) {
                    this.context.steps = this.context.steps.map(s => s.id === step.id ? {...s, completed: true} : s)
                }
                const allComplete = this.context.steps.every(s => Boolean(s.completed))
                if (allComplete) {
                    const allResults = this.context.steps.map(s => s.results)
                    const mergedResults = await this.mergeResults(allResults)
                    console.log('Merged Results:', mergedResults)
                    const saveResultsWorkflow = new SaveResultsWorkflow(this.config)
                    await saveResultsWorkflow.execute(this.context, mergedResults)
                    console.log('Task Complete!');
                    return {
                        success: true,
                        context: this.context
                    }
                }
            }

            return {
                success: false,
                error: 'Could not complete all steps'
            };

        } catch (error) {
            console.error('Orchestrator error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = Orchestrator; 