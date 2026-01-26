export interface Env {
    MAINTENANCE_PAGE_URL: string;
    MAINTENANCE_MODE?: string; // "true" or "false"
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // 0. Manual Maintenance Mode Check
        if (env.MAINTENANCE_MODE === "true") {
            return handleMaintenance(env);
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
            return handleMaintenance(env);
        }
    },
};

async function handleMaintenance(env: Env): Promise<Response> {
    try {
        const pageResponse = await fetch(env.MAINTENANCE_PAGE_URL);
        const maintenanceUrl = new URL(env.MAINTENANCE_PAGE_URL);

        // Rewrite HTML to use absolute URLs for assets
        // This allows the browser to fetch assets directly from the maintenance page origin
        const rewriter = new HTMLRewriter()
            .on('link[href]', new AttributeRewriter('href', maintenanceUrl.origin))
            .on('script[src]', new AttributeRewriter('src', maintenanceUrl.origin))
            .on('img[src]', new AttributeRewriter('src', maintenanceUrl.origin))
            .on('source[src]', new AttributeRewriter('src', maintenanceUrl.origin))
            .on('source[srcset]', new AttributeRewriter('srcset', maintenanceUrl.origin));

        const transformedResponse = rewriter.transform(pageResponse);

        return new Response(transformedResponse.body, {
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

// HTMLRewriter handler to convert relative URLs to absolute URLs
class AttributeRewriter {
    private attributeName: string;
    private baseUrl: string;

    constructor(attributeName: string, baseUrl: string) {
        this.attributeName = attributeName;
        this.baseUrl = baseUrl;
    }

    element(element: Element) {
        const attrValue = element.getAttribute(this.attributeName);
        if (attrValue && !attrValue.startsWith('http') && !attrValue.startsWith('//') && !attrValue.startsWith('data:')) {
            // Convert relative URL to absolute URL
            const absoluteUrl = new URL(attrValue, this.baseUrl).toString();
            element.setAttribute(this.attributeName, absoluteUrl);
        }
    }
}
