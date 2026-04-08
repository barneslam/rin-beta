# RIN — Roadside Intelligence Network

Dispatcher-facing roadside incident management and driver dispatch platform with customer and driver mobile apps.

## Stack

- **Dispatcher Web:** Vite + React + TypeScript + shadcn-ui + Tailwind CSS
- **Customer Mobile:** Expo + React Native + TypeScript
- **Driver Mobile:** Expo + React Native + TypeScript
- **Backend:** Supabase (PostgreSQL + Edge Functions + Realtime)
- **SMS:** Twilio
- **Payments:** Stripe (authorization + capture)

## Quick Start

```bash
# Dispatcher web app
npm install && npm run dev    # http://localhost:8080

# Customer mobile app
cd rin-customer && npm install && npx expo start --web --port 8081

# Driver mobile app
cd rin-driver && npm install && npx expo start --web --port 8082
```

## Documentation

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for complete setup, architecture, and deployment instructions.

## Repository

- **GitHub:** https://github.com/barneslam/rin-beta
- **Supabase:** Project `zyoszbmahxnfcokuzkuv`
