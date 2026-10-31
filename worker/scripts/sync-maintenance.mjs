import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourcePath = process.argv[2]

if (!sourcePath) {
    throw new Error('Usage: npm run sync:maintenance -- /absolute/path/to/dist/index.html')
}

const html = fs.readFileSync(sourcePath, 'utf-8')
const violations = [
    /<script\b[^>]*\bsrc=/i,
    /<link\b[^>]*\brel=["']stylesheet["']/i,
    /@import\s+(?:url\()?\s*["']?https?:\/\//i,
    /url\(\s*["']?https?:\/\//i,
]

if (violations.some((pattern) => pattern.test(html))) {
    throw new Error('Maintenance HTML is not self-contained.')
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const targetPath = path.resolve(scriptDirectory, '../src/maintenance.html')
fs.copyFileSync(sourcePath, targetPath)
console.log(`Synced ${Buffer.byteLength(html)} bytes to ${targetPath}.`)
