// Deployment-level configuration. Only three environment variables are required (DATABASE_URL,
// APP_URL, APP_SECRET); everything else is configured in the admin panel (see settings.ts).

export function baseUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // On Vercel the production domain is known without extra configuration.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET must be set (32+ chars) in production");
  }
  return "dev-only-secret-change-me-dev-only-secret";
}

// Optional: emails that are always treated as admins (a recovery path if the admin account is lost).
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
