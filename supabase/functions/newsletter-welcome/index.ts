// ============================================================
//  NGL Accessories — Newsletter Welcome Edge Function
//  ------------------------------------------------------------
//  1. POST (Postgres webhook on INSERT into `newsletter_subscribers`,
//     see setup/newsletter-emails.sql) → sends a branded welcome
//     email via Resend.
//  2. GET ?id=<subscriber-uuid> → unsubscribes (deletes the row)
//     and shows a small confirmation page. The welcome email's
//     unsubscribe link points here, so no extra site page is needed.
//
//  Deploy:
//    supabase functions deploy newsletter-welcome --no-verify-jwt
//
//  Secrets: reuses the ones already set for order-notification
//  (RESEND_API_KEY, FROM_EMAIL, STORE_URL, WEBHOOK_SECRET) —
//  nothing new to configure.
// ============================================================

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") ?? "NGL Accessories <onboarding@resend.dev>";
const STORE_URL      = Deno.env.get("STORE_URL") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FUNCTION_URL   = `${SUPABASE_URL}/functions/v1/newsletter-welcome`;

// ── Brand palette (inline styles — email clients strip <style>) ──
const C = {
  bg:    "#faf7f2",
  card:  "#ffffff",
  ink:   "#2b2620",
  muted: "#8a8175",
  gold:  "#c9a14a",
  line:  "#ece5d8",
};

function shell(title: string, inner: string, footerExtra = ""): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${C.bg};">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="text-align:center;padding-bottom:24px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:0.18em;color:${C.ink};">NGL ACCESSORIES</div>
      <div style="font-size:11px;letter-spacing:0.3em;color:${C.gold};text-transform:uppercase;margin-top:4px;">Aura of Pearl</div>
    </div>
    <div style="background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:28px;">
      <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:600;color:${C.ink};margin:0 0 6px;">${title}</h1>
      ${inner}
    </div>
    <p style="text-align:center;color:${C.muted};font-size:11px;margin-top:24px;line-height:1.6;">
      NGL Accessories &middot; Premium hypoallergenic jewelry, Philippines<br/>
      ${footerExtra}
    </p>
  </div>
</body></html>`;
}

function welcomeEmail(subscriberId: string): string {
  const unsubUrl = `${FUNCTION_URL}?id=${subscriberId}`;
  return shell(
    "Welcome to the Inner Circle ✨",
    `
    <p style="color:${C.muted};font-size:14px;line-height:1.8;margin:0 0 20px;">
      You're in. As part of the Inner Circle you'll be the <strong style="color:${C.ink};">first to know</strong>
      about new drops, restocks, and private offers — before anyone else.
    </p>
    <div style="background:${C.bg};border-radius:10px;padding:16px;margin-bottom:22px;font-size:13px;color:${C.muted};line-height:2;">
      ✦ Early access to new collections<br/>
      ✦ Subscriber-only promos &amp; discounts<br/>
      ✦ Restock alerts on sold-out favourites
    </div>
    ${
      STORE_URL
        ? `<div style="text-align:center;margin-top:26px;">
             <a href="${STORE_URL}/shop.html" style="display:inline-block;background:${C.gold};color:#fff;text-decoration:none;font-size:13px;letter-spacing:0.06em;padding:12px 28px;border-radius:999px;">Browse the Collections</a>
           </div>`
        : ""
    }
    `,
    `You're receiving this because you joined the NGL Inner Circle.<br/>
     <a href="${unsubUrl}" style="color:${C.muted};">Unsubscribe</a>`
  );
}

function htmlPage(title: string, message: string): Response {
  const body = shell(title, `<p style="color:${C.muted};font-size:14px;line-height:1.8;margin:0;">${message}</p>`);
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    console.error(`Resend error (${to}):`, res.status, await res.text());
  }
  return res.ok;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── Unsubscribe (link clicked in the email) ────────────────
  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return htmlPage("Hmm…", "This unsubscribe link is missing its code. Please use the link from your email.");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { error } = await supabase.from("newsletter_subscribers").delete().eq("id", id);
    if (error) {
      console.error("Unsubscribe failed:", error.message);
      return htmlPage("Something went wrong", "We couldn't process your unsubscribe request. Please try again later.");
    }
    return htmlPage("You're unsubscribed", "You won't receive any more Inner Circle emails from us. Changed your mind? You can re-join anytime from our homepage.");
  }

  // ── Welcome email (Postgres webhook) ───────────────────────
  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json();
    const sub = payload.record;
    if (!sub?.email || !sub?.id) {
      return new Response("No subscriber in payload", { status: 400 });
    }

    await sendEmail(sub.email, "Welcome to the NGL Inner Circle ✨", welcomeEmail(sub.id));

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("newsletter-welcome error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
