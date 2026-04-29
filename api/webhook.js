const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Global variables
let bot, model, doc;

// 1. START SERVER IMMEDIATELY
app.get('/', (req, res) => res.send('Budget Tracker is ALIVE!'));
app.post('/webhook', (req, res) => {
  if (bot) {
    bot.handleUpdate(req.body);
  }
  res.sendStatus(200);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`>>> SERVER LISTENING ON PORT ${PORT}`);
});

// 2. INITIALIZE SERVICES ASYNC (Lazy Loading)
async function init() {
  console.log(">>> LAZY LOADING SERVICES...");
  try {
    // Large libraries loaded ONLY here
    const { Telegraf } = require('telegraf');
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const { GoogleSpreadsheet } = require('google-spreadsheet');
    const { JWT } = require('google-auth-library');
    
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SHEET_ID = process.env.SHEET_ID;
    const AUTHORIZED_USERS = (process.env.AUTHORIZED_USERS || "").split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const serviceAccountAuth = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    console.log(">>> SHEETS READY");

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log(">>> GEMINI READY");

    bot = new Telegraf(TELEGRAM_TOKEN);

    bot.use(async (ctx, next) => {
      if (AUTHORIZED_USERS.includes(ctx.from.id)) return next();
      await ctx.reply(`❌ Unauthorized. ID: ${ctx.from.id}`);
    });

    bot.on('text', async (ctx) => {
      const text = ctx.message.text;
      try {
        const result = await model.generateContent([`Extract transaction: ${text}. Return JSON {amount, category, date, description}`]);
        const cleanText = result.response.text().replace(/```json|```/g, '').trim();
        const transaction = JSON.parse(cleanText);
        
        const sheet = doc.sheetsByTitle['Transactions'] || await doc.addSheet({ title: 'Transactions', headerValues: ['Date', 'User', 'Amount', 'Category', 'Description'] });
        await sheet.addRow([transaction.date, ctx.from.first_name, transaction.amount, transaction.category, transaction.description]);
        
        ctx.reply(`✅ Logged: $${transaction.amount}`);
      } catch (e) {
        console.error("Bot Error:", e);
        ctx.reply(`❌ Error: ${e.message}`);
      }
    });

    console.log(">>> ALL SERVICES READY!");
  } catch (e) {
    console.error(">>> INITIALIZATION FAILED:", e);
  }
}

init();
