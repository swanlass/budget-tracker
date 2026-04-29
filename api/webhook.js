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

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const serviceAccountAuth = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
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
    
    // Ignore Telegram /start command
    if (text.startsWith('/start')) {
      return ctx.reply("👋 Welcome to the Budget Tracker! Send me a message like 'Spent $10 on coffee' to log an expense.");
    }
    
    try {
      // Default to Mountain Time based on your context
      const timezone = process.env.TIMEZONE || 'America/Denver'; 
      const dateInfo = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // Returns YYYY-MM-DD
      
      const intentPrompt = `Task: Classify user intent and extract data.
      Current Date: ${dateInfo}
      Input: "${text}"
      
      Intents:
      - TRANSACTION: Logging an expense (amount, category, date, description).
      - BUDGET_UPDATE: Setting a new monthly budget (amount).
      - QUERY: Asking about spending/budget (month, year).
      
      Return ONLY JSON: {"intent": "TRANSACTION"|"BUDGET_UPDATE"|"QUERY", "data": {relevant fields}}.`;
      
      const result = await model.generateContent([intentPrompt]);
      const responseText = result.response.text().replace(/```json|```/g, '').trim();
      const { intent, data } = JSON.parse(responseText);

      await doc.loadInfo();

      // 2. Handle Intent
      if (intent === 'BUDGET_UPDATE') {
        let configSheet = doc.sheetsByTitle['Config'] || await doc.addSheet({ title: 'Config', headerValues: ['Setting', 'Value'] });
        const rows = await configSheet.getRows();
        const budgetRow = rows.find(r => r.get('Setting') === 'Monthly Budget');
        
        if (budgetRow) {
          budgetRow.set('Value', data.amount);
          await budgetRow.save();
        } else {
          await configSheet.addRow(['Monthly Budget', data.amount]);
        }
        return ctx.reply(`⚙️ *Monthly Budget updated to: $${data.amount}*`, { parse_mode: 'Markdown' });
      }

      if (intent === 'QUERY') {
        // A. Get Budget from Config
        const configSheet = doc.sheetsByTitle['Config'];
        let budget = 8000;
        if (configSheet) {
          const configRows = await configSheet.getRows();
          const budgetRow = configRows.find(r => r.get('Setting') === 'Monthly Budget');
          if (budgetRow) budget = parseFloat(budgetRow.get('Value'));
        }

        // B. Get ALL Transactions
        const sheet = doc.sheetsByTitle['Transactions'];
        const rows = await sheet.getRows();
        const transactionHistory = rows.map(r => {
          return `Date: ${r.get('Date')}, User: ${r.get('User')}, Amount: ${r.get('Amount')}, Category: ${r.get('Category')}, Desc: ${r.get('Description')}`;
        }).join('\n');

        // C. Ask Gemini to analyze the data
        const analysisPrompt = `Context:
        Current Budget: $${budget}
        Today's Date: ${new Date().toISOString().split('T')[0]} (Current Month is ${new Date().toLocaleString('default', { month: 'long' })})
        Transaction History:
        ${transactionHistory}

        User Question: "${text}"
        
        CRITICAL INSTRUCTIONS:
        1. If the user DOES NOT specify a month or year in their question, you MUST ONLY use transactions from the current month (${new Date().toLocaleString('default', { month: 'long' })} ${new Date().getFullYear()}) in your calculations and response.
        2. If they ask for a report or "how much left", provide a summary of the current month vs budget.
        3. Be concise and use Markdown formatting.`;

        const analysisResult = await model.generateContent([analysisPrompt]);
        return ctx.reply(analysisResult.response.text(), { parse_mode: 'Markdown' });
      }

      if (intent === 'TRANSACTION') {
        const finalDate = data.date && data.date !== 'YYYY-MM-DD' ? data.date : dateInfo;
        let sheet = doc.sheetsByTitle['Transactions'] || await doc.addSheet({ title: 'Transactions', headerValues: ['Date', 'User', 'Amount', 'Category', 'Description'] });
        await sheet.addRow([finalDate, ctx.from.first_name, data.amount, data.category, data.description || ""]);
        return ctx.reply(`✅ Logged: $${data.amount} for ${data.category}`);
      }

    } catch (e) {
      await ctx.reply(`❌ Bot Error: ${e.message}`);
    }
  });

  // 4. Handle Voice Messages
  bot.on('voice', async (ctx) => {
    try {
      const voice = ctx.message.voice;
      const fileLink = await bot.telegram.getFileLink(voice.file_id);
      
      const response = await fetch(fileLink);
      const buffer = await response.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString('base64');
      
      const logDate = new Date().toISOString().split('T')[0];
      const result = await model.generateContent([
        { text: `Extract transaction from audio. Return ONLY JSON: {amount: number, category: string, date: string, description: string}. Use "${logDate}" as the date if no date is mentioned. Format date strictly as YYYY-MM-DD.` },
        { inlineData: { data: base64Data, mimeType: 'audio/ogg' } }
      ]);

      const cleanText = result.response.text().replace(/```json|```/g, '').trim();
      const transaction = JSON.parse(cleanText);
      const finalDate = transaction.date && transaction.date.includes('-') ? transaction.date : logDate;

      await doc.loadInfo();
      let sheet = doc.sheetsByTitle['Transactions'] || await doc.addSheet({ title: 'Transactions', headerValues: ['Date', 'User', 'Amount', 'Category', 'Description'] });
      await sheet.addRow([finalDate, ctx.from.first_name, transaction.amount, transaction.category, transaction.description || ""]);
      
      await ctx.reply(`✅ Voice Logged: $${transaction.amount} for ${transaction.category}`);
    } catch (e) {
      await ctx.reply(`❌ Voice Error: ${e.message}`);
    }
  });

  // 5. Handle Photos (Receipts)
  bot.on('photo', async (ctx) => {
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileLink = await bot.telegram.getFileLink(photo.file_id);
      
      const response = await fetch(fileLink);
      const buffer = await response.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString('base64');
      
      const logDate = new Date().toISOString().split('T')[0];
      const result = await model.generateContent([
        { text: `Extract transaction from receipt photo. Return ONLY JSON: {amount: number, category: string, date: string, description: string}. Use "${logDate}" as the date if no date is mentioned. Format date strictly as YYYY-MM-DD.` },
        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } }
      ]);

      const cleanText = result.response.text().replace(/```json|```/g, '').trim();
      const transaction = JSON.parse(cleanText);
      const finalDate = transaction.date && transaction.date.includes('-') ? transaction.date : logDate;

      await doc.loadInfo();
      let sheet = doc.sheetsByTitle['Transactions'] || await doc.addSheet({ title: 'Transactions', headerValues: ['Date', 'User', 'Amount', 'Category', 'Description'] });
      await sheet.addRow([finalDate, ctx.from.first_name, transaction.amount, transaction.category, transaction.description || ""]);
      
      await ctx.reply(`✅ Receipt Logged: $${transaction.amount} for ${transaction.category}`);
    } catch (e) {
      await ctx.reply(`❌ Photo Error: ${e.message}`);
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
