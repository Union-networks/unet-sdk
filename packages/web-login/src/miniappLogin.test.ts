import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMiniappLogin } from './index.js';
import type { DirectProviderLoginChallenge, MiniappLoginApproval, MiniappLoginOptions } from './index.js';

const origin = 'https://shop.example';
const launchToken = 'a'.repeat(64);
const fixture = () => {
  const challenge: DirectProviderLoginChallenge = {
    protocolVersion: 2, requestRef: 'browser_ref', serviceId: 'shop', origin, challenge: 'public_challenge',
    challengeUrl: `${origin}/api/unet/login/challenge/browser_ref`, approvalUrl: `${origin}/api/unet/login/approve`,
    expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
  };
  const approval: MiniappLoginApproval = {
    requestRef: challenge.requestRef, approved: true, scopedUserId: 'scoped_expected',
    launchReadiness: { version: 1, launchToken, expiresAtMs: Date.now() + 30_000 },
  };
  const account = { scopedUserId: approval.scopedUserId, displayName: 'Account' };
  const options = {
    origin,
    createChallenge: vi.fn(async (_signal: AbortSignal) => challenge),
    approve: vi.fn(async (_challenge: DirectProviderLoginChallenge, _signal: AbortSignal) => approval),
    exchange: vi.fn(async (_challenge: DirectProviderLoginChallenge, _signal: AbortSignal) => account),
    initialize: vi.fn(async (value: typeof account, _signal: AbortSignal) => ({ ...value, displayName: 'Initialized' })),
    complete: vi.fn(async (): Promise<unknown> => ({ completed: true })),
  } satisfies MiniappLoginOptions<typeof account>;
  return { options, challenge, approval, account };
};

