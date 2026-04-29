const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Helper to load services
async function getServices() {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const SHEET_ID = process.env.SHEET_ID;
  const AUTHORIZED_USERS = (process.env.AUTHORIZED_USERS || "").split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing!");
  }

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const serviceAccountAuth = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const bot = new Telegraf(TELEGRAM_TOKEN);

  return { bot, model, doc, AUTHORIZED_USERS };
}

// Vercel Serverless Function Handler
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).send('Budget Tracker is ALIVE!');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { bot, model, doc, AUTHORIZED_USERS } = await getServices();

  // Setup Bot Logic
  bot.use(async (ctx, next) => {
    if (AUTHORIZED_USERS.includes(ctx.from.id)) return next();
    await ctx.reply(`❌ Unauthorized. ID: ${ctx.from.id}`);
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    const cleanMsg = text.toLowerCase().trim();

    // 1. Check for Budget Update (e.g., "Set budget to 1000")
    if (cleanMsg.startsWith('set budget to')) {
      try {
        const match = text.match(/\d+/);
        if (!match) return ctx.reply("❌ Please provide a number (e.g., Set budget to 1000)");
        const newBudget = parseFloat(match[0]);
        
        await doc.loadInfo();
        let configSheet = doc.sheetsByTitle['Config'];
        if (!configSheet) {
          configSheet = await doc.addSheet({ title: 'Config', headerValues: ['Setting', 'Value'] });
        }
        
        const rows = await configSheet.getRows();
        const budgetRow = rows.find(r => r.get('Setting') === 'Monthly Budget');
        
        if (budgetRow) {
          budgetRow.set('Value', newBudget);
          await budgetRow.save();
        } else {
          await configSheet.addRow(['Monthly Budget', newBudget]);
        }
        
        return ctx.reply(`⚙️ *Monthly Budget updated to: $${newBudget}*`, { parse_mode: 'Markdown' });
      } catch (e) {
        return ctx.reply(`❌ Setup Error: ${e.message}`);
      }
    }

    // 2. Check for text query (reporting)
    const queryKeywords = ['budget', 'left', 'remaining', 'spent', 'how much'];
    const isQuery = queryKeywords.some(kw => text.toLowerCase().includes(kw));

    if (isQuery) {
      try {
        await doc.loadInfo();
        
        // Get Current Budget
        const configSheet = doc.sheetsByTitle['Config'];
        let budget = 8000; // Default
        if (configSheet) {
          const configRows = await configSheet.getRows();
          const budgetRow = configRows.find(r => r.get('Setting') === 'Monthly Budget');
          if (budgetRow) budget = parseFloat(budgetRow.get('Value'));
        }

        const sheet = doc.sheetsByTitle['Transactions'];
        const rows = await sheet.getRows();
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalSpent = 0;
        rows.forEach(row => {
          const date = new Date(row.get('Date'));
          if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
            totalSpent += parseFloat(row.get('Amount') || 0);
          }
        });
        const remaining = budget - totalSpent;
        return ctx.reply(`📊 *Budget Report (${now.toLocaleString('default', { month: 'long' })})*\nBudget: $${budget.toFixed(2)}\nTotal Spent: $${totalSpent.toFixed(2)}\nRemaining: $${remaining.toFixed(2)}`, { parse_mode: 'Markdown' });
      } catch (e) {
        return ctx.reply(`❌ Report Error: ${e.message}`);
      }
    }

    try {
      const logDate = new Date().toISOString().split('T')[0];
      const result = await model.generateContent([`Extract transaction: ${text}. Return ONLY JSON: {amount: number, category: string, date: string, description: string}. Use "${logDate}" as the date if no date is mentioned. NEVER return "YYYY-MM-DD".`]);
      const cleanText = result.response.text().replace(/```json|```/g, '').trim();
      const transaction = JSON.parse(cleanText);
      const finalDate = transaction.date && transaction.date !== 'YYYY-MM-DD' ? transaction.date : logDate;
      let sheet = doc.sheetsByTitle['Transactions'] || await doc.addSheet({ title: 'Transactions', headerValues: ['Date', 'User', 'Amount', 'Category', 'Description'] });
      await sheet.addRow([finalDate, ctx.from.first_name, transaction.amount, transaction.category, transaction.description]);
      await ctx.reply(`✅ Logged: $${transaction.amount}`);
    } catch (e) {
      await ctx.reply(`❌ Error: ${e.message}`);
    }
  });

  // Handle the Telegram Update
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
};
