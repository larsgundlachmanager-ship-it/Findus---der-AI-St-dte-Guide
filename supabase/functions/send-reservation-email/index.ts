/**
 * Supabase Edge Function: Reservierungs-E-Mail via Resend.
 *
 * Deploy:
 *   supabase functions deploy send-reservation-email
 *
 * Secrets:
 *   supabase secrets set RESEND_API_KEY=re_xxx
 *   supabase secrets set RESERVATION_FROM_EMAIL="Yorro <buchung@deine-domain.de>"
 *
 * App .env:
 *   EXPO_PUBLIC_RESERVATION_EMAIL_ENDPOINT=https://<project>.supabase.co/functions/v1/send-reservation-email
 *
 * Ohne Endpoint nutzt die App automatisch den mailto:-Fallback.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

type Body = {
  to: string;
  restaurantName: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  partySize: number;
  timeLabel: string;
  dateIso?: string;
  notes?: string;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const from =
      Deno.env.get('RESERVATION_FROM_EMAIL') ||
      'Yorro Concierge <onboarding@resend.dev>';

    if (!resendKey) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY missing' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const body = (await req.json()) as Body;
    if (!body?.to || !body.guestEmail || !body.guestName) {
      return new Response(JSON.stringify({ error: 'invalid body' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const subject = `Reservierungsanfrage: ${body.restaurantName} – ${body.timeLabel}`;
    const text = [
      `Guten Tag,`,
      ``,
      `hiermit möchten wir einen Tisch bei ${body.restaurantName} anfragen:`,
      ``,
      `Gast: ${body.guestName}`,
      `Personen: ${body.partySize}`,
      `Wunschzeit: ${body.timeLabel}`,
      body.dateIso ? `Datum: ${body.dateIso}` : null,
      body.notes ? `Hinweis: ${body.notes}` : null,
      ``,
      `Rückmeldung bitte an:`,
      body.guestEmail,
      body.guestPhone || null,
      ``,
      `Viele Grüße`,
      `Yorro Concierge (im Auftrag von ${body.guestName})`,
    ]
      .filter((l) => l != null)
      .join('\n');

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [body.to],
        reply_to: body.guestEmail,
        subject,
        text,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return new Response(JSON.stringify({ error: errText }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
