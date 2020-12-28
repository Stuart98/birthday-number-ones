const { cacheNumberOnes } = require('../services/Scraper');

exports.cacheNumberOnes = async (req, res, next) => {
  const { date } = req.query;

  const data = await cacheNumberOnes(date);

  res.status(200);

  return res.json({
    success: true,
    count: data.length
  });
};
