/**
 * Module dependencies.
 */
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const bodyParser = require('body-parser');
const errorHandler = require('errorhandler');
const dotenv = require('dotenv');
const path = require('path');
const handlebars = require('express-handlebars');
const passport = require('passport');
const SpotifyStrategy = require('passport-spotify').Strategy;
const SpotifyWebApi = require('spotify-web-api-node');
const session = require('express-session');

const { getYearlyNumberOnes } = require('./services/Scraper');

/**
 * Load environment variables from .env file, where API keys and passwords are configured.
 */
dotenv.config({ path: '.env' });

/**
 * Controllers (route handlers).
 */
// const apiController = require('./controllers/api');

/**
 * Create Express server.
 */
const app = express();

const baseUrl = process.env.BASE_URL || 'http://localhost';
const port = process.env.PORT || 3000;
const authCallbackPath = '/auth/spotify/callback';

/**
 * Express configuration.
 */
const sessionOptions = {
  secret: process.env.SESSION_SECRET,
  cookie: {
    maxAge: 269999999999
  },
  saveUninitialized: true,
  resave: true
};
app.use(session(sessionOptions));
app.set('host', '0.0.0.0');
app.set('port', port);
app.set('views', path.join(__dirname, 'views'));
app.engine('handlebars', handlebars());
app.set('view engine', 'handlebars');
app.disable('x-powered-by');
app.use(compression());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');

  next();
});

// initialise passport and session
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((obj, done) => {
  done(null, obj);
});

passport.use(new SpotifyStrategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: `${baseUrl}${authCallbackPath}`
},
(accessToken, refreshToken, expiresIn, profile, done) => {
  return done(null, {
    accessToken
  });
}));


/**
 * Helpers
 */
/**
 * Saves the date and playlist name to the session when authorising Spotify so we
 * can get it later
 */
function saveBirthdayToSession(req, res, next) {
  const { date, name } = req.query;
  req.session.date = date;
  req.session.name = name;

  // write to the log in place of actual analytics :)
  try {
    fs.appendFileSync('access_log.txt', `\n${(new Date()).toLocaleDateString()} ${(new Date()).toLocaleTimeString()}: Spotify Playlist Create: ${date} - ${name}`);
  } catch (e) {
    console.log(e);
  }

  next();
}

/**
 * Primary app routes.
 */
// disable this for now cos we only to the cache every now and again.
// Uncomment `apiController` require above when using
// app.get('/cacheNumberOnes', apiController.cacheNumberOnes);

// GET /create-spotify-playlist
// route to trigger Spotify authorisation.
app.get('/create-spotify-playlist',
  saveBirthdayToSession,
  passport.authenticate('spotify', {
    scope: ['playlist-modify-private'],
    showDialog: true,
  }));

// GET /auth/spotify/callback
// callback after successful Spotify auth. Now we can hit Spotify API
// to create the playlist and populate it with the right tracks
app.get(authCallbackPath,
  passport.authenticate('spotify', { failureRedirect: '/' }),
  async (req, res) => {
    const spotifyApi = new SpotifyWebApi({
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: `http://localhost:${port}${authCallbackPath}`
    });
    spotifyApi.setAccessToken(req.session.passport.user.accessToken);

    // grab date and playlist name from the session
    const { date, name } = req.session;

    const dateSplit = date.split('-');
    const year = dateSplit[0];
    const month = dateSplit[1];
    const day = dateSplit[2];

    try {
      // get number 1s - ideally these get cached on the first run
      const data = await getYearlyNumberOnes(year, month, day);

      // create the Spotify Playlist
      const playlistData = await spotifyApi.createPlaylist(name || `My Birthday Playlist - ${date}`, { description: '', public: false });

      const playlistId = playlistData.body.id;

      // perform a Spotify search for each of the tracks
      const tracksResults = await Promise.all(data.map((d) => spotifyApi.searchTracks(`artist:${d.artist} track:${d.track}`)));

      // get the URI for each track. we just skip over searches that gave no results.
      const trackURIs = tracksResults.map((response) => (response.body.tracks.items.length > 0 ? response.body.tracks.items[0].uri : false)).filter((t) => !!t); // eslint-disable-line max-len

      // add all the tracks to the playlist
      await spotifyApi.addTracksToPlaylist(playlistId, trackURIs);

      // redirect to the playlist's web page
      res.redirect(playlistData.body.external_urls.spotify);
    } catch (e) {
      console.error(e);
      res.status(500).send('Server Error');
    }
  });

// GET / (optional date string appended - `/1990-01-01)
// renders the home page and, if a date is present, it runs the lookup and displays the results.
app.get('/:date?', async (req, res) => {
  const { date } = req.params;
  let data = [];

  if (date) {
    try {
      fs.appendFileSync('access_log.txt', `\n${(new Date()).toLocaleDateString()} ${(new Date()).toLocaleTimeString()}: Track Fetch: ${date}`);
    } catch (e) {
      console.log(e);
    }

    const dateSplit = date.split('-');
    const year = dateSplit[0];
    const month = dateSplit[1];
    const day = dateSplit[2];

    try {
      data = await getYearlyNumberOnes(year, month, day);
    } catch (e) {
      data = [];
      console.log(e);
    }
  }

  res.render('home', {
    hasResults: data.length > 0,
    date,
    data,
  });
});

// POST /
// handles the homepage form post. it extracts the date value and redirects to the GET homepage.
app.post('/', async (req, res) => {
  const { date } = req.body;

  // redirect to the home route to pull results and render
  res.redirect(`/${date}`);
});


/**
 * Error Handler.
 */
if (process.env.NODE_ENV === 'development') {
  // only use in development
  app.use(errorHandler());
} else {
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Server Error');
  });
}

app.use(express.static(`${__dirname}/public`));

/**
 * Start Express server.
 */
app.listen(app.get('port'), () => {
  console.log('%s App is running at http://localhost:%s in %s mode', '', app.get('port'), app.get('env'));
  console.log('  Press CTRL-C to stop\n');
});

module.exports = app;