const never = () => new Promise<never>(() => {});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('runMiniappLogin', () => {
  it('initializes the authoritative account before completing exactly the approved launch', async () => {
    const { options, challenge, approval, account } = fixture();
    const result = await runMiniappLogin(options);
    expect(result).toEqual({ ...account, displayName: 'Initialized' });
    const signal = options.createChallenge.mock.calls[0]![0];
    expect(options.approve).toHaveBeenCalledWith(challenge, signal);
    expect(options.exchange).toHaveBeenCalledWith(challenge, signal);
    expect(options.initialize).toHaveBeenCalledWith(account, signal);
    expect(options.complete).toHaveBeenCalledExactlyOnceWith({
      requestRef: challenge.requestRef, launchToken: approval.launchReadiness.launchToken,
      state: 'ready', stage: 'initial_status', outcome: 'success',
    }, signal);
    expect(options.complete.mock.invocationCallOrder[0]).toBeGreaterThan(options.initialize.mock.invocationCallOrder[0]!);
    expect(signal.aborted).toBe(true);
  });

  it.each(['exchange', 'initialize'] as const)('rejects a different authoritative %s account and completes failed without identity data', async (step) => {
    const { options, approval } = fixture();
    options[step].mockResolvedValueOnce({ scopedUserId: 'scoped_wrong', displayName: 'Wrong' });
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_account_mismatch');
    expect(options.complete).toHaveBeenCalledExactlyOnceWith({
      requestRef: approval.requestRef, launchToken: approval.launchReadiness.launchToken,
      state: 'failed', stage: 'initial_status', outcome: 'unavailable',
    }, expect.any(AbortSignal));
    if (step === 'exchange') expect(options.initialize).not.toHaveBeenCalled();
    expect(JSON.stringify(options.complete.mock.calls)).not.toContain('scoped_');
  });

  it.each(['createChallenge', 'approve', 'exchange', 'initialize', 'complete'] as const)('sanitizes %s errors without logging identifiers', async (step) => {
    const { options } = fixture();
    const error = vi.spyOn(console, 'error');
    const log = vi.spyOn(console, 'log');
    options[step].mockRejectedValueOnce(new Error('scoped_expected private_launch_token browser_ref'));
    await expect(runMiniappLogin(options)).rejects.toThrow(/^miniapp_login_/);
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    if (step === 'createChallenge' || step === 'approve') expect(options.complete).not.toHaveBeenCalled();
    else expect(options.complete).toHaveBeenCalledTimes(1);
  });

  it.each([
    { approved: false }, { requestRef: 'different_ref' }, { scopedUserId: '' },
    { launchReadiness: undefined }, { launchReadiness: { version: 2, launchToken: 'token', expiresAtMs: 9999999999999 } },
    { launchReadiness: { version: 1, launchToken: '', expiresAtMs: 9999999999999 } },
  ])('rejects malformed or unrelated approval without exchange or completion (%j)', async (patch) => {
    const { options, approval } = fixture();
    options.approve.mockResolvedValueOnce({ ...approval, ...patch } as MiniappLoginApproval);
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_approval_invalid');
    expect(options.exchange).not.toHaveBeenCalled();
    expect(options.complete).not.toHaveBeenCalled();
  });

  it.each([0, Date.now() - 1])('rejects expired readiness deadline %s', async (expiresAtMs) => {
    const { options, approval } = fixture();
    approval.launchReadiness.expiresAtMs = expiresAtMs;
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_expired');
    expect(options.exchange).not.toHaveBeenCalled();
    expect(options.complete).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 'future', null])('rejects invalid readiness expiry %s', async (expiresAtMs) => {
    const { options, approval } = fixture();
    approval.launchReadiness.expiresAtMs = expiresAtMs as number;
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_approval_invalid');
    expect(options.exchange).not.toHaveBeenCalled();
    expect(options.complete).not.toHaveBeenCalled();
  });

  it.each([30_001, 60_000, 1.5])('rejects overlong or fractional readiness lifetime %s', async (lifetime) => {
    vi.useFakeTimers();
    const { options, approval } = fixture();
    approval.launchReadiness.expiresAtMs = Date.now() + lifetime;
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_approval_invalid');
    expect(options.exchange).not.toHaveBeenCalled();
    expect(options.complete).not.toHaveBeenCalled();
  });

  it.each(['', 'opaque-token', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), ` ${launchToken}`, `${launchToken}\n`, `0x${launchToken}`])('rejects non-native readiness token %j', async (value) => {
    const { options, approval } = fixture();
    approval.launchReadiness.launchToken = value;
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_approval_invalid');
    expect(options.exchange).not.toHaveBeenCalled();
    expect(options.complete).not.toHaveBeenCalled();
  });

  it('accepts native hex at the exact 30-second expiry boundary', async () => {
    vi.useFakeTimers();
    const { options, approval } = fixture();
    approval.launchReadiness.launchToken = 'ABCDEF01'.repeat(8);
    await expect(runMiniappLogin(options)).resolves.toMatchObject({ scopedUserId: approval.scopedUserId });
  });

  it('rejects additional readiness fields rather than accepting arbitrary initialization caps', async () => {
    const { options, approval } = fixture();
    Object.assign(approval.launchReadiness, { initializationTimeoutMs: 999_999 });
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_approval_invalid');
    expect(options.exchange).not.toHaveBeenCalled();
    expect(options.complete).not.toHaveBeenCalled();
  });

  it.each([undefined, null, false, {}, { success: true }, { completed: false }, { completed: 'true' }, [{ completed: true }]])('requires an explicit true ready acknowledgement (%j)', async (acknowledgement) => {
    const { options } = fixture();
    options.complete.mockResolvedValueOnce(acknowledgement);
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_complete_unconfirmed');
    expect(options.complete).toHaveBeenCalledTimes(1);
  });

  it.each(['exchange', 'initialize', 'complete'] as const)('caps the entire post-approval %s budget at 15 seconds', async (step) => {
    vi.useFakeTimers();
    const { options } = fixture();
    options[step].mockImplementationOnce(never);
    const rejected = expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_aborted');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(options.complete).toHaveBeenCalledTimes(step === 'complete' ? 1 : 0);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(options.complete).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { origin: 'https://elsewhere.example' }, { approvalUrl: 'https://elsewhere.example/approve' },
    { challengeUrl: 'http://shop.example/challenge' }, { requestRef: '' }, { serviceId: '' },
    { protocolVersion: 1 }, { challenge: '' }, { approvalUrl: 'https://user:secret@shop.example/approve' },
  ])('rejects invalid or cross-origin challenges before host approval (%j)', async (patch) => {
    const { options, challenge } = fixture();
    options.createChallenge.mockResolvedValueOnce({ ...challenge, ...patch } as DirectProviderLoginChallenge);
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_challenge_invalid');
    expect(options.approve).not.toHaveBeenCalled();
  });

  it.each(['invalid', new Date(Date.now() - 1000).toISOString()])('rejects invalid or expired challenge deadline %s', async (expiresAtIso) => {
    const { options, challenge } = fixture();
    challenge.expiresAtIso = expiresAtIso;
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_expired');
    expect(options.approve).not.toHaveBeenCalled();
  });

  it('does not start an already aborted flow', async () => {
    const { options } = fixture();
    await expect(runMiniappLogin({ ...options, signal: AbortSignal.abort() })).rejects.toThrow('miniapp_login_aborted');
    expect(options.createChallenge).not.toHaveBeenCalled();
  });

  it.each(['createChallenge', 'approve', 'exchange', 'initialize', 'complete'] as const)('bounds non-cooperative %s callbacks and never advances late', async (step) => {
    vi.useFakeTimers();
    const { options } = fixture();
    options[step].mockImplementationOnce(never);
    const pending = runMiniappLogin({ ...options, timeoutMs: 100 });
    const rejected = expect(pending).rejects.toThrow('miniapp_login_aborted');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(options.complete).toHaveBeenCalledTimes(step === 'exchange' || step === 'initialize' || step === 'complete' ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports failure with a fresh bounded signal after external cancellation and ignores late exchange', async () => {
    const { options, account } = fixture();
    const controller = new AbortController();
    let resolveExchange!: (value: typeof account) => void;
    options.exchange.mockImplementationOnce(async () => {
      controller.abort('sensitive_abort_reason');
      return new Promise<typeof account>((resolve) => { resolveExchange = resolve; });
    });
    await expect(runMiniappLogin({ ...options, signal: controller.signal })).rejects.toThrow('miniapp_login_aborted');
    resolveExchange(account);
    await Promise.resolve();
    expect(options.initialize).not.toHaveBeenCalled();
    expect(options.complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ state: 'failed' }), expect.any(AbortSignal));
  });

  it.each(['challenge', 'approval'] as const)('does not extend the deadline beyond %s expiry', async (boundary) => {
    vi.useFakeTimers();
    const { options, challenge, approval } = fixture();
    if (boundary === 'challenge') challenge.expiresAtIso = new Date(Date.now() + 50).toISOString();
    else approval.launchReadiness.expiresAtMs = Date.now() + 50;
    options.initialize.mockImplementationOnce(never);
    const rejected = expect(runMiniappLogin({ ...options, timeoutMs: 1000 })).rejects.toThrow('miniapp_login_aborted');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(options.complete).toHaveBeenCalledTimes(boundary === 'challenge' ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds best-effort failure completion and preserves the original sanitized failure', async () => {
    vi.useFakeTimers();
    const { options } = fixture();
    options.initialize.mockRejectedValueOnce(new Error('private_account_data'));
    options.complete.mockImplementationOnce(never);
    const rejected = expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_initial_status_failed');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('snapshots host approval so a later adapter cannot change the approved identity or reference', async () => {
    const { options, approval } = fixture();
    options.exchange.mockImplementationOnce(async () => {
      approval.scopedUserId = 'scoped_wrong';
      approval.requestRef = 'wrong_ref';
      return { scopedUserId: 'scoped_wrong', displayName: 'Wrong' };
    });
    await expect(runMiniappLogin(options)).rejects.toThrow('miniapp_login_account_mismatch');
    expect(options.complete).toHaveBeenCalledWith(expect.objectContaining({ requestRef: 'browser_ref', state: 'failed' }), expect.any(AbortSignal));
  });

  it('never navigates and requires the actual browser origin', async () => {
    const { options } = fixture();
    const assign = vi.fn();
    const replace = vi.fn();
    const location = { origin, href: `${origin}/app`, assign, replace };
    vi.stubGlobal('location', location);
    await runMiniappLogin(options);
    expect(location.href).toBe(`${origin}/app`);
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await expect(runMiniappLogin({ ...options, origin: 'https://elsewhere.example' })).rejects.toThrow('miniapp_login_origin_mismatch');
  });

  it.each(['http://shop.example', 'https://user:secret@shop.example', 'not_a_url'])('rejects invalid origin %s', async (value) => {
    const { options } = fixture();
    await expect(runMiniappLogin({ ...options, origin: value })).rejects.toThrow('miniapp_login_origin_mismatch');
    expect(options.createChallenge).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, 1.5, 60_001, 2_147_483_648])('rejects invalid timeout %s', async (timeoutMs) => {
    const { options } = fixture();
    await expect(runMiniappLogin({ ...options, timeoutMs })).rejects.toThrow('miniapp_login_timeout_invalid');
    expect(options.createChallenge).not.toHaveBeenCalled();
  });
});
