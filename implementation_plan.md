# Telegram Budget Tracker (Vercel Version)

This project uses **Vercel Serverless Functions** for a lightning-fast, reliable, and zero-maintenance experience.

## User Review Required

> [!IMPORTANT]
> **Vercel Account**: You will need a free Vercel account. You can sign up at [vercel.com](https://vercel.com/).

> [!WARNING]
> **GitHub Integration**: The easiest way to deploy to Vercel is by pushing your code to a private GitHub repository. I will help you set this up.

## Open Questions

1.  **GitHub Repo**: Do you have a GitHub account ready to host this private repository?

## Proposed Architecture

1.  **Next.js / Vercel API Route**: 
    *   Handles the Telegram Webhook.
    *   Vercel manages all the scaling and infrastructure.
2.  **Gemini Node.js SDK**: 
    *   Processes text, images, and audio files.
3.  **Google Sheets SDK**: 
    *   Writes transactions to your sheet using a Service Account.
4.  **Vercel Dashboard**:
    *   Used to store your `TELEGRAM_TOKEN`, `GEMINI_API_KEY`, `SHEET_ID`, and `GOOGLE_SERVICE_ACCOUNT_KEY`.

## Proposed Changes

### Vercel Backend
#### [NEW] [vercel.json](file:///Users/swanlass/Desktop/expense%20workflow/vercel.json)
*   Configuration for routing `/webhook` to our serverless function.

#### [MODIFY] [index.js](file:///Users/swanlass/Desktop/expense%20workflow/index.js)
*   Adjusted to export a single function for Vercel's runtime.

### Security
*   We will use **Vercel Environment Variables** to store all keys. No more minifying JSON or local key files!

## Verification Plan

### Automated Tests
*   Vercel provides instant deployment previews for every push.

### Manual Verification
1.  Push code to GitHub.
2.  Connect to Vercel and add Environment Variables.
3.  Set Telegram Webhook to the Vercel URL.
4.  Test the bot!
