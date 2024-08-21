const axios = require("axios");
const { JUPITER_V6_API } = require("./config");

async function getQuote(inputMint, outputMint, amount, slippageBps) {
  const response = await axios.get(`${JUPITER_V6_API}/quote`, {
    params: {
      inputMint,
      outputMint,
      amount,
      slippageBps,
    },
  });
  return response.data;
}

async function getSwapInstructions(quoteResponse, userPublicKey) {
  const response = await axios.post(`${JUPITER_V6_API}/swap-instructions`, {
    quoteResponse,
    userPublicKey,
    wrapUnwrapSOL: true,
  });
  return response.data;
}

module.exports = {
  getQuote,
  getSwapInstructions,
};
