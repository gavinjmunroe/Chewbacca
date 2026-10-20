# Clerk Setup Guide

Clerk provides authentication, user management, and organizations for Togari.

## Step 1: Create a Clerk Account

1. Go to https://clerk.com
2. Click "Start building for free"
3. Sign up with your email or GitHub

## Step 2: Create an Application

1. After signing in, you'll see "Create Application"
2. Name it: **"Togari"** (or whatever you prefer)
3. Choose sign-in options:
   - ✅ Email
   - ✅ Google (recommended)
   - ✅ GitHub (optional)
4. Click "Create Application"

## Step 3: Enable Organizations

Organizations let users create workspaces (like "My Health Practice").

1. In Clerk dashboard, go to **"Configure"** → **"Organizations"** (left sidebar)
2. Toggle **"Enable Organizations"** to ON
3. That's it! Organizations are now enabled.

## Step 4: Get Your API Keys

1. In Clerk dashboard, go to **"API Keys"** (left sidebar under "Developers")
2. You'll see two keys:
   - **Publishable Key** - starts with `pk_test_` (safe for frontend)
   - **Secret Key** - starts with `sk_test_` (keep secret!)

3. Copy these to your `.env` file:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxx
```

## Step 5: Configure URLs (Optional but Recommended)

1. In Clerk dashboard, go to **"Paths"** (under Configure)
2. Set these values:
   - **Sign-in URL**: `/sign-in`
   - **Sign-up URL**: `/sign-up`
   - **After sign-in URL**: `/dashboard`
   - **After sign-up URL**: `/dashboard`

3. These are already configured in the code, so this just makes Clerk aware of them.

## Step 6: Test It Out

1. Start your dev server: `pnpm dev`
2. Go to http://localhost:3000
3. Click "Get Started" or "Sign In"
4. Create an account
5. After signing in, Clerk will prompt you to create an organization
6. Name it something like "My Practice" or "Test Org"
7. You'll be redirected to `/dashboard`

## That's It!

Clerk is now fully configured. Your app has:
- ✅ User authentication
- ✅ Sign in / Sign up flows
- ✅ Organizations (workspaces)
- ✅ User management dashboard

## Getting Your Organization ID

You'll need the organization ID for testing the Amber endpoint:

1. After creating an organization in the app
2. In Clerk dashboard, go to **"Organizations"**
3. Click on your organization
4. Copy the **Organization ID** (starts with `org_`)

OR programmatically:
```typescript
// In your app, this is available via:
const { organization } = useOrganization();
console.log(organization.id); // org_xxxxx
```

## Troubleshooting

**Issue**: "Clerk is not defined"
- Solution: Make sure both API keys are in `.env` and restart dev server

**Issue**: "Organizations not available"
- Solution: Enable organizations in Clerk dashboard (Step 3)

**Issue**: Authentication loop
- Solution: Clear browser cookies and try again

## Free Tier Limits

Clerk's free tier includes:
- 10,000 monthly active users
- Unlimited organizations
- All authentication methods
- Perfect for development and MVPs
