# Development Environment Setup - Tizzy

**Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** Initial Setup Guide

---

## Overview

This guide walks you through setting up your development environment for Tizzy. The stack is designed for rapid iteration while maintaining production-grade privacy and security.

**Time estimate:** 2-4 hours for complete setup

---

## System Requirements

### Hardware
- **Development machine:** Mac, Linux, or Windows with WSL2
- **Minimum:** 16GB RAM, 256GB SSD
- **Recommended:** 32GB RAM, 512GB SSD, M1/M2 Mac or equivalent
- **Hardware prototype access:** Contact hardware team for dev kit

### Software Prerequisites
- **macOS:** 12.0+ (Monterey or later)
- **Linux:** Ubuntu 20.04+ or equivalent
- **Windows:** Windows 10/11 with WSL2 (Ubuntu recommended)

---

## Tech Stack Overview

### Hardware Prototyping
- **Microcontroller:** ESP32 or equivalent (TBD based on prototype)
- **Programming:** C/C++, Arduino framework initially
- **Audio processing:** I2S microphones, on-device DSP

### Mobile App
- **Framework:** React Native (cross-platform iOS/Android)
- **Language:** TypeScript
- **State management:** Redux Toolkit or Zustand
- **UI components:** React Native Paper or custom
- **Bluetooth:** react-native-ble-plx

### Backend Services
- **Runtime:** Node.js (LTS version)
- **API framework:** Express.js or Fastify
- **Language:** TypeScript
- **Database:** PostgreSQL (user data, metadata)
- **Vector store:** Pinecone or Weaviate (audio embeddings)
- **Queue:** Redis or BullMQ (async processing)
- **Object storage:** AWS S3 or local MinIO (encrypted audio if retained)

### ML/AI Pipeline
- **Voice processing:** Python 3.10+
- **Speech-to-text:** OpenAI Whisper or similar
- **Audio features:** librosa, pyannote.audio
- **ML framework:** PyTorch or TensorFlow
- **Modulate integration:** API client (when available)
- **Serving:** FastAPI or Flask for inference endpoints

### Infrastructure
- **Development:** Docker Compose (local services)
- **CI/CD:** GitHub Actions
- **Cloud:** AWS (production), local/Docker (development)
- **Monitoring:** Sentry (errors), Prometheus + Grafana (metrics)

### Security & Privacy
- **Encryption:** libsodium (device), AWS KMS (cloud)
- **Key management:** HashiCorp Vault or AWS Secrets Manager
- **Audit logging:** Custom + CloudWatch
- **Privacy tools:** Differential privacy libraries (future)

---

## Step 1: Core Development Tools

### Install Homebrew (macOS/Linux)

```bash
# macOS
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Linux
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Install Core Tools

```bash
# Version control
brew install git

# Node.js (use nvm for version management)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install --lts
nvm use --lts

# Python (use pyenv for version management)
brew install pyenv
pyenv install 3.10.12
pyenv global 3.10.12

# Docker
brew install --cask docker
# Or download from https://www.docker.com/products/docker-desktop

# PostgreSQL (client tools)
brew install postgresql@15

# Redis (for local development)
brew install redis
```

### Install Code Editor

**Recommended:** Visual Studio Code
```bash
brew install --cask visual-studio-code
```

**VS Code Extensions to Install:**
- ESLint
- Prettier
- Python
- Docker
- TypeScript and JavaScript Language Features
- React Native Tools
- GitLens

---

## Step 2: Clone Repository

```bash
# Create workspace directory
mkdir -p ~/tizzy-workspace
cd ~/tizzy-workspace

# Clone main repository
git clone https://github.com/tizzy/tizzy.git
cd tizzy

# Install git hooks (pre-commit, linting)
npm run setup-hooks
```

**Expected directory structure:**
```
tizzy/
├── hardware/          # Embedded firmware
├── mobile/            # React Native app
├── backend/           # Node.js API services
├── ml/                # Python ML pipeline
├── infrastructure/    # Docker, Kubernetes configs
├── docs/              # Documentation
└── scripts/           # Development scripts
```

---

## Step 3: Mobile App Setup (React Native)

### Install React Native Dependencies

```bash
cd mobile

