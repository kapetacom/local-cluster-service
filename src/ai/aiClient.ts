import request from 'request';
import { PlanContext, transformToPlan } from './transform';
import { Application } from './types';

export type PromptResult = {
    explanation: string;
    context: PlanContext;
    threadId: string;
};

interface APIBody {
    question: string;
    threadid?: string;
}

interface APIResponse {
    answer: string;
    threadid: string;
}

class AIClient {
    private readonly _baseUrl: string;

    constructor() {
        this._baseUrl = 'https://ai.staging.kapeta.com';
    }

    public async sendPrompt(handle: string, prompt: string, threadId?: string): Promise<PromptResult> {
        const url = `${this._baseUrl}/`;
        const body: APIBody = {
            question: prompt,
            threadid: threadId,
        };
        const options = {
            url,
            method: 'POST',
            json: true,
            body,
        };
        return new Promise((resolve, reject) => {
            request(options, async (error, response, body: APIResponse) => {
                if (error) {
                    console.error(error);
                    reject(error);
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`Invalid response code: ${response.statusCode}`));
                    return;
                }

                if (!body.answer) {
                    reject(new Error(`Invalid response: ${JSON.stringify(body)}`));
                    return;
                }
                try {
                    const [, answer] = body.answer.split('```json');
                    const application: Application = JSON.parse(answer.split('```')[0].trim());

                    const planContext = await transformToPlan(handle, application);

                    resolve({
                        explanation: application.explanation,
                        context: planContext,
                        threadId: body.threadid,
                    });
                } catch (err: any) {
                    console.log('Failed to parse response', err, body);
                    reject(err);
                }
            });
        });
    }
}

export const aiClient = new AIClient();
