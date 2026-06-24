import type { JsonWebKeySet, JwtClaims } from "../../src";

export interface JwtSigner<TClaims extends JwtClaims = JwtClaims> {
  readonly jwks: JsonWebKeySet;
  sign(claims: TClaims, headerOverrides?: Partial<JwtHeader>): Promise<string>;
}

interface JwtHeader {
  readonly alg: string;
  readonly typ: string;
  readonly kid: string;
}

export async function createJwtSigner<TClaims extends JwtClaims = JwtClaims>(kid = "test-key"): Promise<JwtSigner<TClaims>> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    kid,
    alg: "RS256",
    use: "sig"
  };
  return {
    jwks: { keys: [publicJwk] },
    async sign(claims, headerOverrides = {}) {
      const header = { alg: "RS256", typ: "JWT", kid, ...headerOverrides };
      const headerPart = base64UrlJson(header);
      const payloadPart = base64UrlJson(claims);
      const signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        keyPair.privateKey,
        new TextEncoder().encode(`${headerPart}.${payloadPart}`)
      );
      return `${headerPart}.${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
    }
  };
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
