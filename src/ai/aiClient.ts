/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */
import request from 'request';
import { PlanContext, transformToPlan } from './transform';
import { Application } from './types';
import { KapetaAPI } from '@kapeta/nodejs-api-client';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { getRemoteUrl } from '../utils/utils';

export type PromptResult = {
    explanation: string;
    response: string;
    context?: PlanContext;
};

export interface AIMessage {
    content: string;
    role: 'user' | 'assistant';
}

export interface AIRequest {
    messages: AIMessage[];
}

class AIClient {
    private readonly _baseUrl: string;

    constructor() {
        this._baseUrl = getRemoteUrl('ai-service', 'https://ai.kapeta.com');
    }

    public async sendPrompt(handle: string, body: AIRequest): Promise<PromptResult> {
        const url = `${this._baseUrl}/v1/plan?type=chat`;

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
            request(options, async (error, response, application: Application) => {
                if (error) {
                    console.error(error);
                    reject(error);
                }

                if (response.statusCode !== 200) {
                    console.log('Prompt failed', response.statusCode, response.body);
                    reject(new Error(`Invalid response code: ${response.statusCode}`));
                    return;
                }

                try {
                    if (application?.name) {
                        const planContext = await transformToPlan(handle, application);
                        resolve({
                            explanation: application.explanation,
                            response: application.response ?? application.explanation ?? 'Plan was generated',
                            context: planContext,
                        });
                    } else {
                        resolve({
                            explanation: application.explanation,
                            response:
                                application.response ??
                                application.explanation ??
                                'I did not understand your request. Please rephrase.',
                        });
                    }
                } catch (err: any) {
                    console.error(err);
                    resolve({
                        explanation: '',
                        response: 'I did not understand your request. Please rephrase.',
                    });
                }
            });
        });
    }
}

export const aiClient = new AIClient();