# Install Node modules
npm install

# iOS setup (macOS only)
npx pod-install ios

# Android setup
# Install Android Studio from https://developer.android.com/studio
# Set ANDROID_HOME environment variable
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

### Environment Configuration

```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local with your settings
# API_BASE_URL=http://localhost:3000
# SENTRY_DSN=your_sentry_dsn_here
# etc.
```

### Run Mobile App

```bash
# Start Metro bundler
npm start

# In separate terminal - iOS
npm run ios

# In separate terminal - Android
npm run android
```

---

## Step 4: Backend Services Setup

### Start Local Services with Docker

```bash
cd backend

# Start PostgreSQL, Redis, etc.
docker-compose up -d

# Verify services running
docker-compose ps
```

### Setup Database

```bash
# Create database
npm run db:create

# Run migrations
npm run db:migrate

# Seed development data
npm run db:seed
```

### Environment Configuration

```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local
# DATABASE_URL=postgresql://tizzy:tizzy@localhost:5432/tizzy_dev
# REDIS_URL=redis://localhost:6379
# JWT_SECRET=generate_a_secure_secret
# etc.
```

### Run Backend Locally

```bash
# Install dependencies
npm install

# Start development server (with hot reload)
npm run dev

# API should be available at http://localhost:3000
```

### Verify Backend

```bash
# Health check
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","timestamp":"2026-02-13T..."}
```

---

## Step 5: ML Pipeline Setup (Python)

### Create Virtual Environment

```bash
cd ml

# Create virtual environment
python -m venv venv

# Activate virtual environment
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Download ML Models

```bash
# Download pre-trained models
python scripts/download_models.py

# This downloads:
# - Whisper (speech-to-text)
# - Pyannote diarization models
# - Any custom Tizzy models
```

### Environment Configuration

```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local
# MODEL_PATH=/path/to/models
# DEVICE=cpu  # or 'cuda' if GPU available
# etc.
```

### Run ML Services

```bash
# Start FastAPI inference server
python -m uvicorn app.main:app --reload --port 8000

# ML API available at http://localhost:8000
```

### Verify ML Pipeline

```bash
# Test transcription endpoint
curl -X POST http://localhost:8000/transcribe \
  -F "audio=@test/fixtures/sample.wav"

# Expected: transcription JSON response
```

---

## Step 6: Hardware Development (Optional)

**Note:** Hardware development requires physical dev kit. Contact hardware team.

### Arduino IDE Setup

```bash
# Install Arduino IDE
brew install --cask arduino

# Or download from https://www.arduino.cc/en/software
```

### ESP32 Board Setup

1. Open Arduino IDE
2. Go to Preferences
3. Add ESP32 board manager URL:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
4. Go to Tools > Board > Boards Manager
5. Install "ESP32 by Espressif Systems"

### Install Libraries

Required libraries (via Library Manager):
- ESP32-BLE-Arduino
- ArduinoJson
- I2S Audio Library

### Flash Firmware to Device

```bash
cd hardware/firmware

# Open in Arduino IDE
# Select board: ESP32 Dev Module
# Select port: /dev/cu.usbserial-... (macOS) or COM port (Windows)
# Click Upload
```

### Serial Monitor Debugging

```bash
# Using Arduino IDE Serial Monitor
# Or use screen command:
screen /dev/cu.usbserial-XXXX 115200
```

---

## Step 7: Development Workflow Tools

### Pre-commit Hooks

```bash
# Install pre-commit (if not already)
pip install pre-commit

# Install hooks
pre-commit install

