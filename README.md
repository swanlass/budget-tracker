# 🦞 Telegram Budget Tracker

A high-performance, AI-powered personal finance assistant that lives in your Telegram. Log expenses with natural language (text or speech), process receipts with Gemini, and get intelligent budget reports—all backed by a simple Google Sheet.

---

## 🚀 Features

- **Natural Language Logging**: Just type "lunch $15" or "spent 50 at target".
- **Multimodal Analysis**: Send photos of receipts (Gemini automatically extracts the data).
- **Intelligent Reporting**: Ask "how much left?" or "how much did I spend last month?".
- **Dynamic Budgeting**: Change your monthly limit via chat: "set budget to 5000".
- **Zero Maintenance**: Runs on Vercel Serverless for instant responses and zero cost.

---

## 🛠️ Tech Stack

- **Interface**: [Telegram Bot API](https://core.telegram.org/bots/api)
- **Brain**: [Google Gemini 2.5 Flash](https://ai.google.dev/)
- **Database**: [Google Sheets API](https://developers.google.com/sheets/api)
- **Infrastructure**: [Vercel Serverless Functions](https://vercel.com/)
- **Language**: Node.js

---

## 📦 Setup Guide

### 1. Telegram Bot Setup
1. Search for **@BotFather** on Telegram.
2. Send `/newbot` and follow the instructions to name your bot.
3. **Save the API Token**: You'll receive a string like `123456789:ABC...`.
4. Search for **@userinfobot** to find your own **Telegram User ID**. You'll need this to authorize yourself.

### 2. Google Cloud & Sheets Setup
1. **Create a Project**: Go to [Google Cloud Console](https://console.cloud.google.com/).
2. **Enable APIs**: Enable the **Google Sheets API** and **Vertex AI API**.
3. **Service Account**:
    - Go to **IAM & Admin > Service Accounts**.
    - Create a service account (e.g., `budget-bot`).
    - Go to the **Keys** tab and create a new **JSON Key**. Download this file.
4. **Share the Sheet**:
    - Create a new Google Sheet.
    - Copy the **Sheet ID** from the URL (between `/d/` and `/edit`).
    - Share the sheet with the `client_email` from your JSON key as an **Editor**.
    - Ensure you have a tab named **Transactions** with headers: `Date, User, Amount, Category, Description`.

### 3. Google AI Studio (Gemini)
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key** and copy it.

### 4. Vercel Deployment
1. Create a free account on [Vercel](https://vercel.com/).
2. Push this code to a **Private** GitHub repository.
3. Connect the repo to Vercel.
4. Add the following **Environment Variables** in the Vercel dashboard:
    - `TELEGRAM_TOKEN`: Your bot token.
    - `GEMINI_API_KEY`: Your Gemini key.
    - `SHEET_ID`: Your Google Sheet ID.
    - `AUTHORIZED_USERS`: Your Telegram ID (e.g., `123456789`).
    - `GOOGLE_SERVICE_ACCOUNT_KEY`: The entire content of your `service-account.json` file.
5. Click **Deploy**.

### 5. Link the Webhook
Once deployed, visit this URL in your browser to activate the bot:
`https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_URL>/webhook`

---

## 💬 Commands

- **Log Expense**: `"spent 20 on dinner"` or `"lunch $15"`
- **Query Budget**: `"how much left?"` or `"how much did I spend in March?"`
- **Update Budget**: `"set budget to 5000"`
- **Analyze Spender**: `"how much did Ashley spend?"`

---

## 🛡️ Security

The bot uses **User ID Authorization**. Even if someone finds your bot, it will only respond to the IDs listed in your `AUTHORIZED_USERS` environment variable. Any unauthorized access attempts will be blocked and reported to you.

---

## 📜 License

MIT © [Spencer Wanlass](https://github.com/swanlass)
