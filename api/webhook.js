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
    
    if (text.startsWith('/start')) {
      return ctx.reply("👋 Welcome to the Budget Tracker! Log expenses like 'lunch $15', ask 'how much left?', or set your limit with 'make the budget 5000'.");
    }

    try {
      const timezone = process.env.TIMEZONE || 'America/Denver'; 
      const dateInfo = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
      
      // Helper for robust JSON parsing
      const parseAIJSON = (text) => {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error("AI failed to return valid JSON");
        const jsonStr = text.substring(start, end + 1);
        return JSON.parse(jsonStr);
      };

      // 1. Classify Intent
      const intentPrompt = `Task: Classify intent. Date: ${dateInfo}. Input: "${text}"
      Intents: TRANSACTION, BUDGET_UPDATE, QUERY.
      Return ONLY JSON: {"intent": "..."}.`;
      
      const result = await model.generateContent([intentPrompt]);
      const { intent } = parseAIJSON(result.response.text());

      await doc.loadInfo();

      // 2. Get Valid Categories from "Categories" tab
      const catSheet = doc.sheetsByTitle['Categories'];
      let categoriesList = 'General';
      if (catSheet) {
        const catRows = await catSheet.getRows();
        const cats = catRows.map(r => r.get('Categories')).filter(c => c);
        if (cats.length > 0) categoriesList = cats.join(', ');
      }

      // 3. Handle Intent
      if (intent === 'BUDGET_UPDATE') {
        const budgetPrompt = `Extract budget amount from: "${text}". Return ONLY JSON: {"amount": number}.`;
        const bResult = await model.generateContent([budgetPrompt]);
        const { amount } = parseAIJSON(bResult.response.text());

        let configSheet = doc.sheetsByTitle['Config'] || await doc.addSheet({ title: 'Config', headerValues: ['Setting', 'Value'] });
        const rows = await configSheet.getRows();
        let budgetRow = rows.find(r => r.get('Setting') === 'Monthly Budget');
        if (budgetRow) {
          budgetRow.set('Value', amount);
          await budgetRow.save();
        } else {
          await configSheet.addRow(['Monthly Budget', amount]);
        }
        return ctx.reply(`⚙️ *Monthly Budget updated to: $${amount}*`, { parse_mode: 'Markdown' });
      }

      if (intent === 'QUERY') {
        const configSheet = doc.sheetsByTitle['Config'];
        let budget = 8000;
        if (configSheet) {
          const configRows = await configSheet.getRows();
          const budgetRow = configRows.find(r => r.get('Setting') === 'Monthly Budget');
          if (budgetRow) budget = parseFloat(budgetRow.get('Value'));
        }

        const sheet = doc.sheetsByTitle['Transactions'];
        const rows = await sheet.getRows();
        const transactionHistory = rows.map(r => `Date: ${r.get('Date')}, Person: ${r.get('User')}, Amount: ${r.get('Amount')}, Category: ${r.get('Category')}, Desc: ${r.get('Description')}`).join('\n');

        const analysisPrompt = `Context: Budget $${budget}, History: ${transactionHistory}. Question: "${text}". Return Markdown answer. Default to current month (${dateInfo}).`;
        const analysisResult = await model.generateContent([analysisPrompt]);
        return ctx.reply(analysisResult.response.text(), { parse_mode: 'Markdown' });
      }

      if (intent === 'TRANSACTION') {
        const transPrompt = `Input: "${text}". Categories: [${categoriesList}]. Extract JSON: {amount, category, date, description}. Use closest Category.`;
        const tResult = await model.generateContent([transPrompt]);
        const tData = parseAIJSON(tResult.response.text());
        
        const finalDate = tData.date && tData.date.includes('-') ? tData.date : dateInfo;
        let sheet = doc.sheetsByTitle['Transactions'] || await doc.addSheet({ title: 'Transactions', headerValues: ['Date', 'User', 'Amount', 'Category', 'Description'] });
        
        await sheet.addRow({
          'Date': finalDate,
          'User': ctx.from.first_name,
          'Amount': tData.amount,
          'Category': tData.category,
          'Description': tData.description || ""
        });
        return ctx.reply(`✅ Logged: $${tData.amount} for ${tData.category}`);
      }
    } catch (e) {
      await ctx.reply(`❌ Error: ${e.message}`);
    }
  });

  // Handle Voice/Photo
  const handleMultimodal = async (ctx, mimeType, base64Data) => {
    try {
      const timezone = process.env.TIMEZONE || 'America/Denver';
      const dateInfo = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
      
      const catSheet = doc.sheetsByTitle['Categories'];
      let categoriesList = 'General';
      if (catSheet) {
        const catRows = await catSheet.getRows();
        const cats = catRows.map(r => r.get('Categories')).filter(c => c);
        if (cats.length > 0) categoriesList = cats.join(', ');
      }

      const result = await model.generateContent([
        { text: `Extract transaction. Categories: [${categoriesList}]. Return JSON: {amount, category, date, description}. Date: ${dateInfo}.` },
        { inlineData: { data: base64Data, mimeType } }
      ]);
      const tData = parseAIJSON(result.response.text());
      
      const finalDate = tData.date && tData.date.includes('-') ? tData.date : dateInfo;
      let sheet = doc.sheetsByTitle['Transactions'] || await doc.addSheet({ title: 'Transactions', headerValues: ['Date', 'User', 'Amount', 'Category', 'Description'] });
      await sheet.addRow({
        'Date': finalDate,
        'User': ctx.from.first_name,
        'Amount': tData.amount,
        'Category': tData.category,
        'Description': tData.description || ""
      });
      await ctx.reply(`✅ Logged: $${tData.amount} for ${tData.category}`);
    } catch (e) {
      await ctx.reply(`❌ Error: ${e.message}`);
    }
  };

  bot.on('voice', async (ctx) => {
    const fileLink = await bot.telegram.getFileLink(ctx.message.voice.file_id);
    const response = await fetch(fileLink);
    const base64Data = Buffer.from(await response.arrayBuffer()).toString('base64');
    await handleMultimodal(ctx, 'audio/ogg', base64Data);
  });

  bot.on('photo', async (ctx) => {
    const fileLink = await bot.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length-1].file_id);
    const response = await fetch(fileLink);
    const base64Data = Buffer.from(await response.arrayBuffer()).toString('base64');
    await handleMultimodal(ctx, 'image/jpeg', base64Data);
  });

  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send('Error');
  }
};