# Test hooks
pre-commit run --all-files
```

**What the hooks do:**
- Lint TypeScript/JavaScript (ESLint)
- Format code (Prettier)
- Lint Python (Black, isort, flake8)
- Check for secrets in commits
- Run type checking (TypeScript)

### Testing Setup

```bash
# Mobile app tests
cd mobile
npm test

# Backend tests
cd backend
npm test

# ML pipeline tests
cd ml
pytest

# Run all tests
npm run test:all  # from root
```

### Code Quality Tools

```bash
# TypeScript type checking
npm run type-check

# Linting
npm run lint

# Format code
npm run format

# Security audit
npm audit
```

---

## Step 8: Privacy & Security Setup

### Generate Encryption Keys (Development)

```bash
cd backend

# Generate test encryption keys
npm run keys:generate

# Keys stored in .keys/ (gitignored)
# NEVER commit real keys to git
```

### Setup Secrets Management

```bash
# For local development, use .env files
# For production, use AWS Secrets Manager or Vault

# Install AWS CLI (if using AWS)
brew install awscli

# Configure AWS credentials
aws configure
```

### Enable Audit Logging

```bash
# Audit logs automatically enabled in development
# Check backend/logs/audit.log

# Tail audit log
tail -f backend/logs/audit.log
```

---

## Step 9: Documentation Tools

### Install Documentation Generator

```bash
# TypeDoc for TypeScript
npm install -g typedoc

# Sphinx for Python
pip install sphinx sphinx-rtd-theme

# Generate docs
npm run docs:generate
```

### Access Documentation Locally

```bash
# Start docs server
npm run docs:serve

# Open http://localhost:4000
```

---

## Step 10: Recommended Development Setup

### VS Code Workspace Settings

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "python.linting.enabled": true,
  "python.linting.pylintEnabled": false,
  "python.linting.flake8Enabled": true,
  "python.formatting.provider": "black",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[python]": {
    "editor.defaultFormatter": "ms-python.black-formatter"
  }
}
```

### Recommended VS Code Launch Configurations

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Mobile App",
      "type": "reactnative",
      "request": "launch",
      "platform": "ios",
      "cwd": "${workspaceFolder}/mobile"
    },
    {
      "name": "Debug Backend",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "cwd": "${workspaceFolder}/backend",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Debug Python ML",
      "type": "python",
      "request": "launch",
      "module": "uvicorn",
      "args": ["app.main:app", "--reload"],
      "cwd": "${workspaceFolder}/ml"
    }
  ]
}
```

---

## Step 11: Verify Complete Setup

### Run Integration Test

```bash
# From root directory
npm run test:integration

# This tests:
# - Mobile app connects to backend
# - Backend connects to database
# - ML pipeline processes sample audio
# - End-to-end conversation flow
```

### Expected Output

```
✓ Mobile app builds successfully
✓ Backend API responds to health check
✓ Database migrations applied
✓ ML pipeline transcribes test audio
✓ Bluetooth mock connection works
✓ Privacy controls functional
✓ All services communicating

Setup complete! 🎉
```

---

## Troubleshooting

### Common Issues

#### Issue: Node modules installation fails
```bash
# Solution: Clear cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

#### Issue: iOS build fails with CocoaPods error
```bash
# Solution: Update CocoaPods and reinstall
cd mobile/ios
pod deintegrate
pod install
cd ../..
```

#### Issue: Docker services won't start
```bash
# Solution: Check ports not already in use
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis

# Kill conflicting processes or change ports in docker-compose.yml
```

#### Issue: Python ML models not downloading
```bash
# Solution: Download manually
# Visit model URLs in scripts/download_models.py
# Place in ml/models/ directory
```

#### Issue: Android emulator not starting
```bash
# Solution: Create new AVD
# Open Android Studio > AVD Manager
# Create new Virtual Device
# Select system image (API 33+)
```

### Getting Help

1. **Check documentation:** `docs/`
2. **Search issues:** GitHub Issues
3. **Ask team:** Slack #dev-help channel
4. **Contact lead:** [tech-lead email]

---

## Next Steps After Setup

