// Sending email, through Brevo's HTTP API (brevo.com). The key can only send mail: it reads
// nothing, here or in anybody's mailbox. Server-only.

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/** Both the key and the address mail is sent from (verified in Brevo) are set. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.REPORT_FROM_EMAIL);
}

/**
 * Sends one message to each address separately, so no one sees another's address.
 * Throws with the service's own reason when a message is refused.
 */
export async function sendEmail(input: { to: string[]; subject: string; html: string; text: string }): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.REPORT_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("email is not configured");

  for (const address of input.to) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "תקציב הבית", email: from },
        to: [{ email: address }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`email service answered ${response.status}: ${body.slice(0, 200)}`);
    }
  }
}

/** Where the app lives, for links in messages. Empty when it cannot be known. */
export function siteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  // Set by Vercel to the production domain, without the scheme.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "";
}
