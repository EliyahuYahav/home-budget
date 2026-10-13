// Sends each household the report of the month that ended. Called by Vercel's scheduler
// (vercel.json) on a few mornings early in the month: a household is sent a month once, and
// the later mornings only pick up what failed on an earlier one.
import { monthOf, shiftMonth, todayISO } from "@/lib/dates";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isEmptyReport, renderReportEmail, renderReportText } from "@/lib/report";
import { collectReport } from "@/lib/report-data";
import { createAdminClient, memberContext, sameSecret } from "@/lib/supabase/admin";
import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";

export const maxDuration = 60;

export async function GET(request: Request) {
  // Vercel sends CRON_SECRET this way with every scheduled call.
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return new Response("forbidden", { status: 403 });
  }
  const admin = createAdminClient();
  if (!admin || !isEmailConfigured()) return new Response("not configured", { status: 503 });

  const month = shiftMonth(monthOf(todayISO()), -1);
  const { data: households, error } = await admin.from("households").select("id").eq("monthly_report", true);
  if (error) return new Response("could not read households", { status: 500 });

  const counts = { sent: 0, empty: 0, already: 0, failed: 0 };
  for (const { id } of households ?? []) {
    // Claiming the month first means two calls at once cannot both send it.
    const { error: claimed } = await admin.from("report_log").insert({ household_id: id, period: month });
    if (claimed) {
      counts.already += 1;
      continue;
    }
    try {
      const { data: members } = await admin.from("household_members").select("user_id").eq("household_id", id);
      const first = members?.[0] ? await memberContext(admin, members[0].user_id as string) : null;
      const report = first ? await collectReport(first, month) : null;
      if (!report || isEmptyReport(report)) {
        counts.empty += 1;
        continue;
      }

      const addresses: string[] = [];
      for (const member of members ?? []) {
        const { data } = await admin.auth.admin.getUserById(member.user_id as string);
        if (data.user?.email) addresses.push(data.user.email);
      }
      await sendEmail({ to: addresses, ...renderReportEmail(report) });

      if (isTelegramConfigured()) {
        const { data: chats } = await admin.from("telegram_chats").select("chat_id").eq("household_id", id);
        for (const chat of chats ?? []) {
          // The email is the report; a chat that cannot be reached does not undo it.
          await sendTelegramMessage(chat.chat_id as number, renderReportText(report)).catch(() => {});
        }
      }
      counts.sent += 1;
    } catch (cause) {
      console.error("monthly report failed for a household", cause);
      counts.failed += 1;
      // Let the next morning try again.
      await admin.from("report_log").delete().eq("household_id", id).eq("period", month);
    }
  }
  return Response.json({ month, ...counts });
}
