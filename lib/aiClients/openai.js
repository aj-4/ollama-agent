import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod.mjs";

class OpenAIClass {
    constructor() {
        this.model = 'gpt-4o'
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    }

    async run({messages, responseFormat}) {
        const completion = await this.openai.beta.chat.completions.parse({
            model: this.model,
            response_format: zodResponseFormat(responseFormat, "responseFormat"),
            messages: messages
        });

        return completion.choices[0].message.parsed
    }
}

export default OpenAIClass