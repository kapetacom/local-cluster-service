import EventEmitter from 'events';
import express from 'express';
import { Resource } from '@kapeta/schemas';
import { StringBodyRequest } from './middleware/stringBody';
import { KapetaRequest } from './middleware/kapeta';

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

export enum InstanceType {
    DOCKER = 'docker',
    LOCAL = 'local',
    UNKNOWN = 'unknown',
}
export enum InstanceOwner {
    INTERNAL = 'internal',
    EXTERNAL = 'external',
}

export enum InstanceStatus {
    STOPPED = 'stopped',
    STARTING = 'starting',
    BUSY = 'busy',
    READY = 'ready',
    STOPPING = 'stopping',
    UNHEALTHY = 'unhealthy',
    FAILED = 'failed',
}

export enum DesiredInstanceStatus {
    STOP = 'stop',
    RUN = 'run',
    EXTERNAL = 'external',
}

export type ProcessInfo = {
    type: InstanceType;
    pid?: number | string | null;
    portType?: string;
};

export type InstanceInfo = {
    systemId: string;
    instanceId: string;
    ref: string;
    name: string;
    type: InstanceType;
    owner: InstanceOwner;
    status: InstanceStatus;
    errorMessage?: string;
    desiredStatus: DesiredInstanceStatus;
    address?: string;

    startedAt?: number;
    health?: string | null;
    pid?: number | string | null;
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