1. **Read architecture docs:** `docs/architecture/`
2. **Review coding standards:** `docs/CONTRIBUTING.md`
3. **Pick first issue:** Check GitHub Issues labeled "good first issue"
4. **Join daily standup:** Ask team lead for invite
5. **Request access:** AWS, Sentry, analytics dashboards

---

## Development Best Practices

### Daily Workflow

```bash
# 1. Start your day
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# 2. Start services
docker-compose up -d
npm run dev:all  # Starts all services in parallel

# 3. Make changes
# ... code code code ...

# 4. Test your changes
npm run test:watch  # Keep tests running
npm run lint
npm run type-check

# 5. Commit
git add .
git commit -m "feat: Add awesome feature"
# Pre-commit hooks run automatically

# 6. Push and PR
git push origin feature/your-feature-name
# Create pull request on GitHub
```

### Code Review Checklist

Before submitting PR:
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No console.logs or debug code
- [ ] TypeScript types are correct
- [ ] Privacy implications considered
- [ ] Security review if touching auth/encryption
- [ ] Accessibility considerations
- [ ] Performance impact assessed

---

## Environment Variables Reference

### Mobile App (.env.local)
```bash
API_BASE_URL=http://localhost:3000
SENTRY_DSN=your_sentry_dsn
ENVIRONMENT=development
ENABLE_LOGS=true
```

### Backend (.env.local)
```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://tizzy:tizzy@localhost:5432/tizzy_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret_here
ENCRYPTION_KEY=your_encryption_key_here
AWS_REGION=us-east-1
S3_BUCKET=tizzy-dev-audio
SENTRY_DSN=your_sentry_dsn
```

### ML Pipeline (.env.local)
```bash
MODEL_PATH=/path/to/models
DEVICE=cpu
WHISPER_MODEL=base
MODULATE_API_KEY=your_api_key_here
INFERENCE_BATCH_SIZE=4
```

---

## Security Notes

### Development Security

⚠️ **NEVER commit:**
- `.env` files
- API keys or secrets
- Encryption keys
- Personal data or test data with PII
- AWS credentials

✅ **Always:**
- Use `.env.local` for secrets (gitignored)
- Rotate development keys regularly
- Use test data, never production data
- Enable 2FA on GitHub
- Keep dependencies updated

### Reporting Security Issues

**DO NOT open public GitHub issue for security bugs**

Contact: security@tizzy.ai (once set up)
Or: Direct message to CTO/tech lead

---

## Performance Tips

### Faster Development

```bash
# Use npm workspaces for faster installs
npm install --workspaces

# Use Turborepo for faster builds (if adopted)
npm run build --filter=mobile

# Use watchman for faster React Native file watching
brew install watchman
```

### Optimize Docker

```bash
# Use BuildKit for faster Docker builds
export DOCKER_BUILDKIT=1

# Prune unused containers/images weekly
docker system prune -a
```

---

## Updating This Guide

This setup guide should be updated when:
- New dependencies added
- Architecture changes
- New services introduced
- Common issues discovered

To update:
1. Edit `development/setup.md`
2. Test instructions on clean machine
3. Submit PR with "docs:" prefix
4. Get review from 2+ team members

---

## Additional Resources

### Documentation
- [Architecture Overview](../docs/architecture.md)
- [Contributing Guidelines](./contributing.md)
- [API Documentation](../docs/api/)
- [Privacy Architecture](../docs/privacy-architecture.md)

### External Resources
- [React Native Docs](https://reactnative.dev/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Python FastAPI](https://fastapi.tiangolo.com/)
- [ESP32 Documentation](https://docs.espressif.com/)

### Team Resources
- Slack: #dev-general
- Weekly sync: Fridays 2pm PT
- Tech lead: [name]
- Design reviews: Wednesdays

---

**Last Updated:** February 13, 2026
**Maintainer:** Development Team Lead
**Version:** 1.0 (will increment with major changes)
