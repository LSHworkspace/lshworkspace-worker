import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorker } from './worker.ts'

const maintenanceHtml = '<!doctype html><title>Maintenance</title><div id="root">Offline</div>'
const silentLogger = { warn() {} }

test('passes through successful origin responses', async () => {
    const worker = createWorker(maintenanceHtml, {
        fetcher: async () => new Response('origin', { status: 200 }),
        logger: silentLogger,
    })

    const response = await worker.fetch(new Request('https://lshworkspace.com/'))

    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'origin')
})

test('passes through origin 4xx responses', async () => {
    const worker = createWorker(maintenanceHtml, {
        fetcher: async () => new Response('missing', { status: 404 }),
        logger: silentLogger,
    })

    const response = await worker.fetch(new Request('https://lshworkspace.com/missing'))

    assert.equal(response.status, 404)
    assert.equal(await response.text(), 'missing')
})

test('replaces the known broken legacy maintenance page even when it returns 200', async () => {
    const legacyHtml = '<link href="https://maintenancepage.lshworkspace.com/assets/index.css">'
    const worker = createWorker(maintenanceHtml, {
        fetcher: async () => new Response(legacyHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        }),
        logger: silentLogger,
    })
    const request = new Request('https://lshworkspace.com/', {
        headers: { Accept: 'text/html' },
    })

    const response = await worker.fetch(request)

    assert.equal(response.status, 503)
    assert.equal(response.headers.get('X-LSHworkspace-Fallback'), 'origin-invalid-maintenance-page')
    assert.equal(await response.text(), maintenanceHtml)
})

test('returns inline HTML with 503 for navigation requests when origin fails', async () => {
    const worker = createWorker(maintenanceHtml, {
        fetcher: async () => new Response('failed', { status: 502 }),
        logger: silentLogger,
    })
    const request = new Request('https://lshworkspace.com/', {
        headers: { Accept: 'text/html' },
    })

    const response = await worker.fetch(request)

    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate')
    assert.equal(response.headers.get('Retry-After'), '300')
    assert.equal(response.headers.get('X-LSHworkspace-Fallback'), 'origin-502')
    assert.match(response.headers.get('Content-Security-Policy'), /script-src 'unsafe-inline'/)
    assert.equal(await response.text(), maintenanceHtml)
})

test('returns JSON 503 for API requests', async () => {
    const worker = createWorker(maintenanceHtml, {
        fetcher: async () => {
            throw new Error('network down')
        },
        logger: silentLogger,
    })
    const request = new Request('https://lshworkspace.com/api/status', {
        headers: { Accept: 'application/json' },
    })

    const response = await worker.fetch(request)

    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Content-Type'), 'application/json; charset=UTF-8')
    assert.deepEqual(await response.json(), { error: 'service_unavailable' })
})

test('returns a compact 503 for asset requests', async () => {
    const worker = createWorker(maintenanceHtml, {
        fetcher: async () => new Response('failed', { status: 503 }),
        logger: silentLogger,
    })

    const response = await worker.fetch(
        new Request('https://lshworkspace.com/app.js', {
            headers: { Accept: '*/*' },
        }),
    )

    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=UTF-8')
    assert.equal(await response.text(), 'System Maintenance')
})

test('falls back after the origin timeout', async () => {
    const worker = createWorker(maintenanceHtml, {
        fetcher: async (_request, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'))
            })
        }),
        logger: silentLogger,
        timeoutMs: 5,
    })
    const request = new Request('https://lshworkspace.com/', {
        headers: { Accept: 'text/html' },
    })

    const response = await worker.fetch(request)

    assert.equal(response.status, 503)
    assert.equal(response.headers.get('X-LSHworkspace-Fallback'), 'origin-timeout')
})
