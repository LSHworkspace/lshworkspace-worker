export interface Env {
    MAINTENANCE_PAGE_URL: string;
    MAINTENANCE_MODE?: string; // "true" or "false"
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // 0. Manual Maintenance Mode Check
        if (env.MAINTENANCE_MODE === "true") {
            return handleMaintenance(request, env);
        }

        // 1. Timeout Logic (AbortController)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds timeout

        try {
            // 2. Fetch Upstream with Timeout
            // Create new headers without Host header to avoid Error 1003
            const headers = new Headers(request.headers);
            headers.delete('Host');

            const upstreamRequest = new Request(request.url, {
                method: request.method,
                headers: headers,
                body: request.body,
                redirect: 'follow',
            });

            const response = await fetch(upstreamRequest, { signal: controller.signal });
            clearTimeout(timeoutId); // Clear timeout on success

            // 3. Normal Operation Check
            if (response.status < 500) {
                return response;
            }

            // 4. Server Error (5xx) Detected
            throw new Error("Origin Down or 5xx Error");

        } catch (e) {
            // 5. Failover Logic (Timeout, Network Error, or 5xx)
            return handleMaintenance(request, env);
        }
    },
};

async function handleMaintenance(request: Request, env: Env): Promise<Response> {
    const maintenanceUrl = new URL(env.MAINTENANCE_PAGE_URL);
    const requestUrl = new URL(request.url);

    // Proxy all requests (HTML and assets) from maintenance page
    // This keeps the maintenance page URL hidden from the browser
    try {
        // Build the target URL: use the requested path with maintenance page origin
        const targetUrl = new URL(requestUrl.pathname + requestUrl.search, maintenanceUrl.origin);

        // Create a clean request without Host header to avoid Error 1003
        const proxyRequest = new Request(targetUrl.toString(), {
            method: request.method,
            headers: new Headers(), // No headers to avoid any conflicts
            redirect: 'follow',
        });

        const response = await fetch(proxyRequest);

        // For HTML, return with 503 status
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('text/html')) {
            return new Response(response.body, {
                status: 503,
                headers: {
                    "Content-Type": "text/html;charset=UTF-8",
                    "Cache-Control": "no-store",
                },
            });
        }

        // For assets (CSS, JS, images, etc.), return as-is
        return new Response(response.body, {
            status: response.status,
            headers: response.headers,
        });

    } catch (err) {
        // Last Resort Fallback
        return new Response("System Maintenance", { status: 503 });
    }
}
