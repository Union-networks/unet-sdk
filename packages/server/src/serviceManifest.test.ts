import { describe, expect, it } from 'vitest';
import { createUnetServiceManifest, createUnetServiceManifestHandler } from './index.js';

describe('service manifest miniapp launch readiness', () => {
  const options = { serviceId: 'shop', origin: 'https://shop.example' };

  it('does not advertise readiness by default or for false', () => {
    expect(createUnetServiceManifest(options)).not.toHaveProperty('miniapp');
    expect(createUnetServiceManifest({ ...options, miniappLaunchReadiness: false })).not.toHaveProperty('miniapp');
    expect(createUnetServiceManifest({ ...options, miniappLaunchReadiness: 'true' as unknown as boolean })).not.toHaveProperty('miniapp');
  });

  it('advertises only version 1 when explicitly enabled and preserves existing endpoints', () => {
    const baseline = createUnetServiceManifest(options);
    expect(createUnetServiceManifest({ ...options, miniappLaunchReadiness: true })).toEqual({
      ...baseline, miniapp: { launchReadinessVersion: 1 },
    });
  });

  it('serves the opt-in capability in the same well-known response', async () => {
    const response = await createUnetServiceManifestHandler({ ...options, miniappLaunchReadiness: true })();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ miniapp: { launchReadinessVersion: 1 } });
  });
});
