# 🔐 Clerk Setup Instructions - 2 Minutes!

Your Structify is already configured! ✅ Now you just need Clerk credentials to start developing.

## Step 1: Create Clerk Account (30 seconds)

1. Go to **https://clerk.com**
2. Click **"Start building for free"**
3. Sign up with your email or GitHub

## Step 2: Create Application (30 seconds)

1. After signing in, you'll see **"Create application"** button
2. Click it
3. Name your app: **"Togari"** (or whatever you like)
4. Choose authentication methods (I recommend keeping defaults: Email + Google + GitHub)
5. Click **"Create application"**

## Step 3: Enable Organizations (30 seconds)

This is CRITICAL for multi-tenancy!

1. In the Clerk dashboard, look at the left sidebar
2. Click **"Organizations"**
3. Click the toggle to **"Enable Organizations"**
4. Keep default settings
5. Click **"Save"**

## Step 4: Copy Your API Keys (30 seconds)

1. In the Clerk dashboard, click **"API Keys"** in the left sidebar
2. You'll see two keys:
   - **Publishable key** - starts with `pk_test_`
   - **Secret key** - starts with `sk_test_` (click "Show" to reveal it)

3. Copy both keys
4. Open `/Users/sagartiwari/Desktop/Amber/togari-api/.env` in a text editor
5. Replace these lines:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
```

With your actual keys:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_PASTE_YOUR_KEY_HERE
CLERK_SECRET_KEY=sk_test_PASTE_YOUR_KEY_HERE
```

6. Save the file

## Step 5: Start Developing! 🚀

That's it! Now run:

```bash
# Terminal 1 - API Server
cd /Users/sagartiwari/Desktop/Amber/togari-api
pnpm --filter @togari/api dev

# Terminal 2 - Web App (open a new terminal)
cd /Users/sagartiwari/Desktop/Amber/togari-api
pnpm --filter @togari/web dev
```

Then open **http://localhost:3000** and sign in!

## What You Get

With Clerk set up, you can:
- ✅ Sign in/sign up with email
- ✅ Create and switch between organizations (multi-tenancy!)
- ✅ Invite team members to your organization
- ✅ All data automatically scoped to your organization

## Troubleshooting

### "Invalid publishable key"
- Make sure you copied the ENTIRE key including `pk_test_`
- No extra spaces or quotes
- Must be from a Clerk app with Organizations enabled

### "Can't create organization"
- Go back to Clerk dashboard
- Click "Organizations" in sidebar
- Make sure the toggle is ON

### Still stuck?
Check `docs/CLERK_SETUP.md` for detailed screenshots and more help.

---

**You're almost there!** Just copy those two Clerk keys and you're ready to build. 🎉
