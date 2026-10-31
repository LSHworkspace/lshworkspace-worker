const DEFAULT_TIMEOUT_MS = 5_000
const RETRY_AFTER_SECONDS = 300
const LEGACY_BROKEN_ASSET_ORIGIN = 'https://maintenancepage.lshworkspace.com/assets/'

type Logger = Pick<Console, 'warn'>

interface WorkerOptions {
    fetcher?: typeof fetch
    logger?: Logger
    timeoutMs?: number
}

function isNavigationRequest(request: Request): boolean {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return false
    }

    const url = new URL(request.url)
    const accept = request.headers.get('Accept') ?? ''
    const destination = request.headers.get('Sec-Fetch-Dest')
    const hasFileExtension = /\/[^/]+\.[^/]+$/.test(url.pathname)

    return destination === 'document'
        || accept.includes('text/html')
        || (!url.pathname.startsWith('/api/') && !hasFileExtension)
}

function createFallbackResponse(
    request: Request,
    maintenanceHtml: string,
    reason: string,
): Response {
    const commonHeaders = {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Retry-After': String(RETRY_AFTER_SECONDS),
        'X-LSHworkspace-Fallback': reason,
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
    }

    if (isNavigationRequest(request)) {
        return new Response(request.method === 'HEAD' ? null : maintenanceHtml, {
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
                ...commonHeaders,
                'Content-Type': 'text/html; charset=UTF-8',
                'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
                'Vary': 'Accept, Sec-Fetch-Dest',
            },
        })
    }

    const wantsJson = request.headers.get('Accept')?.includes('application/json')
        || new URL(request.url).pathname.startsWith('/api/')

    return new Response(
        request.method === 'HEAD'
            ? null
            : wantsJson
                ? JSON.stringify({ error: 'service_unavailable' })
                : 'System Maintenance',
        {
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
                ...commonHeaders,
                'Content-Type': wantsJson
                    ? 'application/json; charset=UTF-8'
                    : 'text/plain; charset=UTF-8',
                'Vary': 'Accept',
            },
        },
    )
}

export function createWorker(
    maintenanceHtml: string,
    options: WorkerOptions = {},
) {
    const fetcher = options.fetcher ?? fetch
    const logger = options.logger ?? console
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return {
        async fetch(request: Request): Promise<Response> {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
            const pathname = new URL(request.url).pathname
            const inspectHeadNavigation = request.method === 'HEAD'
                && isNavigationRequest(request)

            try {
                const headers = new Headers(request.headers)
                headers.delete('Host')

                const upstreamRequest = new Request(request.url, {
                    method: inspectHeadNavigation ? 'GET' : request.method,
                    headers,
                    body: request.method === 'GET' || request.method === 'HEAD'
                        ? undefined
                        : request.body,
                    redirect: 'follow',
                })

                const response = await fetcher(upstreamRequest, {
                    signal: controller.signal,
                })

                if (response.status < 500) {
                    if (
                        response.status === 200
                        && isNavigationRequest(request)
                        && response.headers.get('Content-Type')?.includes('text/html')
                        && (await response.clone().text()).includes(LEGACY_BROKEN_ASSET_ORIGIN)
                    ) {
                        await response.body?.cancel()
                        const reason = 'origin-invalid-maintenance-page'
                        logger.warn('Serving maintenance fallback', { pathname, reason })
                        return createFallbackResponse(request, maintenanceHtml, reason)
                    }

                    if (inspectHeadNavigation) {
                        await response.body?.cancel()
                        return new Response(null, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers,
                        })
                    }

                    return response
                }

                await response.body?.cancel()
                const reason = `origin-${response.status}`
                logger.warn('Serving maintenance fallback', { pathname, reason })
                return createFallbackResponse(request, maintenanceHtml, reason)
            } catch (error) {
                const reason = controller.signal.aborted
                    ? 'origin-timeout'
                    : 'origin-unavailable'

                logger.warn('Serving maintenance fallback', {
                    pathname,
                    reason,
                    error: error instanceof Error ? error.name : 'UnknownError',
                })
                return createFallbackResponse(request, maintenanceHtml, reason)
            } finally {
                clearTimeout(timeoutId)
            }
        },
    }
}
