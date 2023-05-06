const MAX_LINES = 1000;

class LogData {

    constructor() {
        /**
         *
         * @type {LogEntry[]}
         */
        this.entries = [];
    }

    /**
     *
     * @param {string} msg
     * @param {string} [level]
     * @param {string} [source]
     */
    addLog(msg, level = 'INFO', source = 'STDOUT') {
        while(this.entries.length > MAX_LINES) {
            this.entries.shift();
        }

        if (!msg.endsWith('\n')) {
            msg += '\n';
        }
        this.entries.push({
            time: Date.now(),
            message: msg,
            level,
            source
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
        return this.getLogs().map(entry => entry.message).join('\n');
    }
}

LogData.MAX_LINES = MAX_LINES;

module.exports = LogData;