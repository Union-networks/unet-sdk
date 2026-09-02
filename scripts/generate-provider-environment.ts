import { mkdir, writeFile } from 'node:fs/promises';
import { PROVIDER_ENVIRONMENT_SCHEMA_VERSION, PROVIDER_ENVIRONMENT_VARIABLES } from '../packages/server/src/providerEnvironment.js';

const groupOrder = ['base', 'claim', 'login', 'issuer', 'domain_admin', 'ledger', 'messaging', 'analytics'];
const groups = groupOrder.map((group) => ({ group, variables: PROVIDER_ENVIRONMENT_VARIABLES.filter((item) => item.group === group) })).filter((item) => item.variables.length);
const example = `${groups.map(({ group, variables }) => [`# ${group}`, ...variables.map((item) => `${item.name}=`)].join('\n')).join('\n\n')}\n`;
const docs = `# Provider environment V${PROVIDER_ENVIRONMENT_SCHEMA_VERSION}\n\nThis reference is generated from the canonical schema exported by \`@u-net/server\`. The dashboard uses these exact names.\n\n${groups.map(({ group, variables }) => `## ${group}\n\n| Variable | Required | Sensitivity |\n| --- | --- | --- |\n${variables.map((item) => `| \`${item.name}\` | ${item.required ? 'Yes' : 'Capability-dependent'} | ${item.sensitivity} |`).join('\n')}`).join('\n\n')}\n\nLedger values come from the signed \`/v2/network/config\` profile. Providers do not retrieve them through SSH. Legacy aliases remain available for one compatibility release only.\n`;

await mkdir('examples', { recursive: true });
await writeFile('examples/provider.env.example', example);
await writeFile('docs/provider-environment.md', docs);
