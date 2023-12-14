/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */
import request from 'request';
import { PlanContext, transformToPlan } from './transform';
import { Application } from './types';
import { KapetaAPI } from '@kapeta/nodejs-api-client';

export type PromptResult = {
    explanation: string;
    response: string;
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

const AI_BASE_URL = 'https://ai.kapeta.com';

class AIClient {
    private readonly _baseUrl: string;

    constructor() {
        this._baseUrl = AI_BASE_URL;
    }

    public async sendPrompt(handle: string, prompt: string, threadId?: string): Promise<PromptResult> {
        const url = `${this._baseUrl}/v1/plan?kind=chat`;
        const body: APIBody = {
            question: prompt,
            threadid: threadId,
        };

        const headers: { [k: string]: string } = {};
        const api = new KapetaAPI();
        if (api.hasToken()) {
            headers['Authorization'] = `Bearer ${await api.getAccessToken()}`;
        }

        const options = {
            url,
            method: 'POST',
            json: true,
            body,
            headers,
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
                        response: application.response,
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
