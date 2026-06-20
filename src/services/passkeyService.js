import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { env } from '../config/env.js';

export async function createRegistrationOptions({ userID, userName, userDisplayName, excludeCredentials = [] }) {
  return generateRegistrationOptions({
    rpName: env.rpName,
    rpID: env.rpId,
    userID,
    userName,
    userDisplayName,
    attestationType: 'none',
    excludeCredentials: excludeCredentials.map((c) => ({
      id: c.credential_id,
      type: 'public-key',
      transports: c.transports ?? [],
    })),
    authenticatorSelection: {
      residentKey: 'required',           // enables discoverable credentials
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // forces iCloud Keychain on Mac/iOS
    },
    extensions: { credProps: true },
  });
}

export async function finishRegistration({ credential, expectedChallenge }) {
  const result = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: env.corsOrigins,
    expectedRPID: env.rpId,
    requireUserVerification: false,
  });
  if (!result.verified || !result.registrationInfo) {
    throw new Error('Registration verification failed');
  }
  // v13: credential info lives under registrationInfo.credential (not flat on registrationInfo)
  const { credential: cred, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  return {
    credentialId: cred.id,
    publicKey: isoBase64URL.fromBuffer(cred.publicKey),
    counter: cred.counter,
    deviceType: credentialDeviceType ?? null,
    backedUp: credentialBackedUp ?? false,
    transports: cred.transports ?? credential.response?.transports ?? [],
  };
}

export async function createAuthenticationOptions({ allowCredentials = [] }) {
  return generateAuthenticationOptions({
    rpID: env.rpId,
    allowCredentials: allowCredentials.map((c) => ({
      id: c.credential_id,
      type: 'public-key',
      transports: c.transports ?? [],
    })),
    userVerification: 'preferred',
  });
}

export async function finishAuthentication({ credential, expectedChallenge, storedCredential }) {
  const result = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: env.corsOrigins,
    expectedRPID: env.rpId,
    // v13: renamed from `authenticator` to `credential`, and fields renamed too
    credential: {
      id: storedCredential.credential_id,
      publicKey: isoBase64URL.toBuffer(storedCredential.public_key),
      counter: storedCredential.counter,
      transports: storedCredential.transports ?? [],
    },
    requireUserVerification: false,
  });
  if (!result.verified) {
    throw new Error('Authentication verification failed');
  }
  return { newCounter: result.authenticationInfo.newCounter };
}
