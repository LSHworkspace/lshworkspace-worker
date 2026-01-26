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
            const response = await fetch(request, { signal: controller.signal });
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

    // Pass-through for static assets (CSS, JS, Images, etc.)
    // React apps usually serve assets under /assets/
    if (requestUrl.pathname.startsWith("/assets/") || requestUrl.pathname.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
        const assetUrl = new URL(requestUrl.pathname, maintenanceUrl.origin);
        return fetch(assetUrl.toString(), request);
    }

    // Serve Maintenance Page (HTML) with 503
    try {
        const pageResponse = await fetch(env.MAINTENANCE_PAGE_URL);

        return new Response(pageResponse.body, {
            status: 503,
            headers: {
                "Content-Type": "text/html;charset=UTF-8",
                "Cache-Control": "no-store",
            },
        });
    } catch (err) {
        // Last Resort Fallback
        return new Response("System Maintenance", { status: 503 });
    }
}
