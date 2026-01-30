// ========================================
// REST Data Source (placeholder for server DB)
// ========================================
export class RestSource {
    constructor(options) {
        this.options = options;
    }

    async init() {
        return;
    }

    async _fetchWithTimeout(url, options) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            return response;
        } finally {
            clearTimeout(timeout);
        }
    }

    async getNoteByDate(key) {
        const url = `${this.options.baseUrl}/notes/${encodeURIComponent(key)}`;
        const res = await this._fetchWithTimeout(url, { method: 'GET' });
        if (!res.ok) {
            throw new Error(`REST get failed: ${res.status}`);
        }
        return res.json();
    }

    async saveOrUpdateNoteByDate(key, content) {
        const url = `${this.options.baseUrl}/notes/${encodeURIComponent(key)}`;
        const res = await this._fetchWithTimeout(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        if (!res.ok) {
            throw new Error(`REST save failed: ${res.status}`);
        }
        return res.json();
    }
}
