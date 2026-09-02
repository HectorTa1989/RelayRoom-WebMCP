import { SignJWT, jwtVerify } from "jose";
import type { ExecutionApproval, Partner } from "@relayroom/contracts";

export const demoEnabled = () =>
  process.env.RELAYROOM_DEMO === "true" &&
  process.env.NODE_ENV !== "production";
export function signingKey() {
  const value = process.env.SESSION_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    (!value ||
      value.length < 32 ||
      /replace|development|change-me/i.test(value))
  ) {
    throw new Error(
      "Production requires a random SESSION_SECRET of at least 32 characters",
    );
  }
  return new TextEncoder().encode(
    value || "relayroom-local-development-secret-change-me",
  );
}
export type Grant = {
  sub: string;
  role: "admin" | "operator";
  scope: "read" | "manage" | "execute" | "release";
  approval?: ExecutionApproval;
};
export async function mintGrant(partner: Partner, grant: Grant) {
  return new SignJWT({
    role: grant.role,
    scope: grant.scope,
    approval: grant.approval,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(grant.sub)
    .setIssuer("relayroom")
    .setAudience(`partner:${partner}`)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(signingKey());
}
export async function verifyGrant(
  partner: Partner,
  token: string,
): Promise<Grant> {
  const { payload } = await jwtVerify(token, signingKey(), {
    algorithms: ["HS256"],
    issuer: "relayroom",
    audience: `partner:${partner}`,
  });
  if (
    !payload.sub ||
    !["admin", "operator"].includes(String(payload.role)) ||
    !["read", "manage", "execute", "release"].includes(String(payload.scope))
  )
    throw new Error("Invalid partner grant");
  return payload as unknown as Grant;
}
