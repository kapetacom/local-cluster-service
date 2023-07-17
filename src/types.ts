import EventEmitter from 'events';
import express from 'express';
import { Resource } from '@kapeta/schemas';
import { StringBodyRequest } from './middleware/stringBody.js';
import { KapetaRequest } from './middleware/kapeta.js';

export type StringMap = { [key: string]: string };
export type AnyMap = { [key: string]: any };

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE' | 'FATAL';
export type LogSource = 'stdout' | 'stderr';
export type EnvironmentType = 'docker' | 'process';
export interface LogEntry {
    source: LogSource;
    level: LogLevel;
    message: string;
    time: number;
}

export interface BlockProcessParams {
    id: string;
    ref: string;
    configuration?: AnyMap;
}

export type ProcessType = 'docker' | 'local';

export interface ProcessDetails {
    pid: number | string;
    type: ProcessType;
    portType?: string;
    output: EventEmitter;
    logs: () => LogEntry[];
    stop: () => Promise<void> | void;
}

export interface ProcessInfo extends ProcessDetails {
    id: string;
    ref: string;
    name: string;
}

export type InstanceInfo = {
    systemId: string;
    instanceId: string;
    address?: string;
    health?: string | null;
    status: string;
    pid?: number | string | null;
    type: ProcessType;
    portType?: string;
};

interface ResourceRef {
    blockId: string;
    resourceName: string;
}

export type ProxyRequestHandler = (req: StringBodyRequest, res: express.Response, info: ProxyRequestInfo) => void;

export interface Connection {
    mapping: any;
    provider: ResourceRef;
    consumer: ResourceRef;
}

export interface OperatorInfo {
    host: string;
    port: string;
    type: string;
    protocol: string;
    options: AnyMap;
    credentials: AnyMap;
}

export interface ProxyRequestInfo {
    address: string;
    connection: Connection;
    providerResource: Resource;
    consumerResource: Resource;
    consumerPath: string;
}

export interface SimpleResponse {
    code: number;
    headers: StringMap;
    body: any;
}

export interface SimpleRequest {
    method: string;
    url: string;
    headers: StringMap;
    body: any;
}

export type KapetaBodyRequest = KapetaRequest & StringBodyRequest;
