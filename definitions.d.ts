declare module '@kapeta/nodejs-api-client' {
    export class KapetaAPI {
        getCurrentIdentity(): Promise<any>;
        getMemberships(identityId: string): Promise<any>;
    }
}

declare module '@kapeta/nodejs-registry-utils' {
    import { Dependency, Kind } from '@kapeta/schemas';

    export interface AssetVersion {
        content: Kind;
        dependencies: Dependency[];
    }

    export class RegistryService {
        constructor(url: string);

        async getVersion(fullName: string, version: string): Promise<AssetVersion>;
    }

    export const Config: any;
    export const Actions: any;
}
