var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var calendar = google.calendar('v3');
var User = require('../shared/models/GoogleCalendarUser');
var cache = require('../shared/lib/cache').getRedisClient();
var SCOPES = ['https://www.googleapis.com/auth/google_calendar.readonly'];
var AuthClient = 'google_calender';
var _ = require('underscore');
var logger = require('../shared/lib/log');

// Load client secrets from a config file.
var content = require('../shared/config/client_secret.json');

var getCalenderEvent = function(user){
    authorize(user, content, getEvents );
}
/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
 //User
function authorize(userdata, credentials, callback) {
    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];
    var auth = new googleAuth();
    var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);
    var user = userdata.user, client = userdata.client;
    // Check if we have previously stored a token.
    User.getUserAuthorisation(user, client)
        .then(function(u){
            //get token
            var token = u.token[0];
            logger.debug('Retrieved Token %s', token);
            oauth2Client.credentials = token;
            callback(oauth2Client);
        },getNewToken(user, client, oauth2Client, callback));
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(user, client, oauth2Client, callback) {
    var authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
    });
    logger.info('Authorize this app by visiting this url: ', authUrl);
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question('Enter the code from that page here: ', function(code) {
        rl.close();
        oauth2Client.getToken(code, function(err, token) {
            if (err) {
                logger.debug('Error while trying to retrieve access token', err);
                return;
            }
            oauth2Client.credentials = token;
            console.log(JSON.stringify(token) + 'Received token');
            // store user token to be used for later execution
            //
            User.updateUserAuthorisation(user, client, token)
                .then(function(result){
                    logger.debug('User %s google calender token %s saved', user,result)}, function(error){
                    logger.debug('Error %s', error);
                });
            callback(oauth2Client);
        });
    });
}

/**
 * Gets the next 10 events on the user's primary google_calendar.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function getEvents(auth) {
    calendar.events.list({
        auth: auth,
        calendarId: 'primary',
        timeMin: (new Date()).toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime'
    }, function(err, response) {
        if (err) {
            logger.debug('There was an error contacting the Calendar service: ' + err);
            return;
        }
        var events = response.items;
        if (events.length == 0) {
            logger.info('No upcoming events found.');
        } else {
            logger.debug(JSON.stringify(events));
            logger.info('Upcoming 10 events:');
            for (var i = 0; i < events.length; i++) {
                var event = events[i];
                var start = event.start.dateTime || event.start.date;
                logger.debug('%s - %s', start, event.summary);
            }
        }
    });
}
module.exports.getCalenderEvent = getCalenderEvent;