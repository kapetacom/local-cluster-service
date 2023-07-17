import { LogEntry, LogLevel, LogSource } from '../types.js';

const MAX_LINES = 1000;
export class LogData {
    public static readonly MAX_LINES = MAX_LINES;
    private readonly entries: LogEntry[] = [];
    constructor() {}

    /**
     *
     * @param {string} msg
     * @param {string} [level]
     * @param {string} [source]
     */
    addLog(msg: string, level: LogLevel = 'INFO', source: LogSource = 'stdout') {
        while (this.entries.length > MAX_LINES) {
            this.entries.shift();
        }

        if (!msg.endsWith('\n')) {
            msg += '\n';
        }
        this.entries.push({
            time: Date.now(),
            message: msg,
            level,
            source,
        });
    }

    /**
     *
     * @return {LogEntry[]}
     */
    getLogs() {
        return this.entries;
    }

    toString() {
        return this.getLogs()
            .map((entry) => entry.message)
            .join('\n');
    }
}
