import NodeCache from 'node-cache';

const DEFAULT_CACHE_TTL = 60 * 1000; // 1 min
export interface CacheEntry<T = any> {
    expires: number;
    data: T;
}
class CacheManager {
    private cache: NodeCache = new NodeCache();

    public flush() {
        this.cache.flushAll();
    }

    public doCached<T>(key: string, getter: () => T, ttl = DEFAULT_CACHE_TTL) {
        const data = this.cache.get<T>(key);
        if (data !== undefined) {
            return data;
        }
        const result = getter();
        this.cache.set(key, result, ttl);
        return result;
    }

    public get<T>(key: string): T | undefined {
        return this.cache.get<T>(key);
    }

    public set<T>(key: string, data: T, ttl = DEFAULT_CACHE_TTL) {
        this.cache.set(key, data, ttl);
    }

    public has(key: string): boolean {
        return this.cache.has(key);
    }

    public remove(key: string) {
        return this.cache.del(key);
    }
}

export const cacheManager = new CacheManager();

export const doCached = <T>(key: string, getter: () => T, ttl = DEFAULT_CACHE_TTL) =>
    cacheManager.doCached(key, getter, ttl);
