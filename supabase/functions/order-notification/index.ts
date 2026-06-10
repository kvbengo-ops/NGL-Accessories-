// ============================================================
//  NGL Accessories — Order Notification Edge Function
//  ------------------------------------------------------------
//  Triggered by a Postgres webhook on INSERT into `orders`
//  (see setup/order-emails.sql). Sends two transactional emails
//  via Resend:
//    1. Order confirmation  → the customer
//    2. New-order alert     → the store admin
//
//  Deploy:
//    supabase functions deploy order-notification --no-verify-jwt
//  Secrets (set once):
//    supabase secrets set RESEND_API_KEY=re_xxx \
//      FROM_EMAIL="NGL Accessories <orders@yourdomain.com>" \
//      ADMIN_EMAIL=owner@yourdomain.com \
//      STORE_URL=https://your-site.com \
//      WEBHOOK_SECRET=some-long-random-string
// ============================================================

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL      = Deno.env.get("FROM_EMAIL") ?? "NGL Accessories <onboarding@resend.dev>";
const ADMIN_EMAIL     = Deno.env.get("ADMIN_EMAIL")!;
const STORE_URL       = Deno.env.get("STORE_URL") ?? "";
const WEBHOOK_SECRET  = Deno.env.get("WEBHOOK_SECRET");

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Brand palette (inline styles — email clients strip <style>) ──
const C = {
  bg:     "#faf7f2",
  card:   "#ffffff",
  ink:    "#2b2620",
  muted:  "#8a8175",
  gold:   "#c9a14a",
  line:   "#ece5d8",
};

const peso = (n: number) =>
  "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });

interface OrderItem {
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

function itemRows(items: OrderItem[]): string {
  return items
    .map(
      (it) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${C.line};color:${C.ink};font-size:14px;">
          ${it.product_name} <span style="color:${C.muted};">&times;${it.quantity}</span>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid ${C.line};color:${C.ink};font-size:14px;text-align:right;white-space:nowrap;">
          ${peso(it.subtotal)}
        </td>
      </tr>`
    )
    .join("");
}

function totalsBlock(order: any): string {
  const shipping = Number(order.total) - Number(order.subtotal) + Number(order.discount ?? 0);
  return `
    <tr><td style="padding:6px 0;color:${C.muted};font-size:14px;">Subtotal</td>
        <td style="padding:6px 0;color:${C.ink};font-size:14px;text-align:right;">${peso(order.subtotal)}</td></tr>
    <tr><td style="padding:6px 0;color:${C.muted};font-size:14px;">Shipping</td>
        <td style="padding:6px 0;color:${C.ink};font-size:14px;text-align:right;">${shipping <= 0 ? "Free" : peso(shipping)}</td></tr>
    ${
      Number(order.discount) > 0
        ? `<tr><td style="padding:6px 0;color:${C.muted};font-size:14px;">Discount</td>
             <td style="padding:6px 0;color:${C.ink};font-size:14px;text-align:right;">-${peso(order.discount)}</td></tr>`
        : ""
    }
    <tr><td style="padding:12px 0 0;color:${C.ink};font-size:16px;font-weight:700;border-top:2px solid ${C.line};">Total</td>
        <td style="padding:12px 0 0;color:${C.ink};font-size:16px;font-weight:700;text-align:right;border-top:2px solid ${C.line};">${peso(order.total)}</td></tr>`;
}

function shell(title: string, inner: string): string {
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
      This is an automated message — please do not reply directly.
    </p>
  </div>
</body></html>`;
}

function customerEmail(order: any, items: OrderItem[]): string {
  return shell(
    "Thank you for your order!",
    `
    <p style="color:${C.muted};font-size:14px;line-height:1.7;margin:0 0 20px;">
      Hi ${order.customer_name ?? "there"}, we've received your order and will process it shortly.
      You'll hear from us once it's on the way.
    </p>
    <div style="background:${C.bg};border-radius:10px;padding:14px 16px;margin-bottom:22px;">
      <span style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};">Order Number</span><br/>
      <strong style="font-size:18px;color:${C.gold};letter-spacing:0.04em;">${order.order_number}</strong>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${itemRows(items)}</table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">${totalsBlock(order)}</table>
    <div style="font-size:13px;color:${C.muted};line-height:1.7;">
      <strong style="color:${C.ink};">Deliver to</strong><br/>${order.delivery_address ?? "—"}<br/><br/>
      <strong style="color:${C.ink};">Payment</strong><br/>${order.payment_method ?? "—"}
    </div>
    ${
      STORE_URL
        ? `<div style="text-align:center;margin-top:26px;">
             <a href="${STORE_URL}/shop.html" style="display:inline-block;background:${C.gold};color:#fff;text-decoration:none;font-size:13px;letter-spacing:0.06em;padding:12px 28px;border-radius:999px;">Continue Shopping</a>
           </div>`
        : ""
    }
    `
  );
}

function adminEmail(order: any, items: OrderItem[]): string {
  return shell(
    "New order received 🛍️",
    `
    <div style="background:${C.bg};border-radius:10px;padding:14px 16px;margin-bottom:22px;">
      <strong style="font-size:18px;color:${C.gold};">${order.order_number}</strong>
      <span style="float:right;font-size:18px;font-weight:700;color:${C.ink};">${peso(order.total)}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${itemRows(items)}</table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">${totalsBlock(order)}</table>
    <div style="font-size:13px;color:${C.muted};line-height:1.8;">
      <strong style="color:${C.ink};">Customer</strong><br/>
      ${order.customer_name ?? "—"}<br/>
      ${order.customer_email ?? "—"}<br/>
      ${order.customer_phone ?? "—"}<br/><br/>
      <strong style="color:${C.ink};">Deliver to</strong><br/>${order.delivery_address ?? "—"}<br/><br/>
      <strong style="color:${C.ink};">Payment</strong><br/>${order.payment_method ?? "—"}
      ${order.order_notes ? `<br/><br/><strong style="color:${C.ink};">Notes</strong><br/>${order.order_notes}` : ""}
    </div>
    ${
      STORE_URL
        ? `<div style="text-align:center;margin-top:26px;">
             <a href="${STORE_URL}/admin/orders.html" style="display:inline-block;background:${C.ink};color:#fff;text-decoration:none;font-size:13px;letter-spacing:0.06em;padding:12px 28px;border-radius:999px;">Open in Dashboard</a>
           </div>`
        : ""
    }
    `
  );
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
  // Shared-secret check (function is deployed with --no-verify-jwt)
  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json();
    const order = payload.record;
    if (!order?.id) {
      return new Response("No order in payload", { status: 400 });
    }

    // Fetch the line items with the service role (RLS-exempt)
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: items, error } = await supabase
      .from("order_items")
      .select("product_name, quantity, price, subtotal")
      .eq("order_id", order.id);
    if (error) console.error("Failed to load order_items:", error.message);

    const lineItems: OrderItem[] = items ?? [];

    // 1) Admin alert — always send
    await sendEmail(
      ADMIN_EMAIL,
      `New order ${order.order_number} — ${peso(order.total)}`,
      adminEmail(order, lineItems)
    );

    // 2) Customer confirmation — only if we have an email
    if (order.customer_email) {
      await sendEmail(
        order.customer_email,
        `Order confirmed — ${order.order_number}`,
        customerEmail(order, lineItems)
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("order-notification error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
