/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import express from 'express';
import { Connection, Resource } from '@kapeta/schemas';
import { StringBodyRequest } from './middleware/stringBody';
import { KapetaRequest } from './middleware/kapeta';

export const KIND_RESOURCE_OPERATOR = 'core/resource-type-operator';
export const KIND_BLOCK_TYPE = 'core/block-type';
export const KIND_BLOCK_TYPE_OPERATOR = 'core/block-type-operator';
export const KIND_BLOCK_TYPE_EXECUTABLE = 'core/block-type-executable';

export type StringMap = { [key: string]: string };
export type AnyMap = { [key: string]: any };
export type SourceOfChange = 'user' | 'filesystem';
export type WatchEventName = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';
export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE' | 'FATAL';
export type LogSource = 'stdout' | 'stderr';
export type EnvironmentType = 'docker' | 'process';

export const DOCKER_HOST_INTERNAL = 'host.docker.internal';

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

export type ProxyRequestHandler = (req: StringBodyRequest, res: express.Response, info: ProxyRequestInfo) => void;

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
