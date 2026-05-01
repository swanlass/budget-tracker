const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { Telegraf } = require('telegraf');

module.exports = async (req, res) => {
  console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
  const isCron = req.headers['x-vercel-cron'] === '1';
  const isTest = req.query && req.query.test === 'true';

  if (!isCron && !isTest) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
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

    const recurringSheet = doc.sheetsByTitle['Recurring payments'];
    const transactionSheet = doc.sheetsByTitle['Transactions'] || await doc.addSheet({ title: 'Transactions', headerValues: ['Date', 'User', 'Amount', 'Category', 'Description'] });

    if (!recurringSheet) {
      return res.status(404).send('Recurring payments tab not found');
    }

    const recurringRows = await recurringSheet.getRows();
    
    const timezone = process.env.TIMEZONE || 'America/Denver';
    const localDate = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const todayStr = `${year}-${month}-01`;

    let count = 0;
    for (const row of recurringRows) {
      const amountStr = (row.get('Amount') || '0').toString();
      const cleanAmount = amountStr.replace(/[^0-9.]/g, '');
      
      await transactionSheet.addRow({
        'Date': todayStr,
        'User': row.get('User') || 'Household',
        'Amount': cleanAmount,
        'Category': row.get('Category') || 'Recurring',
        'Description': row.get('Description') || ''
      });
      count++;
    }

    // Send notification to your Telegram
    const bot = new Telegraf(TELEGRAM_TOKEN);
    if (AUTHORIZED_USERS.length > 0) {
      await bot.telegram.sendMessage(AUTHORIZED_USERS[0], `🔄 *Recurring Payments Logged*\nSuccessfully inserted ${count} transactions for the new month.`, { parse_mode: 'Markdown' });
    }

    res.status(200).send(`Successfully logged ${count} transactions.`);
  } catch (error) {
    console.error(error);
    res.status(500).send(`Error: ${error.message}`);
  }
};
