// netlify/functions/submission-created.js
// =====================================================================
// META CAPI — Server-side Lead event
// Triggers automatically on Netlify Form submission (special filename).
// Recovers 20-30% of leads that browser pixel misses (AdBlock, iOS ITP).
// =====================================================================

const crypto = require('crypto');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const data = (body.payload && body.payload.data) || {};
    const meta = body.payload || {};

    const TOKEN = process.env.META_ACCESS_TOKEN;
    const PIXEL_ID = process.env.META_PIXEL_ID;
    const TEST_CODE = process.env.META_TEST_EVENT_CODE;

    if (!TOKEN || !PIXEL_ID) {
      console.error('Missing META_ACCESS_TOKEN or META_PIXEL_ID env vars');
      return { statusCode: 500, body: 'Config error: missing env vars' };
    }

    // SHA-256 hash for PII (Meta requirement)
    const hash = (s) => s
      ? crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex')
      : null;

    const phoneClean = data.phone
      ? String(data.phone).replace(/[^0-9]/g, '')
      : null;

    const nameParts = (data.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const userData = {
      em: data.email ? [hash(data.email)] : null,
      ph: phoneClean ? [hash(phoneClean)] : null,
      fn: firstName ? [hash(firstName)] : null,
      ln: lastName ? [hash(lastName)] : null,
      fbc: data.fbc || null,
      fbp: data.fbp || null,
      client_ip_address:
        meta.user_ip ||
        event.headers['x-nf-client-connection-ip'] ||
        event.headers['x-forwarded-for'] ||
        null,
      client_user_agent: data.userAgent || event.headers['user-agent'] || null,
      country: [hash('sk')]
    };

    // Remove null fields (Meta rejects them)
    Object.keys(userData).forEach((k) => {
      if (userData[k] === null) delete userData[k];
    });

    const payload = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          event_id: data.eventId || crypto.randomUUID(),
          action_source: 'website',
          event_source_url: 'https://mentoring.tommax.sk',
          user_data: userData,
          custom_data: {
            currency: 'EUR',
            value: 0,
            content_name: 'Mentoring_15min_Diagnostic',
            revenue_range: data.revenue || null,
            business_type: data.business || null,
            utm_source: data.utm_source || null,
            utm_campaign: data.utm_campaign || null,
            utm_content: data.utm_content || null,
            utm_medium: data.utm_medium || null,
            utm_term: data.utm_term || null
          }
        }
      ]
    };

    // test_event_code only when env var is set (delete for production)
    if (TEST_CODE) {
      payload.test_event_code = TEST_CODE;
    }

    const url = `https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${TOKEN}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log('CAPI Response:', JSON.stringify(result));

    if (!response.ok || result.error) {
      console.error('CAPI Error response:', result);
      return {
        statusCode: 200, // 200 so Netlify doesn't retry — we logged the error
        body: JSON.stringify({ ok: false, capi: result })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, events_received: result.events_received })
    };
  } catch (e) {
    console.error('CAPI Function Error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
