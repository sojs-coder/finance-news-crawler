require("dotenv").config();
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const quote = require('stock-quote');

const inv = "investments";
const moves = "moves";
const db = new sqlite3.Database("finance.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS ${inv} (
    ticker TEXT PRIMARY KEY,
    currency TEXT,
    shares INTEGER,
    basis REAL,
    date TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS ${moves} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    shares INTEGER,
    price REAL,
    date TEXT
  )`);
});
async function buyMove(ticker) {
  const res = await axios.get("https://api.polygon.io/v2/aggs/ticker/" + ticker + "/prev?adjusted=true&apiKey=" + process.env.POLYGON_API_KEY)
  const { data } = res;
  const currentPrice = data.results[0].c;
  var date = new Date().toISOString();
  db.run(`INSERT INTO ${moves} (ticker, shares, price, date) VALUES (?, ?, ?, ?)`, [ticker, 1, currentPrice, date]);
  db.get(`SELECT * FROM ${inv} WHERE ticker = ?`, [ticker], (err, row) => {
    if (row) {
      var newBasis = (row.basis * row.shares + currentPrice) / (row.shares + 1);
      db.run(`UPDATE ${inv} SET shares = shares + 1, basis = ? WHERE ticker = ?`, [newBasis, ticker]);
    } else {
      db.run(`INSERT INTO ${inv} (ticker, currency, shares, basis, date) VALUES (?, ?, ?, ?, ?)`, [ticker, data.currency, 1, currentPrice, date]);
    }
  });
}
async function sellMove(ticker) {
  const res = await axios.get("https://api.polygon.io/v2/aggs/ticker/" + ticker + "/prev?adjusted=true&apiKey=" + process.env.POLYGON_API_KEY)
  const { data } = res;
  const currentPrice = data.results[0].c;
  var date = new Date().toISOString();
  db.run(`INSERT INTO ${moves} (ticker, shares, price, date) VALUES (?, ?, ?, ?)`, [ticker, -1, currentPrice, date]);
  db.get(`SELECT * FROM ${inv} WHERE ticker = ?`, [ticker], (err, row) => {
    if (row) {
      if (row.shares >= 1) {
        var newBasis = (row.basis * row.shares - currentPrice) / (row.shares - 1);
        db.run(`UPDATE ${inv} SET shares = shares - 1, basis = ? WHERE ticker = ?`, [newBasis, ticker]);
      }
    }
  });
}
const AWS = require("aws-sdk");
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const bedrockClient = new AWS.BedrockRuntime({ region: "us-east-1" });

function ask(promptText) {
  const modelId = "cohere.command-text-v14"; // Model ID for LLaMA 13B Chat

  const payload = JSON.stringify({
    prompt: promptText,
    temperature: 0.5, // Adjust for creativity
    p: 0.9, // Adjust for coherence,
    max_tokens: 10,
    stop_sequences: ["Headline: ", "Bot: "]
  });

  return bedrockClient.invokeModel({
    modelId,
    "contentType": "application/json",
    "accept": "application/json",
    "body": payload
  })
    .promise()
    .then((response) => {
      var { body } = response;
      body = JSON.parse(body.toString());
      return body.generations[0].text;
    })
    .catch((error) => console.error("Error invoking model:", error));
}

const getTopHeadlines = async () => {
  try {
    const response = await axios.get("https://newsapi.org/v2/top-headlines", {
      params: {
        apiKey: process.env.NEWS_API_KEY,
        category: "business",
        language: "en",
        pageSize: 100,
      },
    });

    return response.data.articles;
  } catch (error) {
    console.error("Error fetching top headlines:", error.message);
    return [];
  }
};

const analyzeSentiment = async (articleTitle) => {
  const prompt = `The following is a report from a robot that analyzes news headlines for tickers and sentiment (one of "bearish", "bullish", or "neutral").
If no stock ticker can be derived from the headline, the bot uses "---, ---".

Headline: Why is everyone talking about rivian stock?
Bot: RIVN, bullish, people talk about rivian

Headline: JSW Energy, Godrej Properties among top 4 trading ideas which could give 11-21% in 3-4 weeks: Rajesh Palvi
Bot: JSWENERGY, bullish, JSW energy top 4 trading idea

Headline: Berkshire Hathaway Stock Rally Could Stall After Earnings Report
Bot: BRK.A, bullish, Berkshire hathaway stock expected to rally

Headline: VinFast breaks ground on its first EV manufacturing unit in India
Bot: VFS, bullish, VinFast pushing production nationwide

Headline: Stocks to Buy: 6 Stocks that can deliver returns of up to 65%
Bot: ---, ---, The stocks are unknown

Headline: Top Wall Street analysts pick these dividend stocks for enhanced returns
Bot: ---, ---, The stocks are unkown

Headline: Inside a clean energy titan's fight to kill a climate project
Bot: ---, ---, The stock is unkown

Headline: Rivian stock expected to fall amid shortages
Bot: RIVN, bearish, Rivian stock expected to fall

Headline: ${articleTitle}
Bot: `
  const response = await ask(prompt);

  const ticker = (response.split(", ")[0] || "---").toUpperCase();
  const sent = (response.split(", ")[1] || "---").toLowerCase();

  return [ticker, sent]
};
const crawlFinanceNews = async () => {
  const buys = [];
  const sells = [];
  const scores = {
  }
  try {
    const articles = await getTopHeadlines();

    for (const article of articles) {
      const articleTitle = article.title;
      var [ticker, sent] = await analyzeSentiment(articleTitle);
      if (ticker !== "---" && sent !== "---") {
        if (!scores[ticker]) {
          scores[ticker] = {
            bearish: 0,
            bullish: 0,
            neutral: 0
          }
        }
        scores[ticker][sent]++;
      }
      console.log(ticker + " | " + sent + " | " + articleTitle)
    }
    Object.keys(scores).forEach((ticker) => {
      var { bearish, bullish, neutral } = scores[ticker];
      if (bullish > bearish && bullish > neutral) {
        console.log("Bullish: " + ticker);
        buys.push(ticker);
      } else if (bearish > bullish && bearish > neutral) {
        console.log("Bearish: " + ticker);
        sells.push(ticker);
      }
    });

    console.log("Buys: ", buys);
    console.log("Sells: ", sells);
    console.log("Initiating moves");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // sleep 20 seconds in between each move
    for (const ticker of buys) {
      console.log("MOVE - BUY: " + ticker);
      try {
        await buyMove(ticker);
      } catch (err) {
        console.log("Error buying: " + ticker + " - " + err.message);
      }
      await sleep(20000);
    }
    for (const ticker of sells) {
      console.log("MOVE - SELL: " + ticker);
      try {
        await sellMove(ticker);
      } catch (err) {
        console.log("Error selling: " + ticker + " - " + err.message);
      }
      await sleep(20000);
    }
  } catch (error) {
    console.error("Error crawling finance news:", error.message);
  }
};

(async () => {
  await crawlFinanceNews();
})()
