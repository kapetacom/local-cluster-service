/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import express from 'express';
import { Connection, Resource } from '@kapeta/schemas';
import { StringBodyRequest } from './middleware/stringBody';
import { KapetaRequest } from './middleware/kapeta';

export type StringMap = { [key: string]: string };
export type AnyMap = { [key: string]: any };
export type SourceOfChange = 'user' | 'filesystem';
export type WatchEventName = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';
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

export interface Health {
    cmd: string;
    interval?: number;
    timeout?: number;
    retries?: number;
}

export type PortInfo = { port: number; type: 'tcp' | 'udp' } | number | string;

export type LocalImageOptions<Credentials = AnyMap, Options = AnyMap> = {
    image: string;
    ports: { [key: string]: PortInfo };
    credentials?: Credentials;
    options?: Options;
    cmd?: string;
    env?: AnyMap;
    health?: Health;
    mounts?: { [key: string]: string };
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

export interface OperatorInstancePort {
    protocol: string;
    port: number;
}

export interface OperatorInstanceInfo {
    hostname: string;
    ports: { [portType: string]: OperatorInstancePort };
    path?: string;
    query?: string;
    hash?: string;
    options?: AnyMap;
    credentials?: AnyMap;
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
