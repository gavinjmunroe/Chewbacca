# Database Migrations Guide

## Setup

1. **Set up local Postgres** (choose one):
   
   **Option A: Local Postgres**
   ```bash
   # macOS with Homebrew
   brew install postgresql@16
   brew services start postgresql@16
   createdb amber
   ```
   
   **Option B: Cloud SQL (GCP)**
   ```bash
   # After running terraform apply, get connection string
   gcloud sql instances describe amber-postgres --format="value(connectionName)"
   ```

2. **Set DATABASE_URL**:
   ```bash
   # Local
   export DATABASE_URL="postgres://$(whoami)@localhost:5432/amber"
   
   # Or create .env file:
   echo 'DATABASE_URL=postgres://user:password@localhost:5432/amber' > .env
   ```

## Generate Migrations

```bash
cd services/app
DATABASE_URL="your-connection-string" pnpm db:generate
```

This creates SQL migration files in `drizzle/` directory.

## Apply Migrations

**Option 1: Push schema directly (dev)**
```bash
DATABASE_URL="your-connection-string" pnpm db:push
```

**Option 2: Run migrations (production)**
```bash
DATABASE_URL="your-connection-string" pnpm db:migrate
```

## Verify

```bash
# Open Drizzle Studio to view your database
DATABASE_URL="your-connection-string" pnpm db:studio
```

## For GCP Cloud SQL

After deploying with Terraform, migrations run automatically on first deploy, or you can run them manually:

```bash
# Get connection name from Terraform output
terraform output database_connection_name

# Use Cloud SQL Proxy for local migration
cloud_sql_proxy -instances=CONNECTION_NAME=tcp:5432

# Then run migrations
DATABASE_URL="postgres://user:pass@localhost:5432/amber" pnpm db:push
```


