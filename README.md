# LSHworkspace Edge Maintenance Worker

This Worker protects `lshworkspace.com` with a self-contained maintenance page.
The maintenance HTML is built from
`LSHworkspace/lshworkspace-maintenance-page`, embedded during CI, validated, and
then deployed to Cloudflare.

## Runtime switches

The switches are plain-text Cloudflare Worker variables. They can be changed by
running the **Worker CI/CD** workflow manually, or directly in the Cloudflare
dashboard.

| `MAINTENANCE_SYSTEM_ENABLED` | `FORCED_MAINTENANCE_ENABLED` | Behavior |
| --- | --- | --- |
| `false` | any value | Bypass all maintenance logic and return the origin response unchanged |
| `true` | `true` | Serve the maintenance page immediately without requesting the origin |
| `true` | `false` | Detect origin failures and serve the maintenance page only as a fallback |

Defaults are `true` and `false`, respectively, so deployments made before the
variables are created retain automatic fallback behavior.

Normal pushes deploy with `--keep-vars`, preventing code deployments from
silently resetting an operator's current mode. A manual workflow run applies
the selected switch values explicitly.

## Validation

```sh
cd worker
npm ci
npm run typecheck
npm test
```
