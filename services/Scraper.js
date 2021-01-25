const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');
const PromisePool = require('@supercharge/promise-pool');

// bring in the cached data once so it doesnt need re-read
const rawNumberOnesData = fs.readFileSync('./data/number-ones.json');
const numberOnesData = JSON.parse(rawNumberOnesData);

/**
 * Converts the full date picked from the website into a YYYY-MM-DD format.
 * @param {String} date Date in format `1 August 2020`
 * @returns {String} Date in the format `2020-8-1`
 */
function parseDate(date) {
  const split = date.split(' ').map((d) => d.trim());
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return `${split[2]}-${months.indexOf(split[1]) + 1}-${split[0]}`;
}

/**
 * Tries to turn the given string to sentence case. E.g. stuart ashworth => Stuart Ashworth.
 * Used to convert track and artist names from ALL CAPS.
 * @param {String} val String to convert
 * @returns {String} Sentence cased string
 */
function toSentenceCase(val) {
  try {
    return val.split(' ').map((s) => s[0].toUpperCase() + s.substring(1).toLowerCase()).join(' ');
  } catch (e) {
    return '';
  }
}

/**
 * Get the details of the number 1 for the specified date from OfficialCharts.com.
 * We parse the results and extract the artist, track name and cover.
 * The site also tells us the start/end dates of the chart week the given
 * date falls on, so we grab that too.
 * @param {String} year The year to look for
 * @param {String} month The (zero-padded) month to look for
 * @param {String} day The (zero-padded) day to look for
 */
async function getNumberOneRemote(year, month, day) {
  const date = `${year}${month}${day}`;
  const url = `https://www.officialcharts.com/charts/singles-chart/${date}`;

  const response = await axios.get(url);

  // Load the web page source code into a cheerio instance
  const $ = cheerio.load(response.data);

  const chartDate = $('.article-date').text().trim().split('-');
  const chartStartDate = chartDate[0].trim();
  const chartEndDate = chartDate[1].trim();
  const track = $('.chart tr.headings + tr .track .title-artist .title').text().trim();
  const artist = $('.chart tr.headings + tr .track .title-artist .artist').text().trim();
  const cover = $('.cover img').attr('src');

  return {
    date: `${year}-${month}-${day}`,
    actualChartStartDate: parseDate(chartStartDate),
    actualChartEndDate: parseDate(chartEndDate),
    track: toSentenceCase(track),
    artist: toSentenceCase(artist),
    cover,
    year,
    month,
    day,
  };
}

/**
 * We collected a full dataset and cached it in a local JSON file (see `cacheNumberOnes`) so
 * we try to grab the data from there.
 * We read the entire file (massive and slow :( ) then use the date as the lookup key.
 * @param {String} year The year to look for
 * @param {String} month The (zero-padded) month to look for
 * @param {String} day The (zero-padded) day to look for
 */
function getNumberOneLocal(year, month, day) {
  return numberOnesData[`${year}-${month}-${day}`];
}

/**
 * Returns the data for the number on the given date. This will try to get the
 * data from the local source, then if not found will fall back to grabbing it from
 * the live website.
 * @param {Number|String} year They year to look up (full 4 digits)
 * @param {Number|String} month The month, zero-padded or single
 * @param {Number|String} day The day, zero-padded or single
 */
async function getNumberOne(year, month, day) {
  month = `0${month}`.slice(-2);
  day = `0${day}`.slice(-2);

  let data = getNumberOneLocal(year, month, day);

  if (!data) {
    data = await getNumberOneRemote(year, month, day);
  }

  return data;
}

/**
 * Gets number 1 data for all years between the specified year and the current year.
 * @param {Number|String} year They year to look up (full 4 digits)
 * @param {Number|String} month The month, zero-padded or single
 * @param {Number|String} day The day, zero-padded or single
 */
async function getYearlyNumberOnes(year, month, day) {
  year = parseInt(year, 10);
  month = parseInt(month, 10);
  day = parseInt(day, 10);

  const now = new Date();
  let currentYear = now.getFullYear();
  const years = [];

  // if the month is later than the current month, then we obviously can't
  // get the number 1 for this year so we fall back to the previous year as the max
  if (month > now.getMonth()) {
    currentYear -= 1;
  }

  // create an array for each year (month and day are constant)
  while (year <= currentYear) {
    years.push(year);

    year += 1;
  }

  // generate an array of promises
  return Promise.all(years.map((y) => getNumberOne(y, month, day)));
}

/**
 * This function was used to cache the number ones for every date since the specified one,
 * so we could speed things up for future lookups by loading from local.
 * @param {String} date A date string in format 'YYYY-MM-DD'
 */
async function cacheNumberOnes(date) {
  const d = new Date(date.slice(0, 4), date.slice(4, 6), date.slice(6, 8));
  const now = new Date();
  const dates = [];

  // increment the date by 1 day until it equals today
  for (; d <= now; d.setDate(d.getDate() + 1)) {
    dates.push({
      year: d.getFullYear(),
      month: `0${d.getMonth()}`.slice(-2),
      day: `0${d.getDate()}`.slice(-2),
    });
  }

  // use a package called PromisePool to batch the fetches into groups of 100, to
  // prevent it all crashing and burning
  const { results } = await PromisePool
    .withConcurrency(100)
    .for(dates)
    .process(async (d) => getNumberOneRemote(d.year, d.month, d.day));

  // build an object with the date strings as the key
  const saveData = {};
  results.forEach((r) => {
    saveData[r.date] = r;
  });

  // save to a file
  fs.writeFileSync('./data/number-ones.json', JSON.stringify(saveData, null, 2));

  return results;
}

module.exports.getNumberOne = getNumberOne;
module.exports.getYearlyNumberOnes = getYearlyNumberOnes;
module.exports.cacheNumberOnes = cacheNumberOnes;
