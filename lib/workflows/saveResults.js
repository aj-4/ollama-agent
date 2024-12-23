const fs = require('fs').promises;
const path = require('path');
const { z } = require('zod');  

const Output = z.object({
    filepath: z.string(),
}).required({
    filepath: true,
}).strict();

class SaveResultsWorkflow {
    constructor(config) {
        this.config = config;
        this.name = 'saveResults';
        this.resultsDir = path.join(process.cwd(), 'results');
        this.definition = {
            name: this.name,
            goal: 'Save the results to a file',
            args: {
                dataToSave: 'json'
            },
            returns: Output,
        }
    }

    getFilename(context) {
        // Convert prompt to kebab case
        return context.originalPrompt
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    }

    async execute(context, saveData) {
        try {
            await fs.mkdir(this.resultsDir, { recursive: true });

            const filename = `${this.getFilename(context)}.${this.format}`;
            const filepath = path.join(this.resultsDir, filename);

            let content = typeof saveData === 'object' 
                    ? JSON.stringify(saveData, null, 2) + '\n'
                    : saveData + '\n';

            console.log('Saving results to', filepath, 'content:', content)

            // Append to existing file
            await fs.appendFile(filepath, content, 'utf8');
            console.log(`Results Saved`);

            let currentContent = '';
            try {
                currentContent = await fs.readFile(filepath, 'utf8');
            } catch (err) {
                // File doesn't exist yet, that's ok
            }

            const totalItems = currentContent.split('\n').filter(line => line.trim()).length;

            return {
                success: true,
                filepath,
                metadata: {
                    totalItems
                }
            };
        } catch (error) {
            console.error('Error saving results:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    convertToCSV(data) {
        // todo
    }
}

module.exports = SaveResultsWorkflow; 