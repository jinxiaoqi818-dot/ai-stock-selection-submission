module.exports = (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    status: "ok",
    service: "ai-stock-selection-submission",
    fuyaoConfigured: Boolean(process.env.FUYAO_API_KEY),
  });
};
