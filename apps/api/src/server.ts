import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { SignJWT, jwtVerify } from "jose";
import { Polar } from "@polar-sh/sdk";
import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
import { planningInputSchema } from "@relayroom/contracts";
import { planRecovery } from "./planner";
import { signingKey, demoEnabled, DomainError } from "@relayroom/operations";
import { checkPassword, findUser, setPaid } from "./accounts";
import { workspaceRouter } from "./workspace";
const PORT = Number(process.env.PORT || 8787);
const ROOM_ORIGIN = process.env.ROOM_ORIGIN || "http://localhost:4173";
const secret = signingKey();

type AppUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator";
  plan: "free" | "pro" | "admin";
};

type AuthRequest = Request & { user?: AppUser };

function entitle(user: Omit<AppUser, "plan">): AppUser {
  return findUser(user.id)!;
}

async function createToken(user: AppUser) {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("relayroom")
    .setAudience("room")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token)
    return res
      .status(401)
      .json({
        error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
      });
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: "relayroom",
      audience: "room",
    });
    if (!payload.sub || !payload.email || !payload.role)
      throw new Error("Invalid session");
    req.user = findUser(payload.sub);
    if (!req.user) throw new Error("Account no longer exists");
    next();
  } catch {
    return res
      .status(401)
      .json({
        error: {
          code: "SESSION_EXPIRED",
          message: "Your session has expired.",
        },
      });
  }
}

const app = express();
app.disable("x-powered-by");
app.use(
  cors({
    origin: ROOM_ORIGIN,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Polar requires the untouched request body for Standard Webhooks signature validation.
app.post(
  "/api/webhooks/polar",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
    if (!webhookSecret)
      return res
        .status(503)
        .json({
          error: {
            code: "POLAR_NOT_CONFIGURED",
            message: "Webhook secret is not configured.",
          },
        });
    try {
      const webhookHeaders = Object.fromEntries(
        Object.entries(req.headers)
          .filter(
            (entry): entry is [string, string | string[]] =>
              entry[1] !== undefined,
          )
          .map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(",") : value,
          ]),
      );
      const event = validateEvent(
        req.body,
        webhookHeaders,
        webhookSecret,
      ) as unknown as {
        type: string;
        data?: {
          externalId?: string | null;
          activeSubscriptions?: unknown[];
          grantedBenefits?: unknown[];
        };
      };
      if (event.type === "customer.state_changed" && event.data?.externalId) {
        const active = Boolean(
          event.data.activeSubscriptions?.length ||
          event.data.grantedBenefits?.length,
        );
        setPaid(
          event.data.externalId,
          active,
          Number(req.headers["webhook-timestamp"]) * 1000,
          String(req.headers["webhook-id"]),
        );
      }
      return res.status(202).send();
    } catch (error) {
      if (error instanceof WebhookVerificationError)
        return res
          .status(403)
          .json({
            error: {
              code: "INVALID_SIGNATURE",
              message: "Invalid Polar webhook signature.",
            },
          });
      throw error;
    }
  },
);

app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "relayroom-api",
    polar: Boolean(
      process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_PRODUCT_ID,
    ),
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    plannerProvider: process.env.OPENAI_API_KEY
      ? "openai"
      : process.env.GEMINI_API_KEY
        ? "gemini"
        : "deterministic",
    plannerModel: process.env.OPENAI_API_KEY
      ? process.env.OPENAI_MODEL || "gpt-5.4"
      : process.env.GEMINI_API_KEY
        ? process.env.GEMINI_MODEL || "gemini-3.7-flash"
        : undefined,
  }),
);

const loginAttempts = new Map<string, { count: number; until: number }>();
app.post("/api/auth/login", async (req, res) => {
  const address = req.ip || "unknown";
  const prior = loginAttempts.get(address);
  if (prior && prior.until > Date.now() && prior.count >= 15)
    return res
      .status(429)
      .json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many sign-in attempts. Try again in 15 minutes.",
        },
      });
  if (loginAttempts.size > 10000)
    for (const [key, value] of loginAttempts)
      if (value.until < Date.now()) loginAttempts.delete(key);
  loginAttempts.set(address, {
    count: prior && prior.until > Date.now() ? prior.count + 1 : 1,
    until:
      prior && prior.until > Date.now() ? prior.until : Date.now() + 900000,
  });
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");
  const account = checkPassword(email, password);
  if (!account)
    return res
      .status(401)
      .json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect.",
        },
      });
  const user = entitle({
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
  });
  loginAttempts.delete(address);
  return res.json({
    token: await createToken(user),
    user,
    entitlements: getEntitlements(user),
  });
});

