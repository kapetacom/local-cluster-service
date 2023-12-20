/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */
export interface Database {
    name: string;
    type: 'mongodb' | 'postgres';
}

export interface BackendService {
    name: string;
    title: string;
    description: string;
    targetLanguage: 'java' | 'node';
    databases: Database[] | null;
}

export interface FrontendService {
    name: string;
    title: string;
    description: string;
    targetLanguage: 'react';
}

export interface Endpoint {
    type: 'backend' | 'frontend';
    name: string;
}

export interface Connection {
    provider: Endpoint;
    consumer: Endpoint;
}

export interface Application {
    kind: 'core/plan';
    name: string;
    title: string;
    description: string;
    backends: BackendService[];
    frontends: FrontendService[];
    connections: Connection[];
    explanation: string;
    response: string;
}
