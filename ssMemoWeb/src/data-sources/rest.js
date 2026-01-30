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

    async getNoteByDate(key) {
        const url = `${this.options.baseUrl}/notes/${encodeURIComponent(key)}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
            throw new Error(`REST get failed: ${res.status}`);
        }
        return res.json();
    }

    async saveOrUpdateNoteByDate(key, content) {
        const url = `${this.options.baseUrl}/notes/${encodeURIComponent(key)}`;
        const res = await fetch(url, {
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
