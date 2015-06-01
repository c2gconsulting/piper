var google = require('googleapis');
var googleAuth = require('google-auth-library');
var calendar = google.calendar('v3');
var mq = require('../../shared/lib/mq');
var gmail = google.gmail('v1');
var User = require('../../shared/models/GoogleCalendarUser');
var cache = require('../../shared/lib/cache').getRedisClient();
var SCOPES = ['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.readonly'];
var _ = require('underscore');
var logger = require('../../shared/lib/log');
var when = require('when');
var CACHE_PREFIX = 'google-apps:';
// Load client secrets from a config file.
var credentials = require('../../shared/config/client_secret.json');
var clientSecret = credentials.web.client_secret;
var clientId = credentials.web.client_id;
var redirectUrl = credentials.web.redirect_uris[0];
/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.web
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
 //User
function authorize(userdata, callback) {
    var auth = new googleAuth();
    var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);
    var user = userdata.user, client = userdata.client;
    // Check if we have previously stored a token.
    User.getUserAuthorisation(user, client)
        .then(function(u){
            //get token
            if(u) {
                var token = u.token[0];
                logger.debug('Retrieved Token %s', token );
                oauth2Client.credentials = token;
                callback(oauth2Client);
            } else {
                getNewToken(user, client, oauth2Client, callback);
            }

        },function(e){
           logger.debug('Error %s', e);
        }

    );
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
    //add a state to auth url
    var state = user + '@' + client;
    callback('', authUrl + '&state=' + state);

}


/**
 * Gets the next 10 events on the user's primary google_calendar.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function getEvents(auth) {
    var promise = new Promise(function(resolve, reject){
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
            reject(err);
        } else {
            resolve(response);
        }
        });
        //if (events.length == 0) {
        //    logger.info('No upcoming events found.');
        //} else {
        //    logger.debug(JSON.stringify(events));
        //    logger.info('Upcoming 10 events:');
        //    for (var i = 0; i < events.length; i++) {
        //        var event = events[i];
        //        var start = event.start.dateTime || event.start.date;
        //        logger.debug('%s - %s', start, event.summary);
        //    }
        //}
    });
    return promise;
}

function valCode(code, user, client) {
    return new Promise(function (resolve, reject) {
        var auth = new googleAuth();
        var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);
        oauth2Client.getToken(code, function (err, token) {
            if (err) {
                logger.debug('Error while trying to retrieve access token', err);
                reject(err);
            } else {
                oauth2Client.credentials = token;
                // store user token to persistent storage, to be used for later execution
                    User.updateUserAuthorisation(user, client, token)
                        .then(function (result) {
                            logger.debug('User %s google calender token %s saved', user, result);
                            // update cache and notify handler main
                            // notify handler_main
                            var pub = mq.context.socket('PUB', {routing: 'topic'});
                            var qbody = { access_token : data.access_token };
                            var qdata = { id : new Date().getTime(), email : userdata.email, header: 'auth', body : qbody };
                            logger.info('UBER_ROUTES_AUTH: Connecting to MQ Exchange <piper.events.out>...');
                            pub.connect('piper.events.out', function() {
                                logger.info('UBER_ROUTES_AUTH: <piper.events.out> connected');
                                pub.publish('uber.routes', JSON.stringify(qdata));
                            });
                        }, function (error) {
                            logger.debug('Error %s', error);
                        });
                    resolve(oauth2Client);

            }

        });
    });

}

function getMailList(auth) {
    var promise = new Promise(function(resolve, reject){
        gmail.users.messages.list({
            'auth': auth,
            'userId': 'me',
            'labelIds': 'IMPORTANT',
            'maxResults': 20
        }, function(err, response) {
            if (err) {
                logger.error('There was an error contacting the Gmail service: ' + err);
                reject(err);
            } else {
                resolve(response);
            }
        });
        //if (events.length == 0) {
        //    logger.info('No upcoming events found.');
        //} else {
        //    logger.debug(JSON.stringify(events));
        //    logger.info('Upcoming 10 events:');
        //    for (var i = 0; i < events.length; i++) {
        //        var event = events[i];
        //        var start = event.start.dateTime || event.start.date;
        //        logger.debug('%s - %s', start, event.summary);
        //    }
        //}
    });
    return promise;
}
function readMail(auth, id) {
    var promise = new Promise(function(resolve, reject){
        logger.debug('Readmail method called');
        gmail.users.messages.get({
            auth: auth,
            id: id,
            userId: 'me',
            format: 'full'
        }, function(err, response){
            if (err) {
                logger.error('Error occurred' + err);
                reject(err);
            } else {
                logger.debug('Response received');
                resolve(response);
            }
        })
    });
    return promise;
}


module.exports.authorize = authorize;
module.exports.getEvents = getEvents;
module.exports.getMailList = getMailList;
module.exports.readMail = readMail;
module.exports.valCode = valCode;