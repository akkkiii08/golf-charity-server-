const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { sendSubscriptionEmail } = require('../utils/email');

// Pricing — amounts in pence (GBP)
const PLANS = {
  monthly: { amount: 999,  interval: 'month', label: 'Monthly Plan' },   // £9.99/mo
  yearly:  { amount: 9900, interval: 'year',  label: 'Yearly Plan' },     // £99.00/yr
};

// Prize pool contribution: 50% of subscription
const PRIZE_POOL_RATIO = 0.5;

// POST /api/payments/create-checkout — create Stripe Checkout session
router.post('/create-checkout', authenticate, async (req, res) => {
  const { plan } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const planConfig = PLANS[plan];

  try {
    // Create or get Stripe customer
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name:  req.user.full_name,
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;
      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', req.user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: { name: `Golf Charity — ${planConfig.label}` },
            unit_amount: planConfig.amount,
            recurring: { interval: planConfig.interval },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/dashboard?payment=success`,
      cancel_url:  `${process.env.CLIENT_URL}/subscribe?payment=cancelled`,
      metadata: { userId: req.user.id, plan },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/payments/webhook — Stripe webhook handler
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;

        // Some test events are generic and may not carry app metadata.
        if (!userId || !plan || !PLANS[plan] || !session.subscription) {
          console.warn('Ignoring checkout.session.completed with missing metadata/subscription', {
            eventId: event.id,
            userId,
            plan,
            hasSubscription: Boolean(session.subscription),
          });
          break;
        }

        const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
        const amount = PLANS[plan].amount;
        const prizePoolContrib = Math.floor(amount * PRIZE_POOL_RATIO);

        const { data: sub, error: subError } = await supabase
          .from('subscriptions')
          .insert({
            user_id: userId,
            plan,
            status: 'active',
            stripe_subscription_id: stripeSubscription.id,
            amount_pence: amount,
            current_period_start: new Date(stripeSubscription.current_period_start * 1000),
            current_period_end:   new Date(stripeSubscription.current_period_end   * 1000),
          })
          .select()
          .single();

        if (subError) {
          console.error('Failed to insert subscription from webhook:', subError);
          break;
        }

        const { error: paymentError } = await supabase.from('payments').insert({
          user_id: userId,
          subscription_id: sub?.id,
          stripe_payment_id: session.payment_intent,
          amount_pence: amount,
          status: 'succeeded',
          prize_pool_contrib: prizePoolContrib,
          charity_contrib: 0,
        });

        if (paymentError) {
          console.error('Failed to insert payment from webhook:', paymentError);
        }

        const { data: user } = await supabase.from('users').select('email, full_name').eq('id', userId).single();
        if (user) sendSubscriptionEmail(user.email, user.full_name, plan).catch(console.error);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase
          .from('subscriptions')
          .update({ status: 'cancelled', cancelled_at: new Date() })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await supabase
            .from('subscriptions')
            .update({ status: 'lapsed' })
            .eq('stripe_subscription_id', invoice.subscription);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.json({ received: true });
});

// GET /api/payments/portal — customer billing portal
router.post('/portal', authenticate, async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('stripe_customer_id').eq('id', req.user.id).single();

  if (!user?.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer:   user.stripe_customer_id,
    return_url: `${process.env.CLIENT_URL}/dashboard`,
  });
  res.json({ url: session.url });
});

module.exports = router;
