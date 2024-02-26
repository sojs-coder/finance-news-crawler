require("dotenv").config();
const axios = require("axios");
const config = require("./config.json");
const { SentimentIntensityAnalyzer } = require("vader-sentiment")
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
  /*
  {
    "prompt": string,
    "temperature": float,
    "p": float,
    "k": float,
    "max_tokens": int,
    "stop_sequences": [string],
    "return_likelihoods": "GENERATION|ALL|NONE",
    "stream": boolean,
    "num_generations": int,
    "logit_bias": {token_id: bias},
    "truncate": "NONE|START|END"
}*/

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
        apiKey: config.NEWS_API_KEY,
        category: "business",
        language: "en",
        pageSize: 40,
      },
    });

    return response.data.articles.slice(20);
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

  const ticker = response.split(", ")[0];
  const sent = response.split(", ")[1];

  return [ticker, sent]
};

const crawlFinanceNews = async () => {
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
    console.log(scores)
  } catch (error) {
    console.error("Error crawling finance news:", error.message);
  }
};

(async () => {
  await crawlFinanceNews();
})()