app.get("/api/auth/session", authenticate, (req: AuthRequest, res) => {
  const user = req.user!;
  res.json({ user, entitlements: getEntitlements(user) });
});

app.use("/api", authenticate, workspaceRouter());

app.post("/api/agent/plan", authenticate, async (req: AuthRequest, res) => {
  const user = req.user!;
  if (!getEntitlements(user).features.crossOriginRecovery) {
    return res
      .status(403)
      .json({
        error: {
          code: "UPGRADE_REQUIRED",
          message:
            "RelayRoom Pro or an admin account is required for coordinated planning.",
        },
      });
  }
  const input = planningInputSchema.parse(req.body);
  if (
    !input?.objective ||
    !input.constraints ||
    !Array.isArray(input.inventory) ||
    !Array.isArray(input.routes)
  ) {
    return res
      .status(400)
      .json({
        error: {
          code: "INVALID_PLANNING_INPUT",
          message:
            "Normalized buyer, supplier, and carrier evidence is required.",
        },
      });
  }
  try {
    return res.json(await planRecovery(input));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "NO_FEASIBLE_RECOVERY_PLAN"
    ) {
      return res
        .status(409)
        .json({
          error: {
            code: error.message,
            message: "No candidate satisfies all partner constraints.",
          },
        });
    }
    throw error;
  }
});

app.post(
  "/api/billing/checkout",
  authenticate,
  async (req: AuthRequest, res) => {
    const user = req.user!;
    if (user.role === "admin" || user.plan === "pro")
      return res.json({
        alreadyEntitled: true,
        user,
        entitlements: getEntitlements(user),
      });

    const staticCheckout = process.env.POLAR_CHECKOUT_URL;
    const accessToken = process.env.POLAR_ACCESS_TOKEN;
    const productId = process.env.POLAR_PRODUCT_ID;
    if (!accessToken || !productId) {
      if (staticCheckout)
        return res.json({ url: appendCheckoutParams(staticCheckout, user) });
      return res
        .status(503)
        .json({
          error: {
            code: "POLAR_NOT_CONFIGURED",
            message:
              "Add POLAR_ACCESS_TOKEN and POLAR_PRODUCT_ID, or POLAR_CHECKOUT_URL, to enable checkout.",
          },
        });
    }

    const polar = new Polar({
      accessToken,
      server:
        process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
    });
    const checkout = await polar.checkouts.create({
      products: [productId],
      externalCustomerId: user.id,
      customerEmail: user.email,
      successUrl: `${ROOM_ORIGIN}/?checkout=success`,
      customerIpAddress: requestIp(req),
      metadata: { source: "relayroom", github: "HectorTa1989" },
    });
    return res.json({ url: checkout.url });
  },
);

app.post("/api/dev/grant-pro", authenticate, (req: AuthRequest, res) => {
  if (!demoEnabled()) return res.status(404).send();
  setPaid(req.user!.id, true);
  const { plan: _plan, ...userWithoutPlan } = req.user!;
  const user = entitle(userWithoutPlan);
  res.json({
    user,
    entitlements: getEntitlements(user),
    source: "local-polar-webhook-simulator",
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof DomainError)
    return res
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
  if (error instanceof Error && error.name === "ZodError")
    return res
      .status(400)
      .json({ error: { code: "INVALID_INPUT", message: error.message } });
  console.error(error);
  res
    .status(500)
    .json({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    });
});

app.listen(PORT, () =>
  console.log(`RelayRoom API listening on http://localhost:${PORT}`),
);

function getEntitlements(user: AppUser) {
  const allAccess = user.role === "admin" || user.plan === "pro";
  return {
    allAccess,
    source:
      user.role === "admin"
        ? "admin-bypass"
        : user.plan === "pro"
          ? "polar"
          : "free",
    features: {
      crossOriginRecovery: allAccess,
      coordinatedCommit: allAccess,
      failureRehearsal: allAccess,
      auditExport: allAccess,
    },
  };
}

function appendCheckoutParams(url: string, user: AppUser) {
  const checkout = new URL(url);
  checkout.searchParams.set("customer_email", user.email);
  checkout.searchParams.set("reference_id", user.id);
  checkout.searchParams.set("utm_source", "relayroom");
  return checkout.toString();
}

function requestIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(",")[0];
  const ip = value?.trim() || req.ip;
  return ip && !["::1", "127.0.0.1"].includes(ip) ? ip : undefined;
}
