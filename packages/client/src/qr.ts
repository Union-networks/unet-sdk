export const parseUnetQrPayload = (payload: string): unknown => {
  const verifyPrefix = 'unet://verify?session_ref=';
  if (payload.startsWith(verifyPrefix)) return { kind: 'unet_verification', version: 1, sessionRef: decodeURIComponent(payload.slice(verifyPrefix.length)) };
  const loginPrefix = 'unet://web-login?payload=';
  if (payload.startsWith(loginPrefix)) return JSON.parse(decodeURIComponent(payload.slice(loginPrefix.length))) as unknown;
  try { return JSON.parse(payload) as unknown; } catch { return { kind: 'unknown', raw: payload }; }
};

export const verificationQrPayload = (sessionRef: string): string => `unet://verify?session_ref=${encodeURIComponent(sessionRef)}`;
