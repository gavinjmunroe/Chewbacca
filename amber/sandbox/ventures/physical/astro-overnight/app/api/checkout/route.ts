import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

// Lazy init — avoid crashing during build when env var is absent
function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-02-25.clover",
  });
}

// Product catalog — replace price IDs with real Stripe price IDs from your dashboard
const PRODUCTS: Record<string, { name: string; price: number; description: string; mode: "payment" | "subscription" }> = {
  trial_pack: {
    name: "Astro Overnight Trial Pack",
    price: 3900, // $39.00 in cents
    description: "20-count trial pack. See what better nights feel like.",
    mode: "payment",
  },
  starter_bundle: {
    name: "Better Nights Starter Kit",
    price: 5900, // $59.00
    description: "40-count pack + Astro Sense clip included.",
    mode: "payment",
  },
  monthly_sub: {
    name: "Astro Overnight Monthly Subscription",
    price: 4900, // $49.00/mo
    description: "80 diapers/month, auto-size tracking, free shipping. Cancel anytime.",
    mode: "subscription",
  },
  sense_addon: {
    name: "Astro Sense Clip",
    price: 2900, // $29.00
    description: "Reusable smart sensing clip. Works with all Astro Core diapers.",
    mode: "payment",
  },
};

export async function POST(req: NextRequest) {
  try {
    const { productId, size } = await req.json();

    const product = PRODUCTS[productId];
    if (!product) {
      return NextResponse.json({ error: "Invalid product" }, { status: 400 });
    }

    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;

    if (product.mode === "subscription") {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: product.name,
                description: `${product.description}${size ? ` · Size ${size}` : ""}`,
                images: [],
                metadata: { size: size || "unspecified" },
              },
              unit_amount: product.price,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/#order`,
        billing_address_collection: "required",
        shipping_address_collection: {
          allowed_countries: ["US", "CA"],
        },
        metadata: { productId, size: size || "" },
        allow_promotion_codes: true,
      });

      return NextResponse.json({ url: session.url });
    } else {
      const session = await stripe.checkout.sessions.create({  // one-time payment
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: product.name,
                description: `${product.description}${size ? ` · Size ${size}` : ""}`,
              },
              unit_amount: product.price,
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/#order`,
        billing_address_collection: "required",
        shipping_address_collection: {
          allowed_countries: ["US", "CA"],
        },
        metadata: { productId, size: size || "" },
        allow_promotion_codes: true,
      });

      return NextResponse.json({ url: session.url });
    }
  } catch (err) {
    console.error("[Stripe checkout error]", err);
    return NextResponse.json(
      { error: "Checkout failed. Please try again." },
      { status: 500 }
    );
  }
}
