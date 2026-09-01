import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_ENVIRONMENT_SCHEMA_VERSION, PROVIDER_ENVIRONMENT_VARIABLES, readCanonicalProviderEnvironment, requireProviderClaimEnvironment } from './providerEnvironment.js';

describe('canonical provider environment', () => {
  it('publishes one versioned schema without duplicate names', () => {
    expect(PROVIDER_ENVIRONMENT_SCHEMA_VERSION).toBe(1);
    expect(new Set(PROVIDER_ENVIRONMENT_VARIABLES.map((item) => item.name)).size).toBe(PROVIDER_ENVIRONMENT_VARIABLES.length);
  });
  it('reads the exact dashboard names', () => {
    const value = readCanonicalProviderEnvironment({ UNET_PROVIDER_SERVICE_ID: 'example-shop', UNET_PROVIDER_ORIGIN: 'https://shop.example', UNET_CONTROL_PLANE_URL: 'https://issuer.example' });
    expect(value).toMatchObject({ serviceId: 'example-shop', origin: 'https://shop.example', controlPlaneUrl: 'https://issuer.example' });
  });
  it('requires the complete claim trio', () => {
    expect(() => requireProviderClaimEnvironment({ UNET_PROVIDER_SERVICE_ID: 'example-shop', UNET_PROVIDER_ORIGIN: 'https://shop.example', UNET_PROVIDER_CLAIM_ID: 'claim' })).toThrow('unet_provider_claim_environment_incomplete');
  });
  it('supports one-release aliases with a warning', () => {
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    expect(readCanonicalProviderEnvironment({ NEXT_PUBLIC_UNET_SERVICE_ID: 'legacy', NEXT_PUBLIC_SITE_ORIGIN: 'https://legacy.example' }).serviceId).toBe('legacy');
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
