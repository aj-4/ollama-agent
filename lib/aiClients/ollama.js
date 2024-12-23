import {Ollama} from "ollama";
import {zodToJsonSchema} from "zod-to-json-schema"
import {z} from "zod"

class OllamaClass {
    constructor() {
        this.ollama = new Ollama({ host: 'http://127.0.0.1:11434' })
        this.model = 'llama3.2:3b-instruct-q8_0' 
    }

    async run({messages, responseFormat}) {
        const completion = await this.ollama.chat({
            model: this.model,
            format: zodToJsonSchema(responseFormat),
            messages: messages
        });

        return responseFormat.parse(JSON.parse(completion.message.content))
    }

    async example() {
        const res = await this.run({
            messages: [{role: "user", content: "Give me 10 fun facts about the history of the internet"}],
            responseFormat: z.object({
                facts: z.array(z.string())
            })
        })
        console.log(res)
    }
}

export default OllamaClass