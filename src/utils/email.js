const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST     || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `Golf Charity Platform <${process.env.SMTP_USER}>`;

const emailWrapper = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #0a0f1e; color: #e8eaf6; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #111827; border-radius: 16px; overflow: hidden; border: 1px solid rgba(99,205,130,0.2); }
    .header { background: linear-gradient(135deg, #0d3b1f 0%, #1a5e32 100%); padding: 40px 32px; text-align: center; }
    .header h1 { color: #63cd82; font-size: 28px; margin: 0; letter-spacing: -0.5px; }
    .header p { color: rgba(255,255,255,0.6); margin: 8px 0 0; }
    .body { padding: 32px; }
    .body p { line-height: 1.7; color: #c9d1e0; }
    .cta { display: inline-block; background: #63cd82; color: #0a1a0f; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; margin: 16px 0; }
    .footer { text-align: center; padding: 24px; color: rgba(255,255,255,0.3); font-size: 13px; border-top: 1px solid rgba(255,255,255,0.06); }
    .badge { display: inline-block; background: rgba(99,205,130,0.15); color: #63cd82; padding: 4px 12px; border-radius: 100px; font-size: 13px; margin: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏌️ Golf Charity</h1>
      <p>Play. Win. Give.</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">© ${new Date().getFullYear()} Golf Charity Platform. All rights reserved.</div>
  </div>
</body>
</html>`;

async function sendWelcomeEmail(email, name) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: '⛳ Welcome to Golf Charity Platform!',
    html: emailWrapper(`
      <p>Hi <strong>${name}</strong>,</p>
      <p>Welcome to the Golf Charity Platform! You're now part of a community that plays golf, wins prizes, and makes a difference for charities across the UK.</p>
      <p>Here's what you can do next:</p>
      <p>
        <span class="badge">🏌️ Enter your scores</span>
        <span class="badge">🎲 Join the monthly draw</span>
        <span class="badge">💚 Support your charity</span>
      </p>
      <p>Your first step is to subscribe and start entering scores.</p>
      <a href="${process.env.CLIENT_URL}/dashboard" class="cta">Go to Dashboard →</a>
      <p>Good luck!</p>
    `),
  });
}

async function sendSubscriptionEmail(email, name, plan) {
  const planLabel = plan === 'yearly' ? 'Yearly (£99/yr)' : 'Monthly (£9.99/mo)';
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: '✅ Subscription Confirmed — Golf Charity',
    html: emailWrapper(`
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your <strong>${planLabel}</strong> subscription is now active. You're entered into the next monthly draw!</p>
      <p>Remember to enter your latest golf scores to be eligible for all prize tiers.</p>
      <a href="${process.env.CLIENT_URL}/dashboard" class="cta">Enter Scores →</a>
    `),
  });
}

async function sendDrawResultEmail(email, name, winningNumbers, isWinner) {
  const subject = isWinner
    ? '🎉 You Won! — Golf Charity Draw Results'
    : '🎲 Draw Results Are In — Golf Charity';

  const content = isWinner
    ? `<p>Hi <strong>${name}</strong>,</p>
       <p>🎉 Congratulations! You matched numbers in this month's draw!</p>
       <p>Winning numbers: <strong>${winningNumbers.join(' · ')}</strong></p>
       <p>Please log in to upload your proof and claim your prize.</p>
       <a href="${process.env.CLIENT_URL}/dashboard" class="cta">Claim Prize →</a>`
    : `<p>Hi <strong>${name}</strong>,</p>
       <p>This month's draw has been published. Winning numbers: <strong>${winningNumbers.join(' · ')}</strong></p>
       <p>Keep entering your scores for next month's draw!</p>
       <a href="${process.env.CLIENT_URL}/dashboard" class="cta">View Draw →</a>`;

  await transporter.sendMail({ from: FROM, to: email, subject, html: emailWrapper(content) });
}

module.exports = { sendWelcomeEmail, sendSubscriptionEmail, sendDrawResultEmail };
