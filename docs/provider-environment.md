# Provider environment V1

This reference is generated from the canonical schema exported by `@union-networks/server`. The dashboard uses these exact names.

## base

| Variable | Required | Sensitivity |
| --- | --- | --- |
| `UNET_PROVIDER_SERVICE_ID` | Yes | public |
| `UNET_PROVIDER_ORIGIN` | Yes | public |
| `UNET_CONTROL_PLANE_URL` | Yes | public |

## claim

| Variable | Required | Sensitivity |
| --- | --- | --- |
| `UNET_PROVIDER_CLAIM_ID` | Yes | public |
| `UNET_PROVIDER_CLAIM_CHALLENGE` | Yes | public |
| `UNET_PROVIDER_CLAIM_TOKEN` | Yes | secret |

## login

| Variable | Required | Sensitivity |
| --- | --- | --- |
| `UNET_PROVIDER_DATABASE_URL` | Yes | secret |
| `UNET_PROVIDER_SESSION_SECRET` | Yes | secret |

## ledger

| Variable | Required | Sensitivity |
| --- | --- | --- |
| `LEDGER_V2_CHAIN_ID` | Capability-dependent | public |
| `LEDGER_V2_CONTRACT_ADDRESS` | Capability-dependent | public |
| `LEDGER_V2_ISSUER_REGISTRY_ADDRESS` | Capability-dependent | public |
| `LEDGER_V2_READ_URL` | Capability-dependent | public |
| `LEDGER_V2_RELAYER_URLS` | Capability-dependent | public |

## messaging

| Variable | Required | Sensitivity |
| --- | --- | --- |
| `UNET_MESSAGING_AUTOMATION_KEY` | Capability-dependent | secret |

## analytics

| Variable | Required | Sensitivity |
| --- | --- | --- |
| `UNET_PROVIDER_METRICS_KEY` | Capability-dependent | secret |

Ledger values come from the signed `/v2/network/config` profile. Providers do not retrieve them through SSH. Legacy aliases remain available for one compatibility release only.
